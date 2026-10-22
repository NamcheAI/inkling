import { Effect, Schema } from "effect";

import { embeddingFailure } from "@earendil-works/inkling-backend";
import { StorageError } from "@earendil-works/inkling-core";
import type {
  EmbedderService,
  SearchDatabaseService,
  SqlRow,
  SqlValue,
  VectorStoreService,
} from "@earendil-works/inkling-core";

export const defaultEmbeddingModel = "@cf/baai/bge-base-en-v1.5";

/** The workspace Durable Object's SQLite database, which supports FTS5 and JSON1. */
export function makeDurableObjectSearchDatabase(
  storage: DurableObjectStorage,
): SearchDatabaseService {
  return {
    batch: (statements) =>
      sqlCall("write search index", () =>
        storage.transactionSync(() => {
          for (const statement of statements) {
            storage.sql.exec(statement.sql, ...bindings(statement.params ?? []));
          }
        }),
      ),
    query: (sql, params = []) =>
      sqlCall("query search index", () =>
        storage.sql
          .exec(sql, ...bindings(params))
          .toArray()
          .map((row): SqlRow =>
            Object.fromEntries(
              Object.entries(row).map(([key, value]) => [
                key,
                value instanceof ArrayBuffer ? new Uint8Array(value) : value,
              ]),
            ),
          ),
      ),
  };
}

const WorkersAiEmbeddingsSchema = Schema.Struct({
  data: Schema.Array(Schema.Array(Schema.Number)),
});

/** Embeddings from a Workers AI text embedding model such as `@cf/baai/bge-base-en-v1.5`. */
export function makeWorkersAiEmbedder(ai: Ai, model = defaultEmbeddingModel): EmbedderService {
  const run = ai.run.bind(ai) as unknown as (
    model: string,
    input: { readonly text: readonly string[] },
  ) => Promise<unknown>;
  return {
    embed: (texts) =>
      texts.length === 0
        ? Effect.succeed([])
        : Effect.tryPromise({
            catch: (cause) => embeddingFailure("request Workers AI embeddings", cause),
            try: () => run(model, { text: texts }),
          }).pipe(
            Effect.flatMap((payload) =>
              Schema.decodeUnknown(WorkersAiEmbeddingsSchema)(payload).pipe(
                Effect.mapError((cause) => embeddingFailure("decode Workers AI embeddings", cause)),
              ),
            ),
            Effect.flatMap((decoded) =>
              decoded.data.length === texts.length
                ? Effect.succeed(decoded.data.map((vector) => Float32Array.from(vector)))
                : Effect.fail(
                    embeddingFailure(
                      "decode Workers AI embeddings",
                      new Error("Workers AI returned the wrong number of vectors."),
                    ),
                  ),
            ),
          ),
    maxBatchSize: 32,
    model: `workers-ai:${model}`,
  };
}

/** A Vectorize index created with the embedding model's dimensions and the cosine metric. */
export function makeVectorizeStore(index: Vectorize): VectorStoreService {
  return {
    delete: (ids) =>
      ids.length === 0
        ? Effect.void
        : sqlCall("delete Vectorize vectors", () => index.deleteByIds([...ids]), true).pipe(
            Effect.asVoid,
          ),
    query: (vector, topK) =>
      sqlCall(
        "query Vectorize",
        () =>
          index.query(vector, {
            returnMetadata: "none",
            returnValues: false,
            topK: Math.min(topK, 100),
          }),
        true,
      ).pipe(
        Effect.map((result) =>
          result.matches.map((match) => ({ id: match.id, score: match.score })),
        ),
      ),
    upsert: (vectors) =>
      vectors.length === 0
        ? Effect.void
        : sqlCall(
            "upsert Vectorize vectors",
            () => index.upsert(vectors.map((vector) => ({ id: vector.id, values: vector.values }))),
            true,
          ).pipe(Effect.asVoid),
  };
}

function bindings(params: readonly SqlValue[]): readonly (string | number | null | ArrayBuffer)[] {
  return params.map((value) =>
    value instanceof Uint8Array
      ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
      : value,
  ) as readonly (string | number | null | ArrayBuffer)[];
}

function sqlCall<A>(
  operation: string,
  run: () => A | Promise<A>,
  retryable = false,
): Effect.Effect<A, StorageError> {
  return Effect.tryPromise({
    catch: (cause) =>
      new StorageError({
        cause,
        message: `Cloudflare search storage failed while attempting to ${operation}.`,
        operation,
        retryable,
      }),
    try: async () => run(),
  });
}
