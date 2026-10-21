import { Data, Effect } from "effect";

export class ClipboardError extends Data.TaggedError("ClipboardError")<{
  readonly cause: unknown;
  readonly message: string;
}> {}

/** Copies text to the clipboard; fails when the browser denies access. */
export function copyText(text: string): Effect.Effect<void, ClipboardError> {
  return Effect.tryPromise({
    catch: (cause) =>
      new ClipboardError({ cause, message: "The browser did not allow copying to the clipboard." }),
    try: () => navigator.clipboard.writeText(text),
  });
}
