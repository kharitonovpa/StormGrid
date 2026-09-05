import { describe, it, expect } from 'bun:test'
import * as THREE from 'three'
import type { Gust } from '../sheen.js'
import { createGustScheduler, createSheenSystem, MAX_GUSTS, SPAWN_EDGE } from '../sheen.js'
import { DIR_AZIMUTH, gustDirection } from '../bearing.js'
import { LOOK } from '../look.js'
import { HALF } from '../constants.js'

const mk = (extra: Partial<Parameters<typeof createGustScheduler>[0]> = {}) =>
  createGustScheduler({ sweepMs: 1400, random: () => 0.5, ...extra })
const run = (s: ReturnType<typeof createGustScheduler>, seconds: number, dt = 0.05) => {
  for (let t = 0; t < seconds; t += dt) s.update(dt)
}
/**
 * Every gust born during the run, in birth order. Counted by object identity:
 * once the live list sits at MAX_GUSTS a spawn and a retirement land in the
 * same tick, so "the array got longer" would miss it.
 */
const spawns = (s: ReturnType<typeof createGustScheduler>, seconds: number, dt = 0.05): Gust[] => {
  const seen = new Set<Gust>()
  const born: Gust[] = []
  for (let t = 0; t < seconds; t += dt) {
    s.update(dt)
    for (const g of s.gusts()) if (!seen.has(g)) { seen.add(g); born.push(g) }
  }
  return born
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
    const seen = spawns(s, 40).map(g => `${g.dirX.toFixed(2)},${g.dirZ.toFixed(2)}`)
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
      let spawned = 0
      const seen = new Set<Gust>()
      for (let t = 0; t < 20; t += 0.05) {
        s.update(0.05)
        for (const g of s.gusts()) if (!seen.has(g)) { seen.add(g); spawned++ }
        expect(s.gusts().length).toBeLessThanOrEqual(MAX_GUSTS)
      }
      return spawned
    }
    expect(count(1)).toBeGreaterThan(count(0.1))
  })

  it('keeps a gust alive one width past the far corner — the Gaussian still shows there', () => {
    const s = mk()
    const T = LOOK.terrain.sheen
    s.follow([{ azimuth: 0, weight: 1 }])
    s.update(0.01)
    s.follow([])                      // no more spawns
    run(s, (2 * 1.4 * HALF + T.width + T.tail) / T.speed + 0.3)
    expect(s.gusts()).toHaveLength(1)
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

describe('sheen system (material patch)', () => {
  const make = () => {
    const mat = new THREE.MeshStandardMaterial()
    const sys = createSheenSystem(mat, mk())
    return { mat, sys }
  }
  // The payloads the patch injects at each anchor. Asserting on these, not on
  // the prepended declarations, is what makes a renamed three chunk fail here:
  // a .replace() that finds no anchor is a silent no-op.
  const VERT_PAYLOAD = 'vWorldXZ = (modelMatrix'
  const FRAG_PAYLOAD = 'diffuseColor.rgb *='
  const stub = (vertexShader: string, fragmentShader: string) => ({
    uniforms: {} as Record<string, unknown>,
    vertexShader,
    fragmentShader,
  })

  it('installs the patch once and marks the program', () => {
    const { mat } = make()
    expect(mat.onBeforeCompile).not.toBe(THREE.Material.prototype.onBeforeCompile)
    expect(mat.customProgramCacheKey()).toContain('sheen')
  })

  it('injects the band into a standard shader', () => {
    const { mat } = make()
    const shader = stub('#include <begin_vertex>\n', '#include <color_fragment>\n')
    mat.onBeforeCompile(shader as never, {} as never)
    expect(shader.vertexShader).toContain(VERT_PAYLOAD)
    expect(shader.fragmentShader).toContain(FRAG_PAYLOAD)
    expect(shader.uniforms.uGust).toBeDefined()
  })

  it('leaves a shader without the anchors untouched', () => {
    const { mat } = make()
    const shader = stub('void main() {}\n', 'void main() {}\n')
    mat.onBeforeCompile(shader as never, {} as never)
    expect(shader.vertexShader).not.toContain(VERT_PAYLOAD)
    expect(shader.fragmentShader).not.toContain(FRAG_PAYLOAD)
  })

  it('copies live gusts into the uniform array and zeroes the rest', () => {
    const { sys } = make()
    sys.follow([{ azimuth: DIR_AZIMUTH.N, weight: 1 }])
    sys.update(0.02)
    const u = sys.uniforms.uGust.value
    expect(u).toHaveLength(12)
    expect(u[3]).toBeGreaterThan(0)                  // gust 0 strength
    expect(u[7]).toBe(0)
    expect(u[11]).toBe(0)
    const [dx, dz] = gustDirection(DIR_AZIMUTH.N)
    expect(u[0]).toBeCloseTo(dx, 5)
    expect(u[1]).toBeCloseTo(dz, 5)
  })

  it('clears every slot once the last gust has retired', () => {
    const { sys } = make()
    sys.follow([{ azimuth: 0, weight: 1 }])
    sys.update(0.02)
    expect(sys.uniforms.uGust.value[3]).toBeGreaterThan(0)   // a gust really was there
    sys.follow([])
    sys.update(20)                                           // well past retirement
    for (const i of [3, 7, 11]) expect(sys.uniforms.uGust.value[i]).toBe(0)
    // Idle slots keep a width and tail of 1: the shader divides by both.
    for (const w of sys.uniforms.uGustWidth.value) expect(w).toBe(1)
    for (const t of sys.uniforms.uGustTail.value) expect(t).toBe(1)
  })
})
