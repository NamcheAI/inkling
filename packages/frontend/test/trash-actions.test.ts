import assert from "node:assert/strict";
import test from "node:test";

import { Effect, Either } from "effect";

import type { DocumentResponse } from "@earendil-works/inkling-protocol";

import { ApiError } from "../src/api.ts";
import { atCurrentRevision } from "../src/trash-actions.ts";

const conflict = new ApiError({
  code: "revision_conflict",
  message: "The document changed.",
  retryable: false,
  status: 409,
});

function documentAt(headRevision: number): DocumentResponse {
  return {
    body: "",
    comments: { revision: 0, threads: [] },
    metadata: {
      approvers: [],
      authors: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      headRevision,
      id: "doc_0123456789",
      labels: [],
      lifecycleState: "draft",
      relatedDocuments: [],
      reviewers: [],
      sharing: { access: "disabled", generation: 0 },
      title: "Trashed",
      updatedAt: "2026-01-01T00:00:00.000Z",
      visibility: "private",
    },
    sequence: headRevision,
  };
}

test("Trash actions retry once at the current revision when the list trailed an edit", async () => {
  const attempts: number[] = [];
  const result = await Effect.runPromise(
    atCurrentRevision(
      { readDocument: () => Effect.succeed(documentAt(7)) },
      { documentId: "doc_0123456789", expectedRevision: 5 },
      (revision) => {
        attempts.push(revision);
        return revision === 7 ? Effect.succeed("restored") : Effect.fail(conflict);
      },
    ),
  );
  assert.equal(result, "restored");
  assert.deepEqual(attempts, [5, 7]);
});

test("Trash actions report a second conflict and other failures as they are", async () => {
  const attempts: number[] = [];
  const repeated = await Effect.runPromise(
    Effect.either(
      atCurrentRevision(
        { readDocument: () => Effect.succeed(documentAt(7)) },
        { documentId: "doc_0123456789", expectedRevision: 5 },
        (revision) => {
          attempts.push(revision);
          return Effect.fail(conflict);
        },
      ),
    ),
  );
  assert.ok(Either.isLeft(repeated));
  assert.deepEqual(attempts, [5, 7]);

  const forbidden = new ApiError({
    code: "forbidden",
    message: "No.",
    retryable: false,
    status: 403,
  });
  const refused = await Effect.runPromise(
    Effect.either(
      atCurrentRevision(
        { readDocument: () => assert.fail("a refusal is not retried") },
        { documentId: "doc_0123456789", expectedRevision: 5 },
        () => Effect.fail(forbidden),
      ),
    ),
  );
  assert.ok(Either.isLeft(refused) && refused.left.code === "forbidden");
});
