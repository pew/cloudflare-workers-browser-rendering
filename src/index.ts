import puppeteer from '@cloudflare/puppeteer'
import sanitize from 'sanitize-filename'
import { nanoid } from 'nanoid'

export interface Env {
  bucketUrl: string
  mybrowser: any
  puppeteer: R2Bucket
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { searchParams } = new URL(request.url)
    let url = searchParams.get('url')
    let img: Buffer
    if (url) {
      const browser = await puppeteer.launch(env.mybrowser)
      const page = await browser.newPage()
      await page.goto(url)
      img = (await page.screenshot({ fullPage: true })) as Buffer
      const title = sanitize(await page.title(), { replacement: '-' })
      const id = nanoid(5)

      const titleString = `${title}_${id}.jpg`

      await browser.close()
      await env.puppeteer.put(titleString, img)
      return Response.redirect(`${env.bucketUrl}/${titleString}`, 307)
    } else {
      return new Response('Please add the ?url=https://example.com/ parameter')
    }
  },
}
