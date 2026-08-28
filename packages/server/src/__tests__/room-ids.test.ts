import { describe, test, expect } from 'bun:test'
import { RoomManager } from '../RoomManager.js'

/*
 * A replay is stored under its room's id, so room ids are durable keys in the
 * database — not just in-memory handles. A bare counter starting at 1 in every
 * fresh process meant the ids repeated after each restart and collided with
 * replays already stored, which used to take the match row down with them (see
 * matchStore-collision.test.ts). Every id therefore has to carry something that
 * distinguishes this process from the last one.
 */
describe('room ids', () => {
  test('are not a bare counter that restarts with the process', () => {
    const id = new RoomManager().createRoom({ lightningEnabled: true }).id
    expect(id).not.toMatch(/^room-\d+$/)
  })

  test('namespace a per-process token ahead of the counter', () => {
    const rm = new RoomManager()
    const first = rm.createRoom({ lightningEnabled: true }).id
    const second = rm.createRoom({ lightningEnabled: true }).id

    expect(first).toMatch(/^room-[a-z0-9]+-\d+$/)
    expect(second).toMatch(/^room-[a-z0-9]+-\d+$/)
    expect(first).not.toBe(second)

    const token = (s: string) => s.split('-')[1]
    expect(token(first)).toBe(token(second))
  })
})
