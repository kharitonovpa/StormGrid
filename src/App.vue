<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createFlame } from './flame'

const CELLS = 7
const SIZE = 60
const HALF = SIZE / 2
const CELL_SIZE = SIZE / CELLS
const SEGMENTS = CELLS * 30
const HEIGHT_SCALE = 5
const THICKNESS = 1
const NOISE_AMP = 1.2
const NOISE_FREQ = 0.35
const GROW_SPEED = 0.6

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}

function hash(n: number) {
  const x = Math.sin(n) * 43758.5453
  return x - Math.floor(x)
}

function noise2d(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix + iy * 57)
  const b = hash(ix + 1 + iy * 57)
  const c = hash(ix + (iy + 1) * 57)
  const d = hash(ix + 1 + (iy + 1) * 57)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

function fbm(x: number, y: number) {
  return noise2d(x, y) * 0.5
       + noise2d(x * 2, y * 2) * 0.25
       + noise2d(x * 4, y * 4) * 0.125
       + noise2d(x * 8, y * 8) * 0.0625
       - 0.45
}

// --- Vertex color helpers ---
function sstep(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

function mix(a: number, b: number, t: number) { return a + (b - a) * t }

function paintColors(geo: THREE.BufferGeometry, isBottom = false) {
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

// --- Terrain state ---
const target = Array.from({ length: CELLS }, () => new Float32Array(CELLS))
const current = Array.from({ length: CELLS }, () => new Float32Array(CELLS))

function generateTerrain() {
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

// --- Flood (rain) state ---
const floodState = Array.from({ length: CELLS }, () => new Array<boolean>(CELLS).fill(false))

interface FloodBody { cells: [number, number][]; minH: number }
let floodBodies: FloodBody[] = []

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
      visited[sz][sx] = true
      let minH = heightOf(sz, sx)

      while (queue.length) {
        const [cz, cx] = queue.shift()!
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
        subVis.add(key)
        while (q.length) {
          const [z, x] = q.shift()!
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

function computeFlood() {
  computeFloodGeneric((z, x) => target[z][x], 1, floodState, floodBodies)
}

const floodStateBot = Array.from({ length: CELLS }, () => new Array<boolean>(CELLS).fill(false))
let floodBodiesBot: FloodBody[] = []

function computeFloodBot() {
  computeFloodGeneric((z, x) => -target[z][x], 1, floodStateBot, floodBodiesBot)
}

function getHeight(wx: number, wz: number): number {
  const gx = (wx + HALF) / CELL_SIZE
  const gz = (wz + HALF) / CELL_SIZE
  const cx = clamp(Math.floor(gx), 0, CELLS - 1) | 0
  const cz = clamp(Math.floor(gz), 0, CELLS - 1) | 0
  const h = current[cz][cx]
  if (Math.abs(h) < 0.001) return 0

  const n = fbm(wx * NOISE_FREQ, wz * NOISE_FREQ) * NOISE_AMP
  return h * HEIGHT_SCALE + n * Math.abs(h)
}

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

function rebuildMesh(
  pos: THREE.BufferAttribute,
  bottomPos: THREE.BufferAttribute | null,
  skirtPos: THREE.BufferAttribute | null
) {
  const stride = SEGMENTS + 1

  for (let i = 0; i < pos.count; i++) {
    const iz = (i / stride) | 0
    const ix = i % stride
    const baseX = -HALF + ix * (SIZE / SEGMENTS)
    const baseZ = -HALF + iz * (SIZE / SEGMENTS)

    const y = getHeight(baseX, baseZ)

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

// --- Three.js ---
const container = ref<HTMLElement | null>(null)
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let animId: number

onMounted(() => {
  const el = container.value!
  const w = el.clientWidth
  const h = el.clientHeight

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0a0e14)

  const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500)
  camera.position.set(30, 25, 30)
  camera.lookAt(0, 0, 0)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(w, h)
  el.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI

  const axes = new THREE.AxesHelper(15)
  scene.add(axes)

  scene.add(new THREE.AmbientLight(0xffffff, 0.5))
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2)
  dirLight.position.set(10, 20, 15)
  scene.add(dirLight)
  const dirLightBottom = new THREE.DirectionalLight(0xffffff, 1.0)
  dirLightBottom.position.set(-10, -20, -15)
  scene.add(dirLightBottom)

  const flame = createFlame()
  flame.scale.setScalar(2)
  flame.position.set(0, 0, 0)
  scene.add(flame)

  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })

  const mesh = new THREE.Mesh(geo, terrainMat)
  scene.add(mesh)

  const bottomGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS)
  bottomGeo.rotateX(-Math.PI / 2)
  const bottomPos = bottomGeo.attributes.position as THREE.BufferAttribute
  const bottomMesh = new THREE.Mesh(bottomGeo, terrainMat)
  scene.add(bottomMesh)

  const perimN = PERIMETER.length
  const skirtVerts = new Float32Array(perimN * 2 * 3)
  const skirtIdxArr: number[] = []
  for (let i = 0; i < perimN; i++) {
    const next = (i + 1) % perimN
    skirtIdxArr.push(i, perimN + i, next, next, perimN + i, perimN + next)
  }
  const skirtGeo = new THREE.BufferGeometry()
  const skirtPos = new THREE.BufferAttribute(skirtVerts, 3)
  skirtGeo.setAttribute('position', skirtPos)
  skirtGeo.setIndex(skirtIdxArr)
  const skirtMesh = new THREE.Mesh(skirtGeo, terrainMat)
  scene.add(skirtMesh)

  const gridStep = SIZE / SEGMENTS
  const gridPts = new Float32Array((CELLS + 1) * SEGMENTS * 4 * 3)
  const gridGeo = new THREE.BufferGeometry()
  const gridPos = new THREE.BufferAttribute(gridPts, 3)
  gridGeo.setAttribute('position', gridPos)
  const gridLines = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0xffaa00 }))
  scene.add(gridLines)

  // === Water (one mesh per water body, shared-vertex top + exterior walls) ===
  const waterMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    roughness: 0.1,
    metalness: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
  })

  interface WaterBody {
    mesh: THREE.Mesh
    geo: THREE.BufferGeometry
    posArr: Float32Array
    posAttr: THREE.BufferAttribute
    topVerts: number[]
    sideTopVerts: number[]
    waterLevel: number
    waterTarget: number
  }
  const waterBodies: WaterBody[] = []

  function buildWater() {
    for (const wb of waterBodies) { scene.remove(wb.mesh); wb.geo.dispose() }
    waterBodies.length = 0
    computeFlood()

    for (const body of floodBodies) {
      const { cells, minH } = body
      const cellSet = new Set(cells.map(([z, x]) => `${z},${x}`))

      const waterSurface = (minH + 1) * HEIGHT_SCALE - 0.3
      const waterBottom = minH * HEIGHT_SCALE

      const v: number[] = []
      const c: number[] = []
      const ix: number[] = []

      const TR = 0.12, TG = 0.52, TB = 0.78
      const BR = 0.04, BG = 0.18, BB = 0.38

      const topMap = new Map<string, number>()
      const topVerts: number[] = []

      function topCorner(ci: number, cj: number): number {
        const k = `${ci},${cj}`
        if (topMap.has(k)) return topMap.get(k)!
        const vi = v.length / 3
        v.push(-HALF + ci * CELL_SIZE, waterSurface, -HALF + cj * CELL_SIZE)
        c.push(TR, TG, TB)
        topMap.set(k, vi)
        topVerts.push(vi)
        return vi
      }

      for (const [cz, cx] of cells) {
        const a = topCorner(cx, cz)
        const b = topCorner(cx + 1, cz)
        const d = topCorner(cx, cz + 1)
        const e = topCorner(cx + 1, cz + 1)
        ix.push(a, d, b, b, d, e)
      }

      const sideTopVerts: number[] = []

      function addWall(x0: number, z0: number, x1: number, z1: number) {
        const base = v.length / 3
        v.push(x0, waterSurface, z0, x1, waterSurface, z1,
               x0, waterBottom, z0, x1, waterBottom, z1)
        c.push(TR, TG, TB, TR, TG, TB, BR, BG, BB, BR, BG, BB)
        ix.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
        sideTopVerts.push(base, base + 1)
      }

      function needsWall(nz: number, nx: number): boolean {
        if (cellSet.has(`${nz},${nx}`)) return false
        if (nz < 0 || nz >= CELLS || nx < 0 || nx >= CELLS) return true
        return target[nz][nx] <= minH
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

      waterBodies.push({
        mesh, geo, posArr, posAttr,
        topVerts, sideTopVerts,
        waterLevel: waterBottom,
        waterTarget: waterSurface,
      })
    }
  }

  let waterTime = 0
  function updateWater(dt: number) {
    waterTime += dt
    for (const wb of waterBodies) {
      const diff = wb.waterTarget - wb.waterLevel
      if (Math.abs(diff) > 0.01)
        wb.waterLevel += Math.sign(diff) * Math.min(Math.abs(diff), dt * 3)

      const base = wb.waterLevel
      const allTop = [...wb.topVerts, ...wb.sideTopVerts]
      for (const vi of allTop) {
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

  // === Bottom water (under the map) ===
  const waterBodiesBot: WaterBody[] = []

  function buildWaterBot() {
    for (const wb of waterBodiesBot) { scene.remove(wb.mesh); wb.geo.dispose() }
    waterBodiesBot.length = 0
    computeFloodBot()

    for (const body of floodBodiesBot) {
      const { cells, minH } = body
      const cellSet = new Set(cells.map(([z, x]) => `${z},${x}`))

      const origH = -minH
      const waterCeiling = origH * HEIGHT_SCALE - THICKNESS
      const waterFloor = (origH - 1) * HEIGHT_SCALE - THICKNESS + 0.3

      const v: number[] = []
      const c: number[] = []
      const ix: number[] = []

      const TR = 0.12, TG = 0.52, TB = 0.78
      const BR = 0.04, BG = 0.18, BB = 0.38

      const faceMap = new Map<string, number>()
      const topVerts: number[] = []

      function faceCorner(ci: number, cj: number): number {
        const k = `${ci},${cj}`
        if (faceMap.has(k)) return faceMap.get(k)!
        const vi = v.length / 3
        v.push(-HALF + ci * CELL_SIZE, waterFloor, -HALF + cj * CELL_SIZE)
        c.push(TR, TG, TB)
        faceMap.set(k, vi)
        topVerts.push(vi)
        return vi
      }

      for (const [cz, cx] of cells) {
        const a = faceCorner(cx, cz)
        const b = faceCorner(cx + 1, cz)
        const d = faceCorner(cx, cz + 1)
        const e = faceCorner(cx + 1, cz + 1)
        ix.push(a, b, d, d, b, e)
      }

      const sideTopVerts: number[] = []

      function addWall(x0: number, z0: number, x1: number, z1: number) {
        const base = v.length / 3
        v.push(x0, waterFloor, z0, x1, waterFloor, z1,
               x0, waterCeiling, z0, x1, waterCeiling, z1)
        c.push(TR, TG, TB, TR, TG, TB, BR, BG, BB, BR, BG, BB)
        ix.push(base, base + 1, base + 2, base + 2, base + 1, base + 3)
        sideTopVerts.push(base, base + 1)
      }

      function needsWall(nz: number, nx: number): boolean {
        if (cellSet.has(`${nz},${nx}`)) return false
        if (nz < 0 || nz >= CELLS || nx < 0 || nx >= CELLS) return true
        return (-target[nz][nx]) <= minH
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

      waterBodiesBot.push({
        mesh, geo, posArr, posAttr,
        topVerts, sideTopVerts,
        waterLevel: waterCeiling,
        waterTarget: waterFloor,
      })
    }
  }

  function updateWaterBot(dt: number) {
    waterTime += dt
    for (const wb of waterBodiesBot) {
      const diff = wb.waterTarget - wb.waterLevel
      if (Math.abs(diff) > 0.01)
        wb.waterLevel += Math.sign(diff) * Math.min(Math.abs(diff), dt * 3)

      const base = wb.waterLevel
      const allTop = [...wb.topVerts, ...wb.sideTopVerts]
      for (const vi of allTop) {
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

  // === Wind: streamlines + dust, fixed Y, blocked by terrain ===

  const WIND_Y_MIN = -4
  const WIND_Y_MAX = 8
  const WIND_Y_MIN_BOT = -WIND_Y_MAX - THICKNESS
  const WIND_Y_MAX_BOT = -WIND_Y_MIN - THICKNESS

  // --- Part 1: Streamlines ---
  const STREAM_COUNT = 100
  const STREAM_PTS = 28
  const STREAM_SPEED = 10

  interface StreamLine {
    x: number; z: number; speed: number; y: number
    phase: number; length: number
  }
  const streams: StreamLine[] = []
  for (let i = 0; i < STREAM_COUNT; i++) {
    streams.push({
      x: (Math.random() - 0.5) * SIZE,
      z: -HALF + Math.random() * SIZE,
      speed: STREAM_SPEED * (0.6 + Math.random() * 0.8),
      y: WIND_Y_MIN + Math.random() * (WIND_Y_MAX - WIND_Y_MIN),
      phase: Math.random() * Math.PI * 2,
      length: 6 + Math.random() * 12,
    })
  }

  const streamVerts = new Float32Array(STREAM_COUNT * STREAM_PTS * 2 * 3)
  const streamColors = new Float32Array(STREAM_COUNT * STREAM_PTS * 2 * 3)
  const streamGeo = new THREE.BufferGeometry()
  const streamPosAttr = new THREE.BufferAttribute(streamVerts, 3)
  const streamColAttr = new THREE.BufferAttribute(streamColors, 3)
  streamGeo.setAttribute('position', streamPosAttr)
  streamGeo.setAttribute('color', streamColAttr)
  const streamMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const streamObj = new THREE.LineSegments(streamGeo, streamMat)
  scene.add(streamObj)

  // --- Part 2: Dust particles ---
  const DUST_COUNT = 1500
  const DUST_SPEED = 11

  interface DustParticle {
    x: number; y: number; z: number
    speed: number; phase: number; drift: number
  }
  const dustArr: DustParticle[] = []
  for (let i = 0; i < DUST_COUNT; i++) {
    dustArr.push({
      x: (Math.random() - 0.5) * SIZE,
      y: WIND_Y_MIN + Math.random() * (WIND_Y_MAX - WIND_Y_MIN),
      z: (Math.random() - 0.5) * SIZE,
      speed: DUST_SPEED * (0.4 + Math.random() * 1.2),
      phase: Math.random() * Math.PI * 2,
      drift: (Math.random() - 0.5) * 1.5,
    })
  }

  const dustPositions = new Float32Array(DUST_COUNT * 3)
  const dustSizes = new Float32Array(DUST_COUNT)
  const dustOpacities = new Float32Array(DUST_COUNT)
  const dustGeo = new THREE.BufferGeometry()
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
  dustGeo.setAttribute('aSize', new THREE.BufferAttribute(dustSizes, 1))
  dustGeo.setAttribute('aOpacity', new THREE.BufferAttribute(dustOpacities, 1))

  const dustMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(0.5, 0.8, 1.0) },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aOpacity;
      varying float vOpacity;
      void main() {
        vOpacity = aOpacity;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (200.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vOpacity;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float alpha = smoothstep(1.0, 0.3, d) * vOpacity;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  })
  const dustObj = new THREE.Points(dustGeo, dustMat)
  scene.add(dustObj)

  // --- Bottom streamlines ---
  const streamsBot: StreamLine[] = []
  for (let i = 0; i < STREAM_COUNT; i++) {
    streamsBot.push({
      x: (Math.random() - 0.5) * SIZE,
      z: -HALF + Math.random() * SIZE,
      speed: STREAM_SPEED * (0.6 + Math.random() * 0.8),
      y: WIND_Y_MIN_BOT + Math.random() * (WIND_Y_MAX_BOT - WIND_Y_MIN_BOT),
      phase: Math.random() * Math.PI * 2,
      length: 6 + Math.random() * 12,
    })
  }
  const streamVertsBot = new Float32Array(STREAM_COUNT * STREAM_PTS * 2 * 3)
  const streamColorsBot = new Float32Array(STREAM_COUNT * STREAM_PTS * 2 * 3)
  const streamGeoBot = new THREE.BufferGeometry()
  const streamPosAttrBot = new THREE.BufferAttribute(streamVertsBot, 3)
  const streamColAttrBot = new THREE.BufferAttribute(streamColorsBot, 3)
  streamGeoBot.setAttribute('position', streamPosAttrBot)
  streamGeoBot.setAttribute('color', streamColAttrBot)
  const streamObjBot = new THREE.LineSegments(streamGeoBot, streamMat)
  scene.add(streamObjBot)

  // --- Bottom dust ---
  const dustArrBot: DustParticle[] = []
  for (let i = 0; i < DUST_COUNT; i++) {
    dustArrBot.push({
      x: (Math.random() - 0.5) * SIZE,
      y: WIND_Y_MIN_BOT + Math.random() * (WIND_Y_MAX_BOT - WIND_Y_MIN_BOT),
      z: (Math.random() - 0.5) * SIZE,
      speed: DUST_SPEED * (0.4 + Math.random() * 1.2),
      phase: Math.random() * Math.PI * 2,
      drift: (Math.random() - 0.5) * 1.5,
    })
  }
  const dustPositionsBot = new Float32Array(DUST_COUNT * 3)
  const dustSizesBot = new Float32Array(DUST_COUNT)
  const dustOpacitiesBot = new Float32Array(DUST_COUNT)
  const dustGeoBot = new THREE.BufferGeometry()
  dustGeoBot.setAttribute('position', new THREE.BufferAttribute(dustPositionsBot, 3))
  dustGeoBot.setAttribute('aSize', new THREE.BufferAttribute(dustSizesBot, 1))
  dustGeoBot.setAttribute('aOpacity', new THREE.BufferAttribute(dustOpacitiesBot, 1))
  const dustObjBot = new THREE.Points(dustGeoBot, dustMat)
  scene.add(dustObjBot)

  function isBlocked(x: number, y: number, z: number): boolean {
    if (x < -HALF || x > HALF || z < -HALF || z > HALF) return false
    return getHeight(x, z) >= y
  }
  function isBlockedBottom(x: number, y: number, z: number): boolean {
    if (x < -HALF || x > HALF || z < -HALF || z > HALF) return false
    return y >= getHeight(x, z) - THICKNESS
  }

  function respawnStream(s: StreamLine) {
    s.z = HALF + Math.random() * 8
    s.x = (Math.random() - 0.5) * SIZE
    s.y = WIND_Y_MIN + Math.random() * (WIND_Y_MAX - WIND_Y_MIN)
  }
  function respawnStreamBot(s: StreamLine) {
    s.z = HALF + Math.random() * 8
    s.x = (Math.random() - 0.5) * SIZE
    s.y = WIND_Y_MIN_BOT + Math.random() * (WIND_Y_MAX_BOT - WIND_Y_MIN_BOT)
  }

  function respawnDust(d: DustParticle) {
    d.z = HALF + Math.random() * 6
    d.x = (Math.random() - 0.5) * SIZE
    d.y = WIND_Y_MIN + Math.random() * (WIND_Y_MAX - WIND_Y_MIN)
  }
  function respawnDustBot(d: DustParticle) {
    d.z = HALF + Math.random() * 6
    d.x = (Math.random() - 0.5) * SIZE
    d.y = WIND_Y_MIN_BOT + Math.random() * (WIND_Y_MAX_BOT - WIND_Y_MIN_BOT)
  }

  let windTime = 0

  function updateStreamSet(
    stArr: StreamLine[], stVerts: Float32Array, stColors: Float32Array,
    stPosAttr: THREE.BufferAttribute, stColAttr: THREE.BufferAttribute,
    blockedFn: (x: number, y: number, z: number) => boolean,
    respawn: (s: StreamLine) => void,
    dt: number,
  ) {
    for (let i = 0; i < stArr.length; i++) {
      const s = stArr[i]
      s.z -= s.speed * dt
      if (s.z < -HALF - s.length - 2) respawn(s)
      if (blockedFn(s.x, s.y, s.z)) respawn(s)

      const wave = Math.sin(windTime * 0.8 + s.phase) * 0.8
      let blk = false

      for (let p = 0; p < STREAM_PTS; p++) {
        const t = p / (STREAM_PTS - 1)
        const vi = (i * STREAM_PTS + p) * 6

        if (blk) {
          stVerts[vi] = 0; stVerts[vi+1] = 0; stVerts[vi+2] = 0
          stVerts[vi+3] = 0; stVerts[vi+4] = 0; stVerts[vi+5] = 0
          stColors[vi] = 0; stColors[vi+1] = 0; stColors[vi+2] = 0
          stColors[vi+3] = 0; stColors[vi+4] = 0; stColors[vi+5] = 0
          continue
        }

        const pz = s.z + t * s.length
        const noiseX = noise2d(pz * 0.3 + s.phase, windTime * 0.4) * 2.5 * t
        const noiseY = noise2d(pz * 0.25 + 50, windTime * 0.35 + s.phase) * 1.2 * t
        const px = s.x + Math.sin(t * Math.PI * 2 + s.phase + windTime * 0.5) * wave * t + noiseX
        const py = s.y + noiseY

        if (blockedFn(px, py, pz)) {
          blk = true
          stVerts[vi] = 0; stVerts[vi+1] = 0; stVerts[vi+2] = 0
          stVerts[vi+3] = 0; stVerts[vi+4] = 0; stVerts[vi+5] = 0
          stColors[vi] = 0; stColors[vi+1] = 0; stColors[vi+2] = 0
          stColors[vi+3] = 0; stColors[vi+4] = 0; stColors[vi+5] = 0
          continue
        }

        stVerts[vi]     = px
        stVerts[vi + 1] = py
        stVerts[vi + 2] = pz

        const nt = Math.min(t + 1 / (STREAM_PTS - 1), 1)
        const nz = s.z + nt * s.length
        const nnX = noise2d(nz * 0.3 + s.phase, windTime * 0.4) * 2.5 * nt
        const nnY = noise2d(nz * 0.25 + 50, windTime * 0.35 + s.phase) * 1.2 * nt
        const nx = s.x + Math.sin(nt * Math.PI * 2 + s.phase + windTime * 0.5) * wave * nt + nnX
        const npy = s.y + nnY
        const nextBlk = blockedFn(nx, npy, nz)

        stVerts[vi + 3] = (p === STREAM_PTS - 1 || nextBlk) ? px : nx
        stVerts[vi + 4] = (p === STREAM_PTS - 1 || nextBlk) ? py : npy
        stVerts[vi + 5] = (p === STREAM_PTS - 1 || nextBlk) ? pz : nz

        const fade = (1 - t)
        const bright = fade * fade * (0.6 + 0.4 * Math.sin(windTime * 2 + s.phase))
        stColors[vi]     = 0.3 * bright
        stColors[vi + 1] = 0.7 * bright
        stColors[vi + 2] = 1.0 * bright
        stColors[vi + 3] = 0.3 * bright * 0.7
        stColors[vi + 4] = 0.7 * bright * 0.7
        stColors[vi + 5] = 1.0 * bright * 0.7

        if (nextBlk) blk = true
      }
    }
    stPosAttr.needsUpdate = true
    stColAttr.needsUpdate = true
  }

  function updateDustSet(
    dArr: DustParticle[], dPositions: Float32Array, dSizes: Float32Array, dOpacities: Float32Array,
    dGeo: THREE.BufferGeometry,
    blockedFn: (x: number, y: number, z: number) => boolean,
    respawn: (d: DustParticle) => void,
    dt: number,
  ) {
    for (let i = 0; i < dArr.length; i++) {
      const d = dArr[i]
      const turbX = noise2d(d.z * 0.2 + d.phase, windTime * 0.6) - 0.5
      const turbY = noise2d(d.x * 0.2 + 30, windTime * 0.5 + d.phase) - 0.5
      d.z -= d.speed * dt
      d.x += (turbX * 3.0 + d.drift) * dt
      d.y += turbY * 1.5 * dt

      if (d.z < -HALF - 2) respawn(d)
      if (d.x < -HALF - 3) d.x = HALF + 1
      if (d.x > HALF + 3) d.x = -HALF - 1

      if (blockedFn(d.x, d.y, d.z)) respawn(d)

      dPositions[i * 3]     = d.x
      dPositions[i * 3 + 1] = d.y
      dPositions[i * 3 + 2] = d.z

      const inBounds = d.x >= -HALF && d.x <= HALF && d.z >= -HALF && d.z <= HALF
      const edgeFade = inBounds
        ? Math.min((d.x + HALF) / 5, (HALF - d.x) / 5, (d.z + HALF) / 5, (HALF - d.z) / 5, 1)
        : 0.2
      dSizes[i] = 1.5 + Math.sin(windTime * 3 + d.phase) * 0.8
      dOpacities[i] = (0.3 + 0.3 * Math.sin(windTime * 2 + d.phase)) * edgeFade
    }
    ;(dGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(dGeo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true
    ;(dGeo.attributes.aOpacity as THREE.BufferAttribute).needsUpdate = true
  }

  function updateWind(dt: number) {
    windTime += dt
    updateStreamSet(streams, streamVerts, streamColors, streamPosAttr, streamColAttr, isBlocked, respawnStream, dt)
    updateStreamSet(streamsBot, streamVertsBot, streamColorsBot, streamPosAttrBot, streamColAttrBot, isBlockedBottom, respawnStreamBot, dt)
    updateDustSet(dustArr, dustPositions, dustSizes, dustOpacities, dustGeo, isBlocked, respawnDust, dt)
    updateDustSet(dustArrBot, dustPositionsBot, dustSizesBot, dustOpacitiesBot, dustGeoBot, isBlockedBottom, respawnDustBot, dt)
  }

  // --- Rain ---
  const RAIN_COUNT = 800
  const RAIN_FALL_SPEED = 28
  const RAIN_CEIL = 25
  const RAIN_STREAK_LEN = 1.4
  const RAIN_WIND_DRIFT = 0

  interface RainDrop {
    x: number; y: number; z: number
    speed: number; phase: number
  }
  const rainDrops: RainDrop[] = []
  for (let i = 0; i < RAIN_COUNT; i++) {
    rainDrops.push({
      x: (Math.random() - 0.5) * SIZE * 1.3,
      y: Math.random() * RAIN_CEIL + 5,
      z: (Math.random() - 0.5) * SIZE * 1.3,
      speed: RAIN_FALL_SPEED * (0.8 + Math.random() * 0.4),
      phase: Math.random() * Math.PI * 2,
    })
  }

  const rainVerts = new Float32Array(RAIN_COUNT * 2 * 3)
  const rainColors = new Float32Array(RAIN_COUNT * 2 * 3)
  const rainGeo = new THREE.BufferGeometry()
  const rainPosAttr = new THREE.BufferAttribute(rainVerts, 3)
  const rainColAttr = new THREE.BufferAttribute(rainColors, 3)
  rainGeo.setAttribute('position', rainPosAttr)
  rainGeo.setAttribute('color', rainColAttr)

  const rainMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const rainObj = new THREE.LineSegments(rainGeo, rainMat)
  scene.add(rainObj)

  // --- Splash rings at impact ---
  const SPLASH_MAX = 120
  interface Splash {
    x: number; y: number; z: number
    age: number; life: number
  }
  const splashes: Splash[] = []
  const SPLASH_RING_PTS = 12
  const splashVerts = new Float32Array(SPLASH_MAX * SPLASH_RING_PTS * 2 * 3)
  const splashColors = new Float32Array(SPLASH_MAX * SPLASH_RING_PTS * 2 * 3)
  const splashGeo = new THREE.BufferGeometry()
  const splashPosAttr = new THREE.BufferAttribute(splashVerts, 3)
  const splashColAttr = new THREE.BufferAttribute(splashColors, 3)
  splashGeo.setAttribute('position', splashPosAttr)
  splashGeo.setAttribute('color', splashColAttr)

  const splashMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const splashObj = new THREE.LineSegments(splashGeo, splashMat)
  scene.add(splashObj)

  // --- Bottom rain (rises upward toward underside) ---
  const rainDropsBot: RainDrop[] = []
  for (let i = 0; i < RAIN_COUNT; i++) {
    rainDropsBot.push({
      x: (Math.random() - 0.5) * SIZE * 1.3,
      y: -(Math.random() * RAIN_CEIL + 5),
      z: (Math.random() - 0.5) * SIZE * 1.3,
      speed: RAIN_FALL_SPEED * (0.8 + Math.random() * 0.4),
      phase: Math.random() * Math.PI * 2,
    })
  }
  const rainVertsBot = new Float32Array(RAIN_COUNT * 2 * 3)
  const rainColorsBot = new Float32Array(RAIN_COUNT * 2 * 3)
  const rainGeoBot = new THREE.BufferGeometry()
  const rainPosAttrBot = new THREE.BufferAttribute(rainVertsBot, 3)
  const rainColAttrBot = new THREE.BufferAttribute(rainColorsBot, 3)
  rainGeoBot.setAttribute('position', rainPosAttrBot)
  rainGeoBot.setAttribute('color', rainColAttrBot)
  const rainObjBot = new THREE.LineSegments(rainGeoBot, rainMat)
  scene.add(rainObjBot)

  const splashesBot: Splash[] = []
  const splashVertsBot = new Float32Array(SPLASH_MAX * SPLASH_RING_PTS * 2 * 3)
  const splashColorsBot = new Float32Array(SPLASH_MAX * SPLASH_RING_PTS * 2 * 3)
  const splashGeoBot = new THREE.BufferGeometry()
  const splashPosAttrBot = new THREE.BufferAttribute(splashVertsBot, 3)
  const splashColAttrBot = new THREE.BufferAttribute(splashColorsBot, 3)
  splashGeoBot.setAttribute('position', splashPosAttrBot)
  splashGeoBot.setAttribute('color', splashColAttrBot)
  const splashObjBot = new THREE.LineSegments(splashGeoBot, splashMat)
  scene.add(splashObjBot)

  function updateRain(dt: number) {
    for (let i = 0; i < RAIN_COUNT; i++) {
      const d = rainDrops[i]
      d.y -= d.speed * dt
      d.z += RAIN_WIND_DRIFT * dt

      const inBounds =
        d.x >= -HALF && d.x <= HALF && d.z >= -HALF && d.z <= HALF
      const ground = inBounds ? getHeight(d.x, d.z) : 0

      if (d.y <= ground) {
        if (inBounds && splashes.length < SPLASH_MAX) {
          splashes.push({ x: d.x, y: ground + 0.05, z: d.z, age: 0, life: 0.3 + Math.random() * 0.2 })
        }
        d.y = RAIN_CEIL + Math.random() * 8
        d.x = (Math.random() - 0.5) * SIZE * 1.3
        d.z = (Math.random() - 0.5) * SIZE * 1.3
      }

      const topY = d.y
      const botY = d.y + RAIN_STREAK_LEN
      const off = i * 6

      rainVerts[off]     = d.x
      rainVerts[off + 1] = topY
      rainVerts[off + 2] = d.z
      rainVerts[off + 3] = d.x
      rainVerts[off + 4] = botY
      rainVerts[off + 5] = d.z

      const bright = 0.5 + 0.2 * Math.sin(d.phase + topY * 0.5)
      rainColors[off]     = 0.55 * bright
      rainColors[off + 1] = 0.7  * bright
      rainColors[off + 2] = 1.0  * bright
      rainColors[off + 3] = 0.15
      rainColors[off + 4] = 0.2
      rainColors[off + 5] = 0.35
    }
    rainPosAttr.needsUpdate = true
    rainColAttr.needsUpdate = true

    // splashes
    let sIdx = 0
    for (let i = splashes.length - 1; i >= 0; i--) {
      const sp = splashes[i]
      sp.age += dt
      if (sp.age >= sp.life) { splashes.splice(i, 1); continue }
      if (sIdx >= SPLASH_MAX) continue

      const t = sp.age / sp.life
      const radius = 0.15 + t * 0.8
      const alpha = (1 - t) * (1 - t)
      const sOff = sIdx * SPLASH_RING_PTS * 6

      for (let p = 0; p < SPLASH_RING_PTS; p++) {
        const a0 = (p / SPLASH_RING_PTS) * Math.PI * 2
        const a1 = ((p + 1) / SPLASH_RING_PTS) * Math.PI * 2
        const vi = sOff + p * 6
        splashVerts[vi]     = sp.x + Math.cos(a0) * radius
        splashVerts[vi + 1] = sp.y
        splashVerts[vi + 2] = sp.z + Math.sin(a0) * radius
        splashVerts[vi + 3] = sp.x + Math.cos(a1) * radius
        splashVerts[vi + 4] = sp.y
        splashVerts[vi + 5] = sp.z + Math.sin(a1) * radius

        splashColors[vi]     = 0.5 * alpha
        splashColors[vi + 1] = 0.75 * alpha
        splashColors[vi + 2] = 1.0 * alpha
        splashColors[vi + 3] = 0.5 * alpha
        splashColors[vi + 4] = 0.75 * alpha
        splashColors[vi + 5] = 1.0 * alpha
      }
      sIdx++
    }
    for (let i = sIdx * SPLASH_RING_PTS * 6; i < splashVerts.length; i++) {
      splashVerts[i] = 0
      splashColors[i] = 0
    }
    splashPosAttr.needsUpdate = true
    splashColAttr.needsUpdate = true
  }

  function updateRainBot(dt: number) {
    for (let i = 0; i < RAIN_COUNT; i++) {
      const d = rainDropsBot[i]
      d.y += d.speed * dt

      const inBounds =
        d.x >= -HALF && d.x <= HALF && d.z >= -HALF && d.z <= HALF
      const ceiling = inBounds ? getHeight(d.x, d.z) - THICKNESS : -THICKNESS

      if (d.y >= ceiling) {
        if (inBounds && splashesBot.length < SPLASH_MAX) {
          splashesBot.push({ x: d.x, y: ceiling - 0.05, z: d.z, age: 0, life: 0.3 + Math.random() * 0.2 })
        }
        d.y = -(RAIN_CEIL + Math.random() * 8)
        d.x = (Math.random() - 0.5) * SIZE * 1.3
        d.z = (Math.random() - 0.5) * SIZE * 1.3
      }

      const topY = d.y
      const botY = d.y - RAIN_STREAK_LEN
      const off = i * 6

      rainVertsBot[off]     = d.x
      rainVertsBot[off + 1] = topY
      rainVertsBot[off + 2] = d.z
      rainVertsBot[off + 3] = d.x
      rainVertsBot[off + 4] = botY
      rainVertsBot[off + 5] = d.z

      const bright = 0.5 + 0.2 * Math.sin(d.phase + topY * 0.5)
      rainColorsBot[off]     = 0.55 * bright
      rainColorsBot[off + 1] = 0.7  * bright
      rainColorsBot[off + 2] = 1.0  * bright
      rainColorsBot[off + 3] = 0.15
      rainColorsBot[off + 4] = 0.2
      rainColorsBot[off + 5] = 0.35
    }
    rainPosAttrBot.needsUpdate = true
    rainColAttrBot.needsUpdate = true

    let sIdx = 0
    for (let i = splashesBot.length - 1; i >= 0; i--) {
      const sp = splashesBot[i]
      sp.age += dt
      if (sp.age >= sp.life) { splashesBot.splice(i, 1); continue }
      if (sIdx >= SPLASH_MAX) continue

      const t = sp.age / sp.life
      const radius = 0.15 + t * 0.8
      const alpha = (1 - t) * (1 - t)
      const sOff = sIdx * SPLASH_RING_PTS * 6

      for (let p = 0; p < SPLASH_RING_PTS; p++) {
        const a0 = (p / SPLASH_RING_PTS) * Math.PI * 2
        const a1 = ((p + 1) / SPLASH_RING_PTS) * Math.PI * 2
        const vi = sOff + p * 6
        splashVertsBot[vi]     = sp.x + Math.cos(a0) * radius
        splashVertsBot[vi + 1] = sp.y
        splashVertsBot[vi + 2] = sp.z + Math.sin(a0) * radius
        splashVertsBot[vi + 3] = sp.x + Math.cos(a1) * radius
        splashVertsBot[vi + 4] = sp.y
        splashVertsBot[vi + 5] = sp.z + Math.sin(a1) * radius

        splashColorsBot[vi]     = 0.5 * alpha
        splashColorsBot[vi + 1] = 0.75 * alpha
        splashColorsBot[vi + 2] = 1.0 * alpha
        splashColorsBot[vi + 3] = 0.5 * alpha
        splashColorsBot[vi + 4] = 0.75 * alpha
        splashColorsBot[vi + 5] = 1.0 * alpha
      }
      sIdx++
    }
    for (let i = sIdx * SPLASH_RING_PTS * 6; i < splashVertsBot.length; i++) {
      splashVertsBot[i] = 0
      splashColorsBot[i] = 0
    }
    splashPosAttrBot.needsUpdate = true
    splashColAttrBot.needsUpdate = true
  }

  function rebuildGrid() {
    let idx = 0
    for (let i = 0; i <= CELLS; i++) {
      const off = -HALF + i * CELL_SIZE
      for (let j = 0; j < SEGMENTS; j++) {
        const t0 = -HALF + j * gridStep
        const t1 = t0 + gridStep
        gridPts[idx++] = off; gridPts[idx++] = getHeight(off, t0) + 0.05; gridPts[idx++] = t0
        gridPts[idx++] = off; gridPts[idx++] = getHeight(off, t1) + 0.05; gridPts[idx++] = t1
        gridPts[idx++] = t0; gridPts[idx++] = getHeight(t0, off) + 0.05; gridPts[idx++] = off
        gridPts[idx++] = t1; gridPts[idx++] = getHeight(t1, off) + 0.05; gridPts[idx++] = off
      }
    }
    gridPos.needsUpdate = true
  }

  let animating = false

  function stepAnimation(dt: number): boolean {
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

  function animate() {
    animId = requestAnimationFrame(animate)
    controls.update()

    if (animating) {
      const done = stepAnimation(1 / 60)
      rebuildMesh(pos, bottomPos, skirtPos)
      geo.computeVertexNormals()
      bottomGeo.computeVertexNormals()
      skirtGeo.computeVertexNormals()
      paintColors(geo)
      paintColors(bottomGeo, true)
      paintColors(skirtGeo)
      rebuildGrid()
      if (done) {
        animating = false
        buildWater()
        buildWaterBot()
      }
    }

    updateWater(1 / 60)
    updateWaterBot(1 / 60)
    updateWind(1 / 60)
    updateRain(1 / 60)
    updateRainBot(1 / 60)
    renderer.render(scene, camera)
  }

  rebuildMesh(pos, bottomPos, skirtPos)
  geo.computeVertexNormals()
  bottomGeo.computeVertexNormals()
  skirtGeo.computeVertexNormals()
  paintColors(geo)
  paintColors(bottomGeo, true)
  paintColors(skirtGeo)
  rebuildGrid()

  animating = true
  animate()

  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault()
      for (const wb of waterBodies) { scene.remove(wb.mesh); wb.geo.dispose() }
      waterBodies.length = 0
      for (const wb of waterBodiesBot) { scene.remove(wb.mesh); wb.geo.dispose() }
      waterBodiesBot.length = 0
      generateTerrain()
      animating = true
    }
  }
  window.addEventListener('keydown', onKey)

  const onResize = () => {
    const rw = el.clientWidth, rh = el.clientHeight
    camera.aspect = rw / rh
    camera.updateProjectionMatrix()
    renderer.setSize(rw, rh)
  }
  window.addEventListener('resize', onResize)

  ;(el as any).__cleanup = () => {
    window.removeEventListener('resize', onResize)
    window.removeEventListener('keydown', onKey)
  }
})

onUnmounted(() => {
  cancelAnimationFrame(animId)
  controls?.dispose()
  renderer?.dispose()
  const el = container.value
  if (el) (el as any).__cleanup?.()
})
</script>

<template>
  <div ref="container" class="canvas-root" />
</template>

<style scoped>
.canvas-root {
  position: fixed;
  inset: 0;
  overflow: hidden;
}
</style>
