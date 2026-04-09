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

async function setupMatchWithArchitect() {
  const p1 = await connectClient()
  const p2 = await connectClient()

  send(p1.ws, { type: 'queue:join', character: 'wheat' })
  send(p2.ws, { type: 'queue:join', character: 'rice' })

  const start1 = await waitForMessage(p1.messages, 'game:start') as { type: 'game:start'; playerId: string }
  await waitForMessage(p2.messages, 'game:start')
  await waitForMessage(p1.messages, 'round:start')

  const arch = await connectClient()
  send(arch.ws, { type: 'architect:join' })
  const assigned = await waitForMessage(arch.messages, 'architect:assigned')

  return { p1, p2, arch, assigned, p1PlayerId: start1.playerId as 'A' | 'B' }
}

describe('architect — join / leave', () => {
  it('architect gets architect:no_match when no active rooms', async () => {
    const a = await connectClient()
    send(a.ws, { type: 'architect:join' })
    const msg = await waitForMessage(a.messages, 'architect:no_match')
    expect(msg.type).toBe('architect:no_match')
    a.ws.close()
  })

  it('architect joins an active match and receives architect:assigned', async () => {
    const { p1, p2, arch, assigned } = await setupMatchWithArchitect()

    expect(assigned.type).toBe('architect:assigned')
    if (assigned.type === 'architect:assigned') {
      expect(assigned.state).toBeDefined()
      expect(assigned.roomId).toBeDefined()
    }

    p1.ws.close()
    p2.ws.close()
    arch.ws.close()
  }, 20_000)

  it('second architect gets architect:no_match on same room', async () => {
    const { p1, p2, arch } = await setupMatchWithArchitect()

    const arch2 = await connectClient()
    send(arch2.ws, { type: 'architect:join' })
    const msg = await waitForMessage(arch2.messages, 'architect:no_match')
    expect(msg.type).toBe('architect:no_match')

    p1.ws.close()
    p2.ws.close()
    arch.ws.close()
    arch2.ws.close()
  }, 20_000)

  it('architect receives tick:start during match', async () => {
    const { p1, p2, arch } = await setupMatchWithArchitect()

    const tickStart = await waitForMessage(arch.messages, 'tick:start')
    expect(tickStart.type).toBe('tick:start')

    p1.ws.close()
    p2.ws.close()
    arch.ws.close()
  }, 20_000)
})

describe('architect — set weather', () => {
  it('architect sets weather and players get updated forecast', async () => {
    const { p1, p2, arch } = await setupMatchWithArchitect()

    const prompt = await waitForMessage(arch.messages, 'architect:prompt')
    expect(prompt.type).toBe('architect:prompt')

    const beforeP1 = p1.messages.length

    send(arch.ws, {
      type: 'architect:set_weather',
      weatherType: 'wind_rain',
      dir: 'S',
    })

    await sleep(200)

    const roundUpdate = await waitForMessageFrom(p1.messages, 'round:start', beforeP1, 5_000)
    expect(roundUpdate.type).toBe('round:start')
    if (roundUpdate.type === 'round:start') {
      expect(roundUpdate.state.forecast.windCandidates).toContain('S')
    }

    p1.ws.close()
    p2.ws.close()
    arch.ws.close()
  }, 20_000)
})

describe('architect — place bonus', () => {
  it('architect places a bonus on the board', async () => {
    const { p1, p2, arch } = await setupMatchWithArchitect()

    await waitForMessage(arch.messages, 'architect:prompt')

    send(arch.ws, {
      type: 'architect:place_bonus',
      x: 3,
      y: 3,
      bonusType: 'intel',
    })

    send(arch.ws, {
      type: 'architect:set_weather',
      weatherType: 'wind',
      dir: 'N',
    })

    await sleep(200)

    const tickStart = await waitForMessage(arch.messages, 'tick:start')
    expect(tickStart.type).toBe('tick:start')

    send(p1.ws, { type: 'action:submit', action: { kind: 'move', dir: 'N' } })
    send(p2.ws, { type: 'action:submit', action: { kind: 'move', dir: 'S' } })

    const tickResolve = await waitForMessage(arch.messages, 'tick:resolve')
    if (tickResolve.type === 'tick:resolve') {
      expect(tickResolve.state).toBeDefined()
    }

    p1.ws.close()
    p2.ws.close()
    arch.ws.close()
  }, 20_000)
})

describe('architect — fallback', () => {
  it('game proceeds with random weather if architect does not respond', async () => {
    const { p1, p2, arch } = await setupMatchWithArchitect()

    await waitForMessage(arch.messages, 'architect:prompt')

    const tickStart = await waitForMessage(arch.messages, 'tick:start', 12_000)
    expect(tickStart.type).toBe('tick:start')

    p1.ws.close()
    p2.ws.close()
    arch.ws.close()
  }, 20_000)
})

describe('architect — game:end', () => {
  it('architect receives game:end when a player disconnects', async () => {
    const { p1, p2, arch } = await setupMatchWithArchitect()

    await waitForMessage(arch.messages, 'tick:start')
    const beforeLen = arch.messages.length

    p1.ws.close()

    const endMsg = await waitForMessageFrom(arch.messages, 'game:end', beforeLen, 15_000)
    expect(endMsg.type).toBe('game:end')

    p2.ws.close()
    arch.ws.close()
  }, 25_000)
})
