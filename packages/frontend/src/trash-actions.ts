import { Effect } from "effect";

import type { ApiClientService, ApiError } from "./api.ts";

export interface TrashMutation {
  readonly documentId: string;
  readonly expectedRevision: number;
}

/**
 * Runs a Trash action at the revision the list shows. The list comes from
 * the catalog, which can trail edits by a moment, so a revision conflict
 * retries once at the document's current revision: restoring or deleting
 * acts on the whole document, whatever its latest edit.
 */
export function atCurrentRevision<A>(
  api: Pick<ApiClientService, "readDocument">,
  mutation: TrashMutation,
  run: (expectedRevision: number) => Effect.Effect<A, ApiError>,
): Effect.Effect<A, ApiError> {
  return run(mutation.expectedRevision).pipe(
    Effect.catchIf(
      (error) => error.code === "revision_conflict",
      () =>
        api
          .readDocument(mutation.documentId)
          .pipe(Effect.flatMap((document) => run(document.metadata.headRevision))),
    ),
  );
}
