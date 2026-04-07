import * as THREE from 'three'
import { HALF, CELL_SIZE, HEIGHT_SCALE } from './constants'
import type { TerrainState } from './terrain'

export function createPreviewSystem(scene: THREE.Scene, terrain: TerrainState) {
  let time = 0

  // --- Raise / Lower: displacement-line grid ---
  const LINE_COUNT = 10
  const PTS_PER_LINE = 32
  const GRID_SPAN = CELL_SIZE
  const BUMP_RADIUS = CELL_SIZE * 0.42
  const BUMP_AMP = HEIGHT_SCALE * 1.2

  const raiseColor = new THREE.Color(0x22ff44)
  const lowerColor = new THREE.Color(0x8b0023)

  const displacementGroup = new THREE.Group()
  displacementGroup.visible = false
  displacementGroup.renderOrder = 999
  scene.add(displacementGroup)

  const lineMaterials: THREE.LineBasicMaterial[] = []
  const lineGeos: THREE.BufferGeometry[] = []
  const linePositionArrays: Float32Array[] = []

  for (let l = 0; l < LINE_COUNT; l++) {
    const arr = new Float32Array(PTS_PER_LINE * 3)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    const mat = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: 1,
      depthTest: false,
    })
    const line = new THREE.Line(geo, mat)
    line.renderOrder = 999
    displacementGroup.add(line)
    lineMaterials.push(mat)
    lineGeos.push(geo)
    linePositionArrays.push(arr)
  }

  let ghostActive = false

  let activeYOffset = 0

  function cellCenter(cx: number, cz: number) {
    const wx = -HALF + (cx + 0.5) * CELL_SIZE
    const wz = -HALF + (cz + 0.5) * CELL_SIZE
    const wy = terrain.getHeight(wx, wz) + activeYOffset
    return { wx, wy, wz }
  }

  function bump(r: number): number {
    if (r >= 1) return 0
    const s = 1 - r * r
    return s * s
  }

  function buildRaiseLines(centerX: number, centerY: number, centerZ: number) {
    const dir = activeYOffset < 0 ? -1 : 1
    const halfSpan = GRID_SPAN * 0.5
    for (let l = 0; l < LINE_COUNT; l++) {
      const lz = centerZ - halfSpan + (l / (LINE_COUNT - 1)) * GRID_SPAN
      const arr = linePositionArrays[l]
      for (let p = 0; p < PTS_PER_LINE; p++) {
        const lx = centerX - halfSpan + (p / (PTS_PER_LINE - 1)) * GRID_SPAN
        const dx = lx - centerX
        const dz = lz - centerZ
        const r = Math.sqrt(dx * dx + dz * dz) / BUMP_RADIUS
        const dy = dir * BUMP_AMP * bump(r)
        arr[p * 3] = lx
        arr[p * 3 + 1] = centerY + dy + dir * 0.15
        arr[p * 3 + 2] = lz
      }
      ;(lineGeos[l].attributes.position as THREE.BufferAttribute).needsUpdate = true
      const distFromCenter = Math.abs((l / (LINE_COUNT - 1)) - 0.5) * 2
      lineMaterials[l].opacity = 1.0 - distFromCenter * 0.3
    }
  }

  function buildLowerLines(centerX: number, centerY: number, centerZ: number) {
    const dir = activeYOffset < 0 ? -1 : 1
    const halfSpan = GRID_SPAN * 0.5
    const liftY = dir * BUMP_AMP
    for (let l = 0; l < LINE_COUNT; l++) {
      const lz = centerZ - halfSpan + (l / (LINE_COUNT - 1)) * GRID_SPAN
      const arr = linePositionArrays[l]
      for (let p = 0; p < PTS_PER_LINE; p++) {
        const lx = centerX - halfSpan + (p / (PTS_PER_LINE - 1)) * GRID_SPAN
        const dx = lx - centerX
        const dz = lz - centerZ
        const r = Math.sqrt(dx * dx + dz * dz) / BUMP_RADIUS
        const dy = -dir * BUMP_AMP * bump(r)
        arr[p * 3] = lx
        arr[p * 3 + 1] = centerY + liftY + dy + dir * 0.15
        arr[p * 3 + 2] = lz
      }
      ;(lineGeos[l].attributes.position as THREE.BufferAttribute).needsUpdate = true
      const distFromCenter = Math.abs((l / (LINE_COUNT - 1)) - 0.5) * 2
      lineMaterials[l].opacity = 1.0 - distFromCenter * 0.3
    }
  }

  function setLineColor(color: THREE.Color) {
    for (const mat of lineMaterials) mat.color.copy(color)
  }

  function showRaise(cx: number, cz: number, yOffset = 0) {
    hideAll()
    activeYOffset = yOffset
    const c = cellCenter(cx, cz)
    setLineColor(raiseColor)
    buildRaiseLines(c.wx, c.wy, c.wz)
    displacementGroup.visible = true
    ghostActive = true
  }

  function showLower(cx: number, cz: number, yOffset = 0) {
    hideAll()
    activeYOffset = yOffset
    const c = cellCenter(cx, cz)
    setLineColor(lowerColor)
    buildLowerLines(c.wx, c.wy, c.wz)
    displacementGroup.visible = true
    ghostActive = true
  }

  // --- Move arc arrow (flat ribbon with gradient fade-in) ---
  const ARC_SEGS = 24
  const RIBBON_W = CELL_SIZE * 0.35
  const RIBBON_COLOR = new THREE.Color(0xffcc55)

  const ribbonMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    uniforms: {
      uPulse: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      attribute vec4 color;
      varying vec4 vColor;
      void main() {
        vColor = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uPulse;
      varying vec4 vColor;
      void main() {
        gl_FragColor = vec4(vColor.rgb, vColor.a * uPulse);
      }
    `,
  })

  let ribbonMesh: THREE.Mesh | null = null
  const spinePool = Array.from({ length: ARC_SEGS + 1 }, () => new THREE.Vector3())

  let arcActive = false

  function buildRibbonGeo(spine: THREE.Vector3[], perpX: number, perpZ: number) {
    const verts = (ARC_SEGS + 1) * 2
    const positions = new Float32Array(verts * 3)
    const colors = new Float32Array(verts * 4)
    const indices: number[] = []

    const r = RIBBON_COLOR.r, g = RIBBON_COLOR.g, b = RIBBON_COLOR.b

    for (let i = 0; i <= ARC_SEGS; i++) {
      const t = i / ARC_SEGS
      const alpha = Math.min(t * 3, 1.0)
      const taper = 1 - 0.7 * t
      const hw = RIBBON_W * 0.5 * Math.max(taper, 0.08)
      const p = spine[i]
      const li = i * 2
      const ri = li + 1

      positions[li * 3] = p.x - perpX * hw
      positions[li * 3 + 1] = p.y
      positions[li * 3 + 2] = p.z - perpZ * hw
      positions[ri * 3] = p.x + perpX * hw
      positions[ri * 3 + 1] = p.y
      positions[ri * 3 + 2] = p.z + perpZ * hw

      colors[li * 4] = r; colors[li * 4 + 1] = g; colors[li * 4 + 2] = b; colors[li * 4 + 3] = alpha
      colors[ri * 4] = r; colors[ri * 4 + 1] = g; colors[ri * 4 + 2] = b; colors[ri * 4 + 3] = alpha

      if (i < ARC_SEGS) {
        const a = li, b2 = ri, c = li + 2, d = ri + 2
        indices.push(a, c, b2, b2, c, d)
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 4))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    return geo
  }

  function showMove(fromCx: number, fromCz: number, toCx: number, toCz: number, yOffset = 0) {
    hideAll()
    activeYOffset = yOffset
    const from = cellCenter(fromCx, fromCz)
    const to = cellCenter(toCx, toCz)

    const dx = to.wx - from.wx
    const dz = to.wz - from.wz
    const dist = Math.sqrt(dx * dx + dz * dz)
    const arcHeight = Math.max(dist * 0.4, CELL_SIZE * 0.5)
    const arcDir = yOffset < 0 ? -1 : 1

    for (let i = 0; i <= ARC_SEGS; i++) {
      const t = i / ARC_SEGS
      const x = from.wx + dx * t
      const z = from.wz + dz * t
      const baseY = from.wy + (to.wy - from.wy) * t
      const arc = arcDir * 4 * arcHeight * t * (1 - t)
      spinePool[i].set(x, baseY + arc, z)
    }

    const len2d = Math.sqrt(dx * dx + dz * dz) || 1
    const perpX = -dz / len2d
    const perpZ = dx / len2d

    const geo = buildRibbonGeo(spinePool, perpX, perpZ)
    ribbonMesh = new THREE.Mesh(geo, ribbonMat)
    ribbonMesh.renderOrder = 998
    scene.add(ribbonMesh)

    arcActive = true
  }

  // --- Common ---

  function removeRibbon() {
    if (ribbonMesh) {
      scene.remove(ribbonMesh)
      ribbonMesh.geometry.dispose()
      ribbonMesh = null
    }
  }

  function hideAll() {
    displacementGroup.visible = false
    ghostActive = false
    removeRibbon()
    arcActive = false
  }

  function update(dt: number) {
    time += dt
    const pulse = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(time * 3))

    if (ghostActive) {
      for (const mat of lineMaterials) {
        mat.opacity = pulse
      }
    }
    if (arcActive) {
      ribbonMat.uniforms.uPulse.value = pulse
    }
  }

  function dispose() {
    scene.remove(displacementGroup)
    for (const geo of lineGeos) geo.dispose()
    for (const mat of lineMaterials) mat.dispose()
    removeRibbon()
    ribbonMat.dispose()
  }

  return { showRaise, showLower, showMove, hide: hideAll, update, dispose }
}
