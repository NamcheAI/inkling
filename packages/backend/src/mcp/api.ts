import { Data, Effect, Schema } from "effect";

import { CatalogResponseSchema, ProtocolErrorSchema } from "@earendil-works/inkling-protocol";

/**
 * Routes one ordinary Inkling HTTP request and returns its response.
 *
 * MCP tools never call the application service directly. Each tool call is
 * translated into the same `/api` requests the browser and CLI send, carrying
 * the caller's own bearer token, and handed to the runtime's router. On Node
 * that is the backend application itself; on Cloudflare it is the Worker
 * router, which forwards document operations to the owning document
 * authority. Authorization therefore stays with the operation handlers, and
 * the MCP layer cannot reach anything the caller could not reach with
 * `fetch()`.
 */
export type McpDispatch = (request: Request) => Promise<Response>;

export class InklingApiError extends Data.TaggedError("InklingApiError")<{
  readonly code: string;
  readonly currentRevision?: number | undefined;
  readonly message: string;
  readonly status: number;
}> {}

export class ToolInputError extends Data.TaggedError("ToolInputError")<{
  readonly message: string;
}> {}

export interface InklingApi {
  /** Public origin of the workspace, used for links shown to the user. */
  readonly origin: string;
  readonly request: <A, I>(
    method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT",
    path: string,
    schema: Schema.Schema<A, I>,
    body?: unknown,
  ) => Effect.Effect<A, InklingApiError>;
}

export function makeInklingApi(
  dispatch: McpDispatch,
  origin: string,
  bearerToken: string,
): InklingApi {
  return {
    origin,
    request: (method, path, schema, body) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          catch: () =>
            new InklingApiError({
              code: "dispatch_failed",
              message: "The Inkling request could not be routed.",
              status: 503,
            }),
          try: () =>
            dispatch(
              new Request(new URL(path, origin), {
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                headers: {
                  Accept: "application/json",
                  Authorization: `Bearer ${bearerToken}`,
                  ...(body === undefined ? {} : { "Content-Type": "application/json" }),
                },
                method,
              }),
            ),
        });
        const payload = yield* Effect.tryPromise({
          catch: () =>
            new InklingApiError({
              code: "invalid_response",
              message: `Inkling returned an unreadable response (${response.status}).`,
              status: response.status,
            }),
          try: () => response.json() as Promise<unknown>,
        });
        if (!response.ok) {
          const error = yield* Schema.decodeUnknown(ProtocolErrorSchema)(payload).pipe(
            Effect.mapError(
              () =>
                new InklingApiError({
                  code: "request_failed",
                  message: `Inkling rejected the request (${response.status}).`,
                  status: response.status,
                }),
            ),
          );
          return yield* Effect.fail(
            new InklingApiError({
              code: error.code,
              currentRevision: error.currentRevision,
              message: error.message,
              status: response.status,
            }),
          );
        }
        return yield* Schema.decodeUnknown(schema)(payload).pipe(
          Effect.mapError(
            () =>
              new InklingApiError({
                code: "invalid_response",
                message: "Inkling returned an unexpected response.",
                status: 502,
              }),
          ),
        );
      }),
  };
}

export function documentPath(documentId: string, suffix = ""): string {
  return `/api/documents/${encodeURIComponent(documentId)}${suffix}`;
}

/**
 * Resolves the document references agents are given by people: a document
 * ID, an RFC number (`57`, `0057`, `RFC 57`, `rfc:57`), or a complete Inkling
 * URL on this workspace's origin. RFC numbers are looked up in the catalog the
 * caller can see, so a number never resolves to a document they cannot read.
 */
export function resolveDocumentId(
  api: InklingApi,
  reference: string,
): Effect.Effect<string, InklingApiError | ToolInputError> {
  return Effect.gen(function* () {
    const value = reference.trim();
    const parsed = yield* parseDocumentReference(value, api.origin);
    if (parsed.kind === "id") return parsed.documentId;
    const catalog = yield* api.request(
      "GET",
      `/api/documents?q=${encodeURIComponent(`rfc:${parsed.rfcNumber}`)}`,
      CatalogResponseSchema,
    );
    const match = catalog.documents.find(
      (candidate) => candidate.metadata.rfcNumber === parsed.rfcNumber,
    );
    if (match === undefined) {
      return yield* new ToolInputError({
        message: `${formatRfcNumber(parsed.rfcNumber)} does not exist or is not visible to you.`,
      });
    }
    return match.metadata.id;
  });
}

export type DocumentReference =
  | { readonly kind: "id"; readonly documentId: string }
  | { readonly kind: "rfc"; readonly rfcNumber: number };

export function parseDocumentReference(
  value: string,
  origin: string,
): Effect.Effect<DocumentReference, ToolInputError> {
  const rfc = /^(?:rfc[\s:#-]*)?(\d{1,9})$/iu.exec(value);
  if (rfc?.[1] !== undefined) return rfcReference(rfc[1]);
  if (!/^https?:\/\//iu.test(value)) {
    return /^[A-Za-z0-9_-]{1,200}$/u.test(value)
      ? Effect.succeed({ documentId: value, kind: "id" })
      : Effect.fail(
          new ToolInputError({
            message: "Pass a document ID, an RFC number, or a complete Inkling URL.",
          }),
        );
  }
  const url = URL.parse(value);
  if (url === null) {
    return Effect.fail(new ToolInputError({ message: "The document URL is invalid." }));
  }
  if (url.host !== new URL(origin).host) {
    return Effect.fail(
      new ToolInputError({
        message: `The URL belongs to ${url.host}, but this Inkling MCP server serves ${new URL(origin).host}.`,
      }),
    );
  }
  const direct = /^\/(?:public\/documents|documents|share)\/([^/]+)(?:\/edit)?\/?$/u.exec(
    url.pathname,
  );
  if (direct?.[1] !== undefined) {
    const encoded = direct[1];
    return Effect.try({
      catch: () => new ToolInputError({ message: "The document URL is invalid." }),
      try: () => ({ documentId: decodeURIComponent(encoded), kind: "id" as const }),
    });
  }
  const routed = /^\/(?:rfcs?\/)?(\d{1,9})(?:\/[^/]*)?\/?$/u.exec(url.pathname);
  if (routed?.[1] !== undefined) return rfcReference(routed[1]);
  return Effect.fail(
    new ToolInputError({ message: "The URL is not a supported Inkling document URL." }),
  );
}

function rfcReference(digits: string): Effect.Effect<DocumentReference, ToolInputError> {
  const rfcNumber = Number(digits);
  return Number.isSafeInteger(rfcNumber) && rfcNumber > 0
    ? Effect.succeed({ kind: "rfc", rfcNumber })
    : Effect.fail(new ToolInputError({ message: "RFC numbers are positive integers." }));
}

export function formatRfcNumber(rfcNumber: number): string {
  return `RFC ${String(rfcNumber).padStart(4, "0")}`;
}
