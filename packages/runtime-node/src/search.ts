import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";

import { Effect, Layer } from "effect";

import {
  makeOpenAiCompatibleEmbedder,
  makeSqlSearchIndex,
  makeSqlVectorStore,
} from "@earendil-works/inkling-backend";
import type { OpenAiCompatibleEmbedderOptions } from "@earendil-works/inkling-backend";
import { Digest, SearchIndex, StorageError } from "@earendil-works/inkling-core";
import type {
  DigestService,
  SearchDatabaseService,
  SearchIndexService,
  SqlRow,
  SqlValue,
} from "@earendil-works/inkling-core";

export interface NodeSearchOptions {
  /** Semantic search through an OpenAI-compatible embeddings endpoint; omitted means keyword only. */
  readonly embeddings?: OpenAiCompatibleEmbedderOptions | undefined;
}

/** Reads `INKLING_EMBEDDINGS_URL`, `INKLING_EMBEDDINGS_MODEL`, and `INKLING_EMBEDDINGS_API_KEY`. */
export function embeddingsFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): OpenAiCompatibleEmbedderOptions | undefined {
  const baseUrl = environment["INKLING_EMBEDDINGS_URL"]?.trim();
  const model = environment["INKLING_EMBEDDINGS_MODEL"]?.trim();
  if (baseUrl === undefined || baseUrl === "" || model === undefined || model === "") {
    return undefined;
  }
  const apiKey = environment["INKLING_EMBEDDINGS_API_KEY"]?.trim();
  return { apiKey: apiKey === "" ? undefined : apiKey, baseUrl, model };
}

/** Opens `search.sqlite` in the data directory for the lifetime of the layer. */
export function searchIndexLayer(
  dataDirectory: string,
  options: NodeSearchOptions = {},
): Layer.Layer<SearchIndexService, StorageError, DigestService> {
  return Layer.scoped(
    SearchIndex,
    Effect.gen(function* () {
      const digest = yield* Digest;
      const database = yield* Effect.acquireRelease(
        sqliteCall("open search database", () =>
          openSqliteSearchDatabase(path.join(dataDirectory, "search.sqlite")),
        ),
        (opened) => Effect.sync(() => opened.close()),
      );
      const semantic =
        options.embeddings === undefined
          ? undefined
          : {
              embedder: makeOpenAiCompatibleEmbedder(options.embeddings),
              vectors: yield* makeSqlVectorStore(database.service),
            };
      return yield* makeSqlSearchIndex({ database: database.service, digest, semantic });
    }),
  );
}

export interface SqliteSearchDatabase {
  readonly service: SearchDatabaseService;
  readonly close: () => void;
}

export function openSqliteSearchDatabase(filename: string): SqliteSearchDatabase {
  if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  const statements = new Map<string, StatementSync>();
  const prepare = (sql: string): StatementSync => {
    const cached = statements.get(sql);
    if (cached !== undefined) return cached;
    const statement = database.prepare(sql);
    statements.set(sql, statement);
    return statement;
  };
  const service: SearchDatabaseService = {
    batch: (batch) =>
      sqliteCall("write search index", () => {
        database.exec("BEGIN IMMEDIATE");
        try {
          for (const statement of batch) {
            prepare(statement.sql).run(...((statement.params ?? []) as SqlValue[]));
          }
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      }),
    query: (sql, params = []) =>
      sqliteCall(
        "query search index",
        () => prepare(sql).all(...(params as SqlValue[])) as unknown as readonly SqlRow[],
      ),
  };
  return { close: () => database.close(), service };
}

function sqliteCall<A>(operation: string, run: () => A): Effect.Effect<A, StorageError> {
  return Effect.try({
    catch: (cause) =>
      new StorageError({
        cause,
        message: `The search database failed while attempting to ${operation}.`,
        operation,
        retryable: false,
      }),
    try: run,
  });
}
