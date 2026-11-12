import { describe, expect, it } from "vitest";
import { buildDesignTokens, contrastRatio, fromHex, kMeans, toHex, RGB } from "../src/palette.js";

const fill = (c: RGB, n: number): RGB[] => Array.from({ length: n }, () => [...c] as RGB);

describe("palette", () => {
  it("round-trips hex", () => {
    expect(toHex([255, 0, 128])).toBe("#ff0080");
    expect(fromHex("#ff0080")).toEqual([255, 0, 128]);
    expect(fromHex("#fff")).toEqual([255, 255, 255]);
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
  });

  it("clusters distinct colors deterministically", () => {
    const px = [...fill([250, 250, 250], 700), ...fill([20, 20, 20], 200), ...fill([230, 40, 40], 100)];
    const a = kMeans(px, 3);
    const b = kMeans(px, 3);
    expect(a).toEqual(b);
    expect(a.map((c) => toHex(c.color))).toEqual(["#fafafa", "#141414", "#e62828"]);
  });

  it("assigns sensible roles for a light moodboard", () => {
    const px = [...fill([250, 250, 250], 700), ...fill([20, 20, 20], 200), ...fill([230, 40, 40], 100)];
    const t = buildDesignTokens(px, 3);
    expect(t.mode).toBe("light");
    expect(t.roles.background).toBe("#fafafa");
    expect(t.roles.text).toBe("#141414");
    expect(t.roles.accent).toBe("#e62828");
    expect(t.contrast.textOnBackground).toBeGreaterThan(4.5);
    expect(t.css).toContain("--color-accent: #e62828;");
    expect(t.tailwind).toContain('accent: "#e62828"');
  });

  it("detects dark mode and guarantees readable text", () => {
    const px = [...fill([15, 15, 25], 900), ...fill([40, 40, 50], 100)];
    const t = buildDesignTokens(px, 2);
    expect(t.mode).toBe("dark");
    expect(t.contrast.textOnBackground).toBeGreaterThanOrEqual(4.5);
  });

  it("rejects empty input", () => {
    expect(() => buildDesignTokens([])).toThrow();
  });
});
