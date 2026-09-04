/**
 * Are we a potential opponent right now? Sent with every ping so the server
 * can hand a lone queuer a bot quickly when the only other tabs are parked.
 * Pure: time and visibility arrive through the env, the DOM is bound by
 * installPresence().
 */
export const ACTIVITY_WINDOW_MS = 60_000

export type PresenceEnv = { now: () => number }

export type Presence = {
  isActive(): boolean
  noteInput(): void
  setVisible(visible: boolean): void
  /** Fires when isActive() flips as a result of noteInput/setVisible. Returns unsubscribe. */
  onChange(fn: (active: boolean) => void): () => void
}

export function createPresence(env: PresenceEnv): Presence {
  let lastInput = env.now()
  let visible = true
  let lastNotified = true
  const subs = new Set<(active: boolean) => void>()

  function isActive() {
    return visible && env.now() - lastInput < ACTIVITY_WINDOW_MS
  }
  function notify() {
    const a = isActive()
    if (a === lastNotified) return
    lastNotified = a
    for (const fn of subs) fn(a)
  }
  return {
    isActive,
    noteInput() { lastInput = env.now(); notify() },
    setVisible(v) { visible = v; notify() },
    onChange(fn) { subs.add(fn); return () => { subs.delete(fn) } },
  }
}

/** Binds the DOM: pointer/key/touch mark input, visibilitychange marks visibility. */
export function installPresence(presence: Presence, doc: Document, win: Window): () => void {
  const onInput = () => presence.noteInput()
  const onVis = () => presence.setVisible(doc.visibilityState === 'visible')
  win.addEventListener('pointerdown', onInput, { passive: true })
  win.addEventListener('keydown', onInput)
  win.addEventListener('touchstart', onInput, { passive: true })
  doc.addEventListener('visibilitychange', onVis)
  onVis()
  return () => {
    win.removeEventListener('pointerdown', onInput)
    win.removeEventListener('keydown', onInput)
    win.removeEventListener('touchstart', onInput)
    doc.removeEventListener('visibilitychange', onVis)
  }
}

/** The one instance the socket reports; App.vue binds it to the document. */
export const presence: Presence = createPresence({ now: () => Date.now() })
