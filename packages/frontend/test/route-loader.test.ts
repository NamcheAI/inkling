import assert from "node:assert/strict";
import test from "node:test";

import { Effect, Either } from "effect";

import type { AuthenticationStatus } from "@earendil-works/inkling-protocol";

import { makeApiClient, makeAuthenticationCache } from "../src/api.ts";
import { loadRoute } from "../src/route-loader.ts";
import type { RouteEnvironment } from "../src/route-loader.ts";
import { signInHref } from "../src/ui.ts";

const forbidden = {
  code: "forbidden",
  message: "The current principal may not perform read-published on this document.",
  retryable: false,
};

function environment(responses: Readonly<Record<string, Response>>): RouteEnvironment {
  return {
    api: (capabilityToken) =>
      makeApiClient(capabilityToken, (path) =>
        Promise.resolve(
          responses[path]?.clone() ??
            Response.json(
              { code: "not_found", message: "Missing.", retryable: false },
              { status: 404 },
            ),
        ),
      ),
    preloadDocumentScreen: () => Promise.resolve(),
  };
}

async function routeError(
  path: string,
  authentication: AuthenticationStatus,
  responses: Readonly<Record<string, Response>> = {},
): Promise<{ readonly code: string; readonly message: string }> {
  const loaded = await Effect.runPromise(
    Effect.either(
      loadRoute(
        new URL(`https://inkling.test${path}`),
        environment({ "/api/auth/status": Response.json(authentication), ...responses }),
      ),
    ),
  );
  assert.ok(Either.isLeft(loaded), "the route fails");
  return { code: loaded.left.code, message: loaded.left.message };
}

test("anonymous readers of a private document are asked to sign in", async () => {
  const error = await routeError(
    "/documents/doc_0123456789",
    { authenticated: false },
    {
      "/api/documents/doc_0123456789?published=true": Response.json(forbidden, { status: 403 }),
    },
  );
  assert.deepEqual(error, {
    code: "sign_in_required",
    message: "Sign in to open this document.",
  });
});

test("signed-in readers without access are told so without authorization internals", async () => {
  const error = await routeError(
    "/documents/doc_0123456789/edit",
    {
      authenticated: true,
      principal: { displayName: "Ada", email: "ada@example.com", id: "ada", role: "member" },
    },
    { "/api/documents/doc_0123456789": Response.json(forbidden, { status: 403 }) },
  );
  assert.deepEqual(error, {
    code: "forbidden",
    message: "Your account cannot open this document.",
  });
});

test("anonymous readers of an RFC that is not public are asked to sign in", async () => {
  const error = await routeError(
    "/rfc/0012",
    { authenticated: false },
    {
      "/api/public/documents?q=12": Response.json({ documents: [], people: [] }),
    },
  );
  assert.equal(error.code, "sign_in_required");
});

test("sign-in returns to the page that asked for it", () => {
  assert.equal(
    signInHref(new URL("https://inkling.test/documents/doc_0123456789/edit?cap=x#intro")),
    `/api/auth/google/start?next=${encodeURIComponent("/documents/doc_0123456789/edit?cap=x#intro")}`,
  );
});

test("the browser remembers the authentication status until a request is refused", async () => {
  const authentication = makeAuthenticationCache();
  const requests: string[] = [];
  let sessionEnded = false;
  const document = {
    body: "# Remembered",
    comments: { revision: 0, threads: [] },
    metadata: {
      approvers: [],
      authors: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      headRevision: 1,
      id: "doc_0123456789",
      labels: [],
      lifecycleState: "draft",
      relatedDocuments: [],
      reviewers: [],
      sharing: { access: "disabled", generation: 0 },
      title: "Remembered",
      updatedAt: "2026-01-01T00:00:00.000Z",
      visibility: "private",
    },
    sequence: 1,
  };
  const remembering: RouteEnvironment = {
    api: (capabilityToken) =>
      makeApiClient(
        capabilityToken,
        (path) => {
          requests.push(path);
          if (path === "/api/auth/status") {
            return Promise.resolve(
              Response.json(
                sessionEnded
                  ? { authenticated: false }
                  : {
                      authenticated: true,
                      principal: { displayName: "Ada", id: "ada", role: "member" },
                    },
              ),
            );
          }
          return Promise.resolve(
            sessionEnded
              ? Response.json(
                  { code: "unauthenticated", message: "Sign in.", retryable: false },
                  { status: 401 },
                )
              : Response.json(document),
          );
        },
        authentication,
      ),
    preloadDocumentScreen: () => Promise.resolve(),
  };
  const load = (path: string) =>
    Effect.runPromise(
      Effect.either(loadRoute(new URL(`https://inkling.test${path}`), remembering)),
    );

  await load("/documents/doc_0123456789/edit");
  await load("/documents/doc_0123456789/edit");
  assert.equal(requests.filter((path) => path === "/api/auth/status").length, 1);

  sessionEnded = true;
  const refused = await load("/documents/doc_0123456789/edit");
  assert.ok(Either.isLeft(refused));
  // The refusal forgot the remembered status, and the retry asked again.
  assert.equal(requests.filter((path) => path === "/api/auth/status").length, 2);
});
