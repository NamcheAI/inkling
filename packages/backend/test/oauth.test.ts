import assert from "node:assert/strict";
import test from "node:test";

import { Effect } from "effect";

import type { InklingApplicationService, RequestCredentials } from "../src/index.ts";
import { createBackendApp } from "../src/index.ts";
import {
  authorizationPage,
  decodeClientId,
  isAllowedRedirectUri,
  submitAuthorization,
} from "../src/mcp/oauth.ts";

const origin = "https://rfcs.example.com";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

async function register(redirectUris: readonly string[], clientName?: string) {
  return createBackendApp().request(`${origin}/oauth/register`, {
    body: JSON.stringify({
      ...(clientName === undefined ? {} : { client_name: clientName }),
      redirect_uris: redirectUris,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

async function registeredClientId(redirectUri: string): Promise<string> {
  const response = await register([redirectUri], "Test agent");
  assert.equal(response.status, 201);
  return ((await response.json()) as { client_id: string }).client_id;
}

function authorizeUrl(clientId: string, overrides: Readonly<Record<string, string>> = {}): string {
  const url = new URL(`${origin}/oauth/authorize`);
  for (const [key, value] of Object.entries({
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: "http://127.0.0.1:7777/callback",
    resource: `${origin}/mcp`,
    response_type: "code",
    state: "opaque-state",
    ...overrides,
  })) {
    if (value !== "") url.searchParams.set(key, value);
  }
  return url.href;
}

function fakeService(
  overrides: Partial<InklingApplicationService> = {},
): InklingApplicationService {
  return {
    authenticationStatus: (credentials: RequestCredentials) =>
      Effect.succeed(
        credentials.sessionToken === "ses_valid.secret"
          ? {
              authenticated: true,
              principal: {
                displayName: "Ada <Lovelace>",
                email: "ada@example.com",
                id: "ada@example.com",
                role: "member" as const,
              },
            }
          : { authenticated: false },
      ),
    createAuthorizationCode: () =>
      Effect.succeed({ code: "oac_1.secret", expiresAt: "2030-01-01T00:00:00.000Z" }),
    ...overrides,
  } as InklingApplicationService;
}

test("MCP discovery documents point clients at this origin's authorization server", async () => {
  const app = createBackendApp();
  const resources = await Promise.all(
    ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"].map(
      async (path) => {
        const response = await app.request(`${origin}${path}`);
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get("access-control-allow-origin"), "*");
        return response.json();
      },
    ),
  );
  for (const resource of resources) {
    assert.deepEqual(resource, {
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      resource: `${origin}/mcp`,
      resource_name: "Inkling",
      scopes_supported: ["workspace"],
    });
  }
  const server = (await (
    await app.request(`${origin}/.well-known/oauth-authorization-server`)
  ).json()) as Record<string, unknown>;
  assert.equal(server["issuer"], origin);
  assert.equal(server["authorization_endpoint"], `${origin}/oauth/authorize`);
  assert.equal(server["token_endpoint"], `${origin}/oauth/token`);
  assert.equal(server["registration_endpoint"], `${origin}/oauth/register`);
  assert.deepEqual(server["code_challenge_methods_supported"], ["S256"]);
  assert.deepEqual(server["token_endpoint_auth_methods_supported"], ["none"]);

  const unauthorized = await app.request(`${origin}/mcp`, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "initialize" }),
    method: "POST",
  });
  assert.equal(unauthorized.status, 401);
  assert.match(
    unauthorized.headers.get("www-authenticate") ?? "",
    /resource_metadata="https:\/\/rfcs\.example\.com\/\.well-known\/oauth-protected-resource\/mcp"/u,
  );
  assert.equal(unauthorized.headers.get("access-control-allow-origin"), "*");
  assert.match(
    unauthorized.headers.get("access-control-expose-headers") ?? "",
    /WWW-Authenticate/u,
  );
  const preflight = await app.request(`${origin}/mcp`, { method: "OPTIONS" });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /Authorization/u);
});

test("dynamic registration accepts only safe redirect URIs and encodes them in the client ID", async () => {
  for (const uri of [
    "http://127.0.0.1:33418/callback",
    "http://localhost:6274/oauth/callback",
    "http://[::1]:9000/cb",
    "https://claude.ai/api/mcp/auth_callback",
    "cursor://anysphere.cursor-mcp/oauth/callback",
  ]) {
    assert.equal(isAllowedRedirectUri(uri), true, uri);
  }
  for (const uri of [
    "http://example.com/callback",
    "http://127.0.0.1/callback",
    "https://example.com/callback#fragment",
    "https://user:pass@example.com/callback",
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "not a uri",
  ]) {
    assert.equal(isAllowedRedirectUri(uri), false, uri);
  }

  const response = await register(["http://127.0.0.1:7777/callback"], "  Claude\u0000 Code  ");
  assert.equal(response.status, 201);
  const registered = (await response.json()) as Record<string, unknown>;
  assert.equal(registered["client_name"], "Claude Code");
  assert.equal(registered["token_endpoint_auth_method"], "none");
  assert.deepEqual(decodeClientId(registered["client_id"] as string), {
    name: "Claude Code",
    redirectUris: ["http://127.0.0.1:7777/callback"],
  });
  assert.equal(decodeClientId("mcp_bm90LWpzb24"), undefined);
  assert.equal(decodeClientId("pi-gateway"), undefined);

  const rejected = await register(["http://evil.example.com/callback"]);
  assert.equal(rejected.status, 400);
  assert.equal(((await rejected.json()) as { error: string }).error, "invalid_redirect_uri");
  const unnamed = (await (await register(["https://agent.example.com/cb"])).json()) as {
    client_name: string;
  };
  assert.equal(unnamed.client_name, "agent.example.com");
});

test("authorization rejects unregistered clients and redirect URIs without redirecting", async () => {
  const clientId = await registeredClientId("http://127.0.0.1:7777/callback");
  const service = fakeService();
  const credentials = { sessionToken: "ses_valid.secret" };
  const rejected = await Promise.all(
    [
      authorizeUrl("mcp_forged"),
      authorizeUrl(clientId, { redirect_uri: "http://127.0.0.1:7777/elsewhere" }),
    ].map(async (url) => {
      const response = await Effect.runPromise(
        authorizationPage(new Request(url), credentials, service),
      );
      return {
        location: response.headers.get("location"),
        status: response.status,
        text: await response.text(),
      };
    }),
  );
  for (const response of rejected) {
    assert.equal(response.status, 400);
    assert.equal(response.location, null);
    assert.match(response.text, /Cannot connect this application/u);
  }

  const noPkce = await Effect.runPromise(
    authorizationPage(
      new Request(authorizeUrl(clientId, { code_challenge: "" })),
      credentials,
      service,
    ),
  );
  assert.equal(noPkce.status, 303);
  const location = new URL(noPkce.headers.get("location") ?? "");
  assert.equal(location.origin + location.pathname, "http://127.0.0.1:7777/callback");
  assert.equal(location.searchParams.get("error"), "invalid_request");
  assert.equal(location.searchParams.get("state"), "opaque-state");
  assert.equal(location.searchParams.get("iss"), origin);

  const wrongResource = await Effect.runPromise(
    authorizationPage(
      new Request(authorizeUrl(clientId, { resource: "https://other.example.com/mcp" })),
      credentials,
      service,
    ),
  );
  assert.equal(
    new URL(wrongResource.headers.get("location") ?? "").searchParams.get("error"),
    "invalid_target",
  );
});

test("authorization bounces once for Strict session cookies before asking to sign in", async () => {
  const clientId = await registeredClientId("http://127.0.0.1:7777/callback");
  const service = fakeService();
  const url = authorizeUrl(clientId);

  const first = await Effect.runPromise(authorizationPage(new Request(url), {}, service));
  assert.equal(first.status, 200);
  const html = await first.text();
  const refresh = /<meta http-equiv="refresh" content="0;url=([^"]+)">/u.exec(html)?.[1];
  assert.ok(refresh);
  const bounced = new URL(refresh.replaceAll("&amp;", "&"), origin);
  assert.equal(bounced.searchParams.get("inkling_continue"), "1");

  const signedOut = await Effect.runPromise(authorizationPage(new Request(bounced), {}, service));
  assert.equal(signedOut.status, 302);
  const login = new URL(signedOut.headers.get("location") ?? "", origin);
  assert.equal(login.pathname, "/api/auth/google/start");
  const next = new URL(login.searchParams.get("next") ?? "", origin);
  assert.equal(next.pathname, "/oauth/authorize");
  assert.equal(next.searchParams.get("inkling_continue"), null);
  assert.equal(next.searchParams.get("client_id"), clientId);
});

test("the consent page shows the destination and requires a same-origin CSRF-protected approval", async () => {
  const clientId = await registeredClientId("http://127.0.0.1:7777/callback");
  const grants: unknown[] = [];
  const service = fakeService({
    createAuthorizationCode: (_credentials, grant) => {
      grants.push(grant);
      return Effect.succeed({ code: "oac_1.secret", expiresAt: "2030-01-01T00:00:00.000Z" });
    },
  });
  const cookies = "inkling_session=ses_valid.secret; inkling_csrf=csrf-token";
  const credentials = { sessionToken: "ses_valid.secret" };

  const consent = await Effect.runPromise(
    authorizationPage(
      new Request(authorizeUrl(clientId), { headers: { Cookie: cookies } }),
      credentials,
      service,
    ),
  );
  assert.equal(consent.status, 200);
  const csp = consent.headers.get("content-security-policy") ?? "";
  assert.match(csp, /form-action 'self' http:\/\/127\.0\.0\.1:7777/u);
  assert.match(csp, /frame-ancestors 'none'/u);
  const html = await consent.text();
  assert.match(html, /Connect Test agent to Inkling\?/u);
  assert.match(html, /Ada &lt;Lovelace&gt;/u);
  assert.match(html, /data-oauth-destination="">http:\/\/127\.0\.0\.1:7777\/callback</u);
  assert.match(html, /name="csrf" value="csrf-token"/u);

  const form = (decision: string, csrf = "csrf-token") =>
    new URLSearchParams({
      client_id: clientId,
      code_challenge: challenge,
      code_challenge_method: "S256",
      csrf,
      decision,
      redirect_uri: "http://127.0.0.1:7777/callback",
      response_type: "code",
      state: "opaque-state",
    });
  const submit = (body: URLSearchParams, headers: Readonly<Record<string, string>>) =>
    Effect.runPromise(
      submitAuthorization(
        new Request(`${origin}/oauth/authorize`, {
          body,
          headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
          method: "POST",
        }),
        credentials,
        service,
      ),
    );

  assert.equal(
    (await submit(form("allow", "wrong"), { Cookie: cookies, Origin: origin })).status,
    403,
  );
  assert.equal(
    (await submit(form("allow"), { Cookie: cookies, Origin: "https://evil.example.com" })).status,
    403,
  );
  assert.equal(grants.length, 0);

  const denied = await submit(form("deny"), { Cookie: cookies, Origin: origin });
  assert.equal(
    new URL(denied.headers.get("location") ?? "").searchParams.get("error"),
    "access_denied",
  );

  const allowed = await submit(form("allow"), { Cookie: cookies, Origin: origin });
  assert.equal(allowed.status, 303);
  const redirect = new URL(allowed.headers.get("location") ?? "");
  assert.equal(redirect.searchParams.get("code"), "oac_1.secret");
  assert.equal(redirect.searchParams.get("state"), "opaque-state");
  assert.equal(redirect.searchParams.get("iss"), origin);
  assert.deepEqual(grants, [
    {
      clientId,
      clientName: "Test agent",
      codeChallenge: challenge,
      redirectUri: "http://127.0.0.1:7777/callback",
    },
  ]);
});
