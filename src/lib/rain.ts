import * as THREE from 'three'
import { HALF, SIZE, THICKNESS } from './constants'
import type { TerrainState } from './terrain'

const RAIN_COUNT = 800
const RAIN_FALL_SPEED = 28
const RAIN_CEIL = 25
const RAIN_STREAK_LEN = 1.4
const SPLASH_MAX = 120
const SPLASH_RING_PTS = 12

interface RainDrop { x: number; y: number; z: number; speed: number; phase: number }
interface Splash { x: number; y: number; z: number; age: number; life: number }

interface RainSet {
  drops: RainDrop[]
  splashes: Splash[]
  rVerts: Float32Array; rColors: Float32Array
  rPosAttr: THREE.BufferAttribute; rColAttr: THREE.BufferAttribute
  sVerts: Float32Array; sColors: Float32Array
  sPosAttr: THREE.BufferAttribute; sColAttr: THREE.BufferAttribute
  dir: 1 | -1
  groundFn: (x: number, z: number) => number
  splashOffset: number
  respawnY: () => number
  streakSign: number
}

export function createRainSystem(scene: THREE.Scene, terrain: TerrainState) {
  const rainMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.5,
    depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const splashMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.7,
    depthWrite: false, blending: THREE.AdditiveBlending,
  })

  function createRainSet(dir: 1 | -1): RainSet {
    const drops: RainDrop[] = []
    for (let i = 0; i < RAIN_COUNT; i++) {
      drops.push({
        x: (Math.random() - 0.5) * SIZE * 1.3,
        y: dir === -1 ? Math.random() * RAIN_CEIL + 5 : -(Math.random() * RAIN_CEIL + 5),
        z: (Math.random() - 0.5) * SIZE * 1.3,
        speed: RAIN_FALL_SPEED * (0.8 + Math.random() * 0.4),
        phase: Math.random() * Math.PI * 2,
      })
    }

    const rVerts = new Float32Array(RAIN_COUNT * 2 * 3)
    const rColors = new Float32Array(RAIN_COUNT * 2 * 3)
    const rGeo = new THREE.BufferGeometry()
    const rPosAttr = new THREE.BufferAttribute(rVerts, 3)
    const rColAttr = new THREE.BufferAttribute(rColors, 3)
    rGeo.setAttribute('position', rPosAttr)
    rGeo.setAttribute('color', rColAttr)
    scene.add(new THREE.LineSegments(rGeo, rainMat))

    const sVerts = new Float32Array(SPLASH_MAX * SPLASH_RING_PTS * 2 * 3)
    const sColors = new Float32Array(SPLASH_MAX * SPLASH_RING_PTS * 2 * 3)
    const sGeo = new THREE.BufferGeometry()
    const sPosAttr = new THREE.BufferAttribute(sVerts, 3)
    const sColAttr = new THREE.BufferAttribute(sColors, 3)
    sGeo.setAttribute('position', sPosAttr)
    sGeo.setAttribute('color', sColAttr)
    scene.add(new THREE.LineSegments(sGeo, splashMat))

    return {
      drops, splashes: [],
      rVerts, rColors, rPosAttr, rColAttr,
      sVerts, sColors, sPosAttr, sColAttr,
      dir,
      groundFn: dir === -1
        ? (x, z) => terrain.getHeight(x, z)
        : (x, z) => terrain.getHeight(x, z) - THICKNESS,
      splashOffset: dir === -1 ? 0.05 : -0.05,
      respawnY: dir === -1
        ? () => RAIN_CEIL + Math.random() * 8
        : () => -(RAIN_CEIL + Math.random() * 8),
      streakSign: dir === -1 ? 1 : -1,
    }
  }

  const rainTop = createRainSet(-1)
  const rainBot = createRainSet(1)

  function updateRainSet(rs: RainSet, dt: number) {
    const { drops, splashes: spl, rVerts: rv, rColors: rc, rPosAttr: rpa, rColAttr: rca,
            sVerts: sv, sColors: sc, sPosAttr: spa, sColAttr: sca } = rs

    for (let i = 0; i < RAIN_COUNT; i++) {
      const d = drops[i]
      d.y += rs.dir * d.speed * dt

      const inBounds = d.x >= -HALF && d.x <= HALF && d.z >= -HALF && d.z <= HALF
      const surface = inBounds ? rs.groundFn(d.x, d.z) : (rs.dir === -1 ? 0 : -THICKNESS)

      const hit = rs.dir === -1 ? d.y <= surface : d.y >= surface
      if (hit) {
        if (inBounds && spl.length < SPLASH_MAX) {
          spl.push({ x: d.x, y: surface + rs.splashOffset, z: d.z, age: 0, life: 0.3 + Math.random() * 0.2 })
        }
        d.y = rs.respawnY()
        d.x = (Math.random() - 0.5) * SIZE * 1.3
        d.z = (Math.random() - 0.5) * SIZE * 1.3
      }

      const topY = d.y
      const botY = d.y + RAIN_STREAK_LEN * rs.streakSign
      const off = i * 6

      rv[off]     = d.x;  rv[off + 1] = topY; rv[off + 2] = d.z
      rv[off + 3] = d.x;  rv[off + 4] = botY; rv[off + 5] = d.z

      const bright = 0.5 + 0.2 * Math.sin(d.phase + topY * 0.5)
      rc[off]     = 0.55 * bright; rc[off + 1] = 0.7 * bright; rc[off + 2] = 1.0 * bright
      rc[off + 3] = 0.15;          rc[off + 4] = 0.2;          rc[off + 5] = 0.35
    }
    rpa.needsUpdate = true
    rca.needsUpdate = true

    let sIdx = 0
    for (let i = spl.length - 1; i >= 0; i--) {
      const sp = spl[i]
      sp.age += dt
      if (sp.age >= sp.life) { spl.splice(i, 1); continue }
      if (sIdx >= SPLASH_MAX) continue

      const t = sp.age / sp.life
      const radius = 0.15 + t * 0.8
      const alpha = (1 - t) * (1 - t)
      const sOff = sIdx * SPLASH_RING_PTS * 6

      for (let p = 0; p < SPLASH_RING_PTS; p++) {
        const a0 = (p / SPLASH_RING_PTS) * Math.PI * 2
        const a1 = ((p + 1) / SPLASH_RING_PTS) * Math.PI * 2
        const vi = sOff + p * 6
        sv[vi]     = sp.x + Math.cos(a0) * radius
        sv[vi + 1] = sp.y
        sv[vi + 2] = sp.z + Math.sin(a0) * radius
        sv[vi + 3] = sp.x + Math.cos(a1) * radius
        sv[vi + 4] = sp.y
        sv[vi + 5] = sp.z + Math.sin(a1) * radius

        sc[vi]     = 0.5 * alpha;  sc[vi + 1] = 0.75 * alpha; sc[vi + 2] = 1.0 * alpha
        sc[vi + 3] = 0.5 * alpha;  sc[vi + 4] = 0.75 * alpha; sc[vi + 5] = 1.0 * alpha
      }
      sIdx++
    }
    for (let i = sIdx * SPLASH_RING_PTS * 6; i < sv.length; i++) { sv[i] = 0; sc[i] = 0 }
    spa.needsUpdate = true
    sca.needsUpdate = true
  }

  return {
    update(dt: number) {
      updateRainSet(rainTop, dt)
      updateRainSet(rainBot, dt)
    },
    dispose() {
      rainMat.dispose()
      splashMat.dispose()
    },
  }
}
