import os from "node:os";
import path from "node:path";

export const PINTEREST_SCOPES = ["boards:read", "pins:read", "user_accounts:read"] as const;

export interface Config {
  clientId?: string;
  clientSecret?: string;
  /** Static token (skips OAuth). Useful for quick testing with a token from the developer portal. */
  accessToken?: string;
  redirectPort: number;
  apiBase: string;
  oauthAuthorizeUrl: string;
  tokenFile: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const sandbox = env.PINTEREST_SANDBOX === "1" || env.PINTEREST_SANDBOX === "true";
  const dataDir = env.MOODBOARD_MCP_HOME ?? path.join(os.homedir(), ".moodboard-mcp");
  const port = Number(env.PINTEREST_REDIRECT_PORT ?? 8085);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PINTEREST_REDIRECT_PORT must be a valid port, got "${env.PINTEREST_REDIRECT_PORT}"`);
  }
  return {
    clientId: env.PINTEREST_CLIENT_ID || undefined,
    clientSecret: env.PINTEREST_CLIENT_SECRET || undefined,
    accessToken: env.PINTEREST_ACCESS_TOKEN || undefined,
    redirectPort: port,
    apiBase: sandbox ? "https://api-sandbox.pinterest.com/v5" : "https://api.pinterest.com/v5",
    oauthAuthorizeUrl: "https://www.pinterest.com/oauth/",
    tokenFile: path.join(dataDir, "token.json"),
  };
}

export function redirectUri(config: Config): string {
  return `http://localhost:${config.redirectPort}/callback`;
}
