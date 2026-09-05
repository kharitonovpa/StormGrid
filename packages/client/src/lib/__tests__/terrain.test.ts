import { describe, it, expect, afterEach } from 'bun:test'
import * as THREE from 'three'
import { paintColors, current, getHeightRaw, rebuildMesh } from '../terrain.js'
import { SIZE, SEGMENTS, HALF, CELL_SIZE, THICKNESS, HEIGHT_SCALE, NOISE_AMP, NOISE_FREQ } from '../constants.js'
import { LOOK } from '../look.js'
import { swell, groove, SWELL_AMP, GROOVE_DEPTH } from '../meadow.js'
import { fbm } from '../noise.js'

function makeSingleVertexGeo(x: number, y: number, z: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([x, y, z], 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0], 3))
  return geo
}

function colourOf(geo: THREE.BufferGeometry): [number, number, number] {
  const c = geo.attributes.color as THREE.BufferAttribute
  return [c.getX(0), c.getY(0), c.getZ(0)]
}
const brightness = (geo: THREE.BufferGeometry) => colourOf(geo).reduce((a, b) => a + b, 0)
const worldAt = (g: number) => -HALF + g * CELL_SIZE   // grid coordinate → world x/z

afterEach(() => {
  for (const row of current) row.fill(0)
})

describe('paintColors accent', () => {
  it('shifts the red channel toward a positive accent', () => {
    const plain = makeSingleVertexGeo(1, 0, 1)
    paintColors(plain)
    const baseRed = colourOf(plain)[0]

    const tinted = makeSingleVertexGeo(1, 0, 1)
    paintColors(tinted, false, [0.3, 0, 0])
    const tintedRed = colourOf(tinted)[0]

    expect(tintedRed).toBeGreaterThan(baseRed)
  })
})

describe('paintColors baked shading', () => {
  // Same vertex, painted on a flat board and then beside a raised block: the
  // noise fields cancel out and only the baked terms differ.
  it('paints the foot of a taller cell darker than the same spot on flat ground', () => {
    const spot = () => makeSingleVertexGeo(worldAt(0.95), 0, worldAt(1.5))   // just west of cell (1, 1)
    const flat = spot()
    paintColors(flat)
    current[1][1] = 2   // cell cx = 1, cz = 1 rises two levels
    const foot = spot()
    paintColors(foot)
    expect(brightness(foot)).toBeLessThan(brightness(flat) * 0.8)
  })

  it('paints the block\'s shadow darker and cooler than the same spot in the sun', () => {
    // The shadow of cell (1, 1) falls away from the sun: 1.5 cells from the
    // block's centre along −(sun.x, sun.z) is inside a two-level block's shadow
    // and more than 0.6 cell from its edge, so only the shadow term acts.
    const [sx, , sz] = LOOK.sun.direction
    const horiz = Math.hypot(sx, sz)
    const spot = () => makeSingleVertexGeo(worldAt(1.5 - (sx / horiz) * 1.5), 0, worldAt(1.5 - (sz / horiz) * 1.5))
    const lit = spot()
    paintColors(lit)
    current[1][1] = 2
    const shadowed = spot()
    paintColors(shadowed)
    expect(brightness(shadowed)).toBeLessThan(brightness(lit) * 0.75)
    const [sr, , sb] = colourOf(shadowed)
    const [lr, , lb] = colourOf(lit)
    expect(sb / sr).toBeGreaterThan(lb / lr)   // bluer relative to red: sky-lit shadow
  })

  it('shades the underside from its own, negated heights', () => {
    // An underside ground vertex just west of cell (1, 1): the flat underside sits at y = −THICKNESS.
    const beside = () => makeSingleVertexGeo(worldAt(0.95), -THICKNESS, worldAt(1.5))
    const flat = beside()
    paintColors(flat, true)
    current[1][1] = 2   // a top hill is an underside pit: nothing rises beside it from below
    const byPit = beside()
    paintColors(byPit, true)
    expect(brightness(byPit)).toBeCloseTo(brightness(flat), 6)
    current[1][1] = -2  // a top pit is an underside hill: its foot is crowded
    const byHill = beside()
    paintColors(byHill, true)
    expect(brightness(byHill)).toBeLessThan(brightness(flat) * 0.8)
  })

  it('repaints a full board-sized plane within budget', () => {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS)
    geo.rotateX(-Math.PI / 2)
    geo.computeVertexNormals()
    let best = Infinity
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now()
      paintColors(geo)
      best = Math.min(best, performance.now() - t0)
    }
    expect(best).toBeLessThan(40)   // generous ceiling: guards against pathological regressions, not the 3 ms laptop budget
  })
})

describe('the meadow on a flat board', () => {
  it('lifts and dips the flat board within the decoration budget, never exactly flat', () => {
    let lo = Infinity, hi = -Infinity
    for (let z = -HALF; z <= HALF; z += 0.53) {
      for (let x = -HALF; x <= HALF; x += 0.47) {
        const y = getHeightRaw(x, z)
        lo = Math.min(lo, y)
        hi = Math.max(hi, y)
      }
    }
    expect(lo).toBeGreaterThanOrEqual(-(SWELL_AMP + GROOVE_DEPTH))
    expect(hi).toBeLessThanOrEqual(SWELL_AMP)
    expect(hi - lo).toBeGreaterThan(0.05)
  })

  it('cuts the groove at a cell border', () => {
    const wx = worldAt(2), wz = worldAt(3.5)
    expect(getHeightRaw(wx, wz)).toBeCloseTo(swell(wx, wz) + groove(wx, wz), 6)
    expect(getHeightRaw(wx, wz)).toBeLessThan(-GROOVE_DEPTH + SWELL_AMP + 1e-6)   // the swell can lift the floor by at most amp
  })

  it('carries no meadow on a fully raised cell', () => {
    current[2][2] = 1
    const wx = worldAt(2.5), wz = worldAt(2.5)
    const expected = HEIGHT_SCALE + fbm(wx * NOISE_FREQ, wz * NOISE_FREQ) * NOISE_AMP
    expect(getHeightRaw(wx, wz)).toBeCloseTo(expected, 6)
  })

  it('paints a crest warmer and lighter than a trough', () => {
    // Find the strongest crest and trough on the flat board, away from borders.
    let best = { s: -Infinity, x: 0, z: 0 }, worst = { s: Infinity, x: 0, z: 0 }
    for (let gz = 0.3; gz < 7; gz += 0.1) {
      for (let gx = 0.3; gx < 7; gx += 0.1) {
        const x = worldAt(gx), z = worldAt(gz)
        const s = swell(x, z)
        if (s > best.s) best = { s, x, z }
        if (s < worst.s) worst = { s, x, z }
      }
    }
    const crest = makeSingleVertexGeo(best.x, 0, best.z)
    const trough = makeSingleVertexGeo(worst.x, 0, worst.z)
    paintColors(crest)
    paintColors(trough)
    // The checkerboard could mask the tint: compare against the same spot with the tint's driver removed
    // is impossible, so require the tint to win by a margin larger than the checker's ±12 %.
    const [cr, , cb] = colourOf(crest)
    const [tr, , tb] = colourOf(trough)
    expect(cr / cb).toBeGreaterThan((tr / tb) * 1.05)
  })

  it("does not tint a fully raised cell's top", () => {
    // The strongest crest and trough inside cell (2, 2), clear of its borders.
    let best = { s: -Infinity, x: 0, z: 0 }, worst = { s: Infinity, x: 0, z: 0 }
    for (let gz = 2.1; gz < 2.9; gz += 0.02) {
      for (let gx = 2.1; gx < 2.9; gx += 0.02) {
        const x = worldAt(gx), z = worldAt(gz)
        const s = swell(x, z)
        if (s > best.s) best = { s, x, z }
        if (s < worst.s) worst = { s, x, z }
      }
    }
    const warmth = (x: number, y: number, z: number) => {
      const geo = makeSingleVertexGeo(x, y, z)
      paintColors(geo)
      const [r, , b] = colourOf(geo)
      return r / b
    }

    // Control: while the cell is flat, the tint separates the two spots.
    expect(warmth(best.x, 0, best.z)).toBeGreaterThan(warmth(worst.x, 0, worst.z) * 1.05)

    // Raised a full level, the cell keeps today's look: the meadow's colour
    // field is gone, so crest and trough come out the same colour. Sampled on
    // the cell's grass-reading flank rather than at HEIGHT_SCALE, where the
    // palette is pure snow (snowW = 1) and the grass tint is moot either way —
    // the gate keys on the cell's level, not on the vertex's y.
    const RAISED_Y = HEIGHT_SCALE * 0.3
    current[2][2] = 1
    const upCrest = warmth(best.x, RAISED_Y, best.z)
    const upTrough = warmth(worst.x, RAISED_Y, worst.z)
    expect(Math.abs(upCrest / upTrough - 1)).toBeLessThan(0.02)
  })

  it('keeps flat vertices on their grid: no sideways displacement on the meadow', () => {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    rebuildMesh(pos, null, null)
    const stride = SEGMENTS + 1
    for (let i = 0; i < pos.count; i++) {
      const ix = i % stride
      const iz = Math.floor(i / stride)
      // Float32-backed BufferAttribute: allow for the position's own storage
      // rounding (not a meadow displacement), well under a visible jitter.
      expect(pos.getX(i)).toBeCloseTo(-HALF + ix * (SIZE / SEGMENTS), 4)
      expect(pos.getZ(i)).toBeCloseTo(-HALF + iz * (SIZE / SEGMENTS), 4)
    }
  })

  it('still displaces hill vertices sideways', () => {
    current[3][3] = 1
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    rebuildMesh(pos, null, null)
    const stride = SEGMENTS + 1
    let found = false
    for (let i = 0; i < pos.count; i++) {
      const ix = i % stride
      const iz = Math.floor(i / stride)
      const baseX = -HALF + ix * (SIZE / SEGMENTS)
      const baseZ = -HALF + iz * (SIZE / SEGMENTS)
      const gx = (baseX + HALF) / CELL_SIZE
      const gz = (baseZ + HALF) / CELL_SIZE
      if (gx > 3 && gx < 4 && gz > 3 && gz < 4) {
        if (Math.abs(pos.getX(i) - baseX) > 1e-4) found = true
      }
    }
    expect(found).toBe(true)
  })
})
