import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { Env } from "../broker/src/worker.js";

const env: Env = { PINTEREST_CLIENT_ID: "app-id", PINTEREST_CLIENT_SECRET: "app-secret" };
const post = (body: unknown) =>
  new Request("https://broker.example/token", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

afterEach(() => vi.unstubAllGlobals());

describe("auth broker worker", () => {
  it("serves the public client id", async () => {
    const res = await worker.fetch(new Request("https://broker.example/config"), env);
    expect(await res.json()).toEqual({ client_id: "app-id", scopes: "boards:read,pins:read,user_accounts:read" });
  });

  it("adds the secret and forwards the code exchange to Pinterest", async () => {
    const upstream = vi.fn(
      async (_url: string, _init: RequestInit) => new Response('{"access_token":"t"}', { status: 200 }),
    );
    vi.stubGlobal("fetch", upstream);
    const res = await worker.fetch(
      post({ grant_type: "authorization_code", code: "abc", redirect_uri: "http://localhost:8085/callback" }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: "t" });
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe("https://api.pinterest.com/v5/oauth/token");
    expect((init.headers as Record<string, string>).Authorization).toBe("Basic " + btoa("app-id:app-secret"));
    expect(String(init.body)).toBe(
      "grant_type=authorization_code&code=abc&redirect_uri=http%3A%2F%2Flocalhost%3A8085%2Fcallback",
    );
  });

  it("forwards refreshes", async () => {
    const upstream = vi.fn(async () => new Response('{"access_token":"t2"}'));
    vi.stubGlobal("fetch", upstream);
    const res = await worker.fetch(post({ grant_type: "refresh_token", refresh_token: "r" }), env);
    expect(res.status).toBe(200);
    expect(String((upstream.mock.calls[0] as any)[1].body)).toBe("grant_type=refresh_token&refresh_token=r");
  });

  it.each([
    [{ grant_type: "client_credentials" }, "unsupported_grant_type"],
    [
      { grant_type: "authorization_code", code: "x", redirect_uri: "https://evil.example/cb" },
      "redirect_uri_not_allowed",
    ],
    [{ grant_type: "authorization_code", redirect_uri: "http://localhost:8085/callback" }, "missing_code"],
    [{ grant_type: "refresh_token" }, "missing_refresh_token"],
    ["not json", "invalid_json"],
  ])("rejects bad requests: %j", async (body, error) => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const res = await worker.fetch(post(body), env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies and unknown routes", async () => {
    expect((await worker.fetch(post("x".repeat(5000)), env)).status).toBe(413);
    expect((await worker.fetch(new Request("https://broker.example/nope"), env)).status).toBe(404);
  });

  it("refuses to run without configuration", async () => {
    const res = await worker.fetch(new Request("https://broker.example/config"), {
      PINTEREST_CLIENT_ID: "",
      PINTEREST_CLIENT_SECRET: "",
    });
    expect(res.status).toBe(500);
  });
});
