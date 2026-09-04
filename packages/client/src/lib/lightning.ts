import * as THREE from 'three'
import { CELL_SIZE } from './constants'
import type { TerrainState } from './terrain'

/**
 * The bolt, in two acts — the way the real thing works. A stepped leader creeps
 * down from the cloud, thin and dim; the instant it touches, the whole channel
 * lights up at once. Everything loud belongs to that instant, which is what
 * `onTouchdown` is for: sound stays with the caller, this file only knows when the
 * ground was reached.
 *
 * All of it is additive light on a local scale — ribbons, a PointLight over the
 * struck cell, a spark burst. Nothing dims, darkens or chars: the board the player
 * reads has to look exactly the same once the flash is over, and a full-screen
 * white-out is both unreadable and unkind to anyone who asked for less motion.
 *
 * Every distance is a multiple of `CELL_SIZE` — a cell is ~8.6 world units wide, so
 * anything written in bare units comes out a few pixels tall and the centrepiece of
 * the storm reads as a board that merely flickered.
 *
 * The strands are built the way `preview.ts` builds the move arc: one flat ribbon
 * per strand, a single perpendicular for the whole thing, per-vertex alpha, drawn
 * with `depthTest: false` and a high render order. That recipe is what keeps the
 * bolt legible at scene scale instead of dissolving into mismatched quads. The
 * perpendicular faces the camera as of the moment of the strike — the bolt lives
 * half a second, so the camera cannot turn away from it — and the fragment shader
 * fades each ribbon from a near-white centreline to a transparent blue edge, which
 * buys a volumetric glow with no post-processing at all.
 */

/** Cloud base: high enough to clear the tallest terrain and the camera's framing. */
const SKY_Y = 4.5 * CELL_SIZE
const SEGMENTS = 5                        // midpoint-displacement depth → 2^5 spans
/** Act one: the leader, barely there. */
const LEADER_W = 0.1 * CELL_SIZE
const LEADER_ALPHA = 0.65
const LEADER_MS = 200
/** Act two: the return stroke, the whole channel at once. */
const CORE_W = 0.18 * CELL_SIZE
const GLOW_W = CORE_W * 3
const GLOW_ALPHA = 0.32
/** The wide pass lingers a moment after the core cuts out. */
const AFTERGLOW_S = 0.15
/** How far the first midpoints wander; halves and a bit with every subdivision. */
const JITTER = 0.5 * CELL_SIZE
/** Where the strand leaves the cloud, relative to the cell it is aimed at. */
const ORIGIN_SPREAD = CELL_SIZE
const FORKS = 3
const FORK_SPREAD = 0.8 * CELL_SIZE
const FORK_ALPHA = 0.55
/** Forks only start showing once the leader is most of the way down. */
const FORK_REVEAL_FROM = 0.7
/** Light reaching about half the board, so the struck cell has a lit surround. */
const LIGHT_RANGE = 4.2 * CELL_SIZE
const LIGHT_PEAK = 26
const LIGHT_LEADER = 6
/**
 * Impact sparks. A ballistic spray only keeps its shape if speeds and gravity are
 * scaled together with the distances, so one factor drives all three.
 */
const SPARK_SCALE = 0.4 * CELL_SIZE
const SPARK_SIZE = 0.09 * CELL_SIZE
const SPARK_LIFE = 0.7
const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Jagged strand from sky to target via midpoint displacement. */
function makeStrand(from: THREE.Vector3, to: THREE.Vector3, jitter: number): THREE.Vector3[] {
  let pts = [from.clone(), to.clone()]
  for (let d = 0; d < SEGMENTS; d++) {
    const next: THREE.Vector3[] = [pts[0]]
    for (let i = 1; i < pts.length; i++) {
      const mid = pts[i - 1].clone().add(pts[i]).multiplyScalar(0.5)
      mid.x += (Math.random() - 0.5) * jitter
      mid.z += (Math.random() - 0.5) * jitter
      next.push(mid, pts[i])
    }
    pts = next
    jitter *= 0.55
  }
  return pts
}

/**
 * Flat ribbon along a jagged spine, `buildMoveRibbonGeo` style: one perpendicular
 * for the whole ribbon, alpha in the vertex data. `aSide` carries the cross-ribbon
 * coordinate the shader fades on; `aAlpha` ramps in from the top so the strand
 * emerges out of the sky instead of ending on a cut line, and tapers a little
 * toward the impact. Vertices run top to bottom, which is what lets a growing draw
 * range walk the bolt down to the ground.
 */
function strandRibbon(
  spine: THREE.Vector3[], width: number, alpha: number, perpX: number, perpZ: number,
): THREE.BufferGeometry {
  const spans = spine.length - 1
  const positions = new Float32Array(spine.length * 2 * 3)
  const sides = new Float32Array(spine.length * 2)
  const alphas = new Float32Array(spine.length * 2)
  const indices: number[] = []

  for (let i = 0; i < spine.length; i++) {
    const t = i / spans
    const a = Math.min(t * 5, 1) * alpha
    const hw = width * 0.5 * (1 - 0.3 * t)
    const p = spine[i]
    const li = i * 2, ri = li + 1

    positions[li * 3] = p.x - perpX * hw
    positions[li * 3 + 1] = p.y
    positions[li * 3 + 2] = p.z - perpZ * hw
    positions[ri * 3] = p.x + perpX * hw
    positions[ri * 3 + 1] = p.y
    positions[ri * 3 + 2] = p.z + perpZ * hw

    sides[li] = -1
    sides[ri] = 1
    alphas[li] = a
    alphas[ri] = a

    if (i < spans) indices.push(li, li + 2, ri, ri, li + 2, ri + 2)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aSide', new THREE.BufferAttribute(sides, 1))
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1))
  geo.setIndex(indices)
  return geo
}

/**
 * Ribbon material: near-white centreline bleeding out to a transparent edge.
 * `uFlash` is the strength of the moment — the leader holds it at 1 and carries its
 * dimness in the vertex alpha, the return stroke drives it per flash.
 */
function ribbonMaterial(core: number, edge: number, falloff: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uFlash: { value: 1 },
      uCore: { value: new THREE.Color(core) },
      uEdge: { value: new THREE.Color(edge) },
      uFalloff: { value: falloff },
    },
    vertexShader: /* glsl */ `
      attribute float aSide;
      attribute float aAlpha;
      varying float vSide;
      varying float vAlpha;
      void main() {
        vSide = aSide;
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFlash;
      uniform vec3 uCore;
      uniform vec3 uEdge;
      uniform float uFalloff;
      varying float vSide;
      varying float vAlpha;
      void main() {
        float d = clamp(abs(vSide), 0.0, 1.0);
        float fall = pow(1.0 - smoothstep(0.0, 1.0, d), uFalloff);
        gl_FragColor = vec4(mix(uCore, uEdge, d), vAlpha * fall * uFlash);
      }
    `,
  })
}

export function createLightningSystem(scene: THREE.Scene, camera: THREE.Camera) {
  const group = new THREE.Group()
  group.visible = false
  scene.add(group)

  const leaderMat = ribbonMaterial(0xdbe9ff, 0x5f8fd8, 1.0)
  const coreMat = ribbonMaterial(0xf4faff, 0x9cc8ff, 1.0)
  const glowMat = ribbonMaterial(0x86b8ff, 0x14294f, 2.0)
  const light = new THREE.PointLight(0xbfd8ff, 0, LIGHT_RANGE, 1.6)
  scene.add(light)

  const sparkGeo = new THREE.BufferGeometry()
  const sparkPos = new Float32Array(40 * 3)
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3))
  // Signal colour: opt out of the scene's tone mapping so it renders exactly as authored.
  const sparkMat = new THREE.PointsMaterial({
    color: 0xcfe4ff, size: SPARK_SIZE, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  })
  const sparks = new THREE.Points(sparkGeo, sparkMat)
  scene.add(sparks)
  let sparkVel: THREE.Vector3[] = []
  let sparkLife = 0

  type Strand = { spans: number; fork: boolean; leader: THREE.Mesh; core: THREE.Mesh; glow: THREE.Mesh }
  let strands: Strand[] = []
  let afterglow = 0

  /**
   * One bolt at a time. A round reset or a replay scrub can start the next strike
   * while an old one is still mid-descent, and the stale one must not leave its
   * ribbons lit on screen.
   */
  let strikeToken = 0
  let disposed = false

  function clearGroup() {
    group.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose() })
    group.clear()
    strands = []
  }

  function addStrand(spine: THREE.Vector3[], perpX: number, perpZ: number, scale: number, alpha: number, fork: boolean) {
    const mk = (w: number, a: number, mat: THREE.ShaderMaterial, order: number) => {
      const mesh = new THREE.Mesh(strandRibbon(spine, w * scale, a, perpX, perpZ), mat)
      mesh.renderOrder = order
      mesh.frustumCulled = false
      group.add(mesh)
      return mesh
    }
    strands.push({
      spans: spine.length - 1,
      fork,
      glow: mk(GLOW_W, GLOW_ALPHA * alpha, glowMat, 1000),
      leader: mk(LEADER_W, LEADER_ALPHA * alpha, leaderMat, 1001),
      core: mk(CORE_W, alpha, coreMat, 1002),
    })
  }

  function build(target: THREE.Vector3) {
    clearGroup()
    afterglow = 0
    // Perpendicular to the line of sight, in the horizontal plane: the widest the
    // ribbon can face the camera, whatever azimuth the board is watched from.
    const vx = target.x - camera.position.x
    const vz = target.z - camera.position.z
    const vlen = Math.hypot(vx, vz) || 1
    const perpX = -vz / vlen
    const perpZ = vx / vlen

    const from = new THREE.Vector3(
      target.x + (Math.random() - 0.5) * ORIGIN_SPREAD,
      SKY_Y,
      target.z + (Math.random() - 0.5) * ORIGIN_SPREAD,
    )
    const main = makeStrand(from, target, JITTER)
    addStrand(main, perpX, perpZ, 1, 1, false)
    for (let f = 0; f < FORKS; f++) {
      const at = main[Math.floor(main.length * (0.25 + Math.random() * 0.4))]
      const tip = at.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * FORK_SPREAD,
        -(1 + Math.random()) * CELL_SIZE,
        (Math.random() - 0.5) * FORK_SPREAD,
      ))
      // Nothing draws depth here, so a fork that overshoots the ground would lie
      // across the grass like a scratch on the lens. They stop at the struck cell.
      tip.y = Math.max(tip.y, target.y)
      addStrand(makeStrand(at, tip, JITTER * 0.5), perpX, perpZ, 0.5, FORK_ALPHA, true)
    }
    light.position.copy(target).setY(target.y + 0.2 * CELL_SIZE)
  }

  /** Act one: only the leader is drawn, and only as far down as it has crept. */
  function showLeader(p: number) {
    const forkP = Math.max(0, (p - FORK_REVEAL_FROM) / (1 - FORK_REVEAL_FROM))
    for (const s of strands) {
      const grown = s.fork ? forkP : p
      s.leader.visible = grown > 0
      s.leader.geometry.setDrawRange(0, Math.ceil(s.spans * Math.min(grown, 1)) * 6)
      s.core.visible = false
      s.glow.visible = false
    }
    group.visible = true
    light.intensity = LIGHT_LEADER * p
  }

  /** Act two: the whole channel, all at once. */
  function showChannel(strength: number) {
    for (const s of strands) {
      s.leader.visible = false
      for (const m of [s.core, s.glow]) {
        m.visible = true
        m.geometry.setDrawRange(0, Infinity)
      }
    }
    group.visible = true
    coreMat.uniforms.uFlash.value = strength
    glowMat.uniforms.uFlash.value = strength
    light.intensity = LIGHT_PEAK * strength
  }

  function startAfterglow() {
    for (const s of strands) s.core.visible = false
    afterglow = AFTERGLOW_S
    light.intensity = 0
  }

  const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

  /**
   * The leader descends for ~200 ms, then `onTouchdown` fires on the same frame the
   * channel lights up. Return-stroke flashes: 120ms on, 60 off, 90 on (re-struck),
   * 60 off, 70 on weaker — three at most, counted from touchdown.
   */
  async function strike(
    cell: { x: number; y: number },
    terrain: TerrainState,
    onTouchdown?: () => void,
  ): Promise<void> {
    if (disposed) return
    const token = ++strikeToken
    const stale = () => disposed || token !== strikeToken
    // Same placement math as player.ts — players stand on cell centres, so the
    // bolt lands where the crown that drew it was standing.
    const target = terrain.cellTopWorld(cell.x, cell.y)
    const flashes: [number, number][] = REDUCED ? [[140, 0.7]] : [[120, 1], [90, 0.85], [70, 0.6]]
    build(target)

    // Act one. Skipped outright for anyone who asked for less motion: they get the
    // channel and the crack, with no crawling line first.
    if (!REDUCED) {
      const t0 = performance.now()
      for (;;) {
        const p = Math.min((performance.now() - t0) / LEADER_MS, 1)
        showLeader(p)
        if (p >= 1) break
        await wait(16)
        if (stale()) return
      }
    }

    // Touchdown. Everything loud happens on this frame.
    onTouchdown?.()
    burst(target)
    for (let i = 0; i < flashes.length; i++) {
      const [ms, strength] = flashes[i]
      if (i > 0) {
        await wait(60)
        if (stale()) return
        build(target)
      }
      showChannel(strength)
      await wait(ms)
      if (stale()) return
      if (i === flashes.length - 1) {
        startAfterglow()
      } else {
        group.visible = false
        light.intensity = 0
      }
    }
  }

  function burst(target: THREE.Vector3) {
    sparkVel = []
    for (let i = 0; i < 40; i++) {
      sparkPos.set([target.x, target.y, target.z], i * 3)
      sparkVel.push(new THREE.Vector3(
        (Math.random() - 0.5) * 6 * SPARK_SCALE,
        (2 + Math.random() * 5) * SPARK_SCALE,
        (Math.random() - 0.5) * 6 * SPARK_SCALE,
      ))
    }
    sparkGeo.attributes.position.needsUpdate = true
    sparkMat.opacity = 0.9
    sparkLife = SPARK_LIFE
  }

  return {
    strike,
    update(dt: number) {
      if (afterglow > 0) {
        afterglow = Math.max(0, afterglow - dt)
        glowMat.uniforms.uFlash.value = (afterglow / AFTERGLOW_S) * 0.45
        if (afterglow === 0) {
          group.visible = false
          glowMat.uniforms.uFlash.value = 1
        }
      }
      if (sparkLife <= 0) return
      sparkLife -= dt
      for (let i = 0; i < sparkVel.length; i++) {
        sparkVel[i].y -= 9 * SPARK_SCALE * dt
        sparkPos[i * 3] += sparkVel[i].x * dt
        sparkPos[i * 3 + 1] += sparkVel[i].y * dt
        sparkPos[i * 3 + 2] += sparkVel[i].z * dt
      }
      sparkGeo.attributes.position.needsUpdate = true
      sparkMat.opacity = Math.max(0, sparkLife / SPARK_LIFE) * 0.9
    },
    dispose() {
      disposed = true
      scene.remove(group, light, sparks)
      clearGroup()
      leaderMat.dispose(); coreMat.dispose(); glowMat.dispose()
      sparkGeo.dispose(); sparkMat.dispose()
    },
  }
}
