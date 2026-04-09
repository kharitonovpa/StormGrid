import { describe, test, expect } from 'bun:test'
import { ConnectionLimiter } from '../ratelimit.js'

describe('ConnectionLimiter', () => {
  test('allows messages within rate limit', () => {
    const limiter = new ConnectionLimiter(10, 10)
    for (let i = 0; i < 10; i++) {
      expect(limiter.consume()).toBe(true)
    }
  })

  test('blocks messages when tokens exhausted', () => {
    const limiter = new ConnectionLimiter(3, 0)
    expect(limiter.consume()).toBe(true)
    expect(limiter.consume()).toBe(true)
    expect(limiter.consume()).toBe(true)
    expect(limiter.consume()).toBe(false)
    expect(limiter.consume()).toBe(false)
  })

  test('refills tokens over time', async () => {
    const limiter = new ConnectionLimiter(5, 100)
    for (let i = 0; i < 5; i++) limiter.consume()
    expect(limiter.consume()).toBe(false)

    await new Promise((r) => setTimeout(r, 60))
    expect(limiter.consume()).toBe(true)
  })

  test('checkSize rejects oversized messages', () => {
    const limiter = new ConnectionLimiter()
    const small = JSON.stringify({ type: 'queue:join', character: 'wheat' })
    expect(limiter.checkSize(small)).toBe(true)

    const big = 'x'.repeat(2000)
    expect(limiter.checkSize(big)).toBe(false)
  })

  test('trackInvalid returns true after streak threshold', () => {
    const limiter = new ConnectionLimiter()
    for (let i = 0; i < 4; i++) {
      expect(limiter.trackInvalid()).toBe(false)
    }
    expect(limiter.trackInvalid()).toBe(true)
  })

  test('resetInvalid clears the streak', () => {
    const limiter = new ConnectionLimiter()
    for (let i = 0; i < 4; i++) limiter.trackInvalid()
    limiter.resetInvalid()
    for (let i = 0; i < 4; i++) {
      expect(limiter.trackInvalid()).toBe(false)
    }
    expect(limiter.trackInvalid()).toBe(true)
  })
})
