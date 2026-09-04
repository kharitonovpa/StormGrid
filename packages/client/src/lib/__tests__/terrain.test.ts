import { describe, it, expect, afterEach } from 'bun:test'
import * as THREE from 'three'
import { paintColors, current } from '../terrain.js'
import { SIZE, SEGMENTS, HALF, CELL_SIZE, THICKNESS } from '../constants.js'
import { LOOK } from '../look.js'

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
