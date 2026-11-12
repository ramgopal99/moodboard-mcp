/**
 * moodboard-mcp auth broker (Cloudflare Worker).
 *
 * Holds the project's Pinterest app secret so users can log in without creating
 * their own Pinterest app. It only adds the secret to token requests and passes
 * Pinterest's response straight back. It never stores or logs tokens.
 *
 * Routes:
 *   GET  /config  -> { client_id, scopes }
 *   POST /token   -> { grant_type: "authorization_code", code, redirect_uri }
 *                  | { grant_type: "refresh_token", refresh_token }
 */

export interface Env {
  PINTEREST_CLIENT_ID: string;
  PINTEREST_CLIENT_SECRET: string;
  /** Comma-separated. Default: http://localhost:8085/callback */
  ALLOWED_REDIRECT_URIS?: string;
  /** Default: https://api.pinterest.com/v5 */
  PINTEREST_API_BASE?: string;
}

const SCOPES = "boards:read,pins:read,user_accounts:read";
const MAX_BODY = 4096;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!env.PINTEREST_CLIENT_ID || !env.PINTEREST_CLIENT_SECRET) {
      return json({ error: "broker_not_configured" }, 500);
    }

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("moodboard-mcp auth broker: OK\nhttps://github.com/ramgopal99/moodboard-mcp\n", {
        headers: { "Content-Type": "text/plain" },
      });
    }

    if (request.method === "GET" && url.pathname === "/config") {
      return json({ client_id: env.PINTEREST_CLIENT_ID, scopes: SCOPES });
    }

    if (request.method === "POST" && url.pathname === "/token") {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return json({ error: "body_too_large" }, 413);
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ error: "invalid_json" }, 400);
      }

      const form = new URLSearchParams();
      if (body.grant_type === "authorization_code") {
        const allowed = (env.ALLOWED_REDIRECT_URIS ?? "http://localhost:8085/callback")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (typeof body.code !== "string" || !body.code) return json({ error: "missing_code" }, 400);
        if (typeof body.redirect_uri !== "string" || !allowed.includes(body.redirect_uri)) {
          return json({ error: "redirect_uri_not_allowed" }, 400);
        }
        form.set("grant_type", "authorization_code");
        form.set("code", body.code);
        form.set("redirect_uri", body.redirect_uri);
      } else if (body.grant_type === "refresh_token") {
        if (typeof body.refresh_token !== "string" || !body.refresh_token) {
          return json({ error: "missing_refresh_token" }, 400);
        }
        form.set("grant_type", "refresh_token");
        form.set("refresh_token", body.refresh_token);
      } else {
        return json({ error: "unsupported_grant_type" }, 400);
      }

      const basic = btoa(`${env.PINTEREST_CLIENT_ID}:${env.PINTEREST_CLIENT_SECRET}`);
      const upstream = await fetch(`${env.PINTEREST_API_BASE ?? "https://api.pinterest.com/v5"}/oauth/token`, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    return json({ error: "not_found" }, 404);
  },
};
