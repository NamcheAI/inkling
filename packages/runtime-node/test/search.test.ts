import assert from "node:assert/strict";
import test from "node:test";

import { Effect } from "effect";

import {
  DigestLive,
  makeSqlSearchIndex,
  makeSqlVectorStore,
} from "@earendil-works/inkling-backend";
import { Digest, documentId, documentRevision } from "@earendil-works/inkling-core";
import type { DocumentId, EmbedderService, SearchIndexService } from "@earendil-works/inkling-core";

import { openSqliteSearchDatabase } from "../src/search.ts";

const storage = `---
state: draft
---
# Storage design

Intro to the storage design.

## Durability

Every accepted edit reaches the journal before acknowledgement.

## Recovery

A checkpoint plus the journal tail recovers acknowledged edits.
`;

const vehicles = `# Fleet

## Vehicles

The automobile pool is shared between teams.
`;

// Maps words onto a few concept axes so tests can assert semantic matches deterministically.
const concepts: Readonly<Record<string, number>> = {
  automobile: 0,
  car: 0,
  checkpoint: 1,
  journal: 2,
  recovery: 1,
  recovers: 1,
  restore: 1,
};

function fakeEmbedder(calls: string[][]): EmbedderService {
  return {
    embed: (texts) =>
      Effect.sync(() => {
        calls.push([...texts]);
        return texts.map((text) => {
          const vector = new Float32Array(4).fill(0.01);
          for (const word of text.toLowerCase().split(/[^a-z]+/u)) {
            const axis = concepts[word];
            if (axis !== undefined) vector[axis] = (vector[axis] ?? 0) + 1;
          }
          return vector;
        });
      }),
    maxBatchSize: 16,
    model: "fake:concepts",
  };
}

function withIndex<A>(
  run: (
    index: SearchIndexService,
    ids: { storage: DocumentId; vehicles: DocumentId },
    clock: { now: number },
  ) => Effect.Effect<A, unknown>,
  semantic?: EmbedderService,
): Promise<A> {
  const database = openSqliteSearchDatabase(":memory:");
  const clock = { now: 1_000 };
  return Effect.runPromise(
    Effect.gen(function* () {
      const digest = yield* Digest;
      const index = yield* makeSqlSearchIndex({
        database: database.service,
        digest,
        now: () => clock.now,
        semantic:
          semantic === undefined
            ? undefined
            : { embedder: semantic, vectors: yield* makeSqlVectorStore(database.service) },
      });
      const ids = {
        storage: yield* documentId("doc_storage"),
        vehicles: yield* documentId("doc_vehicles"),
      };
      return yield* run(index, ids, clock);
    }).pipe(
      Effect.provide(DigestLive),
      Effect.ensuring(Effect.sync(() => database.close())),
    ) as Effect.Effect<A>,
  );
}

const indexBoth = (index: SearchIndexService, ids: { storage: DocumentId; vehicles: DocumentId }) =>
  Effect.gen(function* () {
    yield* index.indexDocument({
      body: storage,
      documentId: ids.storage,
      revision: yield* documentRevision(3),
      title: "Storage design",
      variant: "working",
    });
    yield* index.indexDocument({
      body: vehicles,
      documentId: ids.vehicles,
      revision: yield* documentRevision(1),
      title: "Fleet",
      variant: "working",
    });
  });

test("keyword search finds documents, excerpts, and passages with line ranges", () =>
  withIndex((index, ids) =>
    Effect.gen(function* () {
      yield* indexBoth(index, ids);

      assert.deepEqual(
        [...(yield* index.matchDocuments({ match: "all", phrases: ["acknowledg"] }, "working"))],
        [ids.storage],
      );
      assert.deepEqual(
        [
          ...(yield* index.matchDocuments(
            { match: "all", phrases: ["journal", "fleet"] },
            "working",
          )),
        ],
        [],
      );
      assert.equal(
        (yield* index.matchDocuments({ match: "all", phrases: ["journal"] }, "published")).size,
        0,
      );
      const excerpts = yield* index.excerpts({ match: "any", phrases: ["checkpoint"] }, "working", [
        ids.storage,
      ]);
      assert.match(excerpts.get(ids.storage) ?? "", /checkpoint plus the journal tail/u);

      const passages = yield* index.searchPassages({
        keyword: { match: "any", phrases: ["journal"] },
        limit: 10,
        perDocumentLimit: 3,
        variant: "working",
      });
      assert.deepEqual(
        passages.map((passage) => [passage.headingPath.at(-1), passage.startLine, passage.endLine]),
        [
          ["Durability", 8, 10],
          ["Recovery", 12, 14],
        ],
      );
      assert.equal(passages[0]?.revision, 3);
      assert.deepEqual(passages[0]?.matchedBy, ["keyword"]);
      assert.match(passages[0]?.snippet ?? "", /journal/u);

      const limited = yield* index.searchPassages({
        keyword: { match: "any", phrases: ["journal"] },
        limit: 10,
        perDocumentLimit: 1,
        variant: "working",
      });
      assert.equal(limited.length, 1);
      const restricted = yield* index.searchPassages({
        documentIds: [ids.vehicles],
        keyword: { match: "any", phrases: ["journal"] },
        limit: 10,
        perDocumentLimit: 3,
        variant: "working",
      });
      assert.deepEqual(restricted, []);
    }),
  ));

test("index updates are monotonic and removals are idempotent", () =>
  withIndex((index, ids) =>
    Effect.gen(function* () {
      yield* indexBoth(index, ids);
      yield* index.indexDocument({
        body: "# Storage design\n\nObsolete draft about tapes.",
        documentId: ids.storage,
        revision: yield* documentRevision(2),
        title: "Storage design",
        variant: "working",
      });
      assert.equal(yield* index.indexedRevision(ids.storage, "working"), 3);
      assert.equal(
        (yield* index.matchDocuments({ match: "all", phrases: ["tapes"] }, "working")).size,
        0,
      );

      yield* index.indexDocument({
        body: "# Storage design\n\nNow about tapes.",
        documentId: ids.storage,
        revision: yield* documentRevision(4),
        title: "Storage design",
        variant: "working",
      });
      assert.equal(
        (yield* index.matchDocuments({ match: "all", phrases: ["journal"] }, "working")).size,
        0,
      );
      assert.equal(
        (yield* index.matchDocuments({ match: "all", phrases: ["tapes"] }, "working")).size,
        1,
      );

      yield* index.removeDocument(ids.storage);
      yield* index.removeDocument(ids.storage);
      assert.equal(yield* index.indexedRevision(ids.storage, "working"), undefined);
      yield* index.clear;
      assert.equal(yield* index.indexedRevision(ids.vehicles, "working"), undefined);
    }),
  ));

test("semantic search embeds settled passages once and fuses with keyword hits", async () => {
  const calls: string[][] = [];
  await withIndex(
    (index, ids, clock) =>
      Effect.gen(function* () {
        assert.equal(index.semantic, true);
        yield* indexBoth(index, ids);

        // Passages are embedded only after the document has been quiet.
        assert.deepEqual(yield* index.refresh(clock.now - 1), { embedded: 0, pending: 4 });
        clock.now += 20_000;
        const first = yield* index.refresh(clock.now - 10_000);
        assert.equal(first.embedded, 4);
        assert.equal(first.pending, 0);
        assert.equal((yield* index.refresh(clock.now)).embedded, 0);

        const semanticOnly = yield* index.searchPassages({
          keyword: { match: "any", phrases: ["car"] },
          limit: 3,
          perDocumentLimit: 3,
          semantic: "car",
          variant: "working",
        });
        assert.equal(semanticOnly[0]?.documentId, ids.vehicles);
        assert.deepEqual(semanticOnly[0]?.matchedBy, ["semantic"]);

        const fused = yield* index.searchPassages({
          keyword: { match: "any", phrases: ["checkpoint"] },
          limit: 3,
          perDocumentLimit: 3,
          semantic: "restore",
          variant: "working",
        });
        assert.equal(fused[0]?.headingPath.at(-1), "Recovery");
        assert.deepEqual(fused[0]?.matchedBy, ["keyword", "semantic"]);

        // Editing one section re-embeds only that passage; the old vector is collected.
        const embeddedBefore = calls.flat().length;
        yield* index.indexDocument({
          body: vehicles.replace("shared between teams", "reserved for visitors"),
          documentId: ids.vehicles,
          revision: yield* documentRevision(2),
          title: "Fleet",
          variant: "working",
        });
        clock.now += 20_000;
        assert.deepEqual(yield* index.refresh(clock.now - 10_000), { embedded: 1, pending: 0 });
        assert.equal(calls.flat().length - embeddedBefore, 1);
      }),
    fakeEmbedder(calls),
  );
});
