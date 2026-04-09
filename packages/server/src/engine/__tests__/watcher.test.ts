import { describe, it, expect } from 'bun:test'
import type { ServerMessage } from '../../protocol.js'

const WS_URL = 'ws://localhost:3001/ws'

function connectClient(): Promise<{ ws: WebSocket; messages: ServerMessage[] }> {
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

function send(ws: WebSocket, msg: object) {
  ws.send(JSON.stringify(msg))
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function waitForMessage(
  messages: ServerMessage[],
  type: string,
  timeoutMs = 15_000,
): Promise<ServerMessage> {
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

function waitForMessageFrom(
  messages: ServerMessage[],
  type: string,
  fromIndex: number,
  timeoutMs = 15_000,
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      for (let i = fromIndex; i < messages.length; i++) {
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
      reject(new Error(`Timeout waiting for "${type}" from index ${fromIndex}. Got: ${messages.slice(fromIndex).map(m => m.type).join(', ')}`))
    }, timeoutMs)
  })
}

async function setupMatchWithWatcher() {
  const p1 = await connectClient()
  const p2 = await connectClient()

  send(p1.ws, { type: 'queue:join', character: 'wheat' })
  send(p2.ws, { type: 'queue:join', character: 'rice' })

  const start1 = await waitForMessage(p1.messages, 'game:start') as { type: 'game:start'; playerId: string }
  await waitForMessage(p2.messages, 'game:start')
  await waitForMessage(p1.messages, 'round:start')

  const watcher = await connectClient()
  send(watcher.ws, { type: 'watch:join' })
  const assigned = await waitForMessage(watcher.messages, 'watch:assigned')

  return { p1, p2, watcher, assigned, p1PlayerId: start1.playerId as 'A' | 'B' }
}

describe('watcher — join / leave', () => {
  it('watcher gets watch:no_match when no active rooms', async () => {
    const w = await connectClient()
    send(w.ws, { type: 'watch:join' })
    const msg = await waitForMessage(w.messages, 'watch:no_match')
    expect(msg.type).toBe('watch:no_match')
    w.ws.close()
  })

  it('watcher joins an active match and receives watch:assigned', async () => {
    const { p1, p2, watcher, assigned } = await setupMatchWithWatcher()

    expect(assigned.type).toBe('watch:assigned')
    if (assigned.type === 'watch:assigned') {
      expect(assigned.state).toBeDefined()
      expect(assigned.watcherState.score).toBe(0)
      expect(assigned.watcherState.breakUsed).toBe(false)
    }

    p1.ws.close()
    p2.ws.close()
    watcher.ws.close()
  }, 20_000)

  it('watcher receives tick:start and tick:resolve during match', async () => {
    const { p1, p2, watcher } = await setupMatchWithWatcher()

    const tickStart = await waitForMessage(watcher.messages, 'tick:start')
    expect(tickStart.type).toBe('tick:start')

    send(p1.ws, { type: 'action:submit', action: { kind: 'move', dir: 'N' } })
    send(p2.ws, { type: 'action:submit', action: { kind: 'move', dir: 'S' } })

    const tickResolve = await waitForMessage(watcher.messages, 'tick:resolve')
    expect(tickResolve.type).toBe('tick:resolve')

    p1.ws.close()
    p2.ws.close()
    watcher.ws.close()
  }, 20_000)
})

describe('watcher — predictions', () => {
  it('watcher receives score update after move prediction', async () => {
    const { p1, p2, watcher, p1PlayerId } = await setupMatchWithWatcher()

    await waitForMessage(watcher.messages, 'tick:start')

    send(watcher.ws, {
      type: 'watcher:predict_move',
      target: p1PlayerId,
      action: { kind: 'move', dir: 'N' },
    })

    await sleep(100)

    send(p1.ws, { type: 'action:submit', action: { kind: 'move', dir: 'N' } })
    send(p2.ws, { type: 'action:submit', action: { kind: 'move', dir: 'S' } })

    const scoreMsg = await waitForMessage(watcher.messages, 'watcher:score')
    expect(scoreMsg.type).toBe('watcher:score')
    if (scoreMsg.type === 'watcher:score') {
      expect(scoreMsg.prediction.type).toBe('move')
      expect(scoreMsg.prediction.correct).toBe(true)
      expect(scoreMsg.delta).toBe(5)
    }

    p1.ws.close()
    p2.ws.close()
    watcher.ws.close()
  }, 20_000)
})

describe('watcher — break instrument', () => {
  it('watcher can break a player instrument', async () => {
    const { p1, p2, watcher, p1PlayerId } = await setupMatchWithWatcher()

    const beforeLen = p1.messages.length

    send(watcher.ws, {
      type: 'watcher:break_instrument',
      target: p1PlayerId,
      instrument: 'vane',
    })

    const update = await waitForMessageFrom(p1.messages, 'forecast:update', beforeLen, 5_000)
    if (update.type === 'forecast:update') {
      expect(update.state.forecast.instrumentsBroken[p1PlayerId].vane).toBe(true)
    }

    p1.ws.close()
    p2.ws.close()
    watcher.ws.close()
  }, 20_000)
})

describe('watcher — game:end', () => {
  it('watcher receives game:end when a player disconnects', async () => {
    const { p1, p2, watcher } = await setupMatchWithWatcher()

    await waitForMessage(watcher.messages, 'tick:start')
    const beforeLen = watcher.messages.length

    p1.ws.close()

    const endMsg = await waitForMessageFrom(watcher.messages, 'game:end', beforeLen, 15_000)
    expect(endMsg.type).toBe('game:end')

    p2.ws.close()
    watcher.ws.close()
  }, 25_000)
})
