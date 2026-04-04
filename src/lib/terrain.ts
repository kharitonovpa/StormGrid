import * as THREE from 'three'
import {
  CELLS, SIZE, HALF, CELL_SIZE, SEGMENTS,
  HEIGHT_SCALE, THICKNESS, NOISE_AMP, NOISE_FREQ, GROW_SPEED,
} from './constants'
import { clamp, noise2d, fbm, sstep, mix } from './noise'

// --- Terrain grids ---
export const target = Array.from({ length: CELLS }, () => new Float32Array(CELLS))
export const current = Array.from({ length: CELLS }, () => new Float32Array(CELLS))

let heightCacheDirty = true

export function generateTerrain() {
  heightCacheDirty = true
  const seed = Math.random() * 1000
  for (let cz = 0; cz < CELLS; cz++) {
    for (let cx = 0; cx < CELLS; cx++) {
      const v = noise2d(cx * 0.8 + seed, cz * 0.8 + seed)
      if (v > 0.62) target[cz][cx] = 1
      else if (v < 0.32) target[cz][cx] = -1
      else target[cz][cx] = 0
    }
  }
}

generateTerrain()

// --- Height functions ---
export function getHeightRaw(wx: number, wz: number): number {
  const gx = (wx + HALF) / CELL_SIZE
  const gz = (wz + HALF) / CELL_SIZE
  const cx = clamp(Math.floor(gx), 0, CELLS - 1) | 0
  const cz = clamp(Math.floor(gz), 0, CELLS - 1) | 0
  const h = current[cz][cx]
  if (Math.abs(h) < 0.001) return 0
  const n = fbm(wx * NOISE_FREQ, wz * NOISE_FREQ) * NOISE_AMP
  return h * HEIGHT_SCALE + n * Math.abs(h)
}

const H_RES = 128
const heightCache = new Float32Array((H_RES + 1) * (H_RES + 1))

export function rebuildHeightCache() {
  const step = SIZE / H_RES
  for (let iz = 0; iz <= H_RES; iz++) {
    for (let ix = 0; ix <= H_RES; ix++) {
      heightCache[iz * (H_RES + 1) + ix] = getHeightRaw(-HALF + ix * step, -HALF + iz * step)
    }
  }
  heightCacheDirty = false
}

export function getHeight(wx: number, wz: number): number {
  if (heightCacheDirty) return getHeightRaw(wx, wz)
  const fx = (wx + HALF) / SIZE * H_RES
  const fz = (wz + HALF) / SIZE * H_RES
  const ix = clamp(Math.floor(fx), 0, H_RES - 1)
  const iz = clamp(Math.floor(fz), 0, H_RES - 1)
  const tx = fx - ix, tz = fz - iz
  const stride = H_RES + 1
  const a = heightCache[iz * stride + ix]
  const b = heightCache[iz * stride + ix + 1]
  const c = heightCache[(iz + 1) * stride + ix]
  const d = heightCache[(iz + 1) * stride + ix + 1]
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz
}

// --- Perimeter & mesh rebuild ---
function buildPerimeter(): number[] {
  const s = SEGMENTS + 1
  const p: number[] = []
  for (let ix = 0; ix < SEGMENTS; ix++) p.push(ix)
  for (let iz = 0; iz < SEGMENTS; iz++) p.push(iz * s + SEGMENTS)
  for (let ix = SEGMENTS; ix > 0; ix--) p.push(SEGMENTS * s + ix)
  for (let iz = SEGMENTS; iz > 0; iz--) p.push(iz * s)
  return p
}
const PERIMETER = buildPerimeter()
export { PERIMETER }

export function rebuildMesh(
  pos: THREE.BufferAttribute,
  bottomPos: THREE.BufferAttribute | null,
  skirtPos: THREE.BufferAttribute | null,
) {
  const stride = SEGMENTS + 1
  for (let i = 0; i < pos.count; i++) {
    const iz = (i / stride) | 0
    const ix = i % stride
    const baseX = -HALF + ix * (SIZE / SEGMENTS)
    const baseZ = -HALF + iz * (SIZE / SEGMENTS)
    const y = getHeightRaw(baseX, baseZ)

    let dx = 0, dz = 0
    if (Math.abs(y) > 0.01) {
      dx = fbm(baseX * 0.15 + 100, baseZ * 0.15 + y * 1.2) * 0.8 * Math.abs(y) / HEIGHT_SCALE
      dz = fbm(baseX * 0.15 + y * 1.2, baseZ * 0.15 + 100) * 0.8 * Math.abs(y) / HEIGHT_SCALE
    }

    pos.setXYZ(i, baseX + dx, y, baseZ + dz)
    if (bottomPos) bottomPos.setXYZ(i, baseX + dx, y - THICKNESS, baseZ + dz)
  }
  pos.needsUpdate = true
  if (bottomPos) bottomPos.needsUpdate = true

  if (skirtPos) {
    const n = PERIMETER.length
    for (let k = 0; k < n; k++) {
      const vi = PERIMETER[k]
      const sx = pos.getX(vi), sy = pos.getY(vi), sz = pos.getZ(vi)
      skirtPos.setXYZ(k, sx, sy, sz)
      skirtPos.setXYZ(n + k, sx, sy - THICKNESS, sz)
    }
    skirtPos.needsUpdate = true
  }
}

// --- Vertex coloring ---
export function paintColors(geo: THREE.BufferGeometry, isBottom = false) {
  const p = geo.attributes.position as THREE.BufferAttribute
  const nm = geo.attributes.normal as THREE.BufferAttribute
  if (!nm) return
  let col = geo.attributes.color as THREE.BufferAttribute | undefined
  if (!col) {
    col = new THREE.Float32BufferAttribute(new Float32Array(p.count * 3), 3)
    geo.setAttribute('color', col)
  }
  for (let i = 0; i < p.count; i++) {
    const wx = p.getX(i), wy = p.getY(i), wz = p.getZ(i)
    const nv = noise2d(wx * 0.5 + 77, wz * 0.5 + 77) * 0.12
    const nv2 = noise2d(wx * 0.9 + 33, wz * 0.9 + 33) * 0.08

    const slope = Math.abs(nm.getY(i))
    const h = isBottom ? -wy : wy

    const mudW = 1 - sstep(-3.5, -1.5, h)
    const snowW = sstep(2.0, 4.0, h)
    const grassW = clamp(1 - mudW - snowW, 0, 1)

    const patchN = noise2d(wx * 0.2, wz * 0.2)
    const sgb = sstep(0.35, 0.55, patchN) * 0.4

    const gr0 = 0.18 + nv + nv2, gr1 = 0.44 + nv + nv2, gr2 = 0.1 + nv * 0.5
    const md0 = 0.39 + nv * 0.7, md1 = 0.27 + nv * 0.5, md2 = 0.13 + nv * 0.3
    const sn0 = 0.88 + nv * 0.3 - sgb * 0.55
    const sn1 = 0.90 + nv * 0.3 - sgb * 0.35
    const sn2 = 0.97 + nv * 0.2 - sgb * 0.65

    let r = gr0 * grassW + md0 * mudW + sn0 * snowW
    let g = gr1 * grassW + md1 * mudW + sn1 * snowW
    let b = gr2 * grassW + md2 * mudW + sn2 * snowW

    const rockW = 1 - sstep(0.3, 0.75, slope)
    const rk0 = 0.38 + nv * 0.6, rk1 = 0.34 + nv * 0.5, rk2 = 0.30 + nv * 0.5
    r = mix(r, rk0, rockW)
    g = mix(g, rk1, rockW)
    b = mix(b, rk2, rockW)

    col.setXYZ(i, clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1))
  }
  col.needsUpdate = true
}

// --- Flood (BFS) ---
export interface FloodBody { cells: [number, number][]; minH: number }

const floodState = Array.from({ length: CELLS }, () => new Array<boolean>(CELLS).fill(false))
export let floodBodies: FloodBody[] = []

const floodStateBot = Array.from({ length: CELLS }, () => new Array<boolean>(CELLS).fill(false))
export let floodBodiesBot: FloodBody[] = []

function computeFloodGeneric(
  heightOf: (z: number, x: number) => number,
  peakVal: number,
  stateOut: boolean[][],
  bodiesOut: FloodBody[],
) {
  for (let z = 0; z < CELLS; z++)
    for (let x = 0; x < CELLS; x++) stateOut[z][x] = false
  bodiesOut.length = 0

  const visited = Array.from({ length: CELLS }, () => new Array<boolean>(CELLS).fill(false))
  const dirs: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]]

  for (let sz = 0; sz < CELLS; sz++) {
    for (let sx = 0; sx < CELLS; sx++) {
      if (visited[sz][sx] || heightOf(sz, sx) === peakVal) continue
      const comp: [number, number][] = []
      const queue: [number, number][] = [[sz, sx]]
      let head = 0
      visited[sz][sx] = true
      let minH = heightOf(sz, sx)

      while (head < queue.length) {
        const [cz, cx] = queue[head++]
        comp.push([cz, cx])
        const h = heightOf(cz, cx)
        if (h < minH) minH = h
        for (const [dz, dx] of dirs) {
          const nz = cz + dz, nx = cx + dx
          if (nz < 0 || nz >= CELLS || nx < 0 || nx >= CELLS) continue
          if (visited[nz][nx] || heightOf(nz, nx) === peakVal) continue
          visited[nz][nx] = true
          queue.push([nz, nx])
        }
      }

      const floodedSet = new Set<string>()
      for (const [cz, cx] of comp) {
        if (heightOf(cz, cx) === minH) {
          stateOut[cz][cx] = true
          floodedSet.add(`${cz},${cx}`)
        }
      }

      const subVis = new Set<string>()
      for (const key of floodedSet) {
        if (subVis.has(key)) continue
        const [sz2, sx2] = key.split(',').map(Number)
        const body: [number, number][] = []
        const q: [number, number][] = [[sz2, sx2]]
        let qh = 0
        subVis.add(key)
        while (qh < q.length) {
          const [z, x] = q[qh++]
          body.push([z, x])
          for (const [dz, dx] of dirs) {
            const nk = `${z + dz},${x + dx}`
            if (!subVis.has(nk) && floodedSet.has(nk)) {
              subVis.add(nk)
              q.push([z + dz, x + dx])
            }
          }
        }
        if (body.length > 0) bodiesOut.push({ cells: body, minH })
      }
    }
  }
}

export function computeFlood() {
  computeFloodGeneric((z, x) => target[z][x], 1, floodState, floodBodies)
}

export function computeFloodBot() {
  computeFloodGeneric((z, x) => -target[z][x], 1, floodStateBot, floodBodiesBot)
}

export function invalidateHeightCache() {
  heightCacheDirty = true
}

// --- Animation step ---
export function stepAnimation(dt: number): boolean {
  let done = true
  for (let cz = 0; cz < CELLS; cz++) {
    for (let cx = 0; cx < CELLS; cx++) {
      const diff = target[cz][cx] - current[cz][cx]
      if (Math.abs(diff) > 0.001) {
        done = false
        const step = Math.sign(diff) * Math.min(Math.abs(diff), dt * GROW_SPEED)
        current[cz][cx] += step
      } else {
        current[cz][cx] = target[cz][cx]
      }
    }
  }
  return done
}

// --- Typed export for other modules ---
export interface TerrainState {
  target: Float32Array[]
  current: Float32Array[]
  getHeight(wx: number, wz: number): number
  getHeightRaw(wx: number, wz: number): number
  rebuildHeightCache(): void
  invalidateHeightCache(): void
  generateTerrain(): void
  computeFlood(): void
  computeFloodBot(): void
  floodBodies: FloodBody[]
  floodBodiesBot: FloodBody[]
  rebuildMesh(
    pos: THREE.BufferAttribute,
    bottomPos: THREE.BufferAttribute | null,
    skirtPos: THREE.BufferAttribute | null,
  ): void
  paintColors(geo: THREE.BufferGeometry, isBottom?: boolean): void
  stepAnimation(dt: number): boolean
  PERIMETER: number[]
}

export const terrainState: TerrainState = {
  target,
  current,
  getHeight,
  getHeightRaw,
  rebuildHeightCache,
  invalidateHeightCache,
  generateTerrain,
  computeFlood,
  computeFloodBot,
  get floodBodies() { return floodBodies },
  get floodBodiesBot() { return floodBodiesBot },
  rebuildMesh,
  paintColors,
  stepAnimation,
  PERIMETER,
}
