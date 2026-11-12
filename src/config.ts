import os from "node:os";
import path from "node:path";

export const PINTEREST_SCOPES = ["boards:read", "pins:read", "user_accounts:read"] as const;

/**
 * Hosted auth broker that holds the project's Pinterest app secret, so users can
 * log in without creating their own Pinterest app. Empty until the maintainer
 * deploys broker/ (see broker/README.md). Override with PINTEREST_AUTH_BROKER_URL.
 */
export const DEFAULT_AUTH_BROKER_URL = "";

export interface Config {
  clientId?: string;
  clientSecret?: string;
  /** Static token (skips OAuth). Useful for quick testing with a token from the developer portal. */
  accessToken?: string;
  /** Auth broker base URL (no trailing slash), or undefined when not configured. */
  brokerUrl?: string;
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
    brokerUrl: resolveBroker(env.PINTEREST_AUTH_BROKER_URL),
    redirectPort: port,
    apiBase: sandbox ? "https://api-sandbox.pinterest.com/v5" : "https://api.pinterest.com/v5",
    oauthAuthorizeUrl: "https://www.pinterest.com/oauth/",
    tokenFile: path.join(dataDir, "token.json"),
  };
}

export function redirectUri(config: Config): string {
  return `http://localhost:${config.redirectPort}/callback`;
}

function resolveBroker(value: string | undefined): string | undefined {
  if (value?.toLowerCase() === "none") return undefined;
  const url = (value || DEFAULT_AUTH_BROKER_URL).trim().replace(/\/+$/, "");
  if (!url) return undefined;
  if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)) {
    throw new Error(`PINTEREST_AUTH_BROKER_URL must use https, got "${value}"`);
  }
  return url;
}
