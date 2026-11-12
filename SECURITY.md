# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Instead, use GitHub's **private vulnerability reporting** (Security tab → _Report a vulnerability_) or email **ramgopalbagh009@gmail.com**. Include steps to reproduce and the affected version. You should get a reply within 7 days.

## How this server handles your data

- Uses the official Pinterest OAuth flow with **read-only** scopes.
- The OAuth callback server listens on `127.0.0.1` only, checks a random `state` value, and shuts down after one login.
- Tokens are stored locally in `~/.moodboard-mcp/token.json` (file mode `600` on macOS/Linux) and sent only to `api.pinterest.com`.
- No analytics, telemetry, or third-party servers.

## Supported versions

Only the latest released version receives security fixes.
