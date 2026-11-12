import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { buildAuthorizeUrl, getAccessToken, startLoginFlow } from "../src/auth.js";
import { readToken, writeToken } from "../src/tokenStore.js";
import { jsonRes, testConfig } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

describe("auth", () => {
  it("builds the Pinterest authorize URL", () => {
    const url = new URL(buildAuthorizeUrl(testConfig(), "st"));
    expect(url.origin + url.pathname).toBe("https://www.pinterest.com/oauth/");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8085/callback");
    expect(url.searchParams.get("scope")).toBe("boards:read,pins:read,user_accounts:read");
    expect(url.searchParams.get("state")).toBe("st");
  });

  it("explains missing credentials", () => {
    const cfg = testConfig({ clientId: undefined });
    expect(() => buildAuthorizeUrl(cfg, "s")).toThrow(/PINTEREST_CLIENT_ID/);
  });

  it("prefers a static access token", async () => {
    expect(await getAccessToken(testConfig({ accessToken: "static" }))).toBe("static");
  });

  it("refreshes an expired token and saves it", async () => {
    const cfg = testConfig();
    await writeToken(cfg.tokenFile, { access_token: "old", refresh_token: "r", expires_at: Date.now() - 1 });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(String(init.body)).toContain("grant_type=refresh_token");
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Basic " + Buffer.from("cid:secret").toString("base64"),
      );
      return jsonRes({ access_token: "new", expires_in: 3600 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await getAccessToken(cfg)).toBe("new");
    expect((await readToken(cfg.tokenFile))?.refresh_token).toBe("r");
  });

  it("completes the local OAuth callback flow end to end", async () => {
    const cfg = testConfig({ redirectPort: 18085 });
    vi.stubGlobal("fetch", async () => jsonRes({ access_token: "acc", refresh_token: "ref", expires_in: 3600 }));
    const flow = startLoginFlow(cfg, {
      open: (url) => {
        const state = new URL(url).searchParams.get("state");
        http.get(`http://127.0.0.1:18085/callback?code=abc&state=${state}`, (res) => res.resume());
      },
    });
    const token = await flow.done;
    expect(token.access_token).toBe("acc");
    expect((await readToken(cfg.tokenFile))?.refresh_token).toBe("ref");
  });

  it("rejects a callback with the wrong state", async () => {
    const cfg = testConfig({ redirectPort: 18086 });
    const flow = startLoginFlow(cfg, {
      open: () => http.get(`http://127.0.0.1:18086/callback?code=abc&state=evil`, (res) => res.resume()),
    });
    await expect(flow.done).rejects.toThrow(/state mismatch/);
  });
});
