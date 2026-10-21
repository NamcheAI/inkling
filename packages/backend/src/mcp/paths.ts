/** Public paths of the MCP endpoint and its OAuth authorization server. */
export const mcpEndpointPath = "/mcp";
export const protectedResourceMetadataPath = "/.well-known/oauth-protected-resource";
export const authorizationServerMetadataPath = "/.well-known/oauth-authorization-server";
export const oauthAuthorizePath = "/oauth/authorize";
export const oauthTokenPath = "/oauth/token";
export const oauthRegisterPath = "/oauth/register";

/** The single scope Inkling grants: the approving person's workspace access. */
export const oauthScope = "workspace";

export function mcpResourceMetadataUrl(origin: string): string {
  return `${origin}${protectedResourceMetadataPath}${mcpEndpointPath}`;
}

/** Paths served by the workspace authority's OAuth endpoints. */
export function isOAuthPath(pathname: string): boolean {
  return pathname.startsWith("/oauth/") || pathname.startsWith("/.well-known/oauth-");
}
