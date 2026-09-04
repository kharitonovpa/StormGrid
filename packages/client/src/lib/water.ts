import * as THREE from 'three'
import { CELLS, HALF, CELL_SIZE, HEIGHT_SCALE, THICKNESS } from './constants'
import { GLASS_ORDER } from './glass'
import type { TerrainState, FloodBody } from './terrain'
import { LOOK, srgbHexToLinear } from './look'

// The surface takes the lighter rim colour; the walls fade from the rim colour
// at the surface to the deep body at the floor (lib/look.ts). Vertex colours
// are linear, hence the conversion.
const WATER_RIM = srgbHexToLinear(LOOK.water.rim)
const WATER_DEEP = srgbHexToLinear(LOOK.water.deep)

/** Seconds the decisive hollow takes to brim over. */
const FILL_DURATION = 1.6
/** How long the storm keeps raining once the water starts to gather. */
export const WATER_FILL_MS = FILL_DURATION * 1000
/** Even a single-cell puddle takes this long, so it never pops into place. */
const MIN_FILL_DURATION = 0.3
/** Shallowest water still worth drawing, as a share of the hollow depth. */
const MIN_FRACTION = 0.1

interface WaterBody {
  mesh: THREE.Mesh
  geo: THREE.BufferGeometry
  posArr: Float32Array
  posAttr: THREE.BufferAttribute
  allAnimVerts: number[]
  waterLevel: number
  waterTarget: number
  riseRate: number
}

interface WaterBuildConfig {
  computeFloodFn: () => void
  bodies: () => FloodBody[]
  faceY: (minH: number) => number
  wallY: (minH: number) => number
  faceWinding: [number, number, number, number, number, number]
  wallWinding: [number, number, number, number, number, number]
  wallCheck: (nz: number, nx: number, minH: number) => boolean
  renderOrder: number
}

/**
 * Fill one hollow the way the rain fills it: every hollow takes the same water
 * per second, so a wide one rises slowly and may never reach its brim. `volume`
 * is the water that came down, in cell-depths (see the server rain module); a
 * hollow of n cells ends up at min(1, volume / n) of its depth.
 */
function fillOf(volume: number, cells: number, faceY: number, wallY: number) {
  const depth = faceY - wallY
  const filled = Math.max(1, volume) / cells
  // A hollow that never brims over keeps rising until the rain stops, so all of
  // them come to rest together; the ones that do brim over get there sooner.
  const seconds = filled < 1
    ? FILL_DURATION
    : Math.max(MIN_FILL_DURATION, FILL_DURATION / filled)
  // A film thinner than the ripple would clip through the ground.
  const fraction = Math.min(1, Math.max(MIN_FRACTION, filled))
  return {
    waterLevel: wallY,
    waterTarget: wallY + depth * fraction,
    riseRate: Math.abs(depth * fraction) / seconds,
  }
}

export function createWaterSystem(scene: THREE.Scene, terrain: TerrainState) {
  const waterMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    transparent: true,
    opacity: LOOK.water.opacity,
    roughness: 0.1,
    metalness: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
  })

  const topWaterCfg: WaterBuildConfig = {
    computeFloodFn: () => terrain.computeFlood(),
    bodies: () => terrain.floodBodies,
    faceY: (minH) => (minH + 1) * HEIGHT_SCALE - 0.3,
    wallY: (minH) => minH * HEIGHT_SCALE,
    faceWinding: [0, 1, 2, 2, 1, 3],
    wallWinding: [0, 2, 1, 1, 2, 3],
    wallCheck: (nz, nx, minH) => terrain.target[nz][nx] <= minH,
    renderOrder: GLASS_ORDER.nearWater,
  }

  const botWaterCfg: WaterBuildConfig = {
    computeFloodFn: () => terrain.computeFloodBot(),
    bodies: () => terrain.floodBodiesBot,
    faceY: (minH) => (-minH - 1) * HEIGHT_SCALE - THICKNESS + 0.3,
    wallY: (minH) => (-minH) * HEIGHT_SCALE - THICKNESS,
    faceWinding: [0, 2, 1, 1, 2, 3],
    wallWinding: [0, 1, 2, 2, 1, 3],
    wallCheck: (nz, nx, minH) => (-terrain.target[nz][nx]) <= minH,
    // Drawn before both faces of the slab, so a glass pane can show it through.
    renderOrder: GLASS_ORDER.farWater,
  }

  function buildWaterSet(cfg: WaterBuildConfig, out: WaterBody[], volume: number) {
    for (const wb of out) { scene.remove(wb.mesh); wb.geo.dispose() }
    out.length = 0
    cfg.computeFloodFn()

    const [TR, TG, TB] = WATER_RIM
    const [BR, BG, BB] = WATER_DEEP

    for (const body of cfg.bodies()) {
      const { cells, minH } = body
      const cellSet = new Set(cells.map(([z, x]) => `${z},${x}`))

      const fY = cfg.faceY(minH)
      const wY = cfg.wallY(minH)

      const v: number[] = []
      const c: number[] = []
      const ix: number[] = []
      const cornerMap = new Map<string, number>()
      const faceVerts: number[] = []

      function corner(ci: number, cj: number): number {
        const k = `${ci},${cj}`
        if (cornerMap.has(k)) return cornerMap.get(k)!
        const vi = v.length / 3
        v.push(-HALF + ci * CELL_SIZE, fY, -HALF + cj * CELL_SIZE)
        c.push(TR, TG, TB)
        cornerMap.set(k, vi)
        faceVerts.push(vi)
        return vi
      }

      const fw = cfg.faceWinding
      for (const [cz, cx] of cells) {
        const q = [corner(cx, cz), corner(cx, cz + 1), corner(cx + 1, cz), corner(cx + 1, cz + 1)]
        ix.push(q[fw[0]], q[fw[1]], q[fw[2]], q[fw[3]], q[fw[4]], q[fw[5]])
      }

      const wallFaceVerts: number[] = []
      const ww = cfg.wallWinding

      function addWall(x0: number, z0: number, x1: number, z1: number) {
        const base = v.length / 3
        v.push(x0, fY, z0, x1, fY, z1, x0, wY, z0, x1, wY, z1)
        c.push(TR, TG, TB, TR, TG, TB, BR, BG, BB, BR, BG, BB)
        ix.push(base + ww[0], base + ww[1], base + ww[2], base + ww[3], base + ww[4], base + ww[5])
        wallFaceVerts.push(base, base + 1)
      }

      function needsWall(nz: number, nx: number): boolean {
        if (cellSet.has(`${nz},${nx}`)) return false
        if (nz < 0 || nz >= CELLS || nx < 0 || nx >= CELLS) return true
        return cfg.wallCheck(nz, nx, minH)
      }

      for (const [cz, cx] of cells) {
        const x0 = -HALF + cx * CELL_SIZE
        const x1 = -HALF + (cx + 1) * CELL_SIZE
        const z0 = -HALF + cz * CELL_SIZE
        const z1 = -HALF + (cz + 1) * CELL_SIZE
        if (needsWall(cz - 1, cx)) addWall(x1, z0, x0, z0)
        if (needsWall(cz + 1, cx)) addWall(x0, z1, x1, z1)
        if (needsWall(cz, cx - 1)) addWall(x0, z0, x0, z1)
        if (needsWall(cz, cx + 1)) addWall(x1, z1, x1, z0)
      }

      const posArr = new Float32Array(v)
      const posAttr = new THREE.BufferAttribute(posArr, 3)
      posAttr.setUsage(THREE.DynamicDrawUsage)

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', posAttr)
      geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3))
      geo.setIndex(ix)
      geo.computeVertexNormals()

      const mesh = new THREE.Mesh(geo, waterMat)
      mesh.renderOrder = cfg.renderOrder
      scene.add(mesh)

      out.push({
        mesh, geo, posArr, posAttr,
        allAnimVerts: [...faceVerts, ...wallFaceVerts],
        ...fillOf(volume, cells.length, fY, wY),
      })
    }
  }

  const waterBodies: WaterBody[] = []
  const waterBodiesBot: WaterBody[] = []
  let waterTime = 0
  let normalFrame = 0

  function updateWaterBodies(bodies: WaterBody[], dt: number) {
    for (const wb of bodies) {
      const diff = wb.waterTarget - wb.waterLevel
      if (Math.abs(diff) > 0.01)
        wb.waterLevel += Math.sign(diff) * Math.min(Math.abs(diff), dt * wb.riseRate)

      const base = wb.waterLevel
      for (const vi of wb.allAnimVerts) {
        const x = wb.posArr[vi * 3]
        const z = wb.posArr[vi * 3 + 2]
        wb.posArr[vi * 3 + 1] = base
          + Math.sin(waterTime * 2.5 + x * 0.2 + z * 0.15) * 0.08
          + Math.sin(waterTime * 1.8 - z * 0.25 + x * 0.1) * 0.05
      }

      wb.posAttr.needsUpdate = true
      if (normalFrame === 0) wb.geo.computeVertexNormals()
    }
  }

  function clearBodies() {
    for (const wb of waterBodies) { scene.remove(wb.mesh); wb.geo.dispose() }
    waterBodies.length = 0
    for (const wb of waterBodiesBot) { scene.remove(wb.mesh); wb.geo.dispose() }
    waterBodiesBot.length = 0
  }

  return {
    /** volume: water that came down, in cell-depths (WeatherResult.waterVolume). */
    buildTop(volume: number) { buildWaterSet(topWaterCfg, waterBodies, volume) },
    buildBot(volume: number) { buildWaterSet(botWaterCfg, waterBodiesBot, volume) },
    update(dt: number) {
      waterTime += dt
      normalFrame = (normalFrame + 1) % 3
      updateWaterBodies(waterBodies, dt)
      updateWaterBodies(waterBodiesBot, dt)
    },
    clear: clearBodies,
    dispose() {
      clearBodies()
      waterMat.dispose()
    },
  }
}
