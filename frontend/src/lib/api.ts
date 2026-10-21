export class ApiError extends Error {
  status: number
  body: unknown
  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

const REQUEST_TIMEOUT_MS = 30_000

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS)
  init?.signal?.addEventListener('abort', () => timeoutController.abort())

  let res: Response
  try {
    res = await fetch(path.startsWith('/') ? path : `/api/${path}`, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
      signal: timeoutController.signal,
    })
  } catch (e) {
    if (timeoutController.signal.aborted) {
      throw new ApiError('Request timed out. The database connection may be slow or unreachable.', 0, null)
    }
    throw e
  } finally {
    clearTimeout(timeout)
  }

  const text = await res.text()
  const body: unknown = text ? safeJson(text) : null
  if (!res.ok) {
    const msg =
      (body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : res.statusText) || 'Request failed'
    throw new ApiError(msg, res.status, body)
  }
  return body as T
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}
