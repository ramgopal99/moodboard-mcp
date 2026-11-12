import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { canRefresh, deleteToken, fromTokenResponse, isExpired, readToken, writeToken } from "../src/tokenStore.js";

describe("tokenStore", () => {
  it("handles expiry with a safety margin", () => {
    const now = 1_000_000_000;
    expect(isExpired({ access_token: "a" }, now)).toBe(false);
    expect(isExpired({ access_token: "a", expires_at: now + 60 * 60_000 }, now)).toBe(false);
    expect(isExpired({ access_token: "a", expires_at: now + 60_000 }, now)).toBe(true);
  });

  it("knows when a refresh is possible", () => {
    const now = 1_000;
    expect(canRefresh({ access_token: "a" }, now)).toBe(false);
    expect(canRefresh({ access_token: "a", refresh_token: "r" }, now)).toBe(true);
    expect(canRefresh({ access_token: "a", refresh_token: "r", refresh_expires_at: 500 }, now)).toBe(false);
  });

  it("keeps the old refresh token when a refresh response omits it", () => {
    const prev = { access_token: "old", refresh_token: "r1", refresh_expires_at: 99 };
    const t = fromTokenResponse({ access_token: "new", expires_in: 10 }, prev, 0);
    expect(t).toMatchObject({ access_token: "new", refresh_token: "r1", expires_at: 10_000, refresh_expires_at: 99 });
  });

  it("reads, writes and deletes the token file", async () => {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "mbm-")), "nested", "token.json");
    expect(await readToken(file)).toBeUndefined();
    await writeToken(file, { access_token: "x" });
    expect(await readToken(file)).toEqual({ access_token: "x" });
    await deleteToken(file);
    expect(await readToken(file)).toBeUndefined();
  });
});
