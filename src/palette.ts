export type RGB = [number, number, number];

export interface Swatch {
  hex: string;
  /** Share of sampled pixels, 0..1 */
  weight: number;
  luminance: number;
  saturation: number;
}

export interface DesignTokens {
  mode: "light" | "dark";
  palette: Swatch[];
  roles: {
    background: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
  };
  contrast: { textOnBackground: number; accentOnBackground: number };
  css: string;
  tailwind: string;
}

export function toHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): RGB {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
}

/** WCAG relative luminance. */
export function luminance([r, g, b]: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export function saturation([r, g, b]: RGB): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === 0) return 0;
  return (max - min) / max;
}

const dist2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * Deterministic k-means: seeds with the most common coarse color, then farthest-point picks.
 * Deterministic output keeps results reproducible and testable.
 */
export function kMeans(pixels: RGB[], k = 6, iterations = 12): Array<{ color: RGB; count: number }> {
  if (pixels.length === 0) return [];
  // Seed 1: most frequent 4-bit bucket.
  const buckets = new Map<number, { sum: RGB; n: number }>();
  for (const p of pixels) {
    const key = ((p[0] >> 4) << 8) | ((p[1] >> 4) << 4) | (p[2] >> 4);
    const b = buckets.get(key) ?? { sum: [0, 0, 0], n: 0 };
    b.sum[0] += p[0];
    b.sum[1] += p[1];
    b.sum[2] += p[2];
    b.n++;
    buckets.set(key, b);
  }
  const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  const centers: RGB[] = [[top.sum[0] / top.n, top.sum[1] / top.n, top.sum[2] / top.n]];
  while (centers.length < Math.min(k, buckets.size)) {
    let best = pixels[0];
    let bestD = -1;
    for (const p of pixels) {
      const d = Math.min(...centers.map((c) => dist2(p, c)));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    if (bestD <= 0) break;
    centers.push([...best] as RGB);
  }

  let counts = new Array(centers.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    const sums = centers.map(() => [0, 0, 0] as RGB);
    counts = new Array(centers.length).fill(0);
    for (const p of pixels) {
      let bi = 0;
      let bd = Infinity;
      centers.forEach((c, i) => {
        const d = dist2(p, c);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      sums[bi][0] += p[0];
      sums[bi][1] += p[1];
      sums[bi][2] += p[2];
      counts[bi]++;
    }
    centers.forEach((c, i) => {
      if (counts[i]) centers[i] = [sums[i][0] / counts[i], sums[i][1] / counts[i], sums[i][2] / counts[i]];
    });
  }
  return centers
    .map((color, i) => ({ color, count: counts[i] }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function buildDesignTokens(pixels: RGB[], k = 6): DesignTokens {
  if (pixels.length === 0) throw new Error("No pixels to analyze");
  const clusters = kMeans(pixels, k);
  const total = clusters.reduce((s, c) => s + c.count, 0);
  const palette: Swatch[] = clusters.map((c) => ({
    hex: toHex(c.color),
    weight: +(c.count / total).toFixed(3),
    luminance: +luminance(c.color).toFixed(3),
    saturation: +saturation(c.color).toFixed(3),
  }));

  // Background: the dominant low-saturation color; fall back to the dominant color.
  const neutrals = palette.filter((s) => s.saturation < 0.25);
  const bg = (neutrals[0] ?? palette[0]).hex;
  const bgRgb = fromHex(bg);
  const mode: "light" | "dark" = luminance(bgRgb) > 0.4 ? "light" : "dark";

  const others = palette.filter((s) => s.hex !== bg);
  const byContrast = [...others].sort(
    (a, b) => contrastRatio(fromHex(b.hex), bgRgb) - contrastRatio(fromHex(a.hex), bgRgb),
  );
  // Ensure readable text even if the images have no high-contrast color.
  let text = byContrast[0]?.hex ?? (mode === "light" ? "#111111" : "#f5f5f5");
  if (contrastRatio(fromHex(text), bgRgb) < 4.5) text = mode === "light" ? "#111111" : "#f5f5f5";

  const accentCandidate = [...others].sort(
    (a, b) => b.saturation * (0.5 + b.weight) - a.saturation * (0.5 + a.weight),
  )[0];
  const accent = accentCandidate && accentCandidate.saturation > 0.2 ? accentCandidate.hex : text;

  const surface = toHex(mix(bgRgb, fromHex(text), 0.05));
  const muted = toHex(mix(fromHex(text), bgRgb, 0.45));

  const roles = { background: bg, surface, text, muted, accent };
  const css = [
    ":root {",
    ...Object.entries(roles).map(([k2, v]) => `  --color-${k2}: ${v};`),
    ...palette.map((s, i) => `  --palette-${i + 1}: ${s.hex};`),
    "}",
  ].join("\n");
  const tailwind = [
    "// tailwind.config.js → theme.extend.colors",
    "colors: {",
    ...Object.entries(roles).map(([k2, v]) => `  ${k2}: "${v}",`),
    "}",
  ].join("\n");

  return {
    mode,
    palette,
    roles,
    contrast: {
      textOnBackground: +contrastRatio(fromHex(text), bgRgb).toFixed(2),
      accentOnBackground: +contrastRatio(fromHex(accent), bgRgb).toFixed(2),
    },
    css,
    tailwind,
  };
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
