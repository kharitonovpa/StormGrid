<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createFlame } from './flame'
import { SIZE, HALF, CELL_SIZE, SEGMENTS } from './lib/constants'
import { terrainState } from './lib/terrain'
import { createWaterSystem } from './lib/water'
import { createWindSystem } from './lib/wind'
import { createRainSystem } from './lib/rain'

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

  scene.add(new THREE.AxesHelper(15))
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

  // --- Terrain meshes ---
  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })

  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute
  scene.add(new THREE.Mesh(geo, terrainMat))

  const bottomGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS)
  bottomGeo.rotateX(-Math.PI / 2)
  const bottomPos = bottomGeo.attributes.position as THREE.BufferAttribute
  scene.add(new THREE.Mesh(bottomGeo, terrainMat))

  const perimN = terrainState.PERIMETER.length
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
  scene.add(new THREE.Mesh(skirtGeo, terrainMat))

  // --- Grid lines ---
  const gridStep = SIZE / SEGMENTS
  const gridPts = new Float32Array((7 + 1) * SEGMENTS * 4 * 3)
  const gridGeo = new THREE.BufferGeometry()
  const gridPos = new THREE.BufferAttribute(gridPts, 3)
  gridGeo.setAttribute('position', gridPos)
  const gridLines = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0xffaa00 }))
  scene.add(gridLines)

  function rebuildGrid() {
    let idx = 0
    const CELLS = 7
    for (let i = 0; i <= CELLS; i++) {
      const off = -HALF + i * CELL_SIZE
      for (let j = 0; j < SEGMENTS; j++) {
        const t0 = -HALF + j * gridStep
        const t1 = t0 + gridStep
        gridPts[idx++] = off; gridPts[idx++] = terrainState.getHeight(off, t0) + 0.05; gridPts[idx++] = t0
        gridPts[idx++] = off; gridPts[idx++] = terrainState.getHeight(off, t1) + 0.05; gridPts[idx++] = t1
        gridPts[idx++] = t0; gridPts[idx++] = terrainState.getHeight(t0, off) + 0.05; gridPts[idx++] = off
        gridPts[idx++] = t1; gridPts[idx++] = terrainState.getHeight(t1, off) + 0.05; gridPts[idx++] = off
      }
    }
    gridPos.needsUpdate = true
  }

  // --- Systems ---
  const water = createWaterSystem(scene, terrainState)
  const wind = createWindSystem(scene, terrainState)
  const rain = createRainSystem(scene, terrainState)

  // --- Initial build ---
  terrainState.rebuildMesh(pos, bottomPos, skirtPos)
  terrainState.rebuildHeightCache()
  geo.computeVertexNormals()
  bottomGeo.computeVertexNormals()
  skirtGeo.computeVertexNormals()
  terrainState.paintColors(geo)
  terrainState.paintColors(bottomGeo, true)
  terrainState.paintColors(skirtGeo)
  rebuildGrid()

  // --- Animation loop ---
  let animating = true
  let prevTime = performance.now()

  function animate() {
    animId = requestAnimationFrame(animate)
    const now = performance.now()
    const dt = Math.min((now - prevTime) / 1000, 0.1)
    prevTime = now
    controls.update()

    if (animating) {
      const done = terrainState.stepAnimation(dt)
      terrainState.rebuildMesh(pos, bottomPos, skirtPos)
      geo.computeVertexNormals()
      bottomGeo.computeVertexNormals()
      skirtGeo.computeVertexNormals()
      terrainState.paintColors(geo)
      terrainState.paintColors(bottomGeo, true)
      terrainState.paintColors(skirtGeo)
      rebuildGrid()
      if (done) {
        animating = false
        terrainState.rebuildHeightCache()
        water.buildTop()
        water.buildBot()
      }
    }

    water.update(dt)
    wind.update(dt)
    rain.update(dt)
    renderer.render(scene, camera)
  }

  animate()

  // --- Event handlers ---
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault()
      water.dispose()
      terrainState.generateTerrain()
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
    water.dispose()
    wind.dispose()
    rain.dispose()
  }
})

onUnmounted(() => {
  cancelAnimationFrame(animId)
  const el = container.value
  if (el) (el as any).__cleanup?.()
  controls?.dispose()
  if (renderer) {
    renderer.domElement.parentElement?.removeChild(renderer.domElement)
    renderer.dispose()
  }
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
