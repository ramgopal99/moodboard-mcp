# Contributing to moodboard-mcp

Thanks for wanting to help! Every contribution counts: a typo fix, a bug report, a test, or a new feature.

## Ways to contribute

- **Report a bug**: open an issue with the _Bug report_ template.
- **Suggest a feature**: open an issue with the _Feature request_ template.
- **Pick up an issue**: look for **good first issue** or **help wanted**. Comment on the issue so others know you are on it.
- **Improve docs**: setup guides for other MCP clients are always welcome.

## Development setup

Requirements: Node.js 20+ and npm.

```bash
git clone https://github.com/ramgopal99/moodboard-mcp.git
cd moodboard-mcp
npm install
npm run build      # compile TypeScript to dist/
npm test           # run the test suite
npm run check      # typecheck + formatting + tests (same as CI)
```

Try your changes with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

You do **not** need Pinterest API access to work on most things: the tests mock the Pinterest API. If you want to test against the real API, create your own Pinterest app (see README) and set `PINTEREST_CLIENT_ID` / `PINTEREST_CLIENT_SECRET`, or `PINTEREST_ACCESS_TOKEN`.

## Project layout

```
src/
  index.ts       entry point (stdio transport)
  server.ts      MCP tools and prompts
  auth.ts        Pinterest OAuth flow + token refresh
  tokenStore.ts  local token file
  pinterest.ts   Pinterest API v5 client
  images.ts      image download / resize / decode
  palette.ts     color clustering and design tokens (pure functions)
test/            vitest tests (API is mocked)
```

## Pull request checklist

1. Fork the repo and create a branch: `git checkout -b feat/short-description`.
2. Keep PRs focused: one change per PR.
3. Add or update tests for behavior changes.
4. Run `npm run format` and `npm run check`, and make sure they pass.
5. Update the README if you change tools, config or behavior.
6. Use a clear title, ideally [Conventional Commits](https://www.conventionalcommits.org/) style: `feat: ...`, `fix: ...`, `docs: ...`.
7. Fill in the PR template.

## Ground rules

- **Official API only.** No scraping, cookie capture, or anything that breaks Pinterest's Terms of Service. PRs that add this will be closed.
- **Read-only by default.** New write scopes need a strong reason and a discussion issue first.
- **Never commit secrets.** No tokens, app secrets or `.env` files.
- Write to **stderr** only; stdout is reserved for the MCP protocol.

## Code of Conduct

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
