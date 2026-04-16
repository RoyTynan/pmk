import { type NextRequest, NextResponse } from 'next/server'

const BACKEND = process.env.API_URL ?? 'http://localhost:8000'

async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
): Promise<NextResponse> {
  const { slug } = await params
  const path   = slug.join('/')
  const search = req.nextUrl.search
  const url    = `${BACKEND}/${path}${search}`

  const headers: Record<string, string> = {}
  const ct = req.headers.get('content-type')
  if (ct) headers['content-type'] = ct

  const body = req.method !== 'GET' && req.method !== 'HEAD'
    ? await req.text()
    : undefined

  const res = await fetch(url, { method: req.method, headers, body })

  // Stream the body through — required for SSE, harmless for regular JSON
  return new NextResponse(res.body, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/json',
      'cache-control': res.headers.get('cache-control') ?? 'no-cache',
      'x-accel-buffering': 'no',
    },
  })
}

export const GET    = proxy
export const POST   = proxy
export const DELETE = proxy
export const PUT    = proxy
export const PATCH  = proxy
