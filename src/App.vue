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

function paintColors(geo: THREE.BufferGeometry, isBottom: boolean) {
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

    if (isBottom) {
      col.setXYZ(i, 0.25 + nv, 0.22 + nv, 0.2 + nv)
      continue
    }

    const slope = Math.abs(nm.getY(i))

    const mudW = 1 - sstep(-3.5, -1.5, wy)
    const snowW = sstep(2.0, 4.0, wy)
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

  // === Wind: streamlines + dust, fixed Y, blocked by terrain ===

  const WIND_Y_MIN = -4
  const WIND_Y_MAX = 8

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

  function isBlocked(x: number, y: number, z: number): boolean {
    if (x < -HALF || x > HALF || z < -HALF || z > HALF) return false
    return getHeight(x, z) >= y
  }

  function respawnStream(s: StreamLine) {
    s.z = HALF + Math.random() * 8
    s.x = (Math.random() - 0.5) * SIZE
    s.y = WIND_Y_MIN + Math.random() * (WIND_Y_MAX - WIND_Y_MIN)
  }

  function respawnDust(d: DustParticle) {
    d.z = HALF + Math.random() * 6
    d.x = (Math.random() - 0.5) * SIZE
    d.y = WIND_Y_MIN + Math.random() * (WIND_Y_MAX - WIND_Y_MIN)
  }

  let windTime = 0
  function updateWind(dt: number) {
    windTime += dt

    // Streamlines
    for (let i = 0; i < STREAM_COUNT; i++) {
      const s = streams[i]
      s.z -= s.speed * dt

      if (s.z < -HALF - s.length - 2) respawnStream(s)
      if (isBlocked(s.x, s.y, s.z)) respawnStream(s)

      const wave = Math.sin(windTime * 0.8 + s.phase) * 0.8
      let blocked = false

      for (let p = 0; p < STREAM_PTS; p++) {
        const t = p / (STREAM_PTS - 1)
        const vi = (i * STREAM_PTS + p) * 6

        if (blocked) {
          streamVerts[vi] = 0; streamVerts[vi+1] = 0; streamVerts[vi+2] = 0
          streamVerts[vi+3] = 0; streamVerts[vi+4] = 0; streamVerts[vi+5] = 0
          streamColors[vi] = 0; streamColors[vi+1] = 0; streamColors[vi+2] = 0
          streamColors[vi+3] = 0; streamColors[vi+4] = 0; streamColors[vi+5] = 0
          continue
        }

        const pz = s.z + t * s.length
        const noiseX = noise2d(pz * 0.3 + s.phase, windTime * 0.4) * 2.5 * t
        const noiseY = noise2d(pz * 0.25 + 50, windTime * 0.35 + s.phase) * 1.2 * t
        const px = s.x + Math.sin(t * Math.PI * 2 + s.phase + windTime * 0.5) * wave * t + noiseX
        const py = s.y + noiseY

        if (isBlocked(px, py, pz)) {
          blocked = true
          streamVerts[vi] = 0; streamVerts[vi+1] = 0; streamVerts[vi+2] = 0
          streamVerts[vi+3] = 0; streamVerts[vi+4] = 0; streamVerts[vi+5] = 0
          streamColors[vi] = 0; streamColors[vi+1] = 0; streamColors[vi+2] = 0
          streamColors[vi+3] = 0; streamColors[vi+4] = 0; streamColors[vi+5] = 0
          continue
        }

        streamVerts[vi]     = px
        streamVerts[vi + 1] = py
        streamVerts[vi + 2] = pz

        const nt = Math.min(t + 1 / (STREAM_PTS - 1), 1)
        const nz = s.z + nt * s.length
        const nnX = noise2d(nz * 0.3 + s.phase, windTime * 0.4) * 2.5 * nt
        const nnY = noise2d(nz * 0.25 + 50, windTime * 0.35 + s.phase) * 1.2 * nt
        const nx = s.x + Math.sin(nt * Math.PI * 2 + s.phase + windTime * 0.5) * wave * nt + nnX

        const npy = s.y + nnY
        const nextBlocked = isBlocked(nx, npy, nz)
        streamVerts[vi + 3] = (p === STREAM_PTS - 1 || nextBlocked) ? px : nx
        streamVerts[vi + 4] = (p === STREAM_PTS - 1 || nextBlocked) ? py : npy
        streamVerts[vi + 5] = (p === STREAM_PTS - 1 || nextBlocked) ? pz : nz

        const fade = (1 - t)
        const bright = fade * fade * (0.6 + 0.4 * Math.sin(windTime * 2 + s.phase))
        streamColors[vi]     = 0.3 * bright
        streamColors[vi + 1] = 0.7 * bright
        streamColors[vi + 2] = 1.0 * bright
        streamColors[vi + 3] = 0.3 * bright * 0.7
        streamColors[vi + 4] = 0.7 * bright * 0.7
        streamColors[vi + 5] = 1.0 * bright * 0.7

        if (nextBlocked) blocked = true
      }
    }
    streamPosAttr.needsUpdate = true
    streamColAttr.needsUpdate = true

    // Dust
    const dPosAttr = dustGeo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < DUST_COUNT; i++) {
      const d = dustArr[i]
      const turbX = noise2d(d.z * 0.2 + d.phase, windTime * 0.6) - 0.5
      const turbY = noise2d(d.x * 0.2 + 30, windTime * 0.5 + d.phase) - 0.5
      d.z -= d.speed * dt
      d.x += (turbX * 3.0 + d.drift) * dt
      d.y += turbY * 1.5 * dt

      if (d.z < -HALF - 2) respawnDust(d)
      if (d.x < -HALF - 3) d.x = HALF + 1
      if (d.x > HALF + 3) d.x = -HALF - 1

      if (isBlocked(d.x, d.y, d.z)) {
        respawnDust(d)
      }

      dustPositions[i * 3]     = d.x
      dustPositions[i * 3 + 1] = d.y
      dustPositions[i * 3 + 2] = d.z

      const inBounds = d.x >= -HALF && d.x <= HALF && d.z >= -HALF && d.z <= HALF
      const edgeFade = inBounds
        ? Math.min((d.x + HALF) / 5, (HALF - d.x) / 5, (d.z + HALF) / 5, (HALF - d.z) / 5, 1)
        : 0.2
      dustSizes[i] = 1.5 + Math.sin(windTime * 3 + d.phase) * 0.8
      dustOpacities[i] = (0.3 + 0.3 * Math.sin(windTime * 2 + d.phase)) * edgeFade
    }
    dPosAttr.needsUpdate = true
    ;(dustGeo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true
    ;(dustGeo.attributes.aOpacity as THREE.BufferAttribute).needsUpdate = true
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
      paintColors(geo, false)
      paintColors(bottomGeo, true)
      paintColors(skirtGeo, false)
      rebuildGrid()
      if (done) animating = false
    }

    updateWind(1 / 60)
    updateRain(1 / 60)
    renderer.render(scene, camera)
  }

  rebuildMesh(pos, bottomPos, skirtPos)
  geo.computeVertexNormals()
  bottomGeo.computeVertexNormals()
  skirtGeo.computeVertexNormals()
  paintColors(geo, false)
  paintColors(bottomGeo, true)
  paintColors(skirtGeo, false)
  rebuildGrid()

  animating = true
  animate()

  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault()
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
