import { describe, expect, test } from 'bun:test'
import type { GameState, Height } from '@wheee/shared'
import { hasWind, hasRain, hasLightning } from '@wheee/shared'
import { createInitialState } from '../board.js'
import { resolveLightning } from '../lightning.js'

/** Board helper: place players and paint heights (canonical frame). */
function makeState(aPos: [number, number], bPos: [number, number], heights: [number, number, Height][] = []): GameState {
  const s = createInitialState({ A: { x: aPos[0], y: aPos[1] }, B: { x: bPos[0], y: bPos[1] } })
  for (const [x, y, h] of heights) s.board[y][x].height = h
  return s
}

describe('weather predicates', () => {
  test('cover every combo', () => {
    expect(hasWind('wind_rain_lightning')).toBe(true)
    expect(hasWind('rain_lightning')).toBe(false)
    expect(hasRain('rain_lightning')).toBe(true)
    expect(hasRain('wind_lightning')).toBe(false)
    expect(hasLightning('lightning')).toBe(true)
    expect(hasLightning('wind_rain')).toBe(false)
  })
})

describe('resolveLightning', () => {
  test('flat-0 board: both exposed, equal crowns — both die', () => {
    const s = makeState([1, 1], [5, 5])
    const r = resolveLightning(s)
    expect(r.deaths.sort()).toEqual(['A', 'B'])
    expect(r.deathCauses.A).toEqual({ type: 'lightning' })
    expect(r.spared).toBeNull()
    expect(s.players.A.alive).toBe(false)
    expect(r.boltCell.A).toEqual({ x: 1, y: 1 })
    expect(r.boltCell.B).toEqual({ x: 5, y: 5 })
  })

  test('flat -1 board kills the same (rule is relative, not absolute)', () => {
    const heights: [number, number, Height][] = []
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) heights.push([x, y, -1])
    // Canonical -1 everywhere = A's side all -1, B's side all +1: both flat.
    const s = makeState([1, 1], [5, 5], heights)
    const r = resolveLightning(s)
    expect(r.deaths.sort()).toEqual(['A', 'B'])
  })

  test('a pit is grounded: its wall out-tops the crown', () => {
    // A in a -1 pit (crown -0.5): the 0-level plain is strictly higher. B gets a rod.
    const s = makeState([1, 1], [5, 5], [[1, 1, -1], [4, 4, -1]]) // (4,4) canonical -1 = B-side +1 rod
    const r = resolveLightning(s)
    expect(r.deaths).toEqual([])
    expect(s.players.A.alive).toBe(true)
    // A's bolt went into the nearest strictly-higher ground, not the player.
    expect(r.boltCell.A).not.toEqual({ x: 1, y: 1 })
  })

  test('a rod anywhere on the side saves a 0-level player', () => {
    // Canonical +1 at (6,6) = A-side rod. B stands exposed on their flat side.
    const s = makeState([1, 1], [5, 5], [[6, 6, 1]])
    const r = resolveLightning(s)
    expect(r.deaths).toEqual(['B'])
    expect(r.boltCell.A).toEqual({ x: 6, y: 6 })
    expect(r.spared).toBeNull() // only one was exposed — no arbitration happened
  })

  test('standing on +1 dies through any rod', () => {
    // A on a +1 hill (crown 1.5); another +1 rod exists — nothing out-tops 1.5.
    // B is saved by a B-side rod (canonical -1 at (4,4)).
    const s = makeState([2, 2], [5, 5], [[2, 2, 1], [6, 6, 1], [4, 4, -1]])
    const r = resolveLightning(s)
    expect(r.deaths).toEqual(['A'])
    expect(r.boltCell.A).toEqual({ x: 2, y: 2 })
  })

  test('both exposed, unequal crowns: the taller dies, the shorter is spared', () => {
    // A on +1 (crown 1.5), B flat on their side (crown 0.5): bolt takes A.
    const s = makeState([2, 2], [5, 5], [[2, 2, 1]])
    const r = resolveLightning(s)
    expect(r.deaths).toEqual(['A'])
    expect(r.spared).toBe('B')
    expect(s.players.B.alive).toBe(true)
  })

  test('per-side resolution: B sees negated heights', () => {
    // Canonical -1 at (0,0) is a +1 rod on B's side only. A stays exposed.
    const s = makeState([1, 1], [5, 5], [[0, 0, -1]])
    const r = resolveLightning(s)
    expect(r.deaths).toEqual(['A'])
    expect(r.boltCell.B).toEqual({ x: 0, y: 0 })
  })

  test('deterministic rod pick: highest, then nearest, then lowest y, then lowest x', () => {
    // Two +1 rods for A at Chebyshev distance 2 and 4: nearest wins.
    const s = makeState([3, 3], [5, 5], [[1, 3, 1], [3, 0, 1], [4, 4, -1]])
    const r = resolveLightning(s)
    expect(r.boltCell.A).toEqual({ x: 1, y: 3 }) // dist 2 beats dist 3
  })

  test('dead player is not a target', () => {
    const s = makeState([1, 1], [5, 5])
    s.players.A.alive = false
    const r = resolveLightning(s)
    expect(r.deaths).toEqual(['B'])
    expect(r.boltCell.A).toBeNull()
  })

  test('margin arbitration: B sticks out more above its world', () => {
    // A at (1,1) flat 0: crown 0.5, max other 0, margin 0.5
    // B at (5,5) on height -1: crown 1.5, max other 0, margin 1.5 — B sticks out more
    const s = makeState([1, 1], [5, 5], [[5, 5, -1]])
    const r = resolveLightning(s)
    expect(r.deaths).toEqual(['B'])
    expect(r.spared).toBe('A')
    expect(r.boltCell.A).toBeNull() // A spared; no bolt landed on their side
    expect(r.boltCell.B).toEqual({ x: 5, y: 5 })
    expect(s.players.A.alive).toBe(true)
  })

  test('margin arbitration is relative, not absolute: the smaller crown can still die', () => {
    // Canonical board all -1 except (1,1) = 0. A at (1,1), B at (5,5).
    // A: crown = h(1,1)*1 + 0.5 = 0 + 0.5 = 0.5; every other cell is -1 canonical
    //    (sign +1) = -1, so maxOtherHeight = -1 → margin = 0.5 - (-1) = 1.5.
    // B: crown = h(5,5)*-1 + 0.5 = (-1 * -1) + 0.5 = 1 + 0.5 = 1.5; every other
    //    cell is -1 canonical except (1,1)=0, negated (sign -1) gives 1 and 0
    //    respectively, so maxOtherHeight = 1 → margin = 1.5 - 1 = 0.5.
    // A's absolute crown (0.5) is smaller than B's (1.5) — the rejected
    // "absolute crown" rule would kill B. The ruled ("relative margin") rule
    // instead kills A, since A's crown protrudes furthest above its own world
    // (margin 1.5 > 0.5).
    const heights: [number, number, Height][] = []
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) heights.push([x, y, -1])
    heights.push([1, 1, 0])
    const s = makeState([1, 1], [5, 5], heights)
    const r = resolveLightning(s)
    expect(r.deaths).toEqual(['A'])
    expect(r.spared).toBe('B')
    expect(r.boltCell.A).toEqual({ x: 1, y: 1 })
    expect(r.boltCell.B).toBeNull()
    expect(s.players.A.alive).toBe(false)
    expect(s.players.B.alive).toBe(true)
  })
})
