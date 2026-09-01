/**
 * Reconnect-token persistence, kept in its own file so it can be unit tested
 * without touching WebSocket/`location`-dependent machinery. Backed by
 * `sessionStorage`: it survives a same-tab reload (F5) but disappears when the
 * tab is actually closed — matching "closing the tab = leaving the match" and
 * needing no manual expiry. The server is the sole authority on whether a
 * token is still within its reconnect grace period (`reconnect:fail` covers
 * both "too late" and "match already gone").
 *
 * Every call is wrapped in try/catch: private browsing, or a storage-
 * partitioned embed (Discord Activity, Telegram, GamePush, Yandex), can make
 * touching `sessionStorage` throw. Any failure degrades silently to "no
 * persistence" — the behavior every platform already had before this file
 * existed.
 */

const STORAGE_KEY = 'wheee:reconnectToken'

export function loadReconnectToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function saveReconnectToken(token: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, token)
  } catch { /* private mode / partitioned storage */ }
}

export function clearReconnectToken(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch { /* private mode / partitioned storage */ }
}
