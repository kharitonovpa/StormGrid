import * as THREE from 'three'
import { CELLS, HALF, CELL_SIZE, SEGMENTS, THICKNESS } from './constants'
import { getModel, modelsLoaded } from './models'
import type { CharacterType } from '@stormgrid/shared'
import type { TerrainState } from './terrain'

export interface PlayerState {
  id: 'A' | 'B'
  cx: number
  cz: number
}

const DIRS_8: [number, number][] = [
  [0, -1],   // N
  [0, 1],    // S
  [-1, 0],   // W
  [1, 0],    // E
  [1, -1],   // NE
  [-1, -1],  // NW
  [1, 1],    // SE
  [-1, 1],   // SW
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

  function positionHighlight(mesh: THREE.Mesh, cx: number, cz: number, yOffset = 0) {
    const posAttr = mesh.geometry.attributes.position as THREE.BufferAttribute
    const arr = posAttr.array as Float32Array
    const x0 = -HALF + cx * CELL_SIZE
    const z0 = -HALF + cz * CELL_SIZE
    const step = CELL_SIZE / HL_SEG
    const lift = yOffset < 0 ? -0.1 : 0.1
    let idx = 0
    for (let iz = 0; iz <= HL_SEG; iz++) {
      for (let ix = 0; ix <= HL_SEG; ix++) {
        const wx = x0 + ix * step
        const wz = z0 + iz * step
        arr[idx++] = wx
        arr[idx++] = terrain.getHeight(wx, wz) + yOffset + lift
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
    const pid = inMoveMode ? moveModePlayerId : activePlayerId
    const me = pid === 'A' ? playerA : playerB
    const s = me.state
    const isBottom = me.surface === 'bottom'
    const yOff = isBottom ? -THICKNESS : 0
    const lift = isBottom ? -0.15 : 0.15
    const cx = -HALF + (s.cx + 0.5) * CELL_SIZE
    const cz = -HALF + (s.cz + 0.5) * CELL_SIZE

    for (let i = 0; i <= RING_SEGS; i++) {
      const angle = (i / RING_SEGS) * Math.PI * 2
      const cosA = Math.cos(angle), sinA = Math.sin(angle)

      const ix = cx + cosA * RING_INNER
      const iz = cz + sinA * RING_INNER
      const innerOff = i * 2 * 3
      ringPositions[innerOff] = ix
      ringPositions[innerOff + 1] = terrain.getHeight(ix, iz) + yOff + lift
      ringPositions[innerOff + 2] = iz

      const ox = cx + cosA * RING_OUTER
      const oz = cz + sinA * RING_OUTER
      const outerOff = (i * 2 + 1) * 3
      ringPositions[outerOff] = ox
      ringPositions[outerOff + 1] = terrain.getHeight(ox, oz) + yOff + lift
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

  function buildArrows(from: { cx: number; cz: number }, targets: { cx: number; cz: number }[], yOffset = 0) {
    const lift = yOffset < 0 ? -0.18 : 0.18
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
      const rx = -fz, rz = fx

      function setV(vi: number, fwdD: number, rightD: number) {
        const wx = cx + fx * fwdD + rx * rightD
        const wz = cz + fz * fwdD + rz * rightD
        const wy = terrain.getHeight(wx, wz) + yOffset + lift
        const idx = off + vi * 3
        arrowPositions[idx] = wx
        arrowPositions[idx + 1] = wy
        arrowPositions[idx + 2] = wz
      }

      setV(0, halfL, 0)
      setV(1, headBase, -halfHW)
      setV(2, headBase, halfHW)
      setV(3, headBase, -halfSW)
      setV(4, headBase, halfSW)
      setV(5, -halfL, -halfSW)
      setV(6, -halfL, halfSW)
    }

    arrowPosAttr.needsUpdate = true
    arrowGeo.computeBoundingSphere()
    arrowMesh.visible = true
  }

  // --- Player ---
  const JUMP_DURATION = 0.35
  const JUMP_HEIGHT = CELL_SIZE * 0.6
  const WIND_SLIDE_DURATION = 1.5
  const WIND_DEATH_OVERSHOOT = CELL_SIZE * 5
  const TURN_SPEED = 10

  function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
  }

  function shortAngleDist(from: number, to: number): number {
    const d = ((to - from) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI
    return d
  }

  function angleTo(fromCx: number, fromCz: number, toCx: number, toCz: number): number {
    const dx = (-HALF + (toCx + 0.5) * CELL_SIZE) - (-HALF + (fromCx + 0.5) * CELL_SIZE)
    const dz = (-HALF + (toCz + 0.5) * CELL_SIZE) - (-HALF + (fromCz + 0.5) * CELL_SIZE)
    return Math.atan2(dx, dz)
  }

  function makePlayer(id: 'A' | 'B', startCx: number, startCz: number) {
    let mesh = new THREE.Group() as THREE.Group
    scene.add(mesh)
    const state: PlayerState = { id, cx: startCx, cz: startCz }
    let surface: 'top' | 'bottom' = 'top'
    let currentCharacter: CharacterType | null = null
    const baseScale = 1.0

    let facingY = 0
    let targetFacingY = 0

    let jumping = false
    let jumpT = 0
    let jumpFrom = { x: 0, y: 0, z: 0 }
    let jumpTo = { x: 0, y: 0, z: 0 }

    let windSliding = false
    let windPoints: { wx: number; wy: number; wz: number }[] = []
    let windDied = false
    let windT = 0
    let windResolve: (() => void) | null = null
    let cachedMaterials: THREE.Material[] | null = null

    function cellWorldPos(cx?: number, cz?: number) {
      const _cx = cx ?? state.cx
      const _cz = cz ?? state.cz
      const wx = -HALF + (_cx + 0.5) * CELL_SIZE
      const wz = -HALF + (_cz + 0.5) * CELL_SIZE
      const topY = terrain.getHeight(wx, wz)
      const wy = surface === 'top' ? topY : topY - THICKNESS
      return { wx, wy, wz }
    }

    function applySurface(s: 'top' | 'bottom') {
      surface = s
      mesh.scale.set(baseScale, s === 'top' ? baseScale : -baseScale, baseScale)
    }

    const p = cellWorldPos()
    mesh.position.set(p.wx, p.wy, p.wz)

    return {
      state,
      get mesh() { return mesh },
      get surface() { return surface },
      setSurface: applySurface,
      get isJumping() { return jumping },
      get isWindSliding() { return windSliding },
      lookAtCell(cx: number, cz: number) {
        if (cx === state.cx && cz === state.cz) return
        targetFacingY = angleTo(state.cx, state.cz, cx, cz)
      },
      setCharacter(type: CharacterType) {
        if (currentCharacter === type && modelsLoaded()) return
        const pos = mesh.position.clone()
        const rot = mesh.rotation.y
        const vis = mesh.visible
        scene.remove(mesh)
        mesh = getModel(type)
        mesh.position.copy(pos)
        mesh.rotation.y = rot
        mesh.visible = vis
        mesh.scale.set(baseScale, surface === 'top' ? baseScale : -baseScale, baseScale)
        scene.add(mesh)
        currentCharacter = modelsLoaded() ? type : null
      },
      moveTo(cx: number, cz: number) {
        targetFacingY = angleTo(state.cx, state.cz, cx, cz)
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
      teleportTo(cx: number, cz: number) {
        jumping = false
        windSliding = false
        state.cx = cx
        state.cz = cz
        const p = cellWorldPos(cx, cz)
        mesh.position.set(p.wx, p.wy, p.wz)
      },
      resetAppearance() {
        jumping = false
        windSliding = false
        windDied = false
        if (windResolve) { windResolve(); windResolve = null }
        mesh.visible = true
        mesh.traverse(child => {
          const m = (child as THREE.Mesh).material as THREE.Material | undefined
          if (m) { m.opacity = 1; m.transparent = false }
        })
        cachedMaterials = null
      },
      startWindSlide(path: { x: number; y: number }[], died: boolean): Promise<void> {
        windPoints = path.map(p => cellWorldPos(p.x, p.y))

        if (died && windPoints.length >= 2) {
          const last = windPoints[windPoints.length - 1]
          const prev = windPoints[windPoints.length - 2]
          const dx = last.wx - prev.wx
          const dz = last.wz - prev.wz
          const len = Math.sqrt(dx * dx + dz * dz) || 1
          const nx = dx / len
          const nz = dz / len
          windPoints.push({
            wx: last.wx + nx * WIND_DEATH_OVERSHOOT,
            wy: last.wy + CELL_SIZE * 2,
            wz: last.wz + nz * WIND_DEATH_OVERSHOOT,
          })
        } else if (died && windPoints.length === 1) {
          const only = windPoints[0]
          windPoints.push({
            wx: only.wx + WIND_DEATH_OVERSHOOT,
            wy: only.wy + CELL_SIZE * 2,
            wz: only.wz,
          })
        }

        if (windPoints.length >= 2) {
          const a = windPoints[0], b = windPoints[1]
          targetFacingY = Math.atan2(b.wx - a.wx, b.wz - a.wz)
        }

        windSliding = true
        windDied = died
        windT = 0
        jumping = false

        if (died) {
          cachedMaterials = []
          mesh.traverse(child => {
            const m = (child as THREE.Mesh).material as THREE.Material | undefined
            if (m) { m.transparent = true; cachedMaterials!.push(m) }
          })
        }

        const last = path[path.length - 1]
        if (!died) {
          state.cx = last.x
          state.cz = last.y
        }

        return new Promise(resolve => { windResolve = resolve })
      },
      update(dt: number) {
        if (windSliding) {
          windT += dt / WIND_SLIDE_DURATION
          if (windT >= 1) {
            windT = 1
            windSliding = false
            if (windDied) mesh.visible = false
            if (windResolve) { windResolve(); windResolve = null }
          }

          const segs = windPoints.length - 1
          const raw = easeInOut(windT) * segs
          const idx = Math.min(Math.floor(raw), segs - 1)
          const frac = raw - idx
          const a = windPoints[idx]
          const b = windPoints[idx + 1]
          mesh.position.x = a.wx + (b.wx - a.wx) * frac
          mesh.position.z = a.wz + (b.wz - a.wz) * frac
          mesh.position.y = a.wy + (b.wy - a.wy) * frac

          if (windDied && cachedMaterials) {
            const fadeStart = 0.35
            const fade = windT < fadeStart ? 1 : 1 - (windT - fadeStart) / (1 - fadeStart)
            const opacity = fade * fade
            for (const mat of cachedMaterials) mat.opacity = opacity
          }
        } else if (jumping) {
          jumpT += dt / JUMP_DURATION
          if (jumpT >= 1) {
            jumpT = 1
            jumping = false
          }
          const e = easeInOut(jumpT)
          mesh.position.x = jumpFrom.x + (jumpTo.x - jumpFrom.x) * e
          mesh.position.z = jumpFrom.z + (jumpTo.z - jumpFrom.z) * e
          const baseY = jumpFrom.y + (jumpTo.y - jumpFrom.y) * e
          const arcDir = surface === 'top' ? 1 : -1
          const arc = arcDir * 4 * JUMP_HEIGHT * jumpT * (1 - jumpT)
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

        const angleDiff = shortAngleDist(facingY, targetFacingY)
        if (Math.abs(angleDiff) > 0.01) {
          facingY += angleDiff * Math.min(dt * TURN_SPEED, 1)
        } else {
          facingY = targetFacingY
        }
        mesh.rotation.y = facingY
      },
    }
  }

  const playerA = makePlayer('A', 3, 3)
  const playerB = makePlayer('B', 3, 3)

  // --- Movement mode ---
  let inMoveMode = false
  let validMoves: { cx: number; cz: number }[] = []
  let activePlayerId: 'A' | 'B' = 'A'
  let lastTerrainVersion = -1

  function showMoveOptions() {
    showMoveOptionsFor(activePlayerId)
  }

  let moveModePlayerId: 'A' | 'B' = 'A'
  let moveSurfaceOffset = 0

  function showMoveOptionsFor(pid: 'A' | 'B') {
    inMoveMode = true
    moveModePlayerId = pid
    const player = pid === 'A' ? playerA : playerB
    const s = player.state
    const off = player.surface === 'bottom' ? -THICKNESS : 0
    const moves: { cx: number; cz: number }[] = []
    for (const [dx, dz] of DIRS_8) {
      const nx = s.cx + dx
      const nz = s.cz + dz
      if (nx >= 0 && nx < CELLS && nz >= 0 && nz < CELLS) {
        moves.push({ cx: nx, cz: nz })
      }
    }
    validMoves = moves
    moveSurfaceOffset = off
    for (let i = 0; i < 8; i++) {
      if (i < validMoves.length) {
        positionHighlight(moveHighlights[i], validMoves[i].cx, validMoves[i].cz, off)
      } else {
        moveHighlights[i].visible = false
      }
    }
    buildArrows(s, validMoves, off)
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

  function applyPositions(
    a: { x: number; y: number; alive: boolean; character?: CharacterType },
    b: { x: number; y: number; alive: boolean; character?: CharacterType },
  ) {
    if (a.character) playerA.setCharacter(a.character)
    if (b.character) playerB.setCharacter(b.character)

    if (a.alive && (a.x !== playerA.state.cx || a.y !== playerA.state.cz)) {
      playerA.moveTo(a.x, a.y)
    }
    playerA.mesh.visible = a.alive

    if (b.alive && (b.x !== playerB.state.cx || b.y !== playerB.state.cz)) {
      playerB.moveTo(b.x, b.y)
    }
    playerB.mesh.visible = b.alive
  }

  function setActivePlayer(id: 'A' | 'B' | null) {
    activePlayerId = id ?? 'A'
    if (id === 'B') {
      playerB.setSurface('top')
      playerA.setSurface('bottom')
    } else {
      playerA.setSurface('top')
      playerB.setSurface('bottom')
    }
  }

  function animateWindPaths(
    paths: Record<'A' | 'B', { x: number; y: number }[]>,
    deaths: ('A' | 'B')[],
  ): Promise<void> {
    const promises: Promise<void>[] = []
    for (const pid of ['A', 'B'] as const) {
      const path = paths[pid]
      if (path.length <= 1) continue
      const player = pid === 'A' ? playerA : playerB
      const died = deaths.includes(pid)
      promises.push(player.startWindSlide(path, died))
    }
    return promises.length > 0 ? Promise.all(promises).then(() => {}) : Promise.resolve()
  }

  function applyPositionsImmediate(
    a: { x: number; y: number; alive: boolean; character?: CharacterType },
    b: { x: number; y: number; alive: boolean; character?: CharacterType },
  ) {
    if (a.character) playerA.setCharacter(a.character)
    if (b.character) playerB.setCharacter(b.character)
    playerA.resetAppearance()
    playerB.resetAppearance()
    playerA.teleportTo(a.x, a.y)
    playerB.teleportTo(b.x, b.y)
    playerA.mesh.visible = a.alive
    playerB.mesh.visible = b.alive
  }

  return {
    playerA,
    playerB,
    applyPositions,
    applyPositionsImmediate,
    animateWindPaths,
    setActivePlayer,
    isOccupied(cx: number, cz: number) {
      const a = playerA.state, b = playerB.state
      return (a.cx === cx && a.cz === cz) || (b.cx === cx && b.cz === cz)
    },
    isMyCell(cx: number, cz: number) {
      const s = activePlayerId === 'A' ? playerA.state : playerB.state
      return s.cx === cx && s.cz === cz
    },
    playerAtCell(cx: number, cz: number): 'A' | 'B' | null {
      if (playerA.state.cx === cx && playerA.state.cz === cz) return 'A'
      if (playerB.state.cx === cx && playerB.state.cz === cz) return 'B'
      return null
    },
    get moveMode() { return inMoveMode },
    get moveModePlayer() { return moveModePlayerId },
    surfaceOffsetFor(pid: 'A' | 'B'): number {
      const p = pid === 'A' ? playerA : playerB
      return p.surface === 'bottom' ? -THICKNESS : 0
    },
    showMoveOptions,
    showMoveOptionsFor,
    hideMoveOptions,
    isValidMove,
    setHovered(val: boolean) { isPlayerHovered = val },
    setHoverCell(cx: number | null, cz: number | null) {
      if (!inMoveMode || cx === null || cz === null) return
      const player = moveModePlayerId === 'A' ? playerA : playerB
      player.lookAtCell(cx, cz)
    },
    update(dt: number) {
      playerA.update(dt)
      playerB.update(dt)
      if (inMoveMode && terrain.version !== lastTerrainVersion) {
        lastTerrainVersion = terrain.version
        for (let i = 0; i < validMoves.length; i++) {
          positionHighlight(moveHighlights[i], validMoves[i].cx, validMoves[i].cz, moveSurfaceOffset)
        }
        const active = moveModePlayerId === 'A' ? playerA : playerB
        buildArrows(active.state, validMoves, moveSurfaceOffset)
      }

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
      function disposeGroup(g: THREE.Object3D) {
        g.traverse(child => {
          const m = child as THREE.Mesh
          if (m.geometry) m.geometry.dispose()
          if (m.material) {
            const mat = m.material
            if (Array.isArray(mat)) mat.forEach(x => x.dispose())
            else (mat as THREE.Material).dispose()
          }
        })
      }
      scene.remove(playerA.mesh); disposeGroup(playerA.mesh)
      scene.remove(playerB.mesh); disposeGroup(playerB.mesh)
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
