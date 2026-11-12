import { describe, expect, it } from "vitest";
import { PinterestClient, pickBestImage, summarizePin } from "../src/pinterest.js";
import { jsonRes, mockFetch, testConfig } from "./helpers.js";

describe("pickBestImage", () => {
  it("prefers the largest image within the width limit", () => {
    const pin = {
      id: "1",
      media: {
        images: {
          "150x150": { url: "s", width: 150 },
          "600x": { url: "m", width: 600 },
          "1200x": { url: "l", width: 1200 },
          originals: { url: "o", width: 4000 },
        },
      },
    };
    expect(pickBestImage(pin)?.url).toBe("l");
    expect(pickBestImage(pin, 600)?.url).toBe("m");
  });

  it("falls back to a video cover image", () => {
    expect(pickBestImage({ id: "1", media: { media_type: "video", cover_image_url: "c" } })?.url).toBe("c");
    expect(pickBestImage({ id: "1" })).toBeUndefined();
  });

  it("summarizes pins for the model", () => {
    const s = summarizePin({ id: "42", title: "", media: { media_type: "video", cover_image_url: "c" } });
    expect(s).toMatchObject({ id: "42", is_video: true, image_url: "c", pin_url: "https://www.pinterest.com/pin/42/" });
    expect(s.title).toBeUndefined();
  });
});

describe("PinterestClient", () => {
  it("follows bookmark pagination and stops at the limit", async () => {
    const { impl, calls } = mockFetch({
      "/v5/boards/b1/pins": (url) =>
        url.searchParams.get("bookmark")
          ? jsonRes({ items: [{ id: "3" }, { id: "4" }], bookmark: "next2" })
          : jsonRes({ items: [{ id: "1" }, { id: "2" }], bookmark: "next" }),
    });
    const client = new PinterestClient(testConfig({ accessToken: "t" }), impl);
    const pins = await client.listBoardPins("b1", 3);
    expect(pins.map((p) => p.id)).toEqual(["1", "2", "3"]);
    expect(calls).toHaveLength(2);
  });

  it("turns API errors into helpful messages", async () => {
    const { impl } = mockFetch({
      "/v5/user_account": () => jsonRes({ code: 3, message: "consumer type is not supported" }, 401),
    });
    const client = new PinterestClient(testConfig({ accessToken: "t" }), impl);
    await expect(client.getUser()).rejects.toThrow(/consumer type is not supported.*Trial access/);
  });

  it("requires login when there is no token", async () => {
    const client = new PinterestClient(testConfig(), mockFetch({}).impl);
    await expect(client.getUser()).rejects.toThrow(/pinterest_login/);
  });
});
