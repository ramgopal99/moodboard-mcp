# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0]

### Added

- **No-login mode:** `get_public_board` reads any public board or profile from its link (any Pinterest domain, `pin.it` short links). `extract_design_tokens` accepts `board_url`.
- **One-click login support:** optional hosted auth broker (`broker/`, Cloudflare Worker) so users can log in without creating a Pinterest app. Configure with `PINTEREST_AUTH_BROKER_URL`.
- One-click Claude Desktop extension (`.mcpb`), built with `npm run build:mcpb`.

### Changed

- `moodboard_to_ui` prompt takes `board` (a link or a board id).
- Login now explains the no-login option instead of failing when no app is configured.

## [0.1.0]

### Added

- Official Pinterest OAuth login with local callback, token storage and automatic refresh.
- Tools: `pinterest_login`, `pinterest_auth_status`, `pinterest_logout`, `list_boards`, `get_board_pins`, `get_pin`, `search_my_pins`, `extract_design_tokens`.
- Prompt: `moodboard_to_ui`.
- Test suite with a mocked Pinterest API.
