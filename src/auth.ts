import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { Config, PINTEREST_SCOPES, redirectUri } from "./config.js";
import { StoredToken, canRefresh, fromTokenResponse, isExpired, readToken, writeToken } from "./tokenStore.js";

export class AuthError extends Error {}

export function buildAuthorizeUrl(config: Config, state: string): string {
  if (!config.clientId) throw new AuthError(missingCredentialsMessage());
  const url = new URL(config.oauthAuthorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(config));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", PINTEREST_SCOPES.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

export function missingCredentialsMessage(): string {
  return [
    "Pinterest app credentials are missing.",
    "Set PINTEREST_CLIENT_ID and PINTEREST_CLIENT_SECRET in your MCP client config",
    "(create a free app at https://developers.pinterest.com/apps/ and add",
    "http://localhost:8085/callback as a redirect URI).",
    "See the README for step-by-step setup.",
  ].join(" ");
}

async function tokenRequest(
  config: Config,
  body: Record<string, string>,
): Promise<Parameters<typeof fromTokenResponse>[0]> {
  if (!config.clientId || !config.clientSecret) throw new AuthError(missingCredentialsMessage());
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await fetch(`${config.apiBase}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new AuthError(`Pinterest token request failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

export async function exchangeCode(config: Config, code: string): Promise<StoredToken> {
  const res = await tokenRequest(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(config),
  });
  const token = fromTokenResponse(res);
  await writeToken(config.tokenFile, token);
  return token;
}

export async function refreshToken(config: Config, current: StoredToken): Promise<StoredToken> {
  if (!current.refresh_token) throw new AuthError("No refresh token stored. Run pinterest_login again.");
  const res = await tokenRequest(config, {
    grant_type: "refresh_token",
    refresh_token: current.refresh_token,
  });
  const token = fromTokenResponse(res, current);
  await writeToken(config.tokenFile, token);
  return token;
}

/** Returns a valid access token, refreshing it if needed. */
export async function getAccessToken(config: Config): Promise<string> {
  if (config.accessToken) return config.accessToken;
  const stored = await readToken(config.tokenFile);
  if (!stored) throw new AuthError("Not logged in to Pinterest. Call the pinterest_login tool first.");
  if (!isExpired(stored)) return stored.access_token;
  if (canRefresh(stored)) return (await refreshToken(config, stored)).access_token;
  throw new AuthError("Your Pinterest login has expired. Call the pinterest_login tool again.");
}

export function openBrowser(url: string): void {
  const platform = process.platform;
  const [cmd, args] =
    platform === "win32"
      ? // rundll32 avoids cmd.exe parsing, so "&" in the URL is safe.
        ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The URL is also returned to the user, so failing to open a browser is not fatal.
  }
}

const SUCCESS_HTML = `<!doctype html><meta charset="utf-8"><title>moodboard-mcp</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1>✅ Connected to Pinterest</h1><p>You can close this tab and go back to your AI assistant.</p></div></body>`;

/**
 * Starts a one-shot local HTTP server, opens the Pinterest consent page,
 * and resolves once the redirect with ?code= arrives (or rejects on timeout).
 */
export function startLoginFlow(
  config: Config,
  opts: { timeoutMs?: number; open?: (url: string) => void } = {},
): { authorizeUrl: string; done: Promise<StoredToken> } {
  const state = crypto.randomBytes(16).toString("hex");
  const authorizeUrl = buildAuthorizeUrl(config, state);
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

  const done = new Promise<StoredToken>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${config.redirectPort}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const finish = (status: number, body: string, err?: Error, token?: StoredToken) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(body);
        clearTimeout(timer);
        server.close();
        if (err) reject(err);
        else if (token) resolve(token);
      };
      if (url.searchParams.get("state") !== state) {
        finish(400, "State mismatch. Please start the login again.", new AuthError("OAuth state mismatch"));
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (error || !code) {
        finish(
          400,
          `Login was not completed: ${error ?? "no code"}`,
          new AuthError(`Login failed: ${error ?? "no code"}`),
        );
        return;
      }
      try {
        const token = await exchangeCode(config, code);
        finish(200, SUCCESS_HTML, undefined, token);
      } catch (e) {
        finish(500, "Token exchange failed. Check the MCP server logs.", e as Error);
      }
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new AuthError("Login timed out after 5 minutes. Call pinterest_login again."));
    }, timeoutMs);
    server.on("error", (e) => {
      clearTimeout(timer);
      reject(new AuthError(`Could not listen on port ${config.redirectPort}: ${e.message}`));
    });
    server.listen(config.redirectPort, "127.0.0.1", () => (opts.open ?? openBrowser)(authorizeUrl));
  });

  return { authorizeUrl, done };
}
