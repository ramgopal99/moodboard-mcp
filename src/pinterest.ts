import { Config } from "./config.js";
import { getAccessToken } from "./auth.js";

export interface PinImage {
  url: string;
  width?: number;
  height?: number;
}

export interface Pin {
  id: string;
  title?: string | null;
  description?: string | null;
  link?: string | null;
  alt_text?: string | null;
  dominant_color?: string | null;
  board_id?: string;
  created_at?: string;
  media?: {
    media_type?: string;
    images?: Record<string, PinImage>;
    cover_image_url?: string;
    duration?: number;
  };
}

export interface Board {
  id: string;
  name: string;
  description?: string | null;
  privacy?: string;
  pin_count?: number;
  follower_count?: number;
}

interface Page<T> {
  items: T[];
  bookmark?: string | null;
}

export class PinterestApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class PinterestClient {
  constructor(
    private config: Config,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const token = await getAccessToken(this.config);
    const url = new URL(this.config.apiBase + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 500);
      try {
        msg = JSON.parse(text).message ?? msg;
      } catch {
        /* keep raw text */
      }
      throw new PinterestApiError(res.status, `Pinterest API ${res.status} on ${path}: ${msg}${hint(res.status)}`);
    }
    return JSON.parse(text) as T;
  }

  /** Follows Pinterest's bookmark pagination until `limit` items are collected. */
  private async paginate<T>(path: string, limit: number, query: Record<string, string | undefined> = {}): Promise<T[]> {
    const out: T[] = [];
    let bookmark: string | undefined;
    do {
      const pageSize = Math.min(100, limit - out.length);
      const page = await this.request<Page<T>>(path, { ...query, page_size: pageSize, bookmark });
      out.push(...page.items);
      bookmark = page.bookmark ?? undefined;
    } while (bookmark && out.length < limit);
    return out.slice(0, limit);
  }

  getUser() {
    return this.request<{ username: string; account_type?: string; profile_image?: string }>("/user_account");
  }

  listBoards(limit = 50) {
    return this.paginate<Board>("/boards", limit);
  }

  getBoard(boardId: string) {
    return this.request<Board>(`/boards/${encodeURIComponent(boardId)}`);
  }

  listBoardPins(boardId: string, limit = 25) {
    return this.paginate<Pin>(`/boards/${encodeURIComponent(boardId)}/pins`, limit);
  }

  getPin(pinId: string) {
    return this.request<Pin>(`/pins/${encodeURIComponent(pinId)}`);
  }

  /** Searches the logged-in user's own saved Pins. */
  searchMyPins(query: string, limit = 25) {
    return this.paginate<Pin>("/search/pins", limit, { query });
  }
}

function hint(status: number): string {
  if (status === 401)
    return " (Hint: your token may be invalid, or your Pinterest app's Trial access may still be pending.)";
  if (status === 403) return " (Hint: this needs a scope or access tier your Pinterest app does not have.)";
  if (status === 429) return " (Hint: rate limit hit. Trial apps are limited per day; try again later.)";
  return "";
}

/** Picks the largest available image for a pin, preferring a reasonable size over huge originals. */
export function pickBestImage(pin: Pin, maxWidth = 1200): PinImage | undefined {
  const images = Object.values(pin.media?.images ?? {}).filter((i) => i?.url);
  if (images.length === 0) {
    return pin.media?.cover_image_url ? { url: pin.media.cover_image_url } : undefined;
  }
  const withinLimit = images.filter((i) => (i.width ?? 0) <= maxWidth);
  const pool = withinLimit.length ? withinLimit : images;
  return pool.reduce((best, i) => ((i.width ?? 0) > (best.width ?? 0) ? i : best));
}

/** Compact, model-friendly summary of a pin. */
export function summarizePin(pin: Pin) {
  const img = pickBestImage(pin);
  return {
    id: pin.id,
    title: pin.title || undefined,
    description: pin.description || undefined,
    alt_text: pin.alt_text || undefined,
    link: pin.link || undefined,
    pin_url: `https://www.pinterest.com/pin/${pin.id}/`,
    media_type: pin.media?.media_type,
    is_video: pin.media?.media_type === "video",
    dominant_color: pin.dominant_color || undefined,
    image_url: img?.url,
  };
}
