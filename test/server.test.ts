import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { SAMPLE_RSS, jsonRes, makePng, mockFetch, testConfig } from "./helpers.js";

async function connect(fetchImpl: typeof fetch, config = testConfig({ accessToken: "t" })) {
  const server = createServer({ config, fetchImpl });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("MCP server", async () => {
  const png = await makePng();
  const pins = [
    {
      id: "p1",
      title: "Clean dashboard",
      media: { media_type: "image", images: { "600x": { url: "https://i.pinimg.com/a.png", width: 600 } } },
    },
    {
      id: "p2",
      title: "Card UI",
      media: { media_type: "image", images: { "600x": { url: "https://i.pinimg.com/b.png", width: 600 } } },
    },
  ];
  const { impl } = mockFetch({
    "/v5/boards/b1/pins": () => jsonRes({ items: pins, bookmark: null }),
    "/v5/boards": () => jsonRes({ items: [{ id: "b1", name: "UI inspo", pin_count: 2 }], bookmark: null }),
    "/jane/ui-inspo.rss": () =>
      new Response(SAMPLE_RSS.replaceAll("hash1.jpg", "a.png").replaceAll("hash2.png", "b.png")),
    "https://i.pinimg.com/": () => new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } }),
  });

  it("lists all tools and the prompt", async () => {
    const client = await connect(impl);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([
      "extract_design_tokens",
      "get_board_pins",
      "get_pin",
      "get_public_board",
      "list_boards",
      "pinterest_auth_status",
      "pinterest_login",
      "pinterest_logout",
      "search_my_pins",
    ]);
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toEqual(["moodboard_to_ui"]);
  });

  it("lists boards", async () => {
    const client = await connect(impl);
    const res = await client.callTool({ name: "list_boards", arguments: {} });
    expect(JSON.parse((res.content as any)[0].text)[0]).toMatchObject({ id: "b1", name: "UI inspo" });
  });

  it("returns board pins with images the model can see", async () => {
    const client = await connect(impl);
    const res = await client.callTool({ name: "get_board_pins", arguments: { board_id: "b1", max_images: 2 } });
    const content = res.content as any[];
    expect(content.filter((c) => c.type === "image")).toHaveLength(2);
    expect(content.find((c) => c.type === "image").mimeType).toBe("image/jpeg");
  });

  it("extracts design tokens from a board", async () => {
    const client = await connect(impl);
    const res = await client.callTool({ name: "extract_design_tokens", arguments: { board_id: "b1", colors: 3 } });
    expect(res.isError).toBeFalsy();
    const tokens = JSON.parse((res.content as any)[0].text);
    expect(tokens.analyzed_pins).toBe(2);
    expect(tokens.roles.background).toBe("#fafafa");
    expect(tokens.roles.accent).toBe("#e62828");
  });

  it("returns a tool error instead of crashing on bad input", async () => {
    const client = await connect(impl);
    const res = await client.callTool({ name: "extract_design_tokens", arguments: {} });
    expect(res.isError).toBe(true);
  });

  it("reads a public board with images and no login", async () => {
    const client = await connect(impl, testConfig({ clientId: undefined, clientSecret: undefined }));
    const res = await client.callTool({
      name: "get_public_board",
      arguments: { board_url: "https://www.pinterest.com/jane/ui-inspo/", max_images: 2 },
    });
    expect(res.isError).toBeFalsy();
    const content = res.content as any[];
    expect(JSON.parse(content[0].text)).toMatchObject({ board: "UI inspo", pin_count: 2 });
    expect(content.filter((c) => c.type === "image")).toHaveLength(2);
  });

  it("extracts design tokens from a public board link", async () => {
    const client = await connect(impl, testConfig({ clientId: undefined, clientSecret: undefined }));
    const res = await client.callTool({
      name: "extract_design_tokens",
      arguments: { board_url: "jane/ui-inspo", colors: 3 },
    });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse((res.content as any)[0].text).roles.accent).toBe("#e62828");
  });

  it("explains the no-login option instead of failing on login", async () => {
    const client = await connect(impl, testConfig({ clientId: undefined, clientSecret: undefined }));
    const res = await client.callTool({ name: "pinterest_login", arguments: {} });
    expect((res.content as any)[0].text).toContain("get_public_board");
  });

  it("builds the moodboard prompt", async () => {
    const client = await connect(impl);
    const p = await client.getPrompt({
      name: "moodboard_to_ui",
      arguments: { board: "https://www.pinterest.com/jane/ui-inspo/", build: "a landing page" },
    });
    expect((p.messages[0].content as any).text).toContain("a landing page");
    expect((p.messages[0].content as any).text).toContain("get_public_board");
  });
});
