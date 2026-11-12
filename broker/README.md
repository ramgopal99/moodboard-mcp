# Auth broker (for maintainers)

This tiny Cloudflare Worker lets **users log in to Pinterest with one click**, without creating their own Pinterest developer app.

Pinterest's token endpoint always needs an app secret, and a secret can't ship inside open-source code. The broker keeps the project's one secret on the server and forwards token requests to Pinterest. It **never stores or logs tokens**: each user's token goes straight back to their own computer.

```
user's PC (moodboard-mcp)           broker (this worker)            Pinterest
  1. GET /config  ───────────────▶  returns public client_id
  2. opens pinterest.com/oauth ──────────────────────────────────▶ user approves
  3. ◀──────── redirect to http://localhost:8085/callback?code=...
  4. POST /token {code} ─────────▶  adds secret, forwards ───────▶ /v5/oauth/token
  5. ◀──────────────────────────── tokens (stored locally only) ◀
```

## Deploy (free tier is enough)

1. In your Pinterest app (<https://developers.pinterest.com/apps/>), add the redirect URI `http://localhost:8085/callback`.
2. Put your App ID in `wrangler.toml` → `PINTEREST_CLIENT_ID`.
3. From this folder:
   ```bash
   npx wrangler login
   npx wrangler secret put PINTEREST_CLIENT_SECRET   # paste the App secret
   npx wrangler deploy
   ```
4. Copy the deployed URL (e.g. `https://moodboard-mcp-auth.<you>.workers.dev`) into `DEFAULT_AUTH_BROKER_URL` in `src/config.ts`, then cut a release.

## Important: Pinterest access tier

While your Pinterest app is on **Trial access**, Pinterest only lets the app owner's account log in. To let **everyone** log in, apply for **Standard access** in the Pinterest developer portal (they ask for a short video of the login flow). Until then, users can still use public board links without logging in.

## Security notes

- Only `authorization_code` and `refresh_token` grants are accepted.
- `redirect_uri` must be in `ALLOWED_REDIRECT_URIS`.
- Request bodies are capped at 4 KB. Responses are `Cache-Control: no-store`.
- Consider adding a Cloudflare rate-limiting rule on `/token`.
