import * as THREE from 'three'
import { CELLS, HALF, CELL_SIZE, SEGMENTS } from './constants'
import { createFlame } from '../flame'
import type { TerrainState } from './terrain'

export interface PlayerState {
  id: 'A' | 'B'
  cx: number
  cz: number
}

const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
]

export function createPlayerSystem(scene: THREE.Scene, terrain: TerrainState) {

  // --- Shared highlight geometry template (per cell) ---
  const HL_SEG = Math.ceil(SEGMENTS / CELLS)
  const hlStride = HL_SEG + 1
  const hlVertCount = hlStride * hlStride
  const hlIndices: number[] = []
  for (let iz = 0; iz < HL_SEG; iz++) {
    for (let ix = 0; ix < HL_SEG; ix++) {
      const a = iz * hlStride + ix
      hlIndices.push(a, a + 1, a + hlStride, a + hlStride, a + 1, a + hlStride + 1)
    }
  }

  const hlMat = new THREE.MeshBasicMaterial({
    color: 0xffcc66,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  function createCellHighlight(): THREE.Mesh {
    const positions = new Float32Array(hlVertCount * 3)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setIndex(hlIndices)
    const mesh = new THREE.Mesh(geo, hlMat)
    mesh.visible = false
    mesh.renderOrder = 997
    scene.add(mesh)
    return mesh
  }

  function positionHighlight(mesh: THREE.Mesh, cx: number, cz: number) {
    const posAttr = mesh.geometry.attributes.position as THREE.BufferAttribute
    const arr = posAttr.array as Float32Array
    const x0 = -HALF + cx * CELL_SIZE
    const z0 = -HALF + cz * CELL_SIZE
    const step = CELL_SIZE / HL_SEG
    let idx = 0
    for (let iz = 0; iz <= HL_SEG; iz++) {
      for (let ix = 0; ix <= HL_SEG; ix++) {
        const wx = x0 + ix * step
        const wz = z0 + iz * step
        arr[idx++] = wx
        arr[idx++] = terrain.getHeight(wx, wz) + 0.1
        arr[idx++] = wz
      }
    }
    posAttr.needsUpdate = true
    mesh.geometry.computeVertexNormals()
    mesh.visible = true
  }

  // Pre-allocate 8 highlight meshes
  const moveHighlights = Array.from({ length: 8 }, () => createCellHighlight())

  // --- Player hover / focus ring (terrain-following) ---
  const RING_SEGS = 32
  const RING_INNER = CELL_SIZE * 0.3
  const RING_OUTER = CELL_SIZE * 0.42
  const ringVertCount = (RING_SEGS + 1) * 2
  const ringPositions = new Float32Array(ringVertCount * 3)
  const ringIdx: number[] = []
  for (let i = 0; i < RING_SEGS; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1
    ringIdx.push(a, c, b, b, c, d)
  }

  const ringGeo = new THREE.BufferGeometry()
  const ringPosAttr = new THREE.BufferAttribute(ringPositions, 3)
  ringGeo.setAttribute('position', ringPosAttr)
  ringGeo.setIndex(ringIdx)

  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x66ddff,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.renderOrder = 996
  scene.add(ring)

  let isPlayerHovered = false
  let ringOpacity = 0
  let ringPulseTime = 0

  function updateRingVertices() {
    const s = playerA.state
    const cx = -HALF + (s.cx + 0.5) * CELL_SIZE
    const cz = -HALF + (s.cz + 0.5) * CELL_SIZE
    const lift = 0.15

    for (let i = 0; i <= RING_SEGS; i++) {
      const angle = (i / RING_SEGS) * Math.PI * 2
      const cosA = Math.cos(angle), sinA = Math.sin(angle)

      const ix = cx + cosA * RING_INNER
      const iz = cz + sinA * RING_INNER
      const innerOff = i * 2 * 3
      ringPositions[innerOff] = ix
      ringPositions[innerOff + 1] = terrain.getHeight(ix, iz) + lift
      ringPositions[innerOff + 2] = iz

      const ox = cx + cosA * RING_OUTER
      const oz = cz + sinA * RING_OUTER
      const outerOff = (i * 2 + 1) * 3
      ringPositions[outerOff] = ox
      ringPositions[outerOff + 1] = terrain.getHeight(ox, oz) + lift
      ringPositions[outerOff + 2] = oz
    }
    ringPosAttr.needsUpdate = true
  }

  // --- Thick arrow meshes (road-sign style, on target cells) ---
  const ARROW_LEN = CELL_SIZE * 0.55
  const HEAD_W = CELL_SIZE * 0.38
  const HEAD_L = CELL_SIZE * 0.26
  const SHAFT_W = CELL_SIZE * 0.13
  const MAX_ARROWS = 8
  const VERTS_PER = 7 // tip, headL, headR, shaftTL, shaftTR, shaftBL, shaftBR

  const arrowPositions = new Float32Array(MAX_ARROWS * VERTS_PER * 3)
  const arrowIdx: number[] = []
  for (let i = 0; i < MAX_ARROWS; i++) {
    const b = i * VERTS_PER
    arrowIdx.push(b, b + 1, b + 2)
    arrowIdx.push(b + 3, b + 5, b + 4)
    arrowIdx.push(b + 4, b + 5, b + 6)
  }

  const arrowGeo = new THREE.BufferGeometry()
  const arrowPosAttr = new THREE.BufferAttribute(arrowPositions, 3)
  arrowGeo.setAttribute('position', arrowPosAttr)
  arrowGeo.setIndex(arrowIdx)

  const arrowMat = new THREE.MeshBasicMaterial({
    color: 0xffcc55,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const arrowMesh = new THREE.Mesh(arrowGeo, arrowMat)
  arrowMesh.visible = false
  arrowMesh.renderOrder = 999
  scene.add(arrowMesh)

  function buildArrows(from: { cx: number; cz: number }, targets: { cx: number; cz: number }[]) {
    const lift = 0.18
    const halfL = ARROW_LEN / 2
    const headBase = halfL - HEAD_L
    const halfHW = HEAD_W / 2
    const halfSW = SHAFT_W / 2

    for (let i = 0; i < MAX_ARROWS; i++) {
      const off = i * VERTS_PER * 3
      if (i >= targets.length) {
        for (let j = 0; j < VERTS_PER * 3; j++) arrowPositions[off + j] = 0
        continue
      }

      const t = targets[i]
      const cx = -HALF + (t.cx + 0.5) * CELL_SIZE
      const cz = -HALF + (t.cz + 0.5) * CELL_SIZE

      const ddx = t.cx - from.cx
      const ddz = t.cz - from.cz
      const len = Math.sqrt(ddx * ddx + ddz * ddz)
      const fx = ddx / len, fz = ddz / len
      // right vector (90° CW in XZ plane)
      const rx = -fz, rz = fx

      function setV(vi: number, fwdD: number, rightD: number) {
        const wx = cx + fx * fwdD + rx * rightD
        const wz = cz + fz * fwdD + rz * rightD
        const wy = terrain.getHeight(wx, wz) + lift
        const idx = off + vi * 3
        arrowPositions[idx] = wx
        arrowPositions[idx + 1] = wy
        arrowPositions[idx + 2] = wz
      }

      setV(0, halfL, 0)            // tip
      setV(1, headBase, -halfHW)    // head left
      setV(2, headBase, halfHW)     // head right
      setV(3, headBase, -halfSW)    // shaft top left
      setV(4, headBase, halfSW)     // shaft top right
      setV(5, -halfL, -halfSW)      // shaft bottom left
      setV(6, -halfL, halfSW)       // shaft bottom right
    }

    arrowPosAttr.needsUpdate = true
    arrowGeo.computeBoundingSphere()
    arrowMesh.visible = true
  }

  // --- Player ---
  const JUMP_DURATION = 0.35
  const JUMP_HEIGHT = CELL_SIZE * 0.6

  function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
  }

  function makePlayer(id: 'A' | 'B', startCx: number, startCz: number) {
    const mesh = createFlame()
    mesh.scale.setScalar(2)
    scene.add(mesh)
    const state: PlayerState = { id, cx: startCx, cz: startCz }

    let jumping = false
    let jumpT = 0
    let jumpFrom = { x: 0, y: 0, z: 0 }
    let jumpTo = { x: 0, y: 0, z: 0 }

    function cellWorldPos(cx?: number, cz?: number) {
      const _cx = cx ?? state.cx
      const _cz = cz ?? state.cz
      const wx = -HALF + (_cx + 0.5) * CELL_SIZE
      const wz = -HALF + (_cz + 0.5) * CELL_SIZE
      const wy = terrain.getHeight(wx, wz)
      return { wx, wy, wz }
    }

    const p = cellWorldPos()
    mesh.position.set(p.wx, p.wy, p.wz)

    return {
      state,
      mesh,
      get isJumping() { return jumping },
      moveTo(cx: number, cz: number) {
        jumpFrom.x = mesh.position.x
        jumpFrom.y = mesh.position.y
        jumpFrom.z = mesh.position.z
        const dest = cellWorldPos(cx, cz)
        jumpTo.x = dest.wx
        jumpTo.y = dest.wy
        jumpTo.z = dest.wz
        jumping = true
        jumpT = 0
        state.cx = cx
        state.cz = cz
      },
      update(dt: number) {
        if (jumping) {
          jumpT += dt / JUMP_DURATION
          if (jumpT >= 1) {
            jumpT = 1
            jumping = false
          }
          const e = easeInOut(jumpT)
          mesh.position.x = jumpFrom.x + (jumpTo.x - jumpFrom.x) * e
          mesh.position.z = jumpFrom.z + (jumpTo.z - jumpFrom.z) * e
          const baseY = jumpFrom.y + (jumpTo.y - jumpFrom.y) * e
          const arc = 4 * JUMP_HEIGHT * jumpT * (1 - jumpT)
          mesh.position.y = baseY + arc
        } else {
          const t = cellWorldPos()
          mesh.position.x = t.wx
          mesh.position.z = t.wz
          const dy = t.wy - mesh.position.y
          if (Math.abs(dy) > 0.01) {
            mesh.position.y += dy * Math.min(dt * 5, 1)
          } else {
            mesh.position.y = t.wy
          }
        }
      },
    }
  }

  const playerA = makePlayer('A', 3, 3)

  // --- Movement mode ---
  let inMoveMode = false
  let validMoves: { cx: number; cz: number }[] = []

  function getValidMoves(): { cx: number; cz: number }[] {
    const s = playerA.state
    const moves: { cx: number; cz: number }[] = []
    for (const [dz, dx] of DIRS) {
      const nx = s.cx + dx
      const nz = s.cz + dz
      if (nx >= 0 && nx < CELLS && nz >= 0 && nz < CELLS) {
        moves.push({ cx: nx, cz: nz })
      }
    }
    return moves
  }

  function showMoveOptions() {
    inMoveMode = true
    validMoves = getValidMoves()
    for (let i = 0; i < 8; i++) {
      if (i < validMoves.length) {
        positionHighlight(moveHighlights[i], validMoves[i].cx, validMoves[i].cz)
      } else {
        moveHighlights[i].visible = false
      }
    }
    buildArrows(playerA.state, validMoves)
  }

  function hideMoveOptions() {
    inMoveMode = false
    validMoves = []
    for (const hl of moveHighlights) hl.visible = false
    arrowMesh.visible = false
  }

  function isValidMove(cx: number, cz: number): boolean {
    return validMoves.some(m => m.cx === cx && m.cz === cz)
  }

  return {
    playerA,
    isOccupied(cx: number, cz: number) {
      return playerA.state.cx === cx && playerA.state.cz === cz
    },
    get moveMode() { return inMoveMode },
    showMoveOptions,
    hideMoveOptions,
    isValidMove,
    setHovered(val: boolean) { isPlayerHovered = val },
    update(dt: number) {
      playerA.update(dt)
      if (inMoveMode) {
        for (let i = 0; i < validMoves.length; i++) {
          positionHighlight(moveHighlights[i], validMoves[i].cx, validMoves[i].cz)
        }
        buildArrows(playerA.state, validMoves)
      }

      // Ring animation
      if (inMoveMode) {
        ringPulseTime += dt
        const target = 0.3 + 0.15 * Math.sin(ringPulseTime * 3.5)
        ringOpacity += (target - ringOpacity) * Math.min(dt * 12, 1)
        ringMat.color.setHex(0xffcc44)
      } else if (isPlayerHovered) {
        ringOpacity += (0.3 - ringOpacity) * Math.min(dt * 10, 1)
        ringMat.color.setHex(0x66ddff)
        ringPulseTime = 0
      } else {
        ringOpacity += (0.08 - ringOpacity) * Math.min(dt * 10, 1)
        ringMat.color.setHex(0x66ddff)
        ringPulseTime = 0
      }
      ringMat.opacity = ringOpacity
      ring.visible = ringOpacity > 0.01
      if (ring.visible) updateRingVertices()
    },
    dispose() {
      scene.remove(playerA.mesh)
      for (const hl of moveHighlights) { scene.remove(hl); hl.geometry.dispose() }
      scene.remove(arrowMesh)
      arrowGeo.dispose()
      arrowMat.dispose()
      scene.remove(ring)
      ringGeo.dispose()
      ringMat.dispose()
      hlMat.dispose()
    },
  }
}
