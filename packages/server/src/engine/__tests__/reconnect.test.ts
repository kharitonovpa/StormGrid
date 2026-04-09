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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

type GameStartMsg = { type: 'game:start'; playerId: string; state: object; reconnectToken: string }
type ReconnectOkMsg = { type: 'reconnect:ok'; playerId: string; state: object; tick: number; deadline: number }

async function setupMatch() {
  const p1 = await connectClient()
  const p2 = await connectClient()

  send(p1.ws, { type: 'queue:join', character: 'wheat' })
  send(p2.ws, { type: 'queue:join', character: 'rice' })

  const start1 = await waitForMessage(p1.messages, 'game:start') as GameStartMsg
  const start2 = await waitForMessage(p2.messages, 'game:start') as GameStartMsg

  await waitForMessage(p1.messages, 'tick:start')
  await waitForMessage(p2.messages, 'tick:start')

  return {
    p1: { ...p1, playerId: start1.playerId, token: start1.reconnectToken },
    p2: { ...p2, playerId: start2.playerId, token: start2.reconnectToken },
  }
}

describe('reconnect — game:start includes reconnectToken', () => {
  it('game:start message contains a reconnectToken string', async () => {
    const { p1, p2 } = await setupMatch()

    expect(p1.token).toBeDefined()
    expect(typeof p1.token).toBe('string')
    expect(p1.token.length).toBeGreaterThan(0)
    expect(p2.token).toBeDefined()
    expect(p1.token).not.toBe(p2.token)

    p1.ws.close()
    p2.ws.close()
  }, 20_000)
})

describe('reconnect — opponent:disconnected', () => {
  it('opponent receives opponent:disconnected when player drops', async () => {
    const { p1, p2 } = await setupMatch()

    const beforeLen = p2.messages.length
    p1.ws.close()

    const msg = await waitForMessageFrom(p2.messages, 'opponent:disconnected', beforeLen, 5_000)
    expect(msg.type).toBe('opponent:disconnected')

    p2.ws.close()
  }, 20_000)
})

describe('reconnect — successful reconnect', () => {
  it('player reconnects with valid token and gets reconnect:ok', async () => {
    const { p1, p2 } = await setupMatch()
    const token = p1.token

    const beforeP2 = p2.messages.length
    p1.ws.close()
    await waitForMessageFrom(p2.messages, 'opponent:disconnected', beforeP2, 5_000)

    const reconnected = await connectClient()
    send(reconnected.ws, { type: 'reconnect', token })

    const okMsg = await waitForMessage(reconnected.messages, 'reconnect:ok') as ReconnectOkMsg
    expect(okMsg.type).toBe('reconnect:ok')
    expect(okMsg.playerId).toBe(p1.playerId)
    expect(okMsg.state).toBeDefined()
    expect(typeof okMsg.tick).toBe('number')
    expect(typeof okMsg.deadline).toBe('number')

    const reconnectedMsg = await waitForMessageFrom(p2.messages, 'opponent:reconnected', beforeP2, 5_000)
    expect(reconnectedMsg.type).toBe('opponent:reconnected')

    reconnected.ws.close()
    p2.ws.close()
  }, 20_000)
})

describe('reconnect — grace period expires', () => {
  it('opponent wins by forfeit after grace period', async () => {
    const { p1, p2 } = await setupMatch()

    const beforeP2 = p2.messages.length
    p1.ws.close()

    const endMsg = await waitForMessageFrom(p2.messages, 'game:end', beforeP2, 15_000)
    expect(endMsg.type).toBe('game:end')
    if (endMsg.type === 'game:end') {
      expect(endMsg.winner).toBe(p2.playerId)
    }

    p2.ws.close()
  }, 25_000)
})

describe('reconnect — invalid token', () => {
  it('reconnect with invalid token returns reconnect:fail', async () => {
    const client = await connectClient()
    send(client.ws, { type: 'reconnect', token: 'invalid-token-12345' })

    const msg = await waitForMessage(client.messages, 'reconnect:fail', 5_000)
    expect(msg.type).toBe('reconnect:fail')

    client.ws.close()
  }, 10_000)
})

describe('reconnect — after game ended', () => {
  it('reconnect after game already ended returns reconnect:fail', async () => {
    const { p1, p2 } = await setupMatch()
    const token = p1.token

    p1.ws.close()

    await waitForMessage(p2.messages, 'game:end', 15_000)
    await sleep(500)

    const reconnected = await connectClient()
    send(reconnected.ws, { type: 'reconnect', token })

    const msg = await waitForMessage(reconnected.messages, 'reconnect:fail', 5_000)
    expect(msg.type).toBe('reconnect:fail')

    reconnected.ws.close()
    p2.ws.close()
  }, 25_000)
})
