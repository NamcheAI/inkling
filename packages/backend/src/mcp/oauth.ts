import { Effect, Either, Schema } from "effect";

import type { AuthorizationGrant } from "@earendil-works/inkling-core";

import type { InklingApplicationService, RequestCredentials } from "../application.ts";
import type { ApplicationError } from "../application.ts";
import {
  mcpEndpointPath,
  oauthAuthorizePath,
  oauthRegisterPath,
  oauthScope,
  oauthTokenPath,
} from "./paths.ts";

/**
 * OAuth 2.1 authorization server for MCP clients
 *
 * MCP clients discover everything from the endpoint they connect to: the 401
 * from `/mcp` names protected-resource metadata (RFC 9728), which names this
 * origin as the authorization server (RFC 8414). Clients register dynamically
 * (RFC 7591), send the person through `/oauth/authorize`, and redeem the
 * resulting code at `/oauth/token` with PKCE.
 *
 * Access tokens are ordinary Inkling API keys issued to the approving person
 * and labelled with the client's name. `/mcp` already authenticates API keys,
 * and the person can see and revoke every connected client from the API keys
 * dialog. Keys do not expire, so no refresh tokens are issued.
 *
 * Registration is stateless: the client ID is the client's name and redirect
 * URIs, encoded. Nothing about a client is trusted beyond what the consent
 * page shows the person: the name is self-declared, so the page also shows
 * exactly where the authorization code will be sent. Public clients cannot
 * be authenticated in any case, so storing registrations would add no
 * security. Authorization codes, by contrast, are stored by the workspace
 * authority: they are single-use, short-lived, hashed, and bound to the
 * person, the client, the redirect URI, and the PKCE challenge.
 *
 * Approval needs a browser session. The session cookie is `SameSite=Strict`,
 * so a cross-site navigation from the client (or back from Google sign-in)
 * arrives without it. The authorize page therefore first navigates to itself
 * once from this origin, which carries the cookie, before deciding the person
 * is signed out.
 */

const maximumRedirectUris = 5;
const maximumRedirectUriLength = 2_048;
const maximumClientNameLength = 100;
const bounceParameter = "inkling_continue";

export const corsHeaders: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Last-Event-ID, MCP-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "MCP-Protocol-Version, Mcp-Session-Id, WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
};

export function corsPreflightResponse(): Response {
  return new Response(null, { headers: corsHeaders, status: 204 });
}

export function protectedResourceMetadataResponse(origin: string): Response {
  return metadataResponse({
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    resource: `${origin}${mcpEndpointPath}`,
    resource_name: "Inkling",
    scopes_supported: [oauthScope],
  });
}

export function authorizationServerMetadataResponse(origin: string): Response {
  return metadataResponse({
    authorization_endpoint: `${origin}${oauthAuthorizePath}`,
    authorization_response_iss_parameter_supported: true,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code"],
    issuer: origin,
    registration_endpoint: `${origin}${oauthRegisterPath}`,
    response_modes_supported: ["query"],
    response_types_supported: ["code"],
    scopes_supported: [oauthScope],
    token_endpoint: `${origin}${oauthTokenPath}`,
    token_endpoint_auth_methods_supported: ["none"],
  });
}

// Client registration.

interface RegisteredClient {
  readonly name: string;
  readonly redirectUris: readonly string[];
}

const RegistrationRequestSchema = Schema.Struct({
  client_name: Schema.optional(Schema.String),
  redirect_uris: Schema.Array(Schema.String),
});

const ClientIdPayloadSchema = Schema.Struct({
  n: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(maximumClientNameLength)),
  r: Schema.Array(Schema.String).pipe(Schema.minItems(1), Schema.maxItems(maximumRedirectUris)),
});

export function registerClient(request: Request): Effect.Effect<Response> {
  return Effect.gen(function* () {
    const body = yield* readJson(request);
    const decoded = Schema.decodeUnknownEither(RegistrationRequestSchema)(body);
    if (Either.isLeft(decoded)) {
      return registrationError("invalid_client_metadata", "redirect_uris must be a list of URIs.");
    }
    const redirectUris = decoded.right.redirect_uris;
    if (
      redirectUris.length === 0 ||
      redirectUris.length > maximumRedirectUris ||
      !redirectUris.every(isAllowedRedirectUri)
    ) {
      return registrationError(
        "invalid_redirect_uri",
        `Register 1 to ${maximumRedirectUris} redirect URIs using https, a loopback http address with an explicit port, or an application-specific scheme.`,
      );
    }
    const name = clientName(decoded.right.client_name, redirectUris);
    return new Response(
      JSON.stringify({
        client_id: encodeClientId({ name, redirectUris }),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: name,
        grant_types: ["authorization_code"],
        redirect_uris: redirectUris,
        response_types: ["code"],
        scope: oauthScope,
        token_endpoint_auth_method: "none",
      }),
      { headers: jsonHeaders(), status: 201 },
    );
  });
}

function encodeClientId(client: RegisteredClient): string {
  return `mcp_${base64UrlEncode(new TextEncoder().encode(JSON.stringify({ n: client.name, r: client.redirectUris })))}`;
}

export function decodeClientId(clientId: string): RegisteredClient | undefined {
  if (!clientId.startsWith("mcp_") || clientId.length > 16_384) return undefined;
  const payload = Either.try(
    () => JSON.parse(new TextDecoder().decode(base64UrlDecode(clientId.slice(4)))) as unknown,
  );
  if (Either.isLeft(payload)) return undefined;
  const decoded = Schema.decodeUnknownEither(ClientIdPayloadSchema)(payload.right);
  if (Either.isLeft(decoded) || !decoded.right.r.every(isAllowedRedirectUri)) return undefined;
  return { name: decoded.right.n, redirectUris: decoded.right.r };
}

const forbiddenRedirectSchemes = new Set([
  "about:",
  "blob:",
  "data:",
  "file:",
  "filesystem:",
  "ftp:",
  "javascript:",
  "vbscript:",
  "ws:",
  "wss:",
]);

/**
 * https anywhere; http only on loopback with an explicit port (RFC 8252
 * §7.3); or a private-use scheme for native applications (RFC 8252 §7.1).
 */
export function isAllowedRedirectUri(value: string): boolean {
  if (value.length > maximumRedirectUriLength) return false;
  const url = URL.parse(value);
  if (url === null || url.hash !== "" || url.username !== "" || url.password !== "") {
    return false;
  }
  if (url.protocol === "https:") return url.hostname !== "";
  if (url.protocol === "http:") {
    const host = url.hostname.toLowerCase();
    return (
      url.port !== "" &&
      (host === "localhost" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/u.test(host))
    );
  }
  return /^[a-z][a-z0-9+.-]*:$/u.test(url.protocol) && !forbiddenRedirectSchemes.has(url.protocol);
}

function clientName(requested: string | undefined, redirectUris: readonly string[]): string {
  const cleaned = (requested ?? "")
    .replaceAll(/[\p{Cc}\p{Cf}]/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, maximumClientNameLength)
    .trim();
  if (cleaned !== "") return cleaned;
  const first = URL.parse(redirectUris[0] ?? "");
  return first?.host || first?.protocol.replace(/:$/u, "") || "MCP client";
}

// Authorization.

interface AuthorizationRequest {
  readonly client: RegisteredClient;
  readonly clientId: string;
  readonly codeChallenge: string;
  readonly redirectUri: string;
  readonly resource?: string | undefined;
  readonly scope?: string | undefined;
  readonly state?: string | undefined;
}

type ParsedAuthorization =
  | { readonly kind: "request"; readonly request: AuthorizationRequest }
  /** The client or redirect URI is unusable, so the error is shown here. */
  | { readonly kind: "page"; readonly message: string }
  /** The redirect URI is trusted, so the error goes back to the client. */
  | { readonly kind: "redirect"; readonly response: Response };

function parseAuthorization(parameters: URLSearchParams, origin: string): ParsedAuthorization {
  const clientId = parameters.get("client_id") ?? "";
  const client = decodeClientId(clientId);
  if (client === undefined) {
    return {
      kind: "page",
      message:
        "This application is not registered with Inkling. Reconnect it from the application so it can register again.",
    };
  }
  const requestedRedirect = parameters.get("redirect_uri");
  const redirectUri =
    requestedRedirect ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (redirectUri === undefined || !client.redirectUris.includes(redirectUri)) {
    return {
      kind: "page",
      message: "The application asked Inkling to send you to an address it did not register.",
    };
  }
  const state = parameters.get("state") ?? undefined;
  const fail = (error: string, description: string): ParsedAuthorization => ({
    kind: "redirect",
    response: authorizationRedirect(redirectUri, origin, state, {
      error,
      error_description: description,
    }),
  });
  if (parameters.get("response_type") !== "code") {
    return fail("unsupported_response_type", "Only the authorization code flow is supported.");
  }
  const codeChallenge = parameters.get("code_challenge") ?? "";
  if (
    parameters.get("code_challenge_method") !== "S256" ||
    !/^[A-Za-z0-9_-]{43,128}$/u.test(codeChallenge)
  ) {
    return fail("invalid_request", "PKCE with code_challenge_method S256 is required.");
  }
  const resource = parameters.get("resource") ?? undefined;
  if (resource !== undefined && !isOwnResource(resource, origin)) {
    return fail("invalid_target", "Inkling only issues tokens for its own MCP endpoint.");
  }
  return {
    kind: "request",
    request: {
      client,
      clientId,
      codeChallenge,
      redirectUri,
      resource,
      scope: parameters.get("scope") ?? undefined,
      state,
    },
  };
}

export function authorizationPage(
  request: Request,
  credentials: RequestCredentials,
  service: InklingApplicationService,
): Effect.Effect<Response> {
  return Effect.gen(function* () {
    const url = new URL(request.url);
    const parsed = parseAuthorization(url.searchParams, url.origin);
    if (parsed.kind === "page") return errorPage(parsed.message);
    if (parsed.kind === "redirect") return parsed.response;

    if (credentials.sessionToken === undefined && url.searchParams.get(bounceParameter) === null) {
      const self = new URL(url);
      self.searchParams.set(bounceParameter, "1");
      return continuePage(`${self.pathname}${self.search}`);
    }
    const status = yield* service
      .authenticationStatus({ sessionToken: credentials.sessionToken })
      .pipe(Effect.orElseSucceed(() => ({ authenticated: false }) as const));
    const csrf = cookie(request, "inkling_csrf");
    if (!status.authenticated || status.principal === undefined || csrf === undefined) {
      const next = new URL(url);
      next.searchParams.delete(bounceParameter);
      return redirect(
        `/api/auth/google/start?next=${encodeURIComponent(`${next.pathname}${next.search}`)}`,
        302,
      );
    }
    return consentPage(url.origin, parsed.request, status.principal, csrf);
  });
}

export function submitAuthorization(
  request: Request,
  credentials: RequestCredentials,
  service: InklingApplicationService,
): Effect.Effect<Response> {
  return Effect.gen(function* () {
    const origin = new URL(request.url).origin;
    const form = yield* readForm(request);
    const parsed = parseAuthorization(form, origin);
    if (parsed.kind === "page") return errorPage(parsed.message);
    if (parsed.kind === "redirect") return parsed.response;
    const csrf = cookie(request, "inkling_csrf");
    if (
      request.headers.get("Origin") !== origin ||
      csrf === undefined ||
      form.get("csrf") !== csrf ||
      credentials.sessionToken === undefined
    ) {
      return errorPage(
        "Inkling could not confirm this approval came from you. Start connecting the application again.",
        403,
      );
    }
    const { request: authorization } = parsed;
    if (form.get("decision") !== "allow") {
      return authorizationRedirect(authorization.redirectUri, origin, authorization.state, {
        error: "access_denied",
        error_description: "The request was declined.",
      });
    }
    const grant: AuthorizationGrant = {
      clientId: authorization.clientId,
      clientName: authorization.client.name,
      codeChallenge: authorization.codeChallenge,
      redirectUri: authorization.redirectUri,
    };
    return yield* service
      .createAuthorizationCode({ sessionToken: credentials.sessionToken }, grant)
      .pipe(
        Effect.map(({ code }) =>
          authorizationRedirect(authorization.redirectUri, origin, authorization.state, { code }),
        ),
        Effect.catchAll((error: ApplicationError) =>
          Effect.succeed(
            errorPage(
              error.status === 401 || error.status === 403
                ? "Your Inkling session ended. Sign in and connect the application again."
                : "Inkling could not approve the application. Try again.",
              error.status === 401 || error.status === 403 ? 403 : 503,
            ),
          ),
        ),
      );
  });
}

// Token exchange.

export function exchangeToken(
  request: Request,
  service: InklingApplicationService,
): Effect.Effect<Response> {
  return Effect.gen(function* () {
    const origin = new URL(request.url).origin;
    const form = yield* readForm(request);
    if (form.get("grant_type") !== "authorization_code") {
      return tokenError("unsupported_grant_type", "Only authorization_code is supported.");
    }
    const code = form.get("code") ?? "";
    const clientId = form.get("client_id") ?? "";
    const redirectUri = form.get("redirect_uri") ?? "";
    const verifier = form.get("code_verifier") ?? "";
    const resource = form.get("resource");
    if (code === "" || clientId === "" || redirectUri === "") {
      return tokenError("invalid_request", "code, client_id, and redirect_uri are required.");
    }
    if (!/^[A-Za-z0-9._~-]{43,128}$/u.test(verifier)) {
      return tokenError("invalid_request", "A valid PKCE code_verifier is required.");
    }
    if (resource !== null && !isOwnResource(resource, origin)) {
      return tokenError("invalid_target", "Inkling only issues tokens for its own MCP endpoint.");
    }
    const codeChallenge = yield* s256(verifier);
    return yield* service
      .exchangeAuthorizationCode(code, { clientId, codeChallenge, redirectUri })
      .pipe(
        Effect.map(
          (created) =>
            new Response(
              JSON.stringify({
                access_token: created.key,
                scope: oauthScope,
                token_type: "Bearer",
              }),
              { headers: { ...jsonHeaders(), Pragma: "no-cache" }, status: 200 },
            ),
        ),
        Effect.catchAll((error: ApplicationError) =>
          Effect.succeed(
            error.code === "invalid_grant"
              ? tokenError("invalid_grant", error.message)
              : tokenError("server_error", "The token could not be issued.", 503),
          ),
        ),
      );
  });
}

// Helpers.

function isOwnResource(resource: string, origin: string): boolean {
  const normalized = resource.replace(/\/+$/u, "");
  return normalized === origin || normalized === `${origin}${mcpEndpointPath}`;
}

function authorizationRedirect(
  redirectUri: string,
  origin: string,
  state: string | undefined,
  parameters: Readonly<Record<string, string>>,
): Response {
  const target = new URL(redirectUri);
  for (const [key, value] of Object.entries(parameters)) target.searchParams.set(key, value);
  if (state !== undefined) target.searchParams.set("state", state);
  target.searchParams.set("iss", origin);
  return redirect(target.href, 303);
}

function redirect(location: string, status: 302 | 303): Response {
  return new Response(null, {
    headers: { "Cache-Control": "no-store", Location: location, "Referrer-Policy": "no-referrer" },
    status,
  });
}

function s256(verifier: string): Effect.Effect<string> {
  return Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  ).pipe(Effect.map((digest) => base64UrlEncode(new Uint8Array(digest))));
}

function readForm(request: Request): Effect.Effect<URLSearchParams> {
  return Effect.tryPromise(() => request.text()).pipe(
    Effect.orElseSucceed(() => ""),
    Effect.map((text) => {
      if (text.length > 64_000) return new URLSearchParams();
      if (!(request.headers.get("Content-Type") ?? "").includes("application/json")) {
        return new URLSearchParams(text);
      }
      const parsed = Either.try(() => JSON.parse(text) as unknown);
      const record = Either.isRight(parsed) ? parsed.right : undefined;
      return typeof record === "object" && record !== null && !Array.isArray(record)
        ? new URLSearchParams(
            Object.entries(record).flatMap(([key, value]) =>
              typeof value === "string" ? [[key, value]] : [],
            ),
          )
        : new URLSearchParams();
    }),
  );
}

function readJson(request: Request): Effect.Effect<unknown> {
  return Effect.tryPromise(() => request.text()).pipe(
    Effect.orElseSucceed(() => ""),
    Effect.map((text) => {
      if (text.length > 64_000) return undefined;
      const parsed = Either.try(() => JSON.parse(text) as unknown);
      return Either.isRight(parsed) ? parsed.right : undefined;
    }),
  );
}

function cookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

function jsonHeaders(): Record<string, string> {
  return { ...corsHeaders, "Cache-Control": "no-store", "Content-Type": "application/json" };
}

function metadataResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/json",
    },
  });
}

function registrationError(error: string, description: string): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    headers: jsonHeaders(),
    status: 400,
  });
}

function tokenError(error: string, description: string, status = 400): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    headers: { ...jsonHeaders(), Pragma: "no-cache" },
    status,
  });
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

// Pages.

function consentPage(
  origin: string,
  request: AuthorizationRequest,
  principal: { readonly displayName: string; readonly email?: string | undefined },
  csrf: string,
): Response {
  const destination = URL.parse(request.redirectUri);
  const formTarget =
    destination === null
      ? ""
      : destination.protocol === "http:" || destination.protocol === "https:"
        ? destination.origin
        : destination.protocol;
  const name = escapeHtml(request.client.name);
  const hidden = Object.entries({
    client_id: request.clientId,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    csrf,
    redirect_uri: request.redirectUri,
    response_type: "code",
    ...(request.resource === undefined ? {} : { resource: request.resource }),
    ...(request.scope === undefined ? {} : { scope: request.scope }),
    ...(request.state === undefined ? {} : { state: request.state }),
  })
    .map(([key, value]) => `<input type="hidden" name="${key}" value="${escapeHtml(value)}">`)
    .join("");
  const who = `<strong>${escapeHtml(principal.displayName)}</strong>${
    principal.email === undefined ? "" : ` (${escapeHtml(principal.email)})`
  }`;
  const body = `<h1>Connect ${name} to Inkling?</h1><p>An application calling itself <strong>${name}</strong> wants to use the ${escapeHtml(new URL(origin).host)} workspace as ${who}. It will be able to:</p><ul><li>search and read every document you can read;</li><li>create, edit, comment on, publish, and delete documents on your behalf.</li></ul><p class="oauth-muted">Inkling cannot verify the application's name. After you allow access you will be sent to:</p><p class="oauth-destination" data-oauth-destination="">${escapeHtml(request.redirectUri)}</p><p class="oauth-muted">Only continue if you just started connecting this application. You can disconnect it at any time under API keys in the account menu.</p><form method="post" action="${oauthAuthorizePath}">${hidden}<div class="oauth-actions"><button type="submit" name="decision" value="deny">Cancel</button><button type="submit" name="decision" value="allow" autofocus>Allow access</button></div></form>`;
  return page(`Connect ${request.client.name}`, body, 200, formTarget);
}

function continuePage(target: string): Response {
  const href = escapeHtml(target);
  return page(
    "Continue to Inkling",
    `<h1>Continuing…</h1><p><a href="${href}">Continue to Inkling</a></p>`,
    200,
    "",
    `<meta http-equiv="refresh" content="0;url=${href}">`,
  );
}

function errorPage(message: string, status = 400): Response {
  return page(
    "Cannot connect application",
    `<h1>Cannot connect this application</h1><p>${escapeHtml(message)}</p>`,
    status,
    "",
  );
}

function page(
  title: string,
  body: string,
  status: number,
  formTarget: string,
  head = "",
): Response {
  const formAction = ["'self'", formTarget].filter((value) => value !== "").join(" ");
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">${head}<title>${escapeHtml(title)}</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/public.css"></head><body><header class="public-masthead"><a href="/">INKLING</a><span>AUTHORIZE</span></header><main class="oauth-shell"><article class="oauth-paper">${body}</article></main></body></html>`,
    {
      headers: {
        "Cache-Control": "no-store",
        // Chrome applies form-action to the redirect that follows submission,
        // so the client's redirect target must be allowed explicitly.
        "Content-Security-Policy": `default-src 'none'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; form-action ${formAction}; base-uri 'none'; frame-ancestors 'none'`,
        "Content-Type": "text/html; charset=UTF-8",
        "Referrer-Policy": "no-referrer",
      },
      status,
    },
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
