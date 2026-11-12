import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Config } from "./config.js";
import { AuthError, loginMode, noLoginMessage, startLoginFlow } from "./auth.js";
import { fetchPublicBoard } from "./publicBoards.js";
import { deleteToken, readToken, isExpired } from "./tokenStore.js";
import { Pin, PinterestClient, pickBestImage, summarizePin } from "./pinterest.js";
import { decodeRgb, fetchImage } from "./images.js";
import { RGB, buildDesignTokens } from "./palette.js";

export const VERSION = "0.2.0";

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface ServerDeps {
  config: Config;
  client?: PinterestClient;
  fetchImpl?: typeof fetch;
}

const text = (t: string): Content => ({ type: "text", text: t });
const json = (v: unknown): Content => text(JSON.stringify(v, null, 2));

function errorResult(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [text(msg)], isError: true };
}

export function createServer(deps: ServerDeps): McpServer {
  const { config } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const client = deps.client ?? new PinterestClient(config, fetchImpl);
  let pendingLogin: { url: string; done: Promise<unknown>; error?: string; finished?: boolean } | undefined;

  const server = new McpServer({ name: "moodboard-mcp", version: VERSION });

  async function pinsWithImages(pins: Pin[], maxImages: number): Promise<Content[]> {
    const out: Content[] = [json(pins.map(summarizePin))];
    for (const pin of pins.slice(0, maxImages)) {
      const img = pickBestImage(pin);
      if (!img) continue;
      try {
        const f = await fetchImage(img.url, 768, fetchImpl);
        out.push(text(`Pin ${pin.id}${pin.title ? ` — ${pin.title}` : ""}`));
        out.push({ type: "image", data: f.data, mimeType: f.mimeType });
      } catch (e) {
        out.push(text(`(Could not load image for pin ${pin.id}: ${(e as Error).message})`));
      }
    }
    return out;
  }

  // ---------- Auth ----------

  server.registerTool(
    "pinterest_login",
    {
      title: "Log in to Pinterest",
      description:
        "Starts the official Pinterest OAuth login (needed only for the user's own private/secret boards and search; public boards work without it via get_public_board). Opens the Pinterest consent page in the browser and waits briefly for approval. If approval takes longer, returns the URL; call pinterest_auth_status afterwards.",
      inputSchema: {},
    },
    async () => {
      try {
        const mode = loginMode(config);
        if (mode === "static")
          return { content: [text("Using PINTEREST_ACCESS_TOKEN from the environment; no login needed.")] };
        if (mode === "none") return { content: [text(noLoginMessage())] };
        if (!pendingLogin || pendingLogin.finished) {
          const flow = await startLoginFlow(config, { fetchImpl });
          const entry: NonNullable<typeof pendingLogin> = { url: flow.authorizeUrl, done: flow.done };
          flow.done.then(
            () => (entry.finished = true),
            (e) => {
              entry.finished = true;
              entry.error = (e as Error).message;
            },
          );
          pendingLogin = entry;
        }
        const entry = pendingLogin;
        const result = await Promise.race([
          entry.done.then(
            () => "ok" as const,
            () => "error" as const,
          ),
          new Promise<"waiting">((r) => setTimeout(() => r("waiting"), 45_000)),
        ]);
        if (result === "ok") {
          const user = await client.getUser().catch(() => undefined);
          return { content: [text(`Logged in to Pinterest${user ? ` as @${user.username}` : ""}.`)] };
        }
        if (result === "error") return errorResult(new AuthError(entry.error ?? "Login failed"));
        return {
          content: [
            text(
              `A Pinterest login page was opened in the browser. If it did not open, visit:\n${entry.url}\n\nAfter approving, call pinterest_auth_status.`,
            ),
          ],
        };
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "pinterest_auth_status",
    {
      title: "Check Pinterest login",
      description: "Shows whether the user is logged in to Pinterest and which account is connected.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        if (pendingLogin && !pendingLogin.finished)
          return { content: [text(`Login in progress. Waiting for approval at:\n${pendingLogin.url}`)] };
        if (!config.accessToken) {
          const t = await readToken(config.tokenFile);
          if (!t)
            return {
              content: [
                text(
                  loginMode(config) === "none"
                    ? `Not logged in. ${noLoginMessage()}`
                    : "Not logged in. Call pinterest_login (public boards work without login via get_public_board).",
                ),
              ],
            };
          if (isExpired(t) && !t.refresh_token) return { content: [text("Login expired. Call pinterest_login.")] };
        }
        const user = await client.getUser();
        return { content: [text(`Logged in as @${user.username} (${user.account_type ?? "account"}).`)] };
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "pinterest_logout",
    {
      title: "Log out of Pinterest",
      description: "Deletes the locally stored Pinterest token.",
      inputSchema: {},
      annotations: { destructiveHint: true },
    },
    async () => {
      await deleteToken(config.tokenFile);
      return { content: [text("Logged out. The local Pinterest token was deleted.")] };
    },
  );

  // ---------- No-login: public boards ----------

  server.registerTool(
    "get_public_board",
    {
      title: "Get a public board (no login)",
      description:
        "Reads any PUBLIC Pinterest board or profile from its link, with no login or keys. Returns the latest ~25 pins, with images attached so the model can see them. Accepts board URLs on any Pinterest domain, pin.it short links, or 'username/board-name'. Prefer this tool when the user shares a board link.",
      inputSchema: {
        board_url: z
          .string()
          .min(1)
          .describe("e.g. https://www.pinterest.com/username/board-name/ or username/board-name"),
        limit: z.number().int().min(1).max(50).default(25),
        include_images: z.boolean().default(true),
        max_images: z
          .number()
          .int()
          .min(0)
          .max(20)
          .default(8)
          .describe("How many images to attach (images use context)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ board_url, limit, include_images, max_images }) => {
      try {
        const board = await fetchPublicBoard(board_url, fetchImpl);
        const pins = board.pins.slice(0, limit);
        const header = json({
          board: board.title,
          url: board.url,
          description: board.description,
          pin_count: pins.length,
        });
        if (!include_images) return { content: [header, json(pins.map(summarizePin))] };
        return { content: [header, ...(await pinsWithImages(pins, max_images))] };
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  // ---------- Reading (logged in) ----------

  server.registerTool(
    "list_boards",
    {
      title: "List Pinterest boards",
      description: "Lists the logged-in user's Pinterest boards (id, name, pin count).",
      inputSchema: { limit: z.number().int().min(1).max(250).default(50) },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      try {
        const boards = await client.listBoards(limit);
        return {
          content: [
            json(
              boards.map((b) => ({
                id: b.id,
                name: b.name,
                description: b.description || undefined,
                pin_count: b.pin_count,
                privacy: b.privacy,
              })),
            ),
          ],
        };
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "get_board_pins",
    {
      title: "Get pins from a board",
      description:
        "Gets pins from a board. With include_images=true, the actual images are returned so the model can see the designs (use this for UI/visual inspiration).",
      inputSchema: {
        board_id: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(25),
        include_images: z.boolean().default(true),
        max_images: z
          .number()
          .int()
          .min(0)
          .max(20)
          .default(8)
          .describe("How many images to attach (images use context)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ board_id, limit, include_images, max_images }) => {
      try {
        const pins = await client.listBoardPins(board_id, limit);
        if (!include_images) return { content: [json(pins.map(summarizePin))] };
        return { content: await pinsWithImages(pins, max_images) };
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "get_pin",
    {
      title: "Get a pin",
      description: "Gets one pin's details and (optionally) its image.",
      inputSchema: { pin_id: z.string().min(1), include_image: z.boolean().default(true) },
      annotations: { readOnlyHint: true },
    },
    async ({ pin_id, include_image }) => {
      try {
        const pin = await client.getPin(pin_id);
        return { content: include_image ? await pinsWithImages([pin], 1) : [json(summarizePin(pin))] };
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "search_my_pins",
    {
      title: "Search my saved pins",
      description:
        "Searches the pins the logged-in user has saved (not all of Pinterest — the public search API needs special partner access).",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(25),
        include_images: z.boolean().default(false),
        max_images: z.number().int().min(0).max(20).default(6),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit, include_images, max_images }) => {
      try {
        const pins = await client.searchMyPins(query, limit);
        if (!include_images) return { content: [json(pins.map(summarizePin))] };
        return { content: await pinsWithImages(pins, max_images) };
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  // ---------- Design ----------

  server.registerTool(
    "extract_design_tokens",
    {
      title: "Extract design tokens",
      description:
        "Analyzes the images on a board (public board link, logged-in board id, or a list of pins) and returns a color palette with roles (background, surface, text, muted, accent), WCAG contrast ratios, CSS variables and a Tailwind colors snippet.",
      inputSchema: {
        board_url: z.string().optional().describe("Public board link; works without login"),
        board_id: z.string().optional().describe("Board id from list_boards (needs login)"),
        pin_ids: z.array(z.string()).max(50).optional(),
        max_pins: z.number().int().min(1).max(50).default(20),
        colors: z.number().int().min(3).max(12).default(6),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ board_url, board_id, pin_ids, max_pins, colors }) => {
      try {
        if (!board_url && !board_id && !pin_ids?.length) throw new Error("Provide board_url, board_id or pin_ids.");
        const pins = board_url
          ? (await fetchPublicBoard(board_url, fetchImpl)).pins.slice(0, max_pins)
          : board_id
            ? await client.listBoardPins(board_id, max_pins)
            : await Promise.all(pin_ids!.slice(0, max_pins).map((id) => client.getPin(id)));
        const pixels: RGB[] = [];
        let analyzed = 0;
        for (const pin of pins) {
          const img = pickBestImage(pin, 600);
          if (!img) continue;
          try {
            const res = await fetchImpl(img.url);
            if (!res.ok) continue;
            pixels.push(...(await decodeRgb(Buffer.from(await res.arrayBuffer()))));
            analyzed++;
          } catch {
            /* skip unreadable image */
          }
        }
        if (!analyzed) throw new Error("None of the pin images could be downloaded.");
        const tokens = buildDesignTokens(pixels, colors);
        return { content: [json({ analyzed_pins: analyzed, ...tokens })] };
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  // ---------- Prompts ----------

  server.registerPrompt(
    "moodboard_to_ui",
    {
      title: "Build UI from a Pinterest board",
      description: "Study a Pinterest board and build a UI in the same visual style.",
      argsSchema: {
        board: z.string().describe("Public board link, or a board id from list_boards"),
        build: z.string().describe("What to build, e.g. 'a fitness app home screen'"),
      },
    },
    ({ board, build }) => {
      const isLink = /pinterest\.|pin\.it|\//i.test(board);
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Use Pinterest board ${board} as the visual reference for: ${build}.`,
                isLink
                  ? "1. Call get_public_board with this link and study the images."
                  : "1. Call get_board_pins with include_images=true and study the images.",
                isLink
                  ? "2. Call extract_design_tokens with board_url set to this link."
                  : "2. Call extract_design_tokens with board_id set to this board.",
                "3. Write a short style guide: color roles, typography feel (serif/sans, weight, scale), spacing density, corner radius, shadows, imagery and iconography, layout patterns, and motion cues.",
                "4. Build the UI following that style guide, using the extracted tokens. Do not copy any single pin; combine the shared patterns.",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  return server;
}
