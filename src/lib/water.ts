import * as THREE from 'three'
import { CELLS, HALF, CELL_SIZE, HEIGHT_SCALE, THICKNESS } from './constants'
import type { TerrainState, FloodBody } from './terrain'

interface WaterBody {
  mesh: THREE.Mesh
  geo: THREE.BufferGeometry
  posArr: Float32Array
  posAttr: THREE.BufferAttribute
  allAnimVerts: number[]
  waterLevel: number
  waterTarget: number
}

interface WaterBuildConfig {
  computeFloodFn: () => void
  bodies: () => FloodBody[]
  faceY: (minH: number) => number
  wallY: (minH: number) => number
  faceWinding: [number, number, number, number, number, number]
  wallWinding: [number, number, number, number, number, number]
  wallCheck: (nz: number, nx: number, minH: number) => boolean
  initLevel: (faceY: number, wallY: number) => number
  targetLevel: (faceY: number, wallY: number) => number
}

export function createWaterSystem(scene: THREE.Scene, terrain: TerrainState) {
  const waterMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
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
    initLevel: (_f, w) => w,
    targetLevel: (f) => f,
  }

  const botWaterCfg: WaterBuildConfig = {
    computeFloodFn: () => terrain.computeFloodBot(),
    bodies: () => terrain.floodBodiesBot,
    faceY: (minH) => (-minH - 1) * HEIGHT_SCALE - THICKNESS + 0.3,
    wallY: (minH) => (-minH) * HEIGHT_SCALE - THICKNESS,
    faceWinding: [0, 2, 1, 1, 2, 3],
    wallWinding: [0, 1, 2, 2, 1, 3],
    wallCheck: (nz, nx, minH) => (-terrain.target[nz][nx]) <= minH,
    initLevel: (_f, w) => w,
    targetLevel: (f) => f,
  }

  function buildWaterSet(cfg: WaterBuildConfig, out: WaterBody[]) {
    for (const wb of out) { scene.remove(wb.mesh); wb.geo.dispose() }
    out.length = 0
    cfg.computeFloodFn()

    const TR = 0.12, TG = 0.52, TB = 0.78
    const BR = 0.04, BG = 0.18, BB = 0.38

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
      scene.add(mesh)

      out.push({
        mesh, geo, posArr, posAttr,
        allAnimVerts: [...faceVerts, ...wallFaceVerts],
        waterLevel: cfg.initLevel(fY, wY),
        waterTarget: cfg.targetLevel(fY, wY),
      })
    }
  }

  const waterBodies: WaterBody[] = []
  const waterBodiesBot: WaterBody[] = []
  let waterTime = 0

  function updateWaterBodies(bodies: WaterBody[], dt: number) {
    for (const wb of bodies) {
      const diff = wb.waterTarget - wb.waterLevel
      if (Math.abs(diff) > 0.01)
        wb.waterLevel += Math.sign(diff) * Math.min(Math.abs(diff), dt * 3)

      const base = wb.waterLevel
      for (const vi of wb.allAnimVerts) {
        const x = wb.posArr[vi * 3]
        const z = wb.posArr[vi * 3 + 2]
        wb.posArr[vi * 3 + 1] = base
          + Math.sin(waterTime * 2.5 + x * 0.2 + z * 0.15) * 0.08
          + Math.sin(waterTime * 1.8 - z * 0.25 + x * 0.1) * 0.05
      }

      wb.posAttr.needsUpdate = true
      wb.geo.computeVertexNormals()
    }
  }

  return {
    buildTop() { buildWaterSet(topWaterCfg, waterBodies) },
    buildBot() { buildWaterSet(botWaterCfg, waterBodiesBot) },
    update(dt: number) {
      waterTime += dt
      updateWaterBodies(waterBodies, dt)
      updateWaterBodies(waterBodiesBot, dt)
    },
    dispose() {
      for (const wb of waterBodies) { scene.remove(wb.mesh); wb.geo.dispose() }
      waterBodies.length = 0
      for (const wb of waterBodiesBot) { scene.remove(wb.mesh); wb.geo.dispose() }
      waterBodiesBot.length = 0
    },
  }
}
