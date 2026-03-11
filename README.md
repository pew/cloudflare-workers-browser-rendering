# Cloudflare Workers Browser Rendering

Just playing around with the current [Workers Browser Rendering API](https://developers.cloudflare.com/browser-rendering/)

It'll accept a URL, use Cloudflare's Browser Rendering REST API to generate screenshots, markdown, and pdfs, save those artifacts to R2, and redirect you to the file.

The crawl endpoint is async, so that one returns JSON with a crawl job id and lets you poll for the result later.

**install everything:**

```shell
npm i
```

**set up your config:**

copy `.dev.vars.example` to `.dev.vars`:

```shell
cp .dev.vars.example .dev.vars
```

adjust `bucket_name` in `wrangler.jsonc`, then put your runtime values into `.dev.vars`:

```shell
BUCKET_URL=https://pub-example.r2.dev
CLOUDFLARE_ACCOUNT_ID=YOUR_ACCOUNT_ID
CLOUDFLARE_API_TOKEN=YOUR_API_TOKEN
```

for deployed Workers, you can set those in the dashboard or with `wrangler secret put` instead of committing them to the repo.

**create R2 bucket:**

```shell
npx wrangler r2 bucket create YOUR_BUCKET_NAME
```

**deploy everything:**

```shell
npm run deploy
```

**take a screenshot:**

```text
https://your-worker.cool.workers.dev/screenshot?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

**generate markdown:**

```text
https://your-worker.cool.workers.dev/markdown?url=https://developers.cloudflare.com/browser-rendering/
```

**generate a pdf:**

```text
https://your-worker.cool.workers.dev/pdf?url=https://developers.cloudflare.com/browser-rendering/
```

**start a crawl job:**

```text
https://your-worker.cool.workers.dev/crawl?url=https://developers.cloudflare.com/browser-rendering/
```

**poll a crawl job:**

```text
https://your-worker.cool.workers.dev/crawl?id=YOUR_JOB_ID
```
