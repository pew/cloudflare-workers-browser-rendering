# Cloudflare Workers Puppeteer

Just playing around with the [Workers Browser Rendering API](https://blog.cloudflare.com/browser-rendering-open-beta/)

It'll accept an URL, uses the Browser API to capture a screenshot of the full page and saves it to R2.

**install everything:**

```shell
npm i
```

**create R2 bucket:**

```shell
npx wrangler r2 bucket create my-bucket
```

add it to `wrangler.toml`:

```toml
r2_buckets  = [
  { binding = "puppeteer", bucket_name = "my-bucket"}
]
```

you may want to make the r2 bucket public so you can access the screenshot directly, the Worker will do an redirect. Put the public bucket url into `wrangler.toml` as the `bucketUrl` environment variable.

**deploy everything:**

```shell
npm run deploy
```

**take a screenshot:**

```
https://your-worker.cool.workers.dev/?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ
```
