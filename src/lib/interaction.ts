import * as THREE from 'three'
import { CELLS, HALF, CELL_SIZE, SEGMENTS } from './constants'
import type { TerrainState } from './terrain'

export interface CellClickEvent {
  cx: number
  cz: number
  screenX: number
  screenY: number
}

export function createInteractionSystem(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  domElement: HTMLCanvasElement,
  terrainMesh: THREE.Mesh,
  terrain: TerrainState,
  onCellClick: (e: CellClickEvent) => void,
  onHoverChange: (cell: { cx: number; cz: number } | null) => void,
) {
  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()

  let hoveredCell: { cx: number; cz: number } | null = null
  let mouseDownPos = { x: 0, y: 0 }
  let isDown = false

  // --- Surface highlight overlay ---
  const HL_SEG = Math.ceil(SEGMENTS / CELLS)
  const hl_stride = HL_SEG + 1
  const hlVertCount = hl_stride * hl_stride
  const hlPositions = new Float32Array(hlVertCount * 3)
  const hlIndices: number[] = []
  for (let iz = 0; iz < HL_SEG; iz++) {
    for (let ix = 0; ix < HL_SEG; ix++) {
      const a = iz * hl_stride + ix
      const b = a + 1
      const c = a + hl_stride
      const d = c + 1
      hlIndices.push(a, b, c, c, b, d)
    }
  }
  const hlGeo = new THREE.BufferGeometry()
  const hlPosAttr = new THREE.BufferAttribute(hlPositions, 3)
  hlGeo.setAttribute('position', hlPosAttr)
  hlGeo.setIndex(hlIndices)

  const hlMat = new THREE.MeshBasicMaterial({
    color: 0x44bbff,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const hlMesh = new THREE.Mesh(hlGeo, hlMat)
  hlMesh.visible = false
  hlMesh.renderOrder = 998
  scene.add(hlMesh)

  function updateHighlight(cx: number, cz: number) {
    const x0 = -HALF + cx * CELL_SIZE
    const z0 = -HALF + cz * CELL_SIZE
    const step = CELL_SIZE / HL_SEG
    const lift = 0.08

    let idx = 0
    for (let iz = 0; iz <= HL_SEG; iz++) {
      for (let ix = 0; ix <= HL_SEG; ix++) {
        const wx = x0 + ix * step
        const wz = z0 + iz * step
        hlPositions[idx++] = wx
        hlPositions[idx++] = terrain.getHeight(wx, wz) + lift
        hlPositions[idx++] = wz
      }
    }
    hlPosAttr.needsUpdate = true
    hlGeo.computeVertexNormals()
    hlMesh.visible = true
  }

  function worldToCell(wx: number, wz: number): { cx: number; cz: number } | null {
    const cx = Math.floor((wx + HALF) / CELL_SIZE)
    const cz = Math.floor((wz + HALF) / CELL_SIZE)
    if (cx < 0 || cx >= CELLS || cz < 0 || cz >= CELLS) return null
    return { cx, cz }
  }

  function clearHover() {
    if (!hoveredCell) return
    hoveredCell = null
    hlMesh.visible = false
    onHoverChange(null)
  }

  function setHover(cx: number, cz: number) {
    if (hoveredCell && hoveredCell.cx === cx && hoveredCell.cz === cz) return
    hoveredCell = { cx, cz }
    updateHighlight(cx, cz)
    onHoverChange(hoveredCell)
  }

  function projectCellCenter(cx: number, cz: number) {
    const centerX = -HALF + (cx + 0.5) * CELL_SIZE
    const centerZ = -HALF + (cz + 0.5) * CELL_SIZE
    const centerY = terrain.getHeight(centerX, centerZ)
    const vec = new THREE.Vector3(centerX, centerY, centerZ).project(camera)
    const rect = domElement.getBoundingClientRect()
    return {
      x: (vec.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-vec.y * 0.5 + 0.5) * rect.height + rect.top,
    }
  }

  function raycastCell(clientX: number, clientY: number) {
    const rect = domElement.getBoundingClientRect()
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(mouse, camera)
    const hits = raycaster.intersectObject(terrainMesh)
    if (hits.length > 0) return worldToCell(hits[0].point.x, hits[0].point.z)
    return null
  }

  function onMouseMove(e: MouseEvent) {
    const cell = raycastCell(e.clientX, e.clientY)
    if (cell) setHover(cell.cx, cell.cz)
    else clearHover()
  }

  function onPointerDown(e: PointerEvent) {
    mouseDownPos = { x: e.clientX, y: e.clientY }
    isDown = true
  }

  function onPointerUp(e: PointerEvent) {
    if (!isDown) return
    isDown = false

    const dx = e.clientX - mouseDownPos.x
    const dy = e.clientY - mouseDownPos.y
    if (dx * dx + dy * dy > 36) return

    const cell = raycastCell(e.clientX, e.clientY)
    if (cell) {
      const screen = projectCellCenter(cell.cx, cell.cz)
      onCellClick({ cx: cell.cx, cz: cell.cz, screenX: screen.x, screenY: screen.y })
    }
  }

  domElement.addEventListener('mousemove', onMouseMove)
  domElement.addEventListener('pointerdown', onPointerDown)
  domElement.addEventListener('pointerup', onPointerUp)

  return {
    update(_dt: number) {
      if (hoveredCell) {
        updateHighlight(hoveredCell.cx, hoveredCell.cz)
      }
    },
    clearHover,
    dispose() {
      domElement.removeEventListener('mousemove', onMouseMove)
      domElement.removeEventListener('pointerdown', onPointerDown)
      domElement.removeEventListener('pointerup', onPointerUp)
      scene.remove(hlMesh)
      hlGeo.dispose()
      hlMat.dispose()
    },
  }
}
