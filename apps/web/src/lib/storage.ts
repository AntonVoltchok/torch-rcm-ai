/** localStorage / sessionStorage behind try/catch: convenience state only, never data the app depends on. */
type Area = 'local' | 'session'

function area(which: Area): Storage | null {
  try {
    return which === 'local' ? globalThis.localStorage : globalThis.sessionStorage
  } catch {
    return null
  }
}

export function readJson<T>(key: string, parse: (raw: unknown) => T, fallback: T, which: Area = 'local'): T {
  try {
    const raw = area(which)?.getItem(key)
    return raw === null || raw === undefined ? fallback : parse(JSON.parse(raw))
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown, which: Area = 'local'): void {
  try {
    area(which)?.setItem(key, JSON.stringify(value))
  } catch {
    /* quota or privacy mode: convenience only */
  }
}

export function removeKey(key: string, which: Area = 'local'): void {
  try {
    area(which)?.removeItem(key)
  } catch {
    /* ignore */
  }
}
