# AGENTS.md

## Project Overview

- Single Cloudflare Worker app with the entrypoint at `src/index.ts`.
- Public GET routes are exposed for `/screenshot`, `/markdown`, `/pdf`, and `/crawl`.
- Screenshot, markdown, and pdf requests write artifacts to R2 and return a `307` redirect to the public bucket URL.
- Crawl requests are async: `GET /crawl?url=...` starts a job and `GET /crawl?id=...` polls Cloudflare for status and results.

## Cloudflare Configuration

- Wrangler config lives in `wrangler.jsonc` only. Keep it generic and publishable.
- `compatibility_date` is pinned to `2026-03-11`.
- Per-user runtime values should live in `.dev.vars` for local work or in Worker secrets/dashboard variables for deployed environments.
- `BUCKET_URL` for the public R2 base URL.
- `CLOUDFLARE_ACCOUNT_ID` for the Browser Rendering account ID.
- `artifacts` as the R2 bucket binding used for generated files.
- `CLOUDFLARE_API_TOKEN` as a Worker secret for Browser Rendering REST API calls.

## Browser Rendering Decisions

- Browser Rendering uses Cloudflare REST APIs now; the older Puppeteer/browser binding flow was removed.
- Screenshot, markdown, and pdf generation all use REST endpoints and share the same R2 persistence pattern.
- Crawl defaults to rendered dynamic content with `gotoOptions.waitUntil = "networkidle2"`.
- Crawl defaults to `markdown` output unless `format` query params override it.

## Tooling

- `wrangler` `^4.72.0`
- `typescript` `^5.9.3`
- `prettier` `^3.8.1`
- `nanoid` `^5.1.6`
- TypeScript uses `wrangler types` generated definitions in `worker-configuration.d.ts` instead of `@cloudflare/workers-types`.

## Verification

- Use `npm run typecheck` for local TypeScript verification.
- Use `npx prettier --check README.md AGENTS.md .dev.vars.example env.d.ts wrangler.jsonc src/index.ts package.json tsconfig.json` for formatting checks.
- `npm run cf-typegen` writes Wrangler metadata under `.wrangler-home/` by default to avoid global log/config permission issues.
- Use `XDG_CONFIG_HOME=/tmp/.config npx wrangler deploy --dry-run` if Wrangler cannot write logs in the default config directory.
