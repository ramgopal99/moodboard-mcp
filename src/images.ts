import { Jimp } from "jimp";

export interface FetchedImage {
  data: string; // base64
  mimeType: string;
}

const MAX_BYTES = 8 * 1024 * 1024;

/** Downloads an image and returns it as base64, downscaled so it is cheap to send to a model. */
export async function fetchImage(url: string, maxSide = 768, fetchImpl: typeof fetch = fetch): Promise<FetchedImage> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Image download failed (${res.status}) for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error(`Image too large (${buf.byteLength} bytes): ${url}`);
  const img = await Jimp.read(buf);
  if (Math.max(img.width, img.height) > maxSide) {
    if (img.width >= img.height) img.resize({ w: maxSide });
    else img.resize({ h: maxSide });
  }
  const out = await img.getBuffer("image/jpeg", { quality: 82 });
  return { data: out.toString("base64"), mimeType: "image/jpeg" };
}

export async function decodeRgb(buf: Buffer, sampleSide = 64): Promise<Array<[number, number, number]>> {
  const img = await Jimp.read(buf);
  img.resize({ w: sampleSide, h: sampleSide });
  const px: Array<[number, number, number]> = [];
  const d = img.bitmap.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue; // skip transparent
    px.push([d[i], d[i + 1], d[i + 2]]);
  }
  return px;
}
