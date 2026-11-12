import fs from "node:fs/promises";
import path from "node:path";

export interface StoredToken {
  access_token: string;
  refresh_token?: string;
  /** Epoch ms when the access token expires. */
  expires_at?: number;
  /** Epoch ms when the refresh token expires. */
  refresh_expires_at?: number;
  scope?: string;
}

/** Refresh this long before the access token actually expires. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function isExpired(token: StoredToken, now = Date.now()): boolean {
  if (!token.expires_at) return false;
  return now >= token.expires_at - REFRESH_MARGIN_MS;
}

export function canRefresh(token: StoredToken, now = Date.now()): boolean {
  if (!token.refresh_token) return false;
  if (!token.refresh_expires_at) return true;
  return now < token.refresh_expires_at;
}

export async function readToken(file: string): Promise<StoredToken | undefined> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as StoredToken;
    return typeof parsed.access_token === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function writeToken(file: string, token: StoredToken): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // mode 0o600: only the current user can read the token (ignored on Windows).
  await fs.writeFile(file, JSON.stringify(token, null, 2), { encoding: "utf8", mode: 0o600 });
}

export async function deleteToken(file: string): Promise<void> {
  await fs.rm(file, { force: true });
}

/** Convert a Pinterest OAuth token response into what we store on disk. */
export function fromTokenResponse(
  res: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    scope?: string;
  },
  previous?: StoredToken,
  now = Date.now(),
): StoredToken {
  return {
    access_token: res.access_token,
    // A refresh response may not include a new refresh token; keep the old one.
    refresh_token: res.refresh_token ?? previous?.refresh_token,
    expires_at: res.expires_in ? now + res.expires_in * 1000 : undefined,
    refresh_expires_at: res.refresh_token_expires_in
      ? now + res.refresh_token_expires_in * 1000
      : previous?.refresh_expires_at,
    scope: res.scope ?? previous?.scope,
  };
}
