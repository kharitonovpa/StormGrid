import { API_BASE } from './config'
import { storageGet, storageSet } from './storage'
import type { PlatformAdapter } from './platform/types'

/**
 * First-party analytics: named events, batched and delivered to the game's own
 * server (`POST /api/events`). No third-party SDK — the portals this game ships
 * to (GameDistribution among them) forbid some of those outright, and the
 * questions being asked (funnel, D1) only need counts by device and day.
 *
 * Failures are swallowed: analytics must never cost a frame or a match.
 */

const DEVICE_KEY = 'wheee:device_id'
const FIRST_OPEN_KEY = 'wheee:first_open'
const FLUSH_INTERVAL_MS = 8_000
const FLUSH_AT = 10
const MAX_BATCH = 25

type QueuedEvent = { name: string; props?: Record<string, string | number | boolean> }

let deviceId = ''
let sessionId = ''
let platformType = 'web'
let hostId: string | null = null
let lang = 'en'
let queue: QueuedEvent[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null
let started = false

export function initAnalytics(platform: PlatformAdapter): void {
  if (started) return
  started = true

  deviceId = storageGet(DEVICE_KEY) ?? ''
  if (!deviceId) {
    deviceId = crypto.randomUUID()
    storageSet(DEVICE_KEY, deviceId)
  }
  sessionId = crypto.randomUUID()
  platformType = platform.type
  hostId = platform.hostId
  lang = platform.getLanguage()

  const firstOpen = storageGet(FIRST_OPEN_KEY)
  const now = Date.now()
  if (!firstOpen) storageSet(FIRST_OPEN_KEY, String(now))
  const daysSinceFirst = firstOpen
    ? Math.floor((now - Number(firstOpen)) / 86_400_000)
    : 0

  track('app_open', { returning: !!firstOpen, daysSinceFirst })

  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS)
  // The last batch of a session leaves via sendBeacon — a plain fetch would be
  // cancelled with the page.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush(true)
  })
  window.addEventListener('pagehide', () => flush(true))
}

export function track(name: string, props?: Record<string, string | number | boolean>): void {
  if (!started) return
  queue.push(props ? { name, props } : { name })
  if (queue.length >= FLUSH_AT) flush()
}

function flush(useBeacon = false): void {
  if (queue.length === 0) return
  const events = queue.slice(0, MAX_BATCH)
  queue = queue.slice(events.length)

  const body = JSON.stringify({
    deviceId, sessionId, platform: platformType, host: hostId, lang, events,
  })
  const url = `${API_BASE}/api/events`

  try {
    // text/plain keeps both paths preflight-free; the server parses the body as
    // JSON regardless of the content type.
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))
      return
    }
    fetch(url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } })
      .catch(() => { /* dropped events are acceptable */ })
  } catch { /* never let telemetry throw into game code */ }
}

export function disposeAnalytics(): void {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null }
  flush(true)
  started = false
}
