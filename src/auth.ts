import { Config } from "./config.js";

export function buildAuthHeaders(config: Config): Record<string, string> {
  const headers: Record<string, string> = {};

  switch (config.authMethod) {
    case "basic": {
      const encoded = Buffer.from(
        `${config.username}:${config.apiToken}`
      ).toString("base64");
      headers["Authorization"] = `Basic ${encoded}`;
      break;
    }
    case "pat":
      headers["Authorization"] = `Bearer ${config.apiToken}`;
      break;
    case "cookie":
      headers["Cookie"] = config.apiToken;
      break;
  }

  // Merge the OIDC/SSO proxy session cookie when present.
  // This lets PAT or Basic auth handle Confluence while the session cookie
  // satisfies the proxy sitting in front of it.
  if (config.sessionCookie) {
    const existing = headers["Cookie"];
    headers["Cookie"] = existing
      ? `${existing}; ${config.sessionCookie}`
      : config.sessionCookie;
  }

  return headers;
}

export function authErrorMessage(config: Config, status: number | undefined): string {
  const hint =
    config.authMethod === "basic"
      ? `Check your username and apiToken. For SSO-protected instances, try authMethod "pat" or "cookie".`
      : config.authMethod === "pat"
      ? `Check that your Personal Access Token is valid and not expired.`
      : `Your session cookies may have expired. Log in again and update apiToken in the config.`;
  return `Authentication failed (HTTP ${status ?? "redirect"}).\n${hint}`;
}
