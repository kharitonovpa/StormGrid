import * as THREE from 'three'
import { CELLS, HALF, CELL_SIZE, SEGMENTS, THICKNESS } from './constants'
import type { TerrainState } from './terrain'

export interface CellClickEvent {
  cx: number
  cz: number
  screenX: number
  screenY: number
  isBottom: boolean
}

export function createInteractionSystem(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  domElement: HTMLCanvasElement,
  terrainMesh: THREE.Mesh,
  terrain: TerrainState,
  onCellClick: (e: CellClickEvent) => void,
  onHoverChange: (cell: { cx: number; cz: number; isBottom: boolean } | null) => void,
  extraMeshes: THREE.Mesh[] = [],
  onEmptyClick?: () => void,
) {
  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()
  const _projVec = new THREE.Vector3()

  let hoveredCell: { cx: number; cz: number; isBottom: boolean } | null = null
  let mouseDownPos = { x: 0, y: 0 }
  let isDown = false
  let lastTerrainVersion = -1

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

  function updateHighlight(cx: number, cz: number, yOffset = 0) {
    const x0 = -HALF + cx * CELL_SIZE
    const z0 = -HALF + cz * CELL_SIZE
    const step = CELL_SIZE / HL_SEG
    const lift = yOffset < 0 ? -0.08 : 0.08

    let idx = 0
    for (let iz = 0; iz <= HL_SEG; iz++) {
      for (let ix = 0; ix <= HL_SEG; ix++) {
        const wx = x0 + ix * step
        const wz = z0 + iz * step
        hlPositions[idx++] = wx
        hlPositions[idx++] = terrain.getHeight(wx, wz) + yOffset + lift
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

  function setHover(cx: number, cz: number, isBottom: boolean) {
    if (hoveredCell && hoveredCell.cx === cx && hoveredCell.cz === cz && hoveredCell.isBottom === isBottom) return
    hoveredCell = { cx, cz, isBottom }
    lastTerrainVersion = -1
    updateHighlight(cx, cz, isBottom ? -THICKNESS : 0)
    onHoverChange(hoveredCell)
  }

  function projectCellCenter(cx: number, cz: number, isBottom = false) {
    const centerX = -HALF + (cx + 0.5) * CELL_SIZE
    const centerZ = -HALF + (cz + 0.5) * CELL_SIZE
    const centerY = terrain.getHeight(centerX, centerZ) + (isBottom ? -THICKNESS : 0)
    const vec = _projVec.set(centerX, centerY, centerZ).project(camera)
    const rect = domElement.getBoundingClientRect()
    return {
      x: (vec.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-vec.y * 0.5 + 0.5) * rect.height + rect.top,
    }
  }

  const allMeshes = [terrainMesh, ...extraMeshes]

  function raycastCell(clientX: number, clientY: number): { cx: number; cz: number; isBottom: boolean } | null {
    const rect = domElement.getBoundingClientRect()
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(mouse, camera)
    const hits = raycaster.intersectObjects(allMeshes)
    if (hits.length > 0) {
      const cell = worldToCell(hits[0].point.x, hits[0].point.z)
      if (cell) return { ...cell, isBottom: hits[0].object !== terrainMesh }
    }
    return null
  }

  function onMouseMove(e: MouseEvent) {
    const cell = raycastCell(e.clientX, e.clientY)
    if (cell) setHover(cell.cx, cell.cz, cell.isBottom)
    else clearHover()
  }

  function onPointerDown(e: PointerEvent) {
    mouseDownPos = { x: e.clientX, y: e.clientY }
    isDown = true
    if (e.pointerType === 'touch') {
      const cell = raycastCell(e.clientX, e.clientY)
      if (cell) setHover(cell.cx, cell.cz, cell.isBottom)
    }
  }

  function suppressSyntheticClick() {
    const stop = (ev: Event) => {
      if (ev.target === domElement) { ev.stopPropagation(); ev.preventDefault() }
    }
    document.addEventListener('click', stop, { capture: true, once: true })
    setTimeout(() => document.removeEventListener('click', stop, true), 300)
  }

  function onPointerUp(e: PointerEvent) {
    if (!isDown) return
    isDown = false

    const dx = e.clientX - mouseDownPos.x
    const dy = e.clientY - mouseDownPos.y
    if (dx * dx + dy * dy > 36) return

    const cell = raycastCell(e.clientX, e.clientY)
    if (cell) {
      if (e.pointerType === 'touch') suppressSyntheticClick()
      const screen = projectCellCenter(cell.cx, cell.cz, cell.isBottom)
      onCellClick({ cx: cell.cx, cz: cell.cz, screenX: screen.x, screenY: screen.y, isBottom: cell.isBottom })
    } else {
      onEmptyClick?.()
    }
  }

  domElement.addEventListener('mousemove', onMouseMove)
  domElement.addEventListener('pointerdown', onPointerDown)
  domElement.addEventListener('pointerup', onPointerUp)

  return {
    update(_dt: number) {
      if (hoveredCell && terrain.version !== lastTerrainVersion) {
        lastTerrainVersion = terrain.version
        updateHighlight(hoveredCell.cx, hoveredCell.cz, hoveredCell.isBottom ? -THICKNESS : 0)
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
