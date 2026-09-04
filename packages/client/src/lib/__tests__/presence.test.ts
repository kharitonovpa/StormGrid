import { describe, it, expect } from 'bun:test'
import { createPresence, ACTIVITY_WINDOW_MS } from '../presence.js'

/*
 * The server only waits for humans who are actually there. "There" = the tab
 * is visible and was touched within the activity window. The module knows
 * nothing about the DOM — time and visibility come in through the env.
 */
describe('presence', () => {
  function make(start = 100_000) {
    let now = start
    const p = createPresence({ now: () => now })
    return { p, tick: (ms: number) => { now += ms } }
  }

  it('starts active: a fresh page load is a person looking at it', () => {
    const { p } = make()
    expect(p.isActive()).toBe(true)
  })

  it('goes inactive once the activity window passes without input', () => {
    const { p, tick } = make()
    tick(ACTIVITY_WINDOW_MS + 1)
    expect(p.isActive()).toBe(false)
  })

  it('input keeps it active', () => {
    const { p, tick } = make()
    tick(ACTIVITY_WINDOW_MS - 1)
    p.noteInput()
    tick(ACTIVITY_WINDOW_MS - 1)
    expect(p.isActive()).toBe(true)
  })

  it('a hidden tab is inactive regardless of input', () => {
    const { p } = make()
    p.setVisible(false)
    p.noteInput()
    expect(p.isActive()).toBe(false)
  })

  it('notifies on transitions only', () => {
    const { p, tick } = make()
    const seen: boolean[] = []
    p.onChange((a) => seen.push(a))
    p.setVisible(false)
    p.setVisible(false)
    p.setVisible(true)
    // The window passing is not an event (no timer in the pure module); the
    // next noteInput re-evaluates to active, same as last notified: silence.
    tick(ACTIVITY_WINDOW_MS + 1)
    p.noteInput()
    expect(seen).toEqual([false, true])
  })
})
