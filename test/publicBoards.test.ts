import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  fetchPublicBoard,
  parseBoardRef,
  parseRss,
  rssUrl,
  upscalePinimg,
} from "../src/publicBoards.js";
import { SAMPLE_RSS, mockFetch } from "./helpers.js";

describe("parseBoardRef", () => {
  it.each([
    ["https://www.pinterest.com/jane/ui-inspo/", { username: "jane", board: "ui-inspo" }],
    ["https://in.pinterest.com/jane/ui-inspo", { username: "jane", board: "ui-inspo" }],
    ["pinterest.co.uk/jane/ui-inspo/?invite=1", { username: "jane", board: "ui-inspo" }],
    ["jane/ui-inspo", { username: "jane", board: "ui-inspo" }],
    ["https://www.pinterest.com/jane/", { username: "jane" }],
    ["https://www.pinterest.com/jane/_saved/", { username: "jane" }],
    ["https://www.pinterest.com/jane/ui-inspo.rss", { username: "jane", board: "ui-inspo" }],
  ])("parses %s", (input, expected) => {
    expect(parseBoardRef(input)).toEqual(expected);
  });

  it.each([
    "https://www.pinterest.com/pin/123/",
    "https://example.com/jane/board",
    "https://www.pinterest.com/search/pins/?q=ui",
  ])("rejects %s", (input) => {
    expect(() => parseBoardRef(input)).toThrow();
  });

  it("builds feed URLs", () => {
    expect(rssUrl({ username: "jane", board: "ui-inspo" })).toBe("https://www.pinterest.com/jane/ui-inspo.rss");
    expect(rssUrl({ username: "jane" })).toBe("https://www.pinterest.com/jane/feed.rss");
  });
});

describe("RSS parsing", () => {
  it("decodes entities", () => {
    expect(decodeEntities("a &amp; b &lt;i&gt; &#39;x&#39; &#x1F4CC;")).toBe("a & b <i> 'x' 📌");
  });

  it("upscales Pinterest thumbnails", () => {
    expect(upscalePinimg("https://i.pinimg.com/236x/aa/bb/cc/h.jpg")).toBe("https://i.pinimg.com/736x/aa/bb/cc/h.jpg");
    expect(upscalePinimg("https://i.pinimg.com/170x/aa/h.jpg", "474x")).toBe("https://i.pinimg.com/474x/aa/h.jpg");
  });

  it("parses board metadata and pins", () => {
    const board = parseRss(SAMPLE_RSS);
    expect(board).toMatchObject({
      title: "UI inspo",
      url: "https://www.pinterest.com/jane/ui-inspo",
      description: "Clean interfaces",
    });
    expect(board.pins).toHaveLength(2);
    expect(board.pins[0]).toMatchObject({ id: "123456", title: "Dashboard & cards", description: undefined });
    expect(board.pins[0].media?.images?.["736x"].url).toBe("https://i.pinimg.com/736x/aa/bb/cc/hash1.jpg");
    expect(board.pins[1]).toMatchObject({ id: "e1_AbC-d", description: "Mobile onboarding flow" });
  });

  it("does not leave double-escaped entities in text", () => {
    const xml = SAMPLE_RSS.replace("Mobile onboarding flow", "You&amp;#39;ll love it");
    expect(parseRss(xml).pins[1].description).toBe("You'll love it");
  });
});

describe("fetchPublicBoard", () => {
  it("fetches the board feed", async () => {
    const { impl, calls } = mockFetch({ "/jane/ui-inspo.rss": () => new Response(SAMPLE_RSS) });
    const board = await fetchPublicBoard("https://www.pinterest.com/jane/ui-inspo/", impl);
    expect(board.pins).toHaveLength(2);
    expect(calls).toEqual(["/jane/ui-inspo.rss"]);
  });

  it("gives a clear error for missing or private boards", async () => {
    const { impl } = mockFetch({ "/jane/secret.rss": () => new Response("Board not found", { status: 404 }) });
    await expect(fetchPublicBoard("jane/secret", impl)).rejects.toThrow(/make sure the board is public/);
  });

  it("resolves pin.it short links", async () => {
    const impl = (async (input: string | URL | Request) => {
      const u = String(input);
      if (u.startsWith("https://pin.it/")) {
        const r = new Response("", { status: 200 });
        Object.defineProperty(r, "url", { value: "https://www.pinterest.com/jane/ui-inspo/" });
        return r;
      }
      return new Response(SAMPLE_RSS);
    }) as typeof fetch;
    const board = await fetchPublicBoard("pin.it/AbC123", impl);
    expect(board.title).toBe("UI inspo");
  });
});
