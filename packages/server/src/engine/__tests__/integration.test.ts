import { describe, it, expect } from 'bun:test'
import type { ServerMessage } from '../../protocol.js'

const WS_URL = 'ws://localhost:3001/ws'

function connectPlayer(): Promise<{ ws: WebSocket; messages: ServerMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL)
    const messages: ServerMessage[] = []

    ws.onmessage = (e) => {
      messages.push(JSON.parse(String(e.data)))
    }

    ws.onopen = () => resolve({ ws, messages })
    ws.onerror = (e) => reject(e)
  })
}

function waitForMessage(
  messages: ServerMessage[],
  type: string,
  timeoutMs = 15_000,
): Promise<ServerMessage> {
  const start = messages.length
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      for (let i = 0; i < messages.length; i++) {
        if (messages[i].type === type) {
          clearInterval(interval)
          clearTimeout(timeout)
          resolve(messages[i])
          return
        }
      }
    }, 50)

    const timeout = setTimeout(() => {
      clearInterval(interval)
      reject(new Error(`Timeout waiting for "${type}". Got: ${messages.map(m => m.type).join(', ')}`))
    }, timeoutMs)
  })
}

describe('integration — full match via WebSocket', () => {
  it('two players connect, queue, get matched, and play through ticks', async () => {
    const p1 = await connectPlayer()
    const p2 = await connectPlayer()

    p1.ws.send(JSON.stringify({ type: 'queue:join', character: 'wheat' }))
    p2.ws.send(JSON.stringify({ type: 'queue:join', character: 'rice' }))

    const start1 = await waitForMessage(p1.messages, 'game:start')
    const start2 = await waitForMessage(p2.messages, 'game:start')

    expect(start1.type).toBe('game:start')
    expect(start2.type).toBe('game:start')

    if (start1.type === 'game:start' && start2.type === 'game:start') {
      expect(start1.playerId).not.toBe(start2.playerId)
    }

    const round1 = await waitForMessage(p1.messages, 'round:start')
    expect(round1.type).toBe('round:start')

    const tick1 = await waitForMessage(p1.messages, 'tick:start')
    expect(tick1.type).toBe('tick:start')

    p1.ws.send(JSON.stringify({ type: 'action:submit', action: { kind: 'move', dir: 'N' } }))
    p2.ws.send(JSON.stringify({ type: 'action:submit', action: { kind: 'move', dir: 'S' } }))

    const resolve1 = await waitForMessage(p1.messages, 'tick:resolve')
    expect(resolve1.type).toBe('tick:resolve')

    p1.ws.close()
    p2.ws.close()
  }, 30_000)
})

describe('integration — instant match', () => {
  it('starts against a bot at once, without the queue wait', async () => {
    // This is what the rewarded ad buys, so the point is the speed: the queue
    // would hand over the same bot only after BOT_MATCH_DELAY_MS.
    const p = await connectPlayer()
    const t0 = Date.now()
    p.ws.send(JSON.stringify({ type: 'instant:start', character: 'wheat', streak: 0 }))

    const start = await waitForMessage(p.messages, 'game:start', 5_000) as {
      playerId: string
      practice?: boolean
    }
    const waited = Date.now() - t0

    expect(start.playerId).toBeDefined()
    // Not a tutorial: this match records, and a badge can grow in it.
    expect(start.practice).toBeUndefined()
    expect(waited).toBeLessThan(3_000)
    // Nobody was left sitting in the queue.
    expect(p.messages.some(m => m.type === 'queue:waiting')).toBe(false)

    p.ws.close()
  }, 15_000)
})
