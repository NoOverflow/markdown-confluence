import * as fs from "fs";
import * as path from "path";

/**
 * Authentication methods:
 * - "basic":  username + apiToken via HTTP Basic auth. Works for Confluence Cloud
 *             and self-hosted instances that allow basic auth.
 * - "pat":    Personal Access Token sent as `Authorization: Bearer <token>`.
 *             Supported on Confluence Server/DC 7.9+ and Data Center editions.
 *             Bypasses SSO — generate a PAT in your Confluence profile settings.
 * - "cookie": Raw cookie string (e.g. "JSESSIONID=abc; atl.xsrf.token=xyz").
 *             Useful when the instance is behind SSO: log in via browser,
 *             copy the cookies from DevTools, and paste them here.
 */
export type AuthMethod = "basic" | "pat" | "cookie";

export interface Config {
  /** Base URL of your Confluence instance, e.g. https://yoursite.atlassian.net */
  baseUrl: string;
  /**
   * Authentication method. Defaults to "basic".
   * Use "pat" or "cookie" for SSO-protected self-hosted instances.
   */
  authMethod: AuthMethod;
  /**
   * basic: email address (Cloud) or username (self-hosted)
   * pat:   not used — leave empty or omit
   * cookie: not used — leave empty or omit
   */
  username: string;
  /**
   * basic: API token (Cloud) or password (self-hosted)
   * pat:   the Personal Access Token value
   * cookie: the full raw cookie string from your browser session
   */
  apiToken: string;
  /**
   * Optional. When your Confluence instance sits behind an OIDC/SSO proxy,
   * set this to the raw cookie string from your browser session
   * (e.g. "session=...; _oauth2_proxy=..."). It will be sent alongside the
   * primary auth (PAT or Basic) so the proxy lets the request through.
   */
  sessionCookie?: string;
  /** Target Confluence space key, e.g. "ENG" */
  spaceKey: string;
  /** ID of the parent page under which all content will be nested */
  parentPageId: string;
  /** Path to the content directory (default: ./content) */
  contentDir: string;
}

const CONFIG_FILENAMES = [
  ".markdown-confluence.json",
  "markdown-confluence.json",
];

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const fileConfig = readConfigFile();
  const envConfig = readEnvConfig();

  const authMethod: AuthMethod =
    overrides.authMethod ??
    envConfig.authMethod ??
    fileConfig.authMethod ??
    "basic";

  const merged: Config = {
    baseUrl: overrides.baseUrl ?? envConfig.baseUrl ?? fileConfig.baseUrl ?? "",
    authMethod,
    username:
      overrides.username ?? envConfig.username ?? fileConfig.username ?? "",
    apiToken:
      overrides.apiToken ?? envConfig.apiToken ?? fileConfig.apiToken ?? "",
    sessionCookie:
      overrides.sessionCookie ??
      envConfig.sessionCookie ??
      fileConfig.sessionCookie,
    spaceKey:
      overrides.spaceKey ?? envConfig.spaceKey ?? fileConfig.spaceKey ?? "",
    parentPageId:
      overrides.parentPageId ??
      envConfig.parentPageId ??
      fileConfig.parentPageId ??
      "",
    contentDir:
      overrides.contentDir ??
      envConfig.contentDir ??
      fileConfig.contentDir ??
      "./content",
  };

  validateConfig(merged);
  return merged;
}

function readConfigFile(): Partial<Config> {
  for (const filename of CONFIG_FILENAMES) {
    const filePath = path.resolve(process.cwd(), filename);
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw) as Partial<Config>;
      } catch {
        throw new Error(`Failed to parse config file: ${filePath}`);
      }
    }
  }
  return {};
}

function readEnvConfig(): Partial<Config> {
  return {
    baseUrl: process.env.CONFLUENCE_BASE_URL,
    authMethod: process.env.CONFLUENCE_AUTH_METHOD as AuthMethod | undefined,
    username: process.env.CONFLUENCE_USERNAME,
    apiToken: process.env.CONFLUENCE_API_TOKEN,
    sessionCookie: process.env.CONFLUENCE_SESSION_COOKIE,
    spaceKey: process.env.CONFLUENCE_SPACE_KEY,
    parentPageId: process.env.CONFLUENCE_PARENT_PAGE_ID,
    contentDir: process.env.CONFLUENCE_CONTENT_DIR,
  };
}

function validateConfig(config: Config): void {
  const missing: string[] = [];

  if (!config.baseUrl) missing.push("baseUrl");
  if (!config.spaceKey) missing.push("spaceKey");
  if (!config.parentPageId) missing.push("parentPageId");
  if (!config.apiToken) missing.push("apiToken");
  if (config.authMethod === "basic" && !config.username) missing.push("username");

  if (missing.length > 0) {
    throw new Error(
      `Missing required config fields: ${missing.join(", ")}.\n` +
        `Provide them in .markdown-confluence.json or as environment variables.\n\n` +
        `Auth method "${config.authMethod}" requires:\n` +
        authMethodHelp(config.authMethod)
    );
  }

  const validMethods: AuthMethod[] = ["basic", "pat", "cookie"];
  if (!validMethods.includes(config.authMethod)) {
    throw new Error(
      `Invalid authMethod "${config.authMethod}". Must be one of: ${validMethods.join(", ")}`
    );
  }
}

function authMethodHelp(method: AuthMethod): string {
  switch (method) {
    case "basic":
      return (
        `  username: your email (Cloud) or username (self-hosted)\n` +
        `  apiToken: your API token (Cloud) or password (self-hosted)\n` +
        `  Env vars: CONFLUENCE_USERNAME, CONFLUENCE_API_TOKEN`
      );
    case "pat":
      return (
        `  apiToken: your Personal Access Token (generate in Confluence profile settings)\n` +
        `  Env var:  CONFLUENCE_API_TOKEN\n` +
        `  Note: PATs bypass SSO — available on Confluence Server/DC 7.9+`
      );
    case "cookie":
      return (
        `  apiToken: the full cookie string from your browser (e.g. "JSESSIONID=...; atl.xsrf.token=...")\n` +
        `  Env var:  CONFLUENCE_API_TOKEN\n` +
        `  How to get it: Log in via browser → DevTools → Application → Cookies → copy all values`
      );
  }
}
