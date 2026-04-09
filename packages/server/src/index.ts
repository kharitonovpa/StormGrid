import { Hono } from 'hono'
import { RoomManager } from './RoomManager.js'
import { Matchmaking } from './matchmaking.js'
import { parseClientMessage, send } from './protocol.js'
import type { WsData } from './protocol.js'

const app = new Hono()
const gracePeriodMs = process.env.RECONNECT_GRACE_MS ? Number(process.env.RECONNECT_GRACE_MS) : undefined
const roomManager = new RoomManager({ gracePeriodMs })
const matchmaking = new Matchmaking(roomManager)

const allClients = new Set<ServerWebSocket<WsData>>()

let lobbyStatusTimer: ReturnType<typeof setTimeout> | null = null

function broadcastLobbyStatus() {
  if (lobbyStatusTimer) return
  lobbyStatusTimer = setTimeout(() => {
    lobbyStatusTimer = null
    const msg = JSON.stringify({ type: 'lobby:status', online: allClients.size })
    for (const ws of allClients) {
      try { ws.send(msg) } catch { /* closed */ }
    }
  }, 500)
}

app.get('/health', (c) => c.json({ ok: true }))

app.get('/', (c) =>
  c.json({
    name: 'StormGrid',
    rooms: roomManager.roomCount,
    queue: matchmaking.queueSize,
  }),
)

const PORT = Number(process.env.PORT) || 3001

const server = Bun.serve<WsData>({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url)

    if (url.pathname === '/ws') {
      const sessionId = crypto.randomUUID()
      const ok = server.upgrade(req, {
        data: { sessionId, roomId: null, playerId: null, role: null },
      })
      if (ok) return undefined
      return new Response('WebSocket upgrade failed', { status: 400 })
    }

    return app.fetch(req)
  },

  websocket: {
    open(ws) {
      console.log(`[ws] connect ${ws.data.sessionId}`)
      allClients.add(ws)
      broadcastLobbyStatus()
    },

    message(ws, raw) {
      const msg = parseClientMessage(String(raw))
      if (!msg) {
        send(ws, { type: 'error', message: 'Invalid message' })
        return
      }

      switch (msg.type) {
        case 'queue:join': {
          if (ws.data.roomId) {
            send(ws, { type: 'error', message: 'Already in a game' })
            return
          }
          matchmaking.enqueue(ws, msg.character)
          break
        }

        case 'queue:leave': {
          matchmaking.dequeue(ws)
          break
        }

        case 'action:submit': {
          const { roomId, playerId } = ws.data
          if (!roomId || !playerId) {
            send(ws, { type: 'error', message: 'Not in a game' })
            return
          }
          const room = roomManager.getRoom(roomId)
          if (!room) {
            send(ws, { type: 'error', message: 'Room not found' })
            return
          }
          room.submitAction(playerId, msg.action)
          break
        }

        /* ── Watcher messages ── */

        case 'watch:join': {
          if (ws.data.roomId) {
            send(ws, { type: 'error', message: 'Already in a room' })
            return
          }
          const activeId = roomManager.getActiveRoomId()
          if (!activeId) {
            send(ws, { type: 'watch:no_match' })
            return
          }
          const activeRoom = roomManager.getRoom(activeId)
          if (!activeRoom) {
            send(ws, { type: 'watch:no_match' })
            return
          }
          activeRoom.addWatcher(ws)
          break
        }

        case 'watch:leave': {
          const { roomId } = ws.data
          if (!roomId || ws.data.role !== 'watcher') break
          const room = roomManager.getRoom(roomId)
          if (room) room.removeWatcher(ws)
          break
        }

        case 'watcher:predict_winner': {
          const room = getWatcherRoom(ws)
          if (room) room.watcherPredictWinner(ws, msg.playerId)
          break
        }

        case 'watcher:predict_move': {
          const room = getWatcherRoom(ws)
          if (room) room.watcherPredictMove(ws, msg.target, msg.action)
          break
        }

        case 'watcher:break_instrument': {
          const room = getWatcherRoom(ws)
          if (room) room.watcherBreakInstrument(ws, msg.instrument)
          break
        }

        /* ── Architect messages ── */

        case 'architect:join': {
          if (ws.data.roomId) {
            send(ws, { type: 'error', message: 'Already in a room' })
            return
          }
          const activeId = roomManager.getActiveRoomId()
          if (!activeId) {
            send(ws, { type: 'architect:no_match' })
            return
          }
          const activeRoom = roomManager.getRoom(activeId)
          if (!activeRoom) {
            send(ws, { type: 'architect:no_match' })
            return
          }
          const ok = activeRoom.addArchitect(ws)
          if (!ok) {
            send(ws, { type: 'architect:no_match' })
          }
          break
        }

        case 'architect:leave': {
          const { roomId } = ws.data
          if (!roomId || ws.data.role !== 'architect') break
          const room = roomManager.getRoom(roomId)
          if (room) room.removeArchitect(ws)
          break
        }

        case 'architect:set_weather': {
          const room = getArchitectRoom(ws)
          if (room) room.architectSetWeather(ws, msg.weatherType, msg.dir)
          break
        }

        case 'architect:place_bonus': {
          const room = getArchitectRoom(ws)
          if (room) room.architectPlaceBonus(ws, msg.x, msg.y, msg.bonusType)
          break
        }

        /* ── Reconnect ── */

        case 'reconnect': {
          const result = roomManager.findByToken(msg.token)
          if (!result) {
            send(ws, { type: 'reconnect:fail' })
            return
          }
          const ok = result.room.reconnectPlayer(result.playerId, ws)
          if (!ok) {
            send(ws, { type: 'reconnect:fail' })
          }
          break
        }
      }
    },

    close(ws) {
      console.log(`[ws] disconnect ${ws.data.sessionId}`)
      allClients.delete(ws)
      broadcastLobbyStatus()
      matchmaking.dequeue(ws)

      const { roomId, role } = ws.data
      if (roomId) {
        const room = roomManager.getRoom(roomId)
        if (room) {
          if (role === 'watcher') {
            room.removeWatcher(ws)
          } else if (role === 'architect') {
            room.removeArchitect(ws)
          } else if (ws.data.playerId) {
            room.removePlayer(ws.data.playerId)
          }
        }
      }
    },
  },
})

function getRoomForRole(ws: ServerWebSocket<WsData>, expectedRole: string, errorMsg: string) {
  const { roomId, role } = ws.data
  if (!roomId || role !== expectedRole) {
    send(ws, { type: 'error', message: errorMsg })
    return null
  }
  const room = roomManager.getRoom(roomId)
  if (!room) {
    send(ws, { type: 'error', message: 'Room not found' })
    return null
  }
  return room
}

function getWatcherRoom(ws: ServerWebSocket<WsData>) {
  return getRoomForRole(ws, 'watcher', 'Not watching a game')
}

function getArchitectRoom(ws: ServerWebSocket<WsData>) {
  return getRoomForRole(ws, 'architect', 'Not an architect')
}

type ServerWebSocket<T> = import('bun').ServerWebSocket<T>

console.log(`StormGrid server listening on http://localhost:${server.port}`)
