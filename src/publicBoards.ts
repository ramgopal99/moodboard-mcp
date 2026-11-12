import { Pin } from "./pinterest.js";

/**
 * No-login mode: reads PUBLIC boards and profiles through the RSS feeds Pinterest
 * publishes for them (https://www.pinterest.com/<user>/<board>.rss).
 * No account, app or keys needed. Feeds hold roughly the latest 25 pins.
 */

export interface PublicBoardRef {
  username: string;
  /** Board slug; undefined means the user's profile feed. */
  board?: string;
}

export interface PublicBoard {
  title: string;
  url: string;
  description?: string;
  pins: Pin[];
}

const RESERVED = new Set(["pin", "search", "ideas", "today", "settings", "business", "_", "explore", "login", "oauth"]);

/** Accepts board/profile URLs on any Pinterest domain, or "user/board" / "user" shorthand. */
export function parseBoardRef(input: string): PublicBoardRef {
  let s = input.trim();
  let pathPart: string;
  if (/^https?:\/\//i.test(s) || /pinterest\./i.test(s)) {
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    const url = new URL(s);
    if (!/(^|\.)pinterest\.[a-z.]+$/i.test(url.hostname)) {
      throw new Error(`Not a Pinterest URL: ${input}`);
    }
    pathPart = url.pathname;
  } else {
    pathPart = s;
  }
  const parts = pathPart
    .replace(/\.rss$/i, "")
    .split("/")
    .filter(Boolean)
    .map((p) => decodeURIComponent(p));
  if (parts.length === 0 || RESERVED.has(parts[0].toLowerCase())) {
    throw new Error(
      `"${input}" is not a board or profile link. Use a link like https://www.pinterest.com/username/board-name/`,
    );
  }
  const [username, board] = parts;
  if (board && ["_saved", "_created", "pins", "boards"].includes(board.toLowerCase())) return { username };
  if (parts.length > 2) {
    throw new Error(`"${input}" looks like a board section. Use the board link instead: /${username}/${board}/`);
  }
  return { username, board };
}

export function rssUrl(ref: PublicBoardRef): string {
  const u = encodeURIComponent(ref.username);
  return ref.board
    ? `https://www.pinterest.com/${u}/${encodeURIComponent(ref.board)}.rss`
    : `https://www.pinterest.com/${u}/feed.rss`;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]).trim() : undefined;
};

/** Pinterest feeds use small 236px thumbnails; the same path exists at other sizes. */
export function upscalePinimg(url: string, size = "736x"): string {
  return url.replace(/(i\.pinimg\.com\/)\d+x(\d+)?(_[A-Z]+)?\//, `$1${size}/`);
}

export function parseRss(xml: string): PublicBoard {
  const channel = xml.split(/<item[\s>]/i)[0];
  const items = [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  const pins: Pin[] = items.map((item, i) => {
    const link = tag(item, "link") ?? tag(item, "guid") ?? "";
    const id = link.match(/\/pin\/([^/?#]+)/)?.[1] ?? `item-${i + 1}`;
    const descHtml = tag(item, "description") ?? "";
    const img = descHtml.match(/<img[^>]+src="([^"]+)"/i)?.[1];
    // The description is escaped HTML; after stripping tags its text can still hold entities.
    const text = decodeEntities(descHtml.replace(/<[^>]+>/g, "")).trim();
    const title = tag(item, "title") && decodeEntities(tag(item, "title")!);
    return {
      id,
      title: title || undefined,
      description: text && text !== title ? text : undefined,
      created_at: tag(item, "pubDate"),
      media: img
        ? {
            media_type: "image",
            images: {
              "236x": { url: img, width: 236 },
              "736x": { url: upscalePinimg(img, "736x"), width: 736 },
            },
          }
        : undefined,
    };
  });
  return {
    title: tag(channel, "title") ?? "Pinterest board",
    url: tag(channel, "link") ?? "",
    description: tag(channel, "description") || undefined,
    pins,
  };
}

/** Follows pin.it short links to the real board URL. */
async function resolveShortLink(input: string, fetchImpl: typeof fetch): Promise<string> {
  if (!/^(https?:\/\/)?pin\.it\//i.test(input.trim())) return input;
  const url = /^https?:/i.test(input) ? input : `https://${input.trim()}`;
  const res = await fetchImpl(url, { redirect: "follow" });
  return res.url || url;
}

export async function fetchPublicBoard(input: string, fetchImpl: typeof fetch = fetch): Promise<PublicBoard> {
  const ref = parseBoardRef(await resolveShortLink(input, fetchImpl));
  const url = rssUrl(ref);
  const res = await fetchImpl(url, {
    headers: {
      "User-Agent": "moodboard-mcp (+https://github.com/ramgopal99/moodboard-mcp)",
      Accept: "application/rss+xml, text/xml",
    },
  });
  if (res.status === 404) {
    throw new Error(
      `Pinterest could not find ${ref.board ? `board "${ref.board}" by @${ref.username}` : `user @${ref.username}`}. Check the link, and make sure the board is public (secret boards need pinterest_login).`,
    );
  }
  if (!res.ok) throw new Error(`Pinterest feed request failed (${res.status}) for ${url}`);
  const board = parseRss(await res.text());
  if (board.pins.length === 0) {
    throw new Error(
      "That board's public feed is empty. Pinterest sometimes returns empty feeds; try again later or use pinterest_login.",
    );
  }
  return board;
}
