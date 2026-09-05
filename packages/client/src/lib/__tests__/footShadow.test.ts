import { describe, it, expect } from 'bun:test'
import * as THREE from 'three'
import { createFootShadows, shadowAxis, footAlpha, liftFade } from '../footShadow.js'
import { LOOK } from '../look.js'
import { THICKNESS } from '../constants.js'
import type { TerrainState } from '../terrain.js'

function fakeTerrain(height = 0): TerrainState {
  return { getHeight: () => height, version: 0 } as unknown as TerrainState
}
function ref(x: number, y: number, z: number, surface: 'top' | 'bottom' = 'top') {
  const mesh = new THREE.Group()
  mesh.position.set(x, y, z)
  return { state: { cx: 0, cz: 0 }, mesh, surface }
}

describe('shadowAxis', () => {
  it('is a unit vector pointing away from the sun', () => {
    const [ax, az] = shadowAxis()
    const [sx, , sz] = LOOK.sun.direction
    expect(Math.hypot(ax, az)).toBeCloseTo(1, 6)
    expect(ax * sx + az * sz).toBeLessThan(0)
  })
})

describe('falloffs', () => {
  it('footAlpha is full at the centre, zero at the rim, monotone', () => {
    expect(footAlpha(0)).toBeCloseTo(LOOK.foot.opacity, 6)
    expect(footAlpha(1)).toBe(0)
    let prev = footAlpha(0)
    for (let t = 0.1; t <= 1; t += 0.1) { const a = footAlpha(t); expect(a).toBeLessThanOrEqual(prev); prev = a }
  })
  it('liftFade is 1 on the ground and 0 by 2.5 units up', () => {
    expect(liftFade(0)).toBe(1)
    expect(liftFade(1.25)).toBeCloseTo(0.5, 6)
    expect(liftFade(2.5)).toBe(0)
    expect(liftFade(9)).toBe(0)
  })
})

describe('createFootShadows', () => {
  it('adds two shadow meshes and shows them under grounded, visible characters', () => {
    const scene = new THREE.Scene()
    const foot = createFootShadows(scene, fakeTerrain())
    foot.setPlayerRefs(ref(1, 0, 1), ref(-1, -THICKNESS, -1, 'bottom'))
    foot.update(0.016)
    const shadows = scene.children.filter(o => o.name === 'footShadow') as THREE.Mesh[]
    expect(shadows).toHaveLength(2)
    for (const s of shadows) {
      expect(s.visible).toBe(true)
      expect((s.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(1, 6)
    }
  })

  it('fades a lifted character and hides a hidden one', () => {
    const scene = new THREE.Scene()
    const foot = createFootShadows(scene, fakeTerrain())
    const a = ref(0, 1.25, 0), b = ref(3, 0, 3)
    b.mesh.visible = false
    foot.setPlayerRefs(a, b)
    foot.update(0.016)
    const [sa, sb] = scene.children.filter(o => o.name === 'footShadow') as THREE.Mesh[]
    expect((sa.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.5, 6)
    expect(sb.visible).toBe(false)
  })

  it('hugs the terrain: vertices sit just above the ground height', () => {
    const scene = new THREE.Scene()
    const foot = createFootShadows(scene, fakeTerrain(2))
    foot.setPlayerRefs(ref(0, 2, 0), ref(5, 2, 5))
    foot.update(0.016)
    const [s] = scene.children.filter(o => o.name === 'footShadow') as THREE.Mesh[]
    const pos = s.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(2.06, 6)
  })

  it('disposes cleanly', () => {
    const scene = new THREE.Scene()
    const foot = createFootShadows(scene, fakeTerrain())
    foot.setPlayerRefs(ref(0, 0, 0), ref(1, 0, 1))
    foot.dispose()
    expect(scene.children.filter(o => o.name === 'footShadow')).toHaveLength(0)
  })
})
