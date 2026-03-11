import { nanoid } from 'nanoid'

type WaitUntil = 'domcontentloaded' | 'load' | 'networkidle0' | 'networkidle2'
type CrawlResultStatus = 'queued' | 'completed' | 'disallowed' | 'skipped' | 'errored' | 'cancelled'
type CrawlFormat = 'html' | 'markdown'

interface CloudflareApiEnvelope<T> {
  success?: boolean
  errors?: Array<{ code?: number; message?: string }>
  messages?: Array<{ code?: number; message?: string }>
  result?: T
}

const DEFAULT_GOTO_OPTIONS = {
  timeout: 45_000,
  waitUntil: 'networkidle2' as WaitUntil,
}

const DEFAULT_CRAWL_GOTO_OPTIONS = {
  timeout: 60_000,
  waitUntil: 'networkidle2' as WaitUntil,
}

const SCREENSHOT_OPTIONS = {
  fullPage: true,
}

const VIEWPORT = {
  width: 1280,
  height: 720,
}

const DEFAULT_CRAWL_FORMATS: CrawlFormat[] = ['markdown']

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET') {
      return textResponse('Method not allowed', 405)
    }

    if (!env.BUCKET_URL || !env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
      return jsonResponse(
        {
          error: 'Worker misconfiguration. Expected BUCKET_URL, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_API_TOKEN.',
        },
        500,
      )
    }

    const url = new URL(request.url)

    try {
      switch (url.pathname) {
        case '/':
          return url.searchParams.has('url') ? handleScreenshot(url, env) : usageResponse()
        case '/screenshot':
          return handleScreenshot(url, env)
        case '/markdown':
          return handleMarkdown(url, env)
        case '/pdf':
          return handlePdf(url, env)
        case '/crawl':
          return handleCrawl(url, env)
        default:
          return jsonResponse({ error: 'Not found' }, 404)
      }
    } catch (error) {
      if (error instanceof UpstreamError) {
        return jsonResponse(
          {
            error: error.message,
            details: error.details,
            status: error.status,
          },
          502,
        )
      }

      const message = error instanceof Error ? error.message : 'Unknown error'
      return jsonResponse({ error: message }, 500)
    }
  },
}

async function handleScreenshot(requestUrl: URL, env: Env): Promise<Response> {
  const targetUrl = readTargetUrl(requestUrl)
  if (targetUrl instanceof Response) {
    return targetUrl
  }

  const response = await callBrowserRendering(
    env,
    'screenshot',
    {
      url: targetUrl.toString(),
      gotoOptions: DEFAULT_GOTO_OPTIONS,
      screenshotOptions: SCREENSHOT_OPTIONS,
      viewport: VIEWPORT,
    },
    {
      accept: 'image/png',
    },
  )

  const contentType = response.headers.get('content-type') ?? 'image/png'
  const extension = extensionForContentType(contentType, 'png')
  const key = artifactKey('screenshot', targetUrl, extension)
  const body = await response.arrayBuffer()

  await putArtifact(env, key, body, contentType)
  return redirectToArtifact(env, key)
}

async function handleMarkdown(requestUrl: URL, env: Env): Promise<Response> {
  const targetUrl = readTargetUrl(requestUrl)
  if (targetUrl instanceof Response) {
    return targetUrl
  }

  const response = await callBrowserRendering(env, 'markdown', {
    url: targetUrl.toString(),
    gotoOptions: DEFAULT_GOTO_OPTIONS,
  })

  const payload = (await response.json()) as CloudflareApiEnvelope<string>
  const markdown = unwrapEnvelope(payload, 'Expected markdown content from Cloudflare /markdown')
  const key = artifactKey('markdown', targetUrl, 'md')

  await putArtifact(env, key, markdown, 'text/markdown; charset=utf-8')
  return redirectToArtifact(env, key)
}

async function handlePdf(requestUrl: URL, env: Env): Promise<Response> {
  const targetUrl = readTargetUrl(requestUrl)
  if (targetUrl instanceof Response) {
    return targetUrl
  }

  const response = await callBrowserRendering(
    env,
    'pdf',
    {
      url: targetUrl.toString(),
      gotoOptions: DEFAULT_GOTO_OPTIONS,
    },
    {
      accept: 'application/pdf',
    },
  )

  const key = artifactKey('pdf', targetUrl, 'pdf')
  const body = await response.arrayBuffer()

  await putArtifact(env, key, body, 'application/pdf')
  return redirectToArtifact(env, key)
}

async function handleCrawl(requestUrl: URL, env: Env): Promise<Response> {
  const jobId = requestUrl.searchParams.get('id')
  if (jobId) {
    return getCrawlResults(jobId, requestUrl, env)
  }

  const targetUrl = readTargetUrl(requestUrl)
  if (targetUrl instanceof Response) {
    return targetUrl
  }

  const response = await callBrowserRendering(env, 'crawl', {
    url: targetUrl.toString(),
    limit: readOptionalPositiveInteger(requestUrl, 'limit'),
    depth: readOptionalPositiveInteger(requestUrl, 'depth'),
    formats: readCrawlFormats(requestUrl),
    render: readOptionalBoolean(requestUrl, 'render') ?? true,
    gotoOptions: DEFAULT_CRAWL_GOTO_OPTIONS,
  })

  const payload = (await response.json()) as CloudflareApiEnvelope<string>
  const crawlId = unwrapEnvelope(payload, 'Expected crawl job id from Cloudflare /crawl')

  return jsonResponse(
    {
      id: crawlId,
      success: payload.success ?? true,
      pollUrl: `/crawl?id=${encodeURIComponent(crawlId)}`,
    },
    202,
  )
}

async function getCrawlResults(jobId: string, requestUrl: URL, env: Env): Promise<Response> {
  const trimmedJobId = jobId.trim()
  if (!trimmedJobId) {
    return jsonResponse({ error: 'Missing crawl job id' }, 400)
  }

  const query = new URLSearchParams()
  copyOptionalQueryParam(requestUrl, query, 'cursor')
  copyOptionalQueryParam(requestUrl, query, 'limit')
  const status = requestUrl.searchParams.get('status')
  if (status) {
    if (!isCrawlResultStatus(status)) {
      return jsonResponse({ error: `Invalid crawl status "${status}"` }, 400)
    }
    query.set('status', status)
  }

  const path = query.size > 0 ? `crawl/${encodeURIComponent(trimmedJobId)}?${query}` : `crawl/${encodeURIComponent(trimmedJobId)}`
  const response = await callBrowserRendering(env, path, undefined)
  const payload = (await response.json()) as CloudflareApiEnvelope<unknown>

  return jsonResponse(payload, response.status)
}

async function callBrowserRendering(env: Env, path: string, body?: unknown, options?: { accept?: string }): Promise<Response> {
  const response = await fetch(browserRenderingUrl(env.CLOUDFLARE_ACCOUNT_ID, path), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      Accept: options?.accept ?? 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(stripUndefined(body)),
  })

  if (!response.ok) {
    throw await UpstreamError.fromResponse(response)
  }

  return response
}

function browserRenderingUrl(accountId: string, path: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-rendering/${path}`
}

function readTargetUrl(requestUrl: URL): URL | Response {
  const rawUrl = requestUrl.searchParams.get('url')
  if (!rawUrl) {
    return jsonResponse({ error: 'Missing ?url=https://example.com parameter' }, 400)
  }

  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return jsonResponse({ error: 'Only http and https URLs are supported' }, 400)
    }
    return parsed
  } catch {
    return jsonResponse({ error: 'Invalid url parameter' }, 400)
  }
}

function readOptionalPositiveInteger(requestUrl: URL, key: string): number | undefined {
  const raw = requestUrl.searchParams.get(key)
  if (!raw) {
    return undefined
  }

  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function readOptionalBoolean(requestUrl: URL, key: string): boolean | undefined {
  const raw = requestUrl.searchParams.get(key)
  if (raw === null) {
    return undefined
  }

  if (raw === 'true') {
    return true
  }
  if (raw === 'false') {
    return false
  }
  return undefined
}

function readCrawlFormats(requestUrl: URL): CrawlFormat[] {
  const rawFormats = requestUrl.searchParams.getAll('format')
  if (rawFormats.length === 0) {
    return DEFAULT_CRAWL_FORMATS
  }

  const formats = rawFormats
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is CrawlFormat => value === 'html' || value === 'markdown')

  return formats.length > 0 ? Array.from(new Set(formats)) : DEFAULT_CRAWL_FORMATS
}

function copyOptionalQueryParam(source: URL, target: URLSearchParams, key: string): void {
  const value = source.searchParams.get(key)
  if (value) {
    target.set(key, value)
  }
}

function isCrawlResultStatus(value: string): value is CrawlResultStatus {
  return (
    value === 'queued' ||
    value === 'completed' ||
    value === 'disallowed' ||
    value === 'skipped' ||
    value === 'errored' ||
    value === 'cancelled'
  )
}

async function putArtifact(env: Env, key: string, body: ArrayBuffer | string, contentType: string): Promise<void> {
  await env.artifacts.put(key, body, {
    httpMetadata: {
      contentType,
    },
  })
}

function artifactKey(prefix: string, targetUrl: URL, extension: string): string {
  const id = nanoid(4)
  return `${id}/${id}.${extension}`
}

function redirectToArtifact(env: Env, key: string): Response {
  const base = env.BUCKET_URL.endsWith('/') ? env.BUCKET_URL.slice(0, -1) : env.BUCKET_URL
  const path = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return Response.redirect(`${base}/${path}`, 307)
}

function extensionForContentType(contentType: string, fallback: string): string {
  if (contentType.includes('image/jpeg')) {
    return 'jpg'
  }
  if (contentType.includes('image/webp')) {
    return 'webp'
  }
  if (contentType.includes('image/png')) {
    return 'png'
  }

  return fallback
}

function unwrapEnvelope<T>(payload: CloudflareApiEnvelope<T>, errorMessage: string): T {
  if (payload.success === false) {
    const message = payload.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join('; ')
    throw new Error(message || errorMessage)
  }

  if (payload.result === undefined || payload.result === null) {
    throw new Error(errorMessage)
  }

  return payload.result
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUndefined)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nestedValue]) => nestedValue !== undefined)
        .map(([key, nestedValue]) => [key, stripUndefined(nestedValue)]),
    )
  }

  return value
}

function usageResponse(): Response {
  return textResponse(
    [
      'Cloudflare Browser Rendering Worker',
      '',
      'Routes:',
      'GET /screenshot?url=https://example.com',
      'GET /markdown?url=https://example.com',
      'GET /pdf?url=https://example.com',
      'GET /crawl?url=https://example.com',
      'GET /crawl?id=<job-id>&limit=10&status=completed',
      '',
      'Artifacts are written to R2 and redirected for screenshot, markdown, and pdf.',
      'Crawl returns async job JSON and polling results.',
    ].join('\n'),
  )
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  })
}

class UpstreamError extends Error {
  readonly details?: string
  readonly status: number

  constructor(status: number, message: string, details?: string) {
    super(message)
    this.name = 'UpstreamError'
    this.status = status
    this.details = details
  }

  static async fromResponse(response: Response): Promise<UpstreamError> {
    const contentType = response.headers.get('content-type') ?? ''
    const body = contentType.includes('application/json') ? JSON.stringify(await response.json()) : await response.text()
    const details = body.slice(0, 1000) || undefined

    return new UpstreamError(response.status, `Cloudflare Browser Rendering request failed with ${response.status}`, details)
  }
}
