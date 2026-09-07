import { describe, it, expect, spyOn } from 'bun:test'
import { withBudget } from '../budget'

describe('withBudget', () => {
  it('returns once the budget is spent, leaving the hung work behind', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const hung = new Promise<void>(() => {})
    try {
      await withBudget(hung, 10, 'hung thing')
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('propagates a rejection — a real failure must still reach the caller', async () => {
    const boom = Promise.reject(new Error('SDK exploded'))
    await expect(withBudget(boom, 5_000, 'exploding thing')).rejects.toThrow('SDK exploded')
  })

  it('swallows a rejection that lands after the budget is spent', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    let fail: (e: Error) => void = () => {}
    const late = new Promise<void>((_, reject) => { fail = reject })
    try {
      await withBudget(late, 10, 'late failure')
      // Nobody is awaiting `late` any more: without withBudget's own catch this
      // rejection would go unhandled and crash the page in strict hosts.
      fail(new Error('too late'))
      await new Promise((r) => setTimeout(r, 20))
    } finally {
      warn.mockRestore()
    }
  })

  it('returns as soon as the work finishes, without waiting out the budget', async () => {
    const started = Date.now()
    await withBudget(Promise.resolve('ok'), 5_000, 'fast thing')
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
