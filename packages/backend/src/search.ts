import { Effect, Layer, Schema } from "effect";

import {
  chunkMarkdown,
  passageEmbeddingText,
  reciprocalRankFusion,
  SearchIndex,
  StorageError,
} from "@earendil-works/inkling-core";
import type {
  DigestService,
  DocumentId,
  DocumentRevision,
  EmbedderService,
  KeywordQuery,
  PassageMatchKind,
  SearchDatabaseService,
  SearchIndexService,
  SearchPassage,
  SearchVariant,
  SqlRow,
  SqlStatement,
  SqlValue,
  VectorMatch,
  VectorStoreService,
} from "@earendil-works/inkling-core";

/**
 * SQLite search projection shared by the Node and Cloudflare runtimes.
 *
 * Passages live in `search_chunks` with their text in the FTS5 table
 * `search_text` under the same rowid. Embeddings are optional: each passage
 * carries a digest of the text its embedding is computed from, and
 * `search_vectors` records which digests the vector store holds for the
 * current model, so unchanged passages are never embedded twice and edits only
 * cost the passages they touch.
 */

const schemaStatements: readonly SqlStatement[] = [
  {
    sql: `CREATE TABLE IF NOT EXISTS search_documents (
      document_id TEXT NOT NULL,
      variant TEXT NOT NULL,
      revision INTEGER NOT NULL,
      content_digest TEXT NOT NULL,
      indexed_at INTEGER NOT NULL,
      PRIMARY KEY (document_id, variant)
    )`,
  },
  {
    sql: `CREATE TABLE IF NOT EXISTS search_chunks (
      id INTEGER PRIMARY KEY,
      document_id TEXT NOT NULL,
      variant TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      heading_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      digest TEXT NOT NULL
    )`,
  },
  {
    sql: "CREATE INDEX IF NOT EXISTS search_chunks_document ON search_chunks (document_id, variant)",
  },
  { sql: "CREATE INDEX IF NOT EXISTS search_chunks_digest ON search_chunks (digest)" },
  {
    sql: `CREATE VIRTUAL TABLE IF NOT EXISTS search_text USING fts5(
      title, heading, body, tokenize = 'unicode61 remove_diacritics 2'
    )`,
  },
  {
    sql: `CREATE TABLE IF NOT EXISTS search_vectors (
      vector_id TEXT PRIMARY KEY,
      digest TEXT NOT NULL,
      model TEXT NOT NULL
    )`,
  },
  { sql: "CREATE INDEX IF NOT EXISTS search_vectors_digest ON search_vectors (digest, model)" },
];

const textEncoder = new TextEncoder();
const keywordCandidateLimit = 200;
const semanticCandidateLimit = 50;
const embeddingBatchesPerRefresh = 8;
const orphanBatchSize = 500;
const snippetCharacters = 320;

export interface SemanticSearchConfiguration {
  readonly embedder: EmbedderService;
  readonly vectors: VectorStoreService;
}

export interface SqlSearchIndexOptions {
  readonly database: SearchDatabaseService;
  readonly digest: DigestService;
  readonly semantic?: SemanticSearchConfiguration | undefined;
  readonly now?: (() => number) | undefined;
}

export function makeSqlSearchIndex(
  options: SqlSearchIndexOptions,
): Effect.Effect<SearchIndexService, StorageError> {
  return Effect.gen(function* () {
    const { database, digest, semantic } = options;
    const now = options.now ?? Date.now;
    yield* database.batch(schemaStatements);
    const writeLock = yield* Effect.makeSemaphore(1);
    const locked = writeLock.withPermits(1);
    const sha256 = (text: string) => digest.sha256(textEncoder.encode(text));

    const indexedRevision: SearchIndexService["indexedRevision"] = (documentId, variant) =>
      database
        .query("SELECT revision FROM search_documents WHERE document_id = ? AND variant = ?", [
          documentId,
          variant,
        ])
        .pipe(
          Effect.map((rows) => {
            const revision = rows[0]?.["revision"];
            return typeof revision === "number" ? (revision as DocumentRevision) : undefined;
          }),
        );

    const indexDocument: SearchIndexService["indexDocument"] = (input) =>
      locked(
        Effect.gen(function* () {
          const contentDigest = yield* sha256(`${input.title}\u0000${input.body}`);
          const existing = yield* database.query(
            "SELECT revision, content_digest FROM search_documents WHERE document_id = ? AND variant = ?",
            [input.documentId, input.variant],
          );
          const stored = existing[0];
          if (stored !== undefined) {
            const storedRevision = Number(stored["revision"]);
            if (storedRevision > input.revision) return;
            if (stored["content_digest"] === contentDigest) {
              if (storedRevision !== input.revision) {
                yield* database.batch([
                  {
                    params: [input.revision, input.documentId, input.variant],
                    sql: "UPDATE search_documents SET revision = ? WHERE document_id = ? AND variant = ?",
                  },
                ]);
              }
              return;
            }
          }
          const chunks = chunkMarkdown(input.body);
          const digests = yield* Effect.forEach(chunks, (chunk) =>
            sha256(passageEmbeddingText(input.title, chunk)),
          );
          const statements: SqlStatement[] = [
            ...removeStatements(input.documentId, input.variant),
            {
              params: [input.documentId, input.variant, input.revision, contentDigest, now()],
              sql: `INSERT INTO search_documents (document_id, variant, revision, content_digest, indexed_at)
                VALUES (?, ?, ?, ?, ?)`,
            },
          ];
          chunks.forEach((chunk, index) => {
            statements.push(
              {
                params: [
                  input.documentId,
                  input.variant,
                  chunk.ordinal,
                  JSON.stringify(chunk.headingPath),
                  chunk.startLine,
                  chunk.endLine,
                  digests[index] ?? "",
                ],
                sql: `INSERT INTO search_chunks (document_id, variant, ordinal, heading_path, start_line, end_line, digest)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`,
              },
              {
                params: [input.title, chunk.headingPath.join(" "), chunk.text],
                sql: "INSERT INTO search_text (rowid, title, heading, body) VALUES (last_insert_rowid(), ?, ?, ?)",
              },
            );
          });
          yield* database.batch(statements);
        }),
      );

    const matchDocuments: SearchIndexService["matchDocuments"] = (query, variant) => {
      const expression = keywordExpression(query, "content");
      if (expression === undefined) return Effect.succeed(new Set<DocumentId>());
      return database
        .query(
          `SELECT DISTINCT c.document_id AS document_id
            FROM search_text JOIN search_chunks c ON c.id = search_text.rowid
            WHERE search_text MATCH ? AND c.variant = ?`,
          [expression, variant],
        )
        .pipe(
          Effect.map(
            (rows) => new Set(rows.map((row) => String(row["document_id"]) as DocumentId)),
          ),
        );
    };

    const excerpts: SearchIndexService["excerpts"] = (query, variant, documentIds) => {
      const expression = keywordExpression({ ...query, match: "any" }, "content");
      if (expression === undefined || documentIds.length === 0) {
        return Effect.succeed(new Map<DocumentId, string>());
      }
      return database
        .query(
          `SELECT c.document_id AS document_id, snippet(search_text, 2, '', '', '…', 24) AS snippet
            FROM search_text JOIN search_chunks c ON c.id = search_text.rowid
            WHERE search_text MATCH ? AND c.variant = ?
              AND c.document_id IN (SELECT value FROM json_each(?))
            ORDER BY bm25(search_text, 0.0, 2.0, 1.0)`,
          [expression, variant, JSON.stringify(documentIds)],
        )
        .pipe(
          Effect.map((rows) => {
            const result = new Map<DocumentId, string>();
            for (const row of rows) {
              const documentId = String(row["document_id"]) as DocumentId;
              if (!result.has(documentId)) {
                result.set(documentId, plainExcerpt(String(row["snippet"] ?? "")));
              }
            }
            return result;
          }),
        );
    };

    const keywordPassages = (
      query: KeywordQuery,
      variant: SearchVariant,
      documentIds: readonly DocumentId[] | undefined,
    ): Effect.Effect<readonly PassageRow[], StorageError> => {
      const expression = keywordExpression(query, "all");
      if (expression === undefined) return Effect.succeed([]);
      const restriction =
        documentIds === undefined ? "" : "AND c.document_id IN (SELECT value FROM json_each(?))";
      const params: SqlValue[] = [expression, variant];
      if (documentIds !== undefined) params.push(JSON.stringify(documentIds));
      params.push(keywordCandidateLimit);
      return database
        .query(
          `SELECT c.id AS id, c.document_id AS document_id, c.heading_path AS heading_path,
              c.start_line AS start_line, c.end_line AS end_line, d.revision AS revision,
              search_text.title AS title,
              snippet(search_text, 2, '', '', '…', 40) AS snippet
            FROM search_text
            JOIN search_chunks c ON c.id = search_text.rowid
            JOIN search_documents d ON d.document_id = c.document_id AND d.variant = c.variant
            WHERE search_text MATCH ? AND c.variant = ? ${restriction}
            ORDER BY bm25(search_text, 2.0, 3.0, 1.0)
            LIMIT ?`,
          params,
        )
        .pipe(Effect.map((rows) => rows.map((row) => passageRow(row))));
    };

    const semanticPassages = (
      configuration: SemanticSearchConfiguration,
      text: string,
      variant: SearchVariant,
      documentIds: readonly DocumentId[] | undefined,
    ): Effect.Effect<readonly PassageRow[], StorageError> =>
      Effect.gen(function* () {
        const [vector] = yield* configuration.embedder.embed([text], "query");
        if (vector === undefined) return [];
        const matches = yield* configuration.vectors.query(vector, semanticCandidateLimit);
        if (matches.length === 0) return [];
        const rank = new Map(matches.map((match: VectorMatch, index) => [match.id, index]));
        const restriction =
          documentIds === undefined ? "" : "AND c.document_id IN (SELECT value FROM json_each(?))";
        const params: SqlValue[] = [
          JSON.stringify(matches.map((match) => match.id)),
          configuration.embedder.model,
          variant,
        ];
        if (documentIds !== undefined) params.push(JSON.stringify(documentIds));
        const rows = yield* database.query(
          `SELECT c.id AS id, c.document_id AS document_id, c.heading_path AS heading_path,
              c.start_line AS start_line, c.end_line AS end_line, d.revision AS revision,
              t.title AS title, substr(t.body, 1, ${snippetCharacters * 2}) AS snippet,
              v.vector_id AS vector_id
            FROM search_vectors v
            JOIN search_chunks c ON c.digest = v.digest
            JOIN search_text t ON t.rowid = c.id
            JOIN search_documents d ON d.document_id = c.document_id AND d.variant = c.variant
            WHERE v.vector_id IN (SELECT value FROM json_each(?)) AND v.model = ?
              AND c.variant = ? ${restriction}`,
          params,
        );
        return rows
          .map((row) => ({ rank: rank.get(String(row["vector_id"])) ?? matches.length, row }))
          .toSorted(
            (left, right) =>
              left.rank - right.rank || Number(left.row["id"]) - Number(right.row["id"]),
          )
          .map(({ row }) => passageRow(row, leadingSnippet));
      });

    const searchPassages: SearchIndexService["searchPassages"] = (request) =>
      Effect.gen(function* () {
        if (request.documentIds !== undefined && request.documentIds.length === 0) return [];
        const keyword =
          request.keyword === undefined
            ? []
            : yield* keywordPassages(request.keyword, request.variant, request.documentIds);
        const semanticText = request.semantic?.trim() ?? "";
        const vectorHits =
          semantic === undefined || semanticText.length === 0
            ? []
            : yield* semanticPassages(
                semantic,
                semanticText,
                request.variant,
                request.documentIds,
              ).pipe(
                // Keyword results stay useful when the embedding provider is down.
                Effect.tapError((error) =>
                  Effect.logWarning("Semantic search unavailable", error.message),
                ),
                Effect.orElseSucceed((): readonly PassageRow[] => []),
              );
        const byId = new Map<number, PassageRow & { matchedBy: Set<PassageMatchKind> }>();
        for (const [kind, rows] of [
          ["keyword", keyword],
          ["semantic", vectorHits],
        ] as const) {
          for (const row of rows) {
            const existing = byId.get(row.id);
            if (existing === undefined) byId.set(row.id, { ...row, matchedBy: new Set([kind]) });
            else existing.matchedBy.add(kind);
          }
        }
        const scores = reciprocalRankFusion([
          keyword.map((row) => row.id),
          vectorHits.map((row) => row.id),
        ]);
        const perDocument = new Map<string, number>();
        const passages: SearchPassage[] = [];
        for (const [id, score] of [...scores.entries()].toSorted(
          (left, right) => right[1] - left[1] || left[0] - right[0],
        )) {
          const row = byId.get(id);
          if (row === undefined) continue;
          const count = perDocument.get(row.documentId) ?? 0;
          if (count >= request.perDocumentLimit) continue;
          perDocument.set(row.documentId, count + 1);
          passages.push({
            documentId: row.documentId,
            endLine: row.endLine,
            headingPath: row.headingPath,
            matchedBy: [...row.matchedBy].toSorted(),
            revision: row.revision,
            score,
            snippet: row.snippet,
            startLine: row.startLine,
            title: row.title,
            variant: request.variant,
          });
          if (passages.length >= request.limit) break;
        }
        return passages;
      });

    const embedPending = (
      configuration: SemanticSearchConfiguration,
      quietBefore: number,
    ): Effect.Effect<number, StorageError> =>
      Effect.gen(function* () {
        const batchSize = Math.max(1, Math.min(configuration.embedder.maxBatchSize, 64));
        let embedded = 0;
        for (let batch = 0; batch < embeddingBatchesPerRefresh; batch += 1) {
          const pending = yield* database.query(
            `SELECT c.digest AS digest, MIN(c.id) AS id
              FROM search_chunks c
              JOIN search_documents d ON d.document_id = c.document_id AND d.variant = c.variant
              WHERE d.indexed_at <= ?
                AND NOT EXISTS (
                  SELECT 1 FROM search_vectors v WHERE v.digest = c.digest AND v.model = ?
                )
              GROUP BY c.digest
              LIMIT ?`,
            [quietBefore, configuration.embedder.model, batchSize],
          );
          if (pending.length === 0) break;
          const texts = yield* database.query(
            `SELECT c.id AS id, c.heading_path AS heading_path, t.title AS title, t.body AS body
              FROM search_chunks c JOIN search_text t ON t.rowid = c.id
              WHERE c.id IN (SELECT value FROM json_each(?))`,
            [JSON.stringify(pending.map((row) => Number(row["id"])))],
          );
          const textById = new Map(
            texts.map((row) => [
              Number(row["id"]),
              passageEmbeddingText(String(row["title"] ?? ""), {
                headingPath: decodeHeadingPath(row["heading_path"]),
                text: String(row["body"] ?? ""),
              }),
            ]),
          );
          const work = pending.flatMap((row) => {
            const text = textById.get(Number(row["id"]));
            return text === undefined ? [] : [{ digest: String(row["digest"]), text }];
          });
          if (work.length === 0) break;
          const vectors = yield* configuration.embedder.embed(
            work.map((item) => item.text),
            "document",
          );
          const records = yield* Effect.forEach(work, (item, index) =>
            sha256(`${configuration.embedder.model}\u0000${item.digest}`).pipe(
              Effect.map((vectorId) => ({
                digest: item.digest,
                id: vectorId,
                values: vectors[index] ?? new Float32Array(),
              })),
            ),
          );
          const usable = records.filter((record) => record.values.length > 0);
          yield* configuration.vectors.upsert(usable);
          yield* database.batch(
            usable.map((record) => ({
              params: [record.id, record.digest, configuration.embedder.model],
              sql: "INSERT OR REPLACE INTO search_vectors (vector_id, digest, model) VALUES (?, ?, ?)",
            })),
          );
          embedded += usable.length;
          if (pending.length < batchSize) break;
        }
        return embedded;
      });

    const collectOrphans = (
      configuration: SemanticSearchConfiguration,
    ): Effect.Effect<void, StorageError> =>
      Effect.gen(function* () {
        const orphans = yield* database.query(
          `SELECT v.vector_id AS vector_id FROM search_vectors v
            WHERE v.model <> ? OR NOT EXISTS (SELECT 1 FROM search_chunks c WHERE c.digest = v.digest)
            LIMIT ?`,
          [configuration.embedder.model, orphanBatchSize],
        );
        if (orphans.length === 0) return;
        const ids = orphans.map((row) => String(row["vector_id"]));
        yield* configuration.vectors.delete(ids);
        yield* database.batch([
          {
            params: [JSON.stringify(ids)],
            sql: "DELETE FROM search_vectors WHERE vector_id IN (SELECT value FROM json_each(?))",
          },
        ]);
      });

    const pendingCount = (configuration: SemanticSearchConfiguration) =>
      database
        .query(
          `SELECT COUNT(DISTINCT c.digest) AS pending FROM search_chunks c
            WHERE NOT EXISTS (
              SELECT 1 FROM search_vectors v WHERE v.digest = c.digest AND v.model = ?
            )`,
          [configuration.embedder.model],
        )
        .pipe(Effect.map((rows) => Number(rows[0]?.["pending"] ?? 0)));

    const service: SearchIndexService = {
      clear: locked(
        database.batch([
          { sql: "DELETE FROM search_text" },
          { sql: "DELETE FROM search_chunks" },
          { sql: "DELETE FROM search_documents" },
        ]),
      ),
      enabled: true,
      excerpts,
      indexDocument,
      indexedRevision,
      matchDocuments,
      refresh: (quietBefore) =>
        semantic === undefined
          ? Effect.succeed({ embedded: 0, pending: 0 })
          : Effect.gen(function* () {
              const embedded = yield* embedPending(semantic, quietBefore);
              yield* collectOrphans(semantic);
              return { embedded, pending: yield* pendingCount(semantic) };
            }),
      removeDocument: (documentId, variant) =>
        locked(database.batch(removeStatements(documentId, variant))),
      searchPassages,
      semantic: semantic !== undefined,
    };
    return service;
  });
}

export function sqlSearchIndexLayer(
  options: SqlSearchIndexOptions,
): Layer.Layer<SearchIndexService, StorageError> {
  return Layer.effect(SearchIndex, makeSqlSearchIndex(options));
}

/** For runtimes whose authority never answers search queries, such as Cloudflare document objects. */
export const disabledSearchIndex: SearchIndexService = {
  clear: Effect.void,
  enabled: false,
  excerpts: () => Effect.succeed(new Map()),
  indexDocument: () => Effect.void,
  indexedRevision: () => Effect.succeed(undefined),
  matchDocuments: () => Effect.succeed(new Set()),
  refresh: () => Effect.succeed({ embedded: 0, pending: 0 }),
  removeDocument: () => Effect.void,
  searchPassages: () => Effect.succeed([]),
  semantic: false,
};

export const DisabledSearchIndexLive = Layer.succeed(SearchIndex, disabledSearchIndex);

/**
 * Exact nearest-neighbour search over int8-quantized unit vectors kept in the
 * search database and cached in memory. Adequate for tens of thousands of
 * passages; hosted vector databases replace it at larger scale.
 */
export function makeSqlVectorStore(
  database: SearchDatabaseService,
): Effect.Effect<VectorStoreService, StorageError> {
  return Effect.gen(function* () {
    yield* database.batch([
      {
        sql: "CREATE TABLE IF NOT EXISTS search_vector_values (id TEXT PRIMARY KEY, vector BLOB NOT NULL)",
      },
    ]);
    let cache: Map<string, Int8Array> | undefined;
    const load = Effect.suspend(() =>
      cache !== undefined
        ? Effect.succeed(cache)
        : database.query("SELECT id, vector FROM search_vector_values").pipe(
            Effect.map((rows) => {
              const loaded = new Map<string, Int8Array>();
              for (const row of rows) {
                const vector = row["vector"];
                if (vector instanceof Uint8Array) {
                  loaded.set(
                    String(row["id"]),
                    new Int8Array(vector.buffer, vector.byteOffset, vector.byteLength),
                  );
                }
              }
              cache = loaded;
              return loaded;
            }),
          ),
    );
    return {
      delete: (ids) =>
        database
          .batch([
            {
              params: [JSON.stringify(ids)],
              sql: "DELETE FROM search_vector_values WHERE id IN (SELECT value FROM json_each(?))",
            },
          ])
          .pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                for (const id of ids) cache?.delete(id);
              }),
            ),
          ),
      query: (vector, topK) =>
        load.pipe(
          Effect.map((vectors) => {
            const query = quantize(vector);
            const matches: VectorMatch[] = [];
            for (const [id, candidate] of vectors) {
              if (candidate.length !== query.length) continue;
              let dot = 0;
              for (let index = 0; index < query.length; index += 1) {
                dot += (query[index] ?? 0) * (candidate[index] ?? 0);
              }
              matches.push({ id, score: dot / (127 * 127) });
            }
            return matches.toSorted((left, right) => right.score - left.score).slice(0, topK);
          }),
        ),
      upsert: (records) => {
        const quantized = records.map((record) => ({
          id: record.id,
          vector: quantize(record.values),
        }));
        return database
          .batch(
            quantized.map((record) => ({
              params: [
                record.id,
                new Uint8Array(
                  record.vector.buffer,
                  record.vector.byteOffset,
                  record.vector.byteLength,
                ),
              ],
              sql: "INSERT OR REPLACE INTO search_vector_values (id, vector) VALUES (?, ?)",
            })),
          )
          .pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                for (const record of quantized) cache?.set(record.id, record.vector);
              }),
            ),
          );
      },
    };
  });
}

const OpenAiEmbeddingsSchema = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({ embedding: Schema.Array(Schema.Number), index: Schema.Number }),
  ),
});

export interface OpenAiCompatibleEmbedderOptions {
  /** Base URL of an OpenAI-compatible API, such as http://localhost:11434/v1 for Ollama. */
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string | undefined;
  readonly fetch?: typeof fetch | undefined;
}

/** Embeddings from any OpenAI-compatible `/embeddings` endpoint, local or hosted. */
export function makeOpenAiCompatibleEmbedder(
  options: OpenAiCompatibleEmbedderOptions,
): EmbedderService {
  const request = options.fetch ?? fetch;
  const endpoint = `${options.baseUrl.replace(/\/+$/u, "")}/embeddings`;
  return {
    embed: (texts) =>
      texts.length === 0
        ? Effect.succeed([])
        : Effect.tryPromise({
            catch: (cause) => embeddingFailure("request embeddings", cause),
            try: async () => {
              const response = await request(endpoint, {
                body: JSON.stringify({ input: texts, model: options.model }),
                headers: {
                  "Content-Type": "application/json",
                  ...(options.apiKey === undefined
                    ? {}
                    : { Authorization: `Bearer ${options.apiKey}` }),
                },
                method: "POST",
              });
              if (!response.ok) {
                throw new Error(`Embedding endpoint returned HTTP ${response.status}.`);
              }
              return (await response.json()) as unknown;
            },
          }).pipe(
            Effect.flatMap((payload) =>
              Schema.decodeUnknown(OpenAiEmbeddingsSchema)(payload).pipe(
                Effect.mapError((cause) => embeddingFailure("decode embeddings", cause)),
              ),
            ),
            Effect.flatMap((decoded) => {
              const ordered = decoded.data.toSorted((left, right) => left.index - right.index);
              return ordered.length === texts.length
                ? Effect.succeed(ordered.map((item) => Float32Array.from(item.embedding)))
                : Effect.fail(
                    embeddingFailure(
                      "decode embeddings",
                      new Error("The embedding endpoint returned the wrong number of vectors."),
                    ),
                  );
            }),
          ),
    maxBatchSize: 32,
    model: `openai-compatible:${options.model}`,
  };
}

export function embeddingFailure(operation: string, cause: unknown): StorageError {
  return new StorageError({
    cause,
    message: `The embedding provider failed while attempting to ${operation}.`,
    operation,
    retryable: true,
  });
}

interface PassageRow {
  readonly id: number;
  readonly documentId: DocumentId;
  readonly headingPath: readonly string[];
  readonly startLine: number;
  readonly endLine: number;
  readonly revision: DocumentRevision;
  readonly title: string;
  readonly snippet: string;
}

function removeStatements(documentId: string, variant?: SearchVariant): SqlStatement[] {
  const scope =
    variant === undefined
      ? { params: [documentId], where: "document_id = ?" }
      : { params: [documentId, variant], where: "document_id = ? AND variant = ?" };
  return [
    {
      params: scope.params,
      sql: `DELETE FROM search_text WHERE rowid IN (SELECT id FROM search_chunks WHERE ${scope.where})`,
    },
    { params: scope.params, sql: `DELETE FROM search_chunks WHERE ${scope.where}` },
    { params: scope.params, sql: `DELETE FROM search_documents WHERE ${scope.where}` },
  ];
}

function passageRow(row: SqlRow, snippet: (text: string) => string = (text) => text): PassageRow {
  return {
    documentId: String(row["document_id"]) as DocumentId,
    endLine: Number(row["end_line"]),
    headingPath: decodeHeadingPath(row["heading_path"]),
    id: Number(row["id"]),
    revision: Number(row["revision"]) as DocumentRevision,
    snippet: snippet(collapseWhitespace(String(row["snippet"] ?? ""))),
    startLine: Number(row["start_line"]),
    title: String(row["title"] ?? ""),
  };
}

function decodeHeadingPath(value: SqlValue | undefined): readonly string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Builds an FTS5 expression from normalized phrases. Normalized text holds
 * only letters, numbers, and single spaces, so quoting is always safe; the
 * trailing `*` keeps the prefix matching people expect while typing.
 */
export function keywordExpression(
  query: KeywordQuery,
  columns: "all" | "content",
): string | undefined {
  const phrases = query.phrases
    .map((phrase) => phrase.split(/\s+/u).filter((token) => token.length > 0))
    .filter((tokens) => tokens.length > 0)
    .map((tokens) => `"${tokens.join(" ").replaceAll('"', "")}"*`);
  if (phrases.length === 0) return undefined;
  const combined = phrases.join(query.match === "all" ? " AND " : " OR ");
  return columns === "content" ? `{heading body} : (${combined})` : combined;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function leadingSnippet(value: string): string {
  if (value.length <= snippetCharacters) return value;
  const cut = value.lastIndexOf(" ", snippetCharacters);
  return `${value.slice(0, cut > snippetCharacters / 2 ? cut : snippetCharacters)}…`;
}

function plainExcerpt(value: string): string {
  return value
    .replace(/[^\p{Letter}\p{Number}\s…]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
}

function quantize(vector: Float32Array): Int8Array {
  let norm = 0;
  for (const value of vector) norm += value * value;
  const scale = norm === 0 ? 0 : 127 / Math.sqrt(norm);
  const quantized = new Int8Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    quantized[index] = Math.max(-127, Math.min(127, Math.round((vector[index] ?? 0) * scale)));
  }
  return quantized;
}
