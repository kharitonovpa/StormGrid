<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as THREE from 'three'
import type { CharacterType } from '@stormgrid/shared'
import { getModel, whenModelsReady } from '../lib/models'

const props = defineProps<{
  character: CharacterType
  active: boolean
}>()

const canvas = ref<HTMLCanvasElement | null>(null)

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let model: THREE.Group | null = null
let modelBaseY = 0
let animId = 0
let elapsed = 0
let disposed = false

function fitModel(m: THREE.Group) {
  const box = new THREE.Box3().setFromObject(m)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const scale = 1.6 / maxDim
  m.scale.setScalar(scale)
  box.setFromObject(m)
  box.getCenter(center)
  m.position.sub(center)
  m.position.y -= box.min.y * 0.3
}

function loadModel() {
  if (!scene) return
  if (model) {
    scene.remove(model)
    model.traverse((child) => {
      const m = child as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
    })
    model = null
  }
  model = getModel(props.character)
  fitModel(model)
  modelBaseY = model.position.y
  scene.add(model)
}

onMounted(() => {
  const el = canvas.value!
  const size = 120
  const dpr = Math.min(devicePixelRatio, 2)

  renderer = new THREE.WebGLRenderer({ canvas: el, alpha: true, antialias: true })
  renderer.setPixelRatio(dpr)
  renderer.setSize(size, size, false)
  renderer.setClearColor(0x000000, 0)

  scene = new THREE.Scene()

  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50)
  camera.position.set(0, 1.2, 3.5)
  camera.lookAt(0, 0.3, 0)

  scene.add(new THREE.AmbientLight(0xffffff, 0.7))
  const dir = new THREE.DirectionalLight(0xffffff, 1.0)
  dir.position.set(3, 5, 4)
  scene.add(dir)
  const fill = new THREE.DirectionalLight(0x8899bb, 0.4)
  fill.position.set(-3, 2, -2)
  scene.add(fill)

  loadModel()

  whenModelsReady().then(() => {
    if (disposed) return
    loadModel()
  })

  let prev = performance.now()
  function animate() {
    if (disposed) return
    animId = requestAnimationFrame(animate)
    const now = performance.now()
    const dt = Math.min((now - prev) / 1000, 0.1)
    prev = now
    elapsed += dt

    if (model) {
      model.rotation.y = elapsed * 0.8
      const bobAmp = props.active ? 0.08 : 0.03
      const bobSpeed = props.active ? 2.5 : 1.5
      model.position.y = modelBaseY + Math.sin(elapsed * bobSpeed) * bobAmp
    }

    renderer!.render(scene, camera)
  }
  animate()
})

watch(() => props.character, () => {
  loadModel()
})

onUnmounted(() => {
  disposed = true
  cancelAnimationFrame(animId)
  if (model) {
    model.traverse((child) => {
      const m = child as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
    })
  }
  renderer?.dispose()
  renderer = null
})
</script>

<template>
  <canvas ref="canvas" class="char-preview-canvas" />
</template>

<style scoped>
.char-preview-canvas {
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
}
</style>
