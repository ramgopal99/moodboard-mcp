# moodboard-mcp

**Turn your Pinterest boards into design references for AI coding assistants.**

`moodboard-mcp` is an open-source [Model Context Protocol](https://modelcontextprotocol.io) server. It lets Claude, Cursor, VS Code and other MCP clients **log in to your Pinterest with the official OAuth flow**, **see the images on your boards**, and **extract design tokens** (palette, color roles, contrast, CSS variables, Tailwind colors) so they can build UI in the style you like.

```
You:    Use my "SaaS dashboards" board to design a settings page.
Claude: → list_boards → get_board_pins (sees 8 images) → extract_design_tokens
        → writes a style guide → builds the page with your palette.
```

[![CI](https://github.com/ramgopal99/moodboard-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ramgopal99/moodboard-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## Features

| Tool                    | What it does                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `pinterest_login`       | Official Pinterest OAuth login in your browser. Token is stored locally and refreshed automatically. |
| `pinterest_auth_status` | Shows which Pinterest account is connected.                                                          |
| `pinterest_logout`      | Deletes the local token.                                                                             |
| `list_boards`           | Lists your boards.                                                                                   |
| `get_board_pins`        | Gets pins from a board, **with the images attached** so the model can actually see them.             |
| `get_pin`               | One pin with its image.                                                                              |
| `search_my_pins`        | Searches pins you have saved.                                                                        |
| `extract_design_tokens` | Palette + roles (background, surface, text, muted, accent), WCAG contrast, CSS vars, Tailwind.       |

Prompt: **`moodboard_to_ui`**: "study board X and build Y in the same style".

**Privacy by design:** read-only scopes (`boards:read`, `pins:read`, `user_accounts:read`), runs locally on your machine, no scraping, no cookies, no third-party servers. Your token never leaves your computer except to talk to `api.pinterest.com`.

## Quick start

### 1. Create your own Pinterest app (one time, ~5 minutes)

Each user brings their own free Pinterest app. That keeps secrets out of this repo and gives you your own rate limit.

1. You need a Pinterest **business** account (free; you can convert a personal one in settings).
2. Go to <https://developers.pinterest.com/apps/> → **Connect app** and fill in the form. Request **Trial access**.
3. In the app settings, add this **Redirect URI**:
   ```
   http://localhost:8085/callback
   ```
4. Copy the **App ID** and **App secret key**.

> Trial access approval can take a few days. Until it is approved, the API returns `401 ... consumer type is not supported`. That is a Pinterest-side wait, not a bug in this server.

### 2. Add the server to your MCP client

**Claude Desktop**: edit `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "moodboard": {
      "command": "npx",
      "args": ["-y", "moodboard-mcp"],
      "env": {
        "PINTEREST_CLIENT_ID": "your-app-id",
        "PINTEREST_CLIENT_SECRET": "your-app-secret"
      }
    }
  }
}
```

**Claude Code**

```bash
claude mcp add moodboard -e PINTEREST_CLIENT_ID=your-app-id -e PINTEREST_CLIENT_SECRET=your-app-secret -- npx -y moodboard-mcp
```

**Cursor**: `~/.cursor/mcp.json` uses the same JSON as Claude Desktop.

### 3. Log in

Ask your assistant: **"Log in to Pinterest."** A browser tab opens, you approve, done.

Then try:

- "List my Pinterest boards."
- "Show me the pins on my _Mobile UI_ board."
- "Extract design tokens from my _Brand_ board and give me a Tailwind config."
- Use the `moodboard_to_ui` prompt with a board id and what you want built.

## Configuration

| Variable                  | Default            | Description                                                   |
| ------------------------- | ------------------ | ------------------------------------------------------------- |
| `PINTEREST_CLIENT_ID`     | (none)             | Your Pinterest App ID.                                        |
| `PINTEREST_CLIENT_SECRET` | (none)             | Your Pinterest App secret.                                    |
| `PINTEREST_ACCESS_TOKEN`  | (none)             | Optional static token (skips OAuth), handy for quick testing. |
| `PINTEREST_REDIRECT_PORT` | `8085`             | Local port for the OAuth callback. Must match your app.       |
| `PINTEREST_SANDBOX`       | `false`            | Use `api-sandbox.pinterest.com`.                              |
| `MOODBOARD_MCP_HOME`      | `~/.moodboard-mcp` | Where the token file is stored.                               |

## Limitations (honest)

- **Searching all of Pinterest is not available** through the public API. Pinterest's site-wide search endpoint requires partner approval, so `search_my_pins` searches only _your_ saved pins. Workflow tip: save inspiration to a board, then point the assistant at that board.
- **Video pins** return their cover image for now. Frame extraction is on the roadmap.
- Trial apps have daily rate limits. Plenty for inspiration, but not for bulk export.

## Develop from source

```bash
git clone https://github.com/ramgopal99/moodboard-mcp.git
cd moodboard-mcp
npm install
npm run build
npm test
```

Point your MCP client at `node /absolute/path/to/moodboard-mcp/dist/index.js`. You can also use the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Roadmap

- [ ] Video pin frame extraction (motion/style references)
- [ ] Typography hints (detect serif/sans, weight) from images
- [ ] Export a full design-system JSON (spacing, radius, shadows)
- [ ] Optional Streamable HTTP transport for remote hosting
- [ ] Publish to the official MCP Registry

Want to help? See [CONTRIBUTING.md](CONTRIBUTING.md). Issues labelled **good first issue** are a great start.

## Contributing

Contributions of all sizes are welcome: bug reports, docs, tests, features. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Ramgopal Bagh

_Not affiliated with or endorsed by Pinterest. Pinterest is a trademark of Pinterest, Inc._
