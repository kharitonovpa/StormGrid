<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { SIZE, HALF, CELL_SIZE, SEGMENTS } from './lib/constants'
import { terrainState } from './lib/terrain'
import { createWaterSystem } from './lib/water'
import { createWindSystem } from './lib/wind'
import { createRainSystem } from './lib/rain'
import { createCompassSystem } from './lib/compass'
import { createInteractionSystem } from './lib/interaction'
import { createPlayerSystem } from './lib/player'

const container = ref<HTMLElement | null>(null)
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let animId: number

// --- Radial menu state ---
const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuCx = ref(0)
const menuCz = ref(0)
const menuCellValue = ref(0)
const menuIsPlayer = ref(false)

type MenuAction = 'raise' | 'lower' | 'move'

const menuOptions = computed(() => {
  const v = menuCellValue.value
  const opts: { action: MenuAction; label: string; icon: string; disabled: boolean }[] = []
  if (menuIsPlayer.value) {
    opts.push({ action: 'move', label: 'Move', icon: 'move', disabled: false })
  }
  opts.push(
    { action: 'raise', label: 'Raise', icon: 'raise', disabled: v === 1 },
    { action: 'lower', label: 'Lower', icon: 'lower', disabled: v === -1 },
  )
  return opts
})

const menuStyle = computed(() => ({
  left: menuX.value + 'px',
  top: menuY.value + 'px',
}))

function closeMenu() {
  menuVisible.value = false
}

let handleAction: ((action: MenuAction) => void) | null = null

function selectOption(action: MenuAction) {
  handleAction?.(action)
  closeMenu()
}

const RING_R = 50
function optionStyle(index: number) {
  const count = menuOptions.value.length
  if (count === 2) {
    const x = index === 0 ? -1 : 1
    return { transform: `translate(${x * RING_R - 24}px, -24px)` }
  }
  // 3 items: angles -90° (top), -210° (bottom-left), -330° (bottom-right)
  const angles = [-90, -210, -330]
  const rad = (angles[index] * Math.PI) / 180
  const x = Math.cos(rad) * RING_R - 24
  const y = Math.sin(rad) * RING_R - 24
  return { transform: `translate(${x}px, ${y}px)` }
}

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

  const dirLightBottom = new THREE.DirectionalLight(0xffffff, 1.0)
  dirLightBottom.position.set(-10, -20, -15)
  scene.add(dirLightBottom)

  const players = createPlayerSystem(scene, terrainState)

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
  const topMesh = new THREE.Mesh(geo, terrainMat)
  scene.add(topMesh)

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
  const gridLines = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0x2a4a2a, transparent: true, opacity: 0.35 }))
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
  const compass = createCompassSystem(scene)

  const interaction = createInteractionSystem(
    scene, camera, renderer.domElement as HTMLCanvasElement, topMesh, terrainState,
    (e) => {
      if (players.moveMode) {
        if (players.isValidMove(e.cx, e.cz)) {
          players.playerA.moveTo(e.cx, e.cz)
        }
        players.hideMoveOptions()
        return
      }
      menuCx.value = e.cx
      menuCz.value = e.cz
      menuX.value = e.screenX
      menuY.value = e.screenY
      menuCellValue.value = terrainState.target[e.cz][e.cx]
      menuIsPlayer.value = players.isOccupied(e.cx, e.cz)
      menuVisible.value = true
    },
    (cell) => {
      const canvas = renderer.domElement
      if (cell && players.isOccupied(cell.cx, cell.cz)) {
        players.setHovered(true)
        canvas.style.cursor = 'pointer'
      } else if (cell && players.moveMode && players.isValidMove(cell.cx, cell.cz)) {
        players.setHovered(false)
        canvas.style.cursor = 'pointer'
      } else {
        players.setHovered(false)
        canvas.style.cursor = ''
      }
    },
  )

  // --- Action handler (closure over animating) ---
  handleAction = (action) => {
    if (action === 'move') {
      players.showMoveOptions()
      return
    }
    const cx = menuCx.value
    const cz = menuCz.value
    const cur = terrainState.target[cz][cx]
    const next = action === 'raise' ? cur + 1 : cur - 1
    if (next < -1 || next > 1 || next === cur) return

    water.dispose()
    terrainState.target[cz][cx] = next
    terrainState.invalidateHeightCache()
    animating = true
  }

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
    players.update(dt)
    interaction.update(dt)
    renderer.render(scene, camera)
  }

  animate()

  // --- Event handlers ---
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault()
      closeMenu()
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
    compass.dispose()
    players.dispose()
    interaction.dispose()
    handleAction = null
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

  <!-- Radial Menu -->
  <Teleport to="body">
    <div v-if="menuVisible" class="radial-backdrop" @click="closeMenu" />
    <Transition name="radial">
      <div v-if="menuVisible" class="radial-menu" :style="menuStyle">
        <button
          v-for="(opt, i) in menuOptions"
          :key="opt.action"
          class="radial-option"
          :class="[opt.icon, { disabled: opt.disabled }]"
          :style="optionStyle(i)"
          @click.stop="!opt.disabled && selectOption(opt.action)"
        >
          <svg viewBox="0 0 32 32" width="26" height="26">
            <template v-if="opt.icon === 'move'">
              <polygon points="16,4 20,10 12,10" fill="currentColor" />
              <polygon points="16,28 12,22 20,22" fill="currentColor" />
              <polygon points="4,16 10,12 10,20" fill="currentColor" />
              <polygon points="28,16 22,12 22,20" fill="currentColor" />
              <rect x="14" y="10" width="4" height="12" rx="1" fill="currentColor" opacity="0.4" />
              <rect x="10" y="14" width="12" height="4" rx="1" fill="currentColor" opacity="0.4" />
            </template>
            <polygon v-else-if="opt.icon === 'raise'" points="16,6 28,26 4,26" fill="currentColor" />
            <polygon v-else points="16,26 28,6 4,6" fill="currentColor" />
          </svg>
          <span class="radial-label">{{ opt.label }}</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.canvas-root {
  position: fixed;
  inset: 0;
  overflow: hidden;
}
</style>

<style>
.radial-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.radial-menu {
  position: fixed;
  z-index: 1001;
  pointer-events: none;
  width: 0;
  height: 0;
}

.radial-option {
  position: absolute;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 2px solid rgba(180, 190, 210, 0.35);
  background: rgba(30, 35, 45, 0.82);
  color: rgba(210, 215, 225, 0.85);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  pointer-events: auto;
  transition: all 0.18s ease;
  padding: 0;
  gap: 1px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}

.radial-option svg {
  flex-shrink: 0;
}

.radial-label {
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.3px;
  opacity: 0.7;
  white-space: nowrap;
}

.radial-option.raise {
  border-color: rgba(150, 210, 170, 0.4);
  color: rgba(170, 220, 185, 0.85);
}
.radial-option.raise:hover:not(.disabled) {
  background: rgba(40, 60, 48, 0.88);
  border-color: rgba(170, 225, 185, 0.6);
  box-shadow: 0 0 14px rgba(150, 210, 170, 0.2);
}

.radial-option.move {
  border-color: rgba(160, 170, 220, 0.4);
  color: rgba(175, 185, 230, 0.85);
}
.radial-option.move:hover:not(.disabled) {
  background: rgba(42, 44, 62, 0.88);
  border-color: rgba(175, 185, 235, 0.6);
  box-shadow: 0 0 14px rgba(160, 170, 220, 0.2);
}

.radial-option.lower {
  border-color: rgba(220, 170, 150, 0.4);
  color: rgba(225, 180, 165, 0.85);
}
.radial-option.lower:hover:not(.disabled) {
  background: rgba(60, 42, 38, 0.88);
  border-color: rgba(230, 185, 165, 0.6);
  box-shadow: 0 0 14px rgba(220, 170, 150, 0.2);
}

.radial-option.disabled {
  opacity: 0.2;
  cursor: default;
  pointer-events: none;
}

/* Transition */
.radial-enter-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.radial-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}
.radial-enter-from,
.radial-leave-to {
  opacity: 0;
  transform: scale(0.7);
}
</style>
