/**
 * Server-sent events over fetch (not EventSource): we need the `X-Torch-User` header, and we want to
 * send `Last-Event-ID` ourselves after a reload, which EventSource cannot do. Reconnect policy lives in
 * the hooks; this module only parses and connects once.
 */
export interface SseMessage {
  id: number | null
  event: string
  data: string
}

/** Incremental parser: feed text chunks, get complete messages back. Handles CRLF and split chunks. */
export class SseParser {
  private buffer = ''

  push(chunk: string): SseMessage[] {
    this.buffer += chunk.replace(/\r\n?/g, '\n')
    const out: SseMessage[] = []
    let sep = this.buffer.indexOf('\n\n')
    while (sep !== -1) {
      const block = this.buffer.slice(0, sep)
      this.buffer = this.buffer.slice(sep + 2)
      const msg = parseBlock(block)
      if (msg) out.push(msg)
      sep = this.buffer.indexOf('\n\n')
    }
    return out
  }
}

function parseBlock(block: string): SseMessage | null {
  let id: number | null = null
  let event = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'id') {
      const n = Number(value)
      id = Number.isFinite(n) ? n : null
    } else if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  if (data.length === 0 && id === null) return null
  return { id, event, data: data.join('\n') }
}

export interface ConnectOptions {
  url: string
  headers?: Record<string, string>
  lastEventId?: number | null
  signal: AbortSignal
  onOpen?: () => void
  onMessage: (msg: SseMessage) => void
}

/** Resolves when the server closes the stream; rejects on network/HTTP error (not on abort). */
export async function connectSse(opts: ConnectOptions): Promise<void> {
  const headers: Record<string, string> = { Accept: 'text/event-stream', ...opts.headers }
  if (opts.lastEventId !== null && opts.lastEventId !== undefined) headers['Last-Event-ID'] = String(opts.lastEventId)
  let res: Response
  try {
    res = await fetch(opts.url, { headers, signal: opts.signal, cache: 'no-store' })
  } catch (err) {
    if (opts.signal.aborted) return
    throw err
  }
  if (!res.ok || !res.body) throw new Error(`SSE ${opts.url} → HTTP ${res.status}`)
  opts.onOpen?.()
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  const parser = new SseParser()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      for (const msg of parser.push(value)) opts.onMessage(msg)
    }
  } catch (err) {
    if (opts.signal.aborted) return
    throw err
  } finally {
    reader.releaseLock()
  }
}

/** Exponential backoff with a cap: 0.5 s, 1 s, 2 s, 4 s, 8 s. */
export function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt)
}
