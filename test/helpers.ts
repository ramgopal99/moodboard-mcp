import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { Jimp } from "jimp";
import { Config, loadConfig } from "../src/config.js";

export function testConfig(overrides: Partial<Config> = {}): Config {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbm-"));
  return {
    ...loadConfig({ MOODBOARD_MCP_HOME: dir, PINTEREST_CLIENT_ID: "cid", PINTEREST_CLIENT_SECRET: "secret" }),
    ...overrides,
  };
}

/** A tiny PNG split into a white top half and a red bottom half. */
export async function makePng(top = 0xfafafaff, bottom = 0xe62828ff): Promise<Buffer> {
  const img = new Jimp({ width: 40, height: 40, color: top });
  for (let y = 20; y < 40; y++) for (let x = 0; x < 40; x++) img.setPixelColor(bottom, x, y);
  return img.getBuffer("image/png");
}

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

export function mockFetch(routes: Record<string, Handler>) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.pathname + url.search);
    for (const [prefix, h] of Object.entries(routes)) {
      if ((url.origin + url.pathname).startsWith(prefix) || url.pathname.startsWith(prefix)) return h(url, init);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

export const jsonRes = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
