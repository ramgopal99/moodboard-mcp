import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { buildAuthorizeUrl, getAccessToken, loginMode, resolveClientId, startLoginFlow } from "../src/auth.js";
import { readToken, writeToken } from "../src/tokenStore.js";
import { jsonRes, testConfig } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

describe("auth", () => {
  it("builds the Pinterest authorize URL", () => {
    const url = new URL(buildAuthorizeUrl(testConfig(), "st", "cid"));
    expect(url.origin + url.pathname).toBe("https://www.pinterest.com/oauth/");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8085/callback");
    expect(url.searchParams.get("scope")).toBe("boards:read,pins:read,user_accounts:read");
    expect(url.searchParams.get("state")).toBe("st");
  });

  it("picks the right login mode", () => {
    expect(loginMode(testConfig({ accessToken: "t" }))).toBe("static");
    expect(loginMode(testConfig())).toBe("own-app");
    expect(loginMode(testConfig({ clientSecret: undefined, brokerUrl: "https://b.example" }))).toBe("broker");
    expect(loginMode(testConfig({ clientId: undefined, clientSecret: undefined }))).toBe("none");
  });

  it("explains how to proceed when no login is configured", async () => {
    const cfg = testConfig({ clientId: undefined, clientSecret: undefined });
    await expect(resolveClientId(cfg)).rejects.toThrow(/get_public_board/);
  });

  it("gets the public client id from the broker", async () => {
    const cfg = testConfig({ clientId: undefined, clientSecret: undefined, brokerUrl: "https://broker.example" });
    const f = vi.fn(async () => jsonRes({ client_id: "broker-cid" })) as unknown as typeof fetch;
    expect(await resolveClientId(cfg, f)).toBe("broker-cid");
  });

  it("exchanges tokens through the broker without any secret on the client", async () => {
    const cfg = testConfig({
      clientId: undefined,
      clientSecret: undefined,
      brokerUrl: "https://broker2.example",
      redirectPort: 18087,
    });
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return jsonRes({ access_token: "via-broker", refresh_token: "r", expires_in: 3600 });
    });
    const flow = await startLoginFlow(cfg, {
      fetchImpl: (async () => jsonRes({ client_id: "broker-cid-2" })) as unknown as typeof fetch,
      open: (u) => {
        expect(new URL(u).searchParams.get("client_id")).toBe("broker-cid-2");
        const state = new URL(u).searchParams.get("state");
        http.get(`http://127.0.0.1:18087/callback?code=c1&state=${state}`, (res) => res.resume());
      },
    });
    expect((await flow.done).access_token).toBe("via-broker");
    expect(seen[0].url).toBe("https://broker2.example/token");
    const body = JSON.parse(String(seen[0].init?.body));
    expect(body).toEqual({
      grant_type: "authorization_code",
      code: "c1",
      redirect_uri: "http://localhost:18087/callback",
    });
    expect(JSON.stringify(seen[0].init?.headers)).not.toContain("Basic");
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
    const flow = await startLoginFlow(cfg, {
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
    const flow = await startLoginFlow(cfg, {
      open: () => http.get(`http://127.0.0.1:18086/callback?code=abc&state=evil`, (res) => res.resume()),
    });
    await expect(flow.done).rejects.toThrow(/state mismatch/);
  });
});
