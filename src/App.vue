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

  const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true })
  const mesh = new THREE.Mesh(geo, mat)
  scene.add(mesh)

  const bottomGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS)
  bottomGeo.rotateX(-Math.PI / 2)
  const bottomPos = bottomGeo.attributes.position as THREE.BufferAttribute
  const bottomMesh = new THREE.Mesh(bottomGeo, mat)
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
  const skirtMesh = new THREE.Mesh(skirtGeo, mat)
  scene.add(skirtMesh)

  const gridStep = SIZE / SEGMENTS
  const gridPts = new Float32Array((CELLS + 1) * SEGMENTS * 4 * 3)
  const gridGeo = new THREE.BufferGeometry()
  const gridPos = new THREE.BufferAttribute(gridPts, 3)
  gridGeo.setAttribute('position', gridPos)
  const gridLines = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0xffaa00 }))
  scene.add(gridLines)

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
      rebuildGrid()
      if (done) animating = false
    }

    renderer.render(scene, camera)
  }

  rebuildMesh(pos, bottomPos, skirtPos)
  geo.computeVertexNormals()
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
