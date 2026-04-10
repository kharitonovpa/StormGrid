import * as THREE from 'three'
import { HALF, CELL_SIZE, HEIGHT_SCALE } from './constants'
import type { TerrainState } from './terrain'

export function createPreviewSystem(scene: THREE.Scene, terrain: TerrainState) {
  let time = 0

  /* ═══════════════════════════════════════════════════════════════
     Raise / Lower — ribbon lines + glow disc + sparkle particles
     ═══════════════════════════════════════════════════════════════ */

  const LINE_COUNT = 10
  const PTS_PER_LINE = 32
  const GRID_SPAN = CELL_SIZE
  const BUMP_RADIUS = CELL_SIZE * 0.42
  const BUMP_AMP = HEIGHT_SCALE * 1.2
  const RIBBON_HW = CELL_SIZE * 0.025
  const DISC_SEGS = 32
  const DISC_RADIUS = CELL_SIZE * 0.6
  const SPARKLE_COUNT = 24
  const SPARKLE_MAX_H = BUMP_AMP * 0.7

  const raiseColor = new THREE.Color(0x44ff88)
  const lowerColor = new THREE.Color(0xff3355)

  // ── Ribbon mesh (all 10 lines in one geometry) ──

  const VERTS_PER_LINE = PTS_PER_LINE * 2
  const TOTAL_VERTS = LINE_COUNT * VERTS_PER_LINE

  const rPos = new Float32Array(TOTAL_VERTS * 3)
  const rAlpha = new Float32Array(TOTAL_VERTS)
  const rDist = new Float32Array(TOTAL_VERTS)
  const rIdx: number[] = []
  for (let l = 0; l < LINE_COUNT; l++) {
    const b = l * VERTS_PER_LINE
    for (let p = 0; p < PTS_PER_LINE - 1; p++) {
      const i = b + p * 2
      rIdx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3)
    }
  }

  const rGeo = new THREE.BufferGeometry()
  const rPosAttr = new THREE.BufferAttribute(rPos, 3)
  const rAlphaAttr = new THREE.BufferAttribute(rAlpha, 1)
  const rDistAttr = new THREE.BufferAttribute(rDist, 1)
  rGeo.setAttribute('position', rPosAttr)
  rGeo.setAttribute('aAlpha', rAlphaAttr)
  rGeo.setAttribute('aDist', rDistAttr)
  rGeo.setIndex(rIdx)

  const ribbonMat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color() },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute float aDist;
      varying float vAlpha;
      varying float vDist;
      void main() {
        vAlpha = aAlpha;
        vDist  = aDist;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3  uColor;
      uniform float uTime;
      varying float vAlpha;
      varying float vDist;
      void main() {
        float wave  = sin(vDist * 8.0 - uTime * 4.0) * 0.5 + 0.5;
        float pulse = 0.3 + 0.7 * wave;
        gl_FragColor = vec4(uColor, vAlpha * pulse);
      }
    `,
  })

  const ribbonObj = new THREE.Mesh(rGeo, ribbonMat)
  ribbonObj.renderOrder = 999
  ribbonObj.visible = false
  scene.add(ribbonObj)

  // ── Glow disc ──

  const discMat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color() },
      uPulse: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3  uColor;
      uniform float uPulse;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(uColor, vAlpha * uPulse * 0.35);
      }
    `,
  })

  const dVerts = DISC_SEGS + 1
  const dPos = new Float32Array(dVerts * 3)
  const dAlpha = new Float32Array(dVerts)
  const dIdx: number[] = []
  dAlpha[0] = 1.0
  for (let i = 0; i < DISC_SEGS; i++) {
    const a = (i / DISC_SEGS) * Math.PI * 2
    const vi = i + 1
    dPos[vi * 3] = Math.cos(a) * DISC_RADIUS
    dPos[vi * 3 + 2] = Math.sin(a) * DISC_RADIUS
    dAlpha[vi] = 0.0
    dIdx.push(0, vi, (i + 1) % DISC_SEGS + 1)
  }
  const discGeo = new THREE.BufferGeometry()
  discGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3))
  discGeo.setAttribute('aAlpha', new THREE.BufferAttribute(dAlpha, 1))
  discGeo.setIndex(dIdx)

  const discObj = new THREE.Mesh(discGeo, discMat)
  discObj.renderOrder = 998
  discObj.visible = false
  scene.add(discObj)

  // ── Sparkle particles ──

  const sparkleMat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color() } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aOpacity;
      varying float vOpacity;
      void main() {
        vOpacity = aOpacity;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (200.0 / -mv.z);
        gl_Position  = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vOpacity;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.2, d) * vOpacity;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  })

  const sPos = new Float32Array(SPARKLE_COUNT * 3)
  const sSize = new Float32Array(SPARKLE_COUNT)
  const sOpac = new Float32Array(SPARKLE_COUNT)
  const sGeo = new THREE.BufferGeometry()
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3))
  sGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1))
  sGeo.setAttribute('aOpacity', new THREE.BufferAttribute(sOpac, 1))

  const sparkleObj = new THREE.Points(sGeo, sparkleMat)
  sparkleObj.renderOrder = 1000
  sparkleObj.visible = false
  scene.add(sparkleObj)

  interface Spark { ox: number; oz: number; phase: number; speed: number; sz: number }
  const sparks: Spark[] = Array.from({ length: SPARKLE_COUNT }, () => ({
    ox: (Math.random() - 0.5) * GRID_SPAN * 0.9,
    oz: (Math.random() - 0.5) * GRID_SPAN * 0.9,
    phase: Math.random(),
    speed: 0.3 + Math.random() * 0.5,
    sz: 2 + Math.random() * 4,
  }))

  // ── Shared state ──

  let ghostActive = false
  let activeYOffset = 0
  let sparkDir = 1
  let ctrX = 0, ctrY = 0, ctrZ = 0

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

  function buildRibbons(cx: number, cy: number, cz: number, isLower: boolean) {
    const dir = activeYOffset < 0 ? -1 : 1
    const halfSpan = GRID_SPAN * 0.5
    const liftY = isLower ? dir * BUMP_AMP : 0
    const bumpDir = isLower ? -dir : dir

    for (let l = 0; l < LINE_COUNT; l++) {
      const lz = cz - halfSpan + (l / (LINE_COUNT - 1)) * GRID_SPAN
      const base = l * VERTS_PER_LINE
      const lineT = Math.abs((l / (LINE_COUNT - 1)) - 0.5) * 2
      const lineAlpha = 0.85 - lineT * 0.5

      for (let p = 0; p < PTS_PER_LINE; p++) {
        const t = p / (PTS_PER_LINE - 1)
        const lx = cx - halfSpan + t * GRID_SPAN
        const dx = lx - cx
        const dz = lz - cz
        const r = Math.sqrt(dx * dx + dz * dz) / BUMP_RADIUS
        const dy = bumpDir * BUMP_AMP * bump(r)
        const wy = cy + liftY + dy + dir * 0.15

        const dist = Math.sqrt(dx * dx + dz * dz) / (halfSpan * 1.414)
        const edgeFade = 1.0 - Math.pow(Math.abs(t - 0.5) * 2, 3)
        const alpha = lineAlpha * Math.max(edgeFade, 0.08)

        const vi = base + p * 2
        rPos[vi * 3] = lx;     rPos[vi * 3 + 1] = wy; rPos[vi * 3 + 2] = lz - RIBBON_HW
        rPos[(vi+1)*3] = lx; rPos[(vi+1)*3+1] = wy; rPos[(vi+1)*3+2] = lz + RIBBON_HW

        rAlpha[vi] = alpha; rAlpha[vi + 1] = alpha
        rDist[vi] = dist;   rDist[vi + 1] = dist
      }
    }
    rPosAttr.needsUpdate = true
    rAlphaAttr.needsUpdate = true
    rDistAttr.needsUpdate = true
  }

  function showDisplacement(cx: number, cz: number, yOff: number, isRaise: boolean) {
    hideAll()
    activeYOffset = yOff
    const dir = activeYOffset < 0 ? -1 : 1
    sparkDir = isRaise ? dir : -dir
    const c = cellCenter(cx, cz)
    ctrX = c.wx; ctrY = c.wy; ctrZ = c.wz
    const color = isRaise ? raiseColor : lowerColor

    ribbonMat.uniforms.uColor.value.copy(color)
    buildRibbons(c.wx, c.wy, c.wz, !isRaise)
    ribbonObj.visible = true

    discMat.uniforms.uColor.value.copy(color)
    discObj.position.set(c.wx, c.wy + dir * 0.1, c.wz)
    discObj.visible = true

    sparkleMat.uniforms.uColor.value.copy(color)
    for (const s of sparks) s.phase = Math.random()
    sparkleObj.visible = true

    ghostActive = true
  }

  function showRaise(cx: number, cz: number, yOffset = 0) {
    showDisplacement(cx, cz, yOffset, true)
  }

  function showLower(cx: number, cz: number, yOffset = 0) {
    showDisplacement(cx, cz, yOffset, false)
  }

  /* ═══════════════════════════════════════════════════════════════
     Move arc arrow (gradient ribbon with fade-in)  — unchanged
     ═══════════════════════════════════════════════════════════════ */

  const ARC_SEGS = 24
  const MOVE_RIBBON_W = CELL_SIZE * 0.35
  const MOVE_RIBBON_COLOR = new THREE.Color(0xffcc55)

  const moveArcMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    uniforms: { uPulse: { value: 1.0 } },
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

  let moveRibbonMesh: THREE.Mesh | null = null
  const spinePool = Array.from({ length: ARC_SEGS + 1 }, () => new THREE.Vector3())
  let arcActive = false

  function buildMoveRibbonGeo(spine: THREE.Vector3[], perpX: number, perpZ: number) {
    const verts = (ARC_SEGS + 1) * 2
    const positions = new Float32Array(verts * 3)
    const colors = new Float32Array(verts * 4)
    const indices: number[] = []
    const cr = MOVE_RIBBON_COLOR.r, cg = MOVE_RIBBON_COLOR.g, cb = MOVE_RIBBON_COLOR.b

    for (let i = 0; i <= ARC_SEGS; i++) {
      const t = i / ARC_SEGS
      const alpha = Math.min(t * 3, 1.0)
      const taper = 1 - 0.7 * t
      const hw = MOVE_RIBBON_W * 0.5 * Math.max(taper, 0.08)
      const p = spine[i]
      const li = i * 2, ri = li + 1

      positions[li * 3] = p.x - perpX * hw
      positions[li * 3 + 1] = p.y
      positions[li * 3 + 2] = p.z - perpZ * hw
      positions[ri * 3] = p.x + perpX * hw
      positions[ri * 3 + 1] = p.y
      positions[ri * 3 + 2] = p.z + perpZ * hw

      colors[li*4] = cr; colors[li*4+1] = cg; colors[li*4+2] = cb; colors[li*4+3] = alpha
      colors[ri*4] = cr; colors[ri*4+1] = cg; colors[ri*4+2] = cb; colors[ri*4+3] = alpha

      if (i < ARC_SEGS) {
        const a = li, b2 = ri, c2 = li + 2, d = ri + 2
        indices.push(a, c2, b2, b2, c2, d)
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

    const geo = buildMoveRibbonGeo(spinePool, perpX, perpZ)
    moveRibbonMesh = new THREE.Mesh(geo, moveArcMat)
    moveRibbonMesh.renderOrder = 998
    scene.add(moveRibbonMesh)
    arcActive = true
  }

  /* ═══════════════════════════════════════════════════════════════
     Common: hide / update / dispose
     ═══════════════════════════════════════════════════════════════ */

  function removeMoveRibbon() {
    if (moveRibbonMesh) {
      scene.remove(moveRibbonMesh)
      moveRibbonMesh.geometry.dispose()
      moveRibbonMesh = null
    }
  }

  function hideAll() {
    ribbonObj.visible = false
    discObj.visible = false
    sparkleObj.visible = false
    ghostActive = false
    removeMoveRibbon()
    arcActive = false
  }

  function update(dt: number) {
    time += dt

    if (ghostActive) {
      ribbonMat.uniforms.uTime.value = time

      const pulse = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(time * 2.5))
      discMat.uniforms.uPulse.value = pulse

      const sp = sGeo.attributes.position as THREE.BufferAttribute
      const ss = sGeo.attributes.aSize as THREE.BufferAttribute
      const so = sGeo.attributes.aOpacity as THREE.BufferAttribute

      for (let i = 0; i < SPARKLE_COUNT; i++) {
        const s = sparks[i]
        s.phase += dt * s.speed
        if (s.phase > 1) {
          s.phase -= 1
          s.ox = (Math.random() - 0.5) * GRID_SPAN * 0.9
          s.oz = (Math.random() - 0.5) * GRID_SPAN * 0.9
        }
        sPos[i * 3] = ctrX + s.ox
        sPos[i * 3 + 1] = ctrY + sparkDir * s.phase * SPARKLE_MAX_H
        sPos[i * 3 + 2] = ctrZ + s.oz
        sSize[i] = s.sz
        sOpac[i] = Math.sin(s.phase * Math.PI) * 0.6
      }
      sp.needsUpdate = true
      ss.needsUpdate = true
      so.needsUpdate = true
    }

    if (arcActive) {
      const pulse = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(time * 3))
      moveArcMat.uniforms.uPulse.value = pulse
    }
  }

  function dispose() {
    scene.remove(ribbonObj)
    rGeo.dispose()
    ribbonMat.dispose()

    scene.remove(discObj)
    discGeo.dispose()
    discMat.dispose()

    scene.remove(sparkleObj)
    sGeo.dispose()
    sparkleMat.dispose()

    removeMoveRibbon()
    moveArcMat.dispose()
  }

  return { showRaise, showLower, showMove, hide: hideAll, update, dispose }
}
