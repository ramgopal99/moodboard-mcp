# moodboard-mcp

**Turn your Pinterest boards into design references for AI coding assistants.**

`moodboard-mcp` is an open-source [Model Context Protocol](https://modelcontextprotocol.io) server. Paste **any public Pinterest board link** (no account, no keys, no setup) and Claude, Cursor, VS Code or any MCP client can **see the images** and **extract design tokens** (palette, color roles, contrast, CSS variables, Tailwind colors) to build UI in that style. Optionally **log in with the official Pinterest OAuth flow** to use your private boards too.

```
You:    Design a settings page in the style of https://www.pinterest.com/jane/saas-dashboards/
Claude: → get_public_board (sees 8 images) → extract_design_tokens
        → writes a style guide → builds the page with that palette.
```

[![CI](https://github.com/ramgopal99/moodboard-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ramgopal99/moodboard-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## Features

| Tool                    | What it does                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `get_public_board`      | **No login.** Reads any public board or profile from its link (latest ~25 pins), with images.        |
| `pinterest_login`       | Official Pinterest OAuth login in your browser. Token is stored locally and refreshed automatically. |
| `pinterest_auth_status` | Shows which Pinterest account is connected.                                                          |
| `pinterest_logout`      | Deletes the local token.                                                                             |
| `list_boards`           | Lists your boards.                                                                                   |
| `get_board_pins`        | Gets pins from a board, **with the images attached** so the model can actually see them.             |
| `get_pin`               | One pin with its image.                                                                              |
| `search_my_pins`        | Searches pins you have saved.                                                                        |
| `extract_design_tokens` | Palette + roles (background, surface, text, muted, accent), WCAG contrast, CSS vars, Tailwind.       |

Prompt: **`moodboard_to_ui`**: "study board X and build Y in the same style".

**Privacy by design:** runs locally on your machine, no scraping, no cookies, no analytics. Public boards are read from the RSS feeds Pinterest publishes for them. Login uses read-only scopes (`boards:read`, `pins:read`, `user_accounts:read`) and your token is stored only on your computer.

## Quick start

### 1. Install

**Claude Desktop (one click):** download `moodboard-mcp.mcpb` from the [latest release](https://github.com/ramgopal99/moodboard-mcp/releases/latest) and double-click it (or drag it into Settings → Extensions). Leave the "Advanced" fields empty. No Node.js or config editing needed.

**Claude Code**

```bash
claude mcp add moodboard -- npx -y moodboard-mcp
```

**Cursor / other clients**: add to your MCP config (e.g. `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "moodboard": { "command": "npx", "args": ["-y", "moodboard-mcp"] }
  }
}
```

### 2. Use it (no login)

Copy a board link from Pinterest (browser address bar, or Share → Copy link) and ask:

- "Here's my moodboard: https://www.pinterest.com/username/board-name/. Design a landing page in this style."
- "Extract the color palette from this board as a Tailwind config: <link>"
- Use the `moodboard_to_ui` prompt with a board link and what you want built.

Works for any **public** board or profile, on any Pinterest domain, including `pin.it` short links.

### 3. Optional: log in for private boards

Logging in adds `list_boards`, `get_board_pins`, `get_pin`, `search_my_pins` and access to your secret boards.

**One-click login:** when a release includes the hosted login service, just ask _"Log in to Pinterest"_, approve in the browser tab that opens, and you're done. Nothing to configure.

**Use your own Pinterest app (advanced):** needed if the release has no hosted login, or if you prefer not to use it.

1. You need a Pinterest **business** account (free; you can convert a personal one in settings).
2. Go to <https://developers.pinterest.com/apps/> → **Connect app**, request **Trial access**, and add the redirect URI `http://localhost:8085/callback`.
3. Put the **App ID** and **App secret** in the extension's Advanced fields, or set `PINTEREST_CLIENT_ID` / `PINTEREST_CLIENT_SECRET` in your MCP config.

> Trial access approval can take a few days. Until it is approved, the API returns `401 ... consumer type is not supported`.

### How login works (for the curious)

Pinterest's token endpoint always requires an app secret, and a secret can't be shipped inside open-source code. So the project runs a tiny [auth broker](broker/README.md) that holds the secret and forwards the token request. Your token comes straight back to your computer; the broker never stores or logs it. You can always skip it by using your own app.

## Configuration

| Variable                    | Default            | Description                                                   |
| --------------------------- | ------------------ | ------------------------------------------------------------- |
| `PINTEREST_CLIENT_ID`       | (none)             | Your Pinterest App ID.                                        |
| `PINTEREST_CLIENT_SECRET`   | (none)             | Your Pinterest App secret.                                    |
| `PINTEREST_ACCESS_TOKEN`    | (none)             | Optional static token (skips OAuth), handy for quick testing. |
| `PINTEREST_AUTH_BROKER_URL` | built-in           | Hosted login service. Set to `none` to disable.               |
| `PINTEREST_REDIRECT_PORT`   | `8085`             | Local port for the OAuth callback. Must match your app.       |
| `PINTEREST_SANDBOX`         | `false`            | Use `api-sandbox.pinterest.com`.                              |
| `MOODBOARD_MCP_HOME`        | `~/.moodboard-mcp` | Where the token file is stored.                               |

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
