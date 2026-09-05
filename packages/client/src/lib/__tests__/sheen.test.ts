import { describe, it, expect } from 'bun:test'
import { createGustScheduler, MAX_GUSTS, SPAWN_EDGE } from '../sheen.js'
import { DIR_AZIMUTH, gustDirection } from '../bearing.js'
import { LOOK } from '../look.js'
import { HALF } from '../constants.js'

const mk = (extra: Partial<Parameters<typeof createGustScheduler>[0]> = {}) =>
  createGustScheduler({ sweepMs: 1400, random: () => 0.5, ...extra })
const run = (s: ReturnType<typeof createGustScheduler>, seconds: number, dt = 0.05) => {
  for (let t = 0; t < seconds; t += dt) s.update(dt)
}

describe('gust scheduler', () => {
  it('spawns nothing with no masses', () => {
    const s = mk()
    s.follow([])
    run(s, 30)
    expect(s.gusts()).toHaveLength(0)
  })

  it('spawns nothing while every weight is at or under 0.05', () => {
    const s = mk()
    s.follow([{ azimuth: 0, weight: 0.05 }, { azimuth: 1, weight: 0 }])
    run(s, 30)
    expect(s.gusts()).toHaveLength(0)
  })

  it('spawns gusts on a single mass\'s bearing, born at the upwind edge, travelling at the token speed', () => {
    const s = mk()
    s.follow([{ azimuth: DIR_AZIMUTH.E, weight: 1 }])
    s.update(0.01)
    const [g] = s.gusts()
    expect(g).toBeDefined()
    const [dx, dz] = gustDirection(DIR_AZIMUTH.E)
    expect(g.dirX).toBeCloseTo(dx, 6)
    expect(g.dirZ).toBeCloseTo(dz, 6)
    expect(g.pos).toBe(SPAWN_EDGE)   // born this frame: update() advances first, then spawns
    expect(g.speed).toBe(LOOK.terrain.sheen.speed)
    expect(g.width).toBe(LOOK.terrain.sheen.width)
    expect(g.tail).toBe(LOOK.terrain.sheen.tail)
  })

  it('scales strength with the mass weight', () => {
    const a = mk(); a.follow([{ azimuth: 0, weight: 1 }]); a.update(0.01)
    const b = mk(); b.follow([{ azimuth: 0, weight: 0.4 }]); b.update(0.01)
    expect(a.gusts()[0].strength).toBeCloseTo(LOOK.terrain.sheen.strength, 6)
    expect(b.gusts()[0].strength).toBeCloseTo(LOOK.terrain.sheen.strength * 0.4, 6)
  })

  it('alternates between two masses and never picks another bearing', () => {
    const s = mk()
    s.follow([{ azimuth: DIR_AZIMUTH.N, weight: 1 }, { azimuth: DIR_AZIMUTH.S, weight: 1 }])
    const seen: string[] = []
    let last = 0
    for (let t = 0; t < 40; t += 0.05) {
      s.update(0.05)
      const gs = s.gusts()
      if (gs.length > last) seen.push(`${gs[gs.length - 1].dirX.toFixed(2)},${gs[gs.length - 1].dirZ.toFixed(2)}`)
      last = gs.length
    }
    expect(seen.length).toBeGreaterThanOrEqual(4)
    const n = `${gustDirection(DIR_AZIMUTH.N)[0].toFixed(2)},${gustDirection(DIR_AZIMUTH.N)[1].toFixed(2)}`
    const so = `${gustDirection(DIR_AZIMUTH.S)[0].toFixed(2)},${gustDirection(DIR_AZIMUTH.S)[1].toFixed(2)}`
    for (let i = 0; i < seen.length; i++) {
      expect([n, so]).toContain(seen[i])
      if (i > 0) expect(seen[i]).not.toBe(seen[i - 1])
    }
  })

  it('spawns faster at full weight than at a faint one, and never more than MAX_GUSTS', () => {
    const count = (w: number) => {
      const s = mk()
      s.follow([{ azimuth: 0, weight: w }])
      let spawned = 0, last = 0
      for (let t = 0; t < 20; t += 0.05) {
        s.update(0.05)
        if (s.gusts().length > last) spawned++
        last = s.gusts().length
        expect(s.gusts().length).toBeLessThanOrEqual(MAX_GUSTS)
      }
      return spawned
    }
    expect(count(1)).toBeGreaterThan(count(0.1))
  })

  it('retires a gust once it has crossed the board', () => {
    const s = mk()
    s.follow([{ azimuth: 0, weight: 1 }])
    s.update(0.01)
    s.follow([])                      // no more spawns
    run(s, (2 * 1.4 * HALF + 2 * LOOK.terrain.sheen.width) / LOOK.terrain.sheen.speed + 1)
    expect(s.gusts()).toHaveLength(0)
  })

  it('sweeps one wide, full-strength gust on the true bearing, timed to the front', () => {
    const s = mk({ sweepMs: 2000 })
    s.follow([{ azimuth: DIR_AZIMUTH.N, weight: 1 }, { azimuth: DIR_AZIMUTH.W, weight: 1 }])
    s.sweep('W')
    const gs = s.gusts()
    expect(gs).toHaveLength(1)
    const [dx, dz] = gustDirection(DIR_AZIMUTH.W)
    expect(gs[0].dirX).toBeCloseTo(dx, 6)
    expect(gs[0].dirZ).toBeCloseTo(dz, 6)
    expect(gs[0].strength).toBe(1)
    expect(gs[0].width).toBe(LOOK.terrain.sheen.width * 2)
    expect(gs[0].speed).toBeCloseTo((2 * 1.4 * HALF) / 2, 6)   // crossing distance / sweep seconds
  })

  it('spawns nothing under reduced motion, sweep included', () => {
    const s = mk({ reduced: true })
    s.follow([{ azimuth: 0, weight: 1 }])
    run(s, 10)
    s.sweep('N')
    expect(s.gusts()).toHaveLength(0)
  })
})
