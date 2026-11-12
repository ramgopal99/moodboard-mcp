import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { Config, PINTEREST_SCOPES, redirectUri } from "./config.js";
import { StoredToken, canRefresh, fromTokenResponse, isExpired, readToken, writeToken } from "./tokenStore.js";

export class AuthError extends Error {}

/**
 * How this server logs in:
 * - static:  PINTEREST_ACCESS_TOKEN is set; no login flow.
 * - own-app: the user supplied their own Pinterest app ID + secret.
 * - broker:  a hosted auth broker holds the app secret; users just click "log in".
 * - none:    no login configured; public boards still work without logging in.
 */
export type LoginMode = "static" | "own-app" | "broker" | "none";

export function loginMode(config: Config): LoginMode {
  if (config.accessToken) return "static";
  if (config.clientId && config.clientSecret) return "own-app";
  if (config.brokerUrl) return "broker";
  return "none";
}

export function noLoginMessage(): string {
  return [
    "Pinterest login is not set up, but you don't need it for public boards:",
    "use get_public_board with any public board link (e.g. https://www.pinterest.com/username/board-name/).",
    "To read your own or secret boards, either install a release that includes one-click login,",
    "or add your own Pinterest app ID and secret (see the README: 'Use your own Pinterest app').",
  ].join(" ");
}

type TokenResponse = Parameters<typeof fromTokenResponse>[0];

let brokerClientId: { url: string; id: string } | undefined;

/** Client ID used in the authorize URL: the user's own, or the broker's public one. */
export async function resolveClientId(config: Config, fetchImpl: typeof fetch = fetch): Promise<string> {
  const mode = loginMode(config);
  if (mode === "own-app") return config.clientId!;
  if (mode !== "broker") throw new AuthError(noLoginMessage());
  if (brokerClientId && brokerClientId.url === config.brokerUrl) return brokerClientId.id;
  const res = await fetchImpl(`${config.brokerUrl}/config`);
  if (!res.ok) throw new AuthError(`Login service is unavailable right now (${res.status}). Try again later.`);
  const body = (await res.json()) as { client_id?: string };
  if (!body.client_id) throw new AuthError("Login service returned no client_id.");
  brokerClientId = { url: config.brokerUrl!, id: body.client_id };
  return body.client_id;
}

export function buildAuthorizeUrl(config: Config, state: string, clientId: string): string {
  const url = new URL(config.oauthAuthorizeUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri(config));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", PINTEREST_SCOPES.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(config: Config, body: Record<string, string>): Promise<TokenResponse> {
  const mode = loginMode(config);
  let res: Response;
  if (mode === "own-app") {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    res = await fetch(`${config.apiBase}/oauth/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  } else if (mode === "broker") {
    // The broker adds the app secret server-side and returns Pinterest's response unchanged.
    // It never stores tokens.
    res = await fetch(`${config.brokerUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } else {
    throw new AuthError(noLoginMessage());
  }
  const text = await res.text();
  if (!res.ok) throw new AuthError(`Pinterest token request failed (${res.status}): ${text.slice(0, 500)}`);
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
  const res = await tokenRequest(config, { grant_type: "refresh_token", refresh_token: current.refresh_token });
  const token = fromTokenResponse(res, current);
  await writeToken(config.tokenFile, token);
  return token;
}

/** Returns a valid access token, refreshing it if needed. */
export async function getAccessToken(config: Config): Promise<string> {
  if (config.accessToken) return config.accessToken;
  const stored = await readToken(config.tokenFile);
  if (!stored) {
    throw new AuthError(
      "Not logged in to Pinterest. Call pinterest_login, or use get_public_board for public boards (no login needed).",
    );
  }
  if (!isExpired(stored)) return stored.access_token;
  if (canRefresh(stored)) return (await refreshToken(config, stored)).access_token;
  throw new AuthError("Your Pinterest login has expired. Call the pinterest_login tool again.");
}

export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? // rundll32 avoids cmd.exe parsing, so "&" in the URL is safe.
        ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
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
export async function startLoginFlow(
  config: Config,
  opts: { timeoutMs?: number; open?: (url: string) => void; fetchImpl?: typeof fetch } = {},
): Promise<{ authorizeUrl: string; done: Promise<StoredToken> }> {
  const clientId = await resolveClientId(config, opts.fetchImpl);
  const state = crypto.randomBytes(16).toString("hex");
  const authorizeUrl = buildAuthorizeUrl(config, state, clientId);
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
        const why = error ?? "no code";
        finish(400, `Login was not completed: ${why}`, new AuthError(`Login failed: ${why}`));
        return;
      }
      try {
        finish(200, SUCCESS_HTML, undefined, await exchangeCode(config, code));
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
