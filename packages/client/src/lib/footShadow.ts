import * as THREE from 'three'
import { CELL_SIZE, THICKNESS } from './constants'
import { LOOK } from './look'
import type { TerrainState } from './terrain'

/**
 * Contact shadow under each character: a soft ellipse that hugs the terrain
 * (built like the player ring in lib/player.ts), elongated along the same axis
 * the baked block shadows fall on (lib/terrainShade.ts uses the same SUN for
 * both faces, so the underside shares the axis). Gives the figure weight
 * without a shadow map. Vertices are rebuilt only when the character's
 * position, surface or the terrain changed — nothing at rest.
 */
type PlayerRef = {
  state: { cx: number; cz: number }
  mesh: THREE.Object3D
  surface: 'top' | 'bottom'
}

const RINGS = 3
const SEGS = 24
const LIFT = 0.06
/** World units of lift at which the shadow has faded out entirely. */
const FADE_LIFT = 2.5

/** Unit horizontal direction the sun's shadows fall along: away from the sun. */
export function shadowAxis(): [number, number] {
  const [x, , z] = LOOK.sun.direction
  const h = Math.hypot(x, z)
  return [-x / h, -z / h]
}

/** Alpha at normalised radius t (0 centre → 1 rim): a smooth (1 − t)² falloff. */
export function footAlpha(t: number): number {
  const u = Math.max(0, 1 - t)
  return LOOK.foot.opacity * u * u
}

/** 1 on the ground → 0 at FADE_LIFT world units above (or below, on the underside). */
export function liftFade(lift: number): number {
  return Math.max(0, 1 - lift / FADE_LIFT)
}

export function createFootShadows(scene: THREE.Scene, terrain: TerrainState) {
  const [axisX, axisZ] = shadowAxis()
  const perpX = -axisZ, perpZ = axisX
  const across = LOOK.foot.across * CELL_SIZE
  const along = LOOK.foot.along * CELL_SIZE
  const offset = LOOK.foot.offset * CELL_SIZE
  const color = new THREE.Color(LOOK.foot.color)   // sRGB hex → linear, like every THREE.Color

  const vertCount = 1 + RINGS * SEGS
  const index: number[] = []
  for (let s = 0; s < SEGS; s++) {
    // fan: centre → ring 1
    index.push(0, 1 + s, 1 + ((s + 1) % SEGS))
    for (let r = 1; r < RINGS; r++) {
      const a = 1 + (r - 1) * SEGS + s
      const b = 1 + (r - 1) * SEGS + ((s + 1) % SEGS)
      const c = 1 + r * SEGS + s
      const d = 1 + r * SEGS + ((s + 1) % SEGS)
      index.push(a, c, b, b, c, d)
    }
  }

  function makeShadow() {
    const positions = new Float32Array(vertCount * 3)
    const colors = new Float32Array(vertCount * 4)
    // Colour and alpha are fixed per vertex; only positions move.
    colors.set([color.r, color.g, color.b, footAlpha(0)], 0)
    for (let r = 1; r <= RINGS; r++) {
      const a = footAlpha(r / RINGS)
      for (let s = 0; s < SEGS; s++) colors.set([color.r, color.g, color.b, a], (1 + (r - 1) * SEGS + s) * 4)
    }
    const geo = new THREE.BufferGeometry()
    const posAttr = new THREE.BufferAttribute(positions, 3)
    geo.setAttribute('position', posAttr)
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 4))   // itemSize 4: vertex alpha
    geo.setIndex(index)
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = 'footShadow'
    mesh.renderOrder = 995   // under the player ring (996)
    mesh.visible = false
    scene.add(mesh)
    return { mesh, mat, posAttr, positions, lastX: NaN, lastZ: NaN, lastSurface: '' as string, lastVersion: -1 }
  }

  const shadows = [makeShadow(), makeShadow()]
  let refs: [PlayerRef | null, PlayerRef | null] = [null, null]

  function rebuild(sh: ReturnType<typeof makeShadow>, wx: number, wz: number, surface: 'top' | 'bottom') {
    const yOff = surface === 'bottom' ? -THICKNESS - LIFT : LIFT
    const cx = wx + axisX * offset
    const cz = wz + axisZ * offset
    const p = sh.positions
    p[0] = cx; p[1] = terrain.getHeight(cx, cz) + yOff; p[2] = cz
    for (let r = 1; r <= RINGS; r++) {
      const t = r / RINGS
      for (let s = 0; s < SEGS; s++) {
        const ang = (s / SEGS) * Math.PI * 2
        const u = Math.cos(ang) * across * t
        const v = Math.sin(ang) * along * t
        const x = cx + perpX * u + axisX * v
        const z = cz + perpZ * u + axisZ * v
        const o = (1 + (r - 1) * SEGS + s) * 3
        p[o] = x; p[o + 1] = terrain.getHeight(x, z) + yOff; p[o + 2] = z
      }
    }
    sh.posAttr.needsUpdate = true
  }

  function updateOne(sh: ReturnType<typeof makeShadow>, ref: PlayerRef | null) {
    if (!ref || !ref.mesh.visible) { sh.mesh.visible = false; return }
    const wx = ref.mesh.position.x, wz = ref.mesh.position.z
    const groundY = terrain.getHeight(wx, wz) + (ref.surface === 'bottom' ? -THICKNESS : 0)
    const fade = liftFade(Math.abs(ref.mesh.position.y - groundY))
    sh.mat.opacity = fade
    sh.mesh.visible = fade > 0.01
    if (!sh.mesh.visible) return
    if (wx !== sh.lastX || wz !== sh.lastZ || ref.surface !== sh.lastSurface || terrain.version !== sh.lastVersion) {
      rebuild(sh, wx, wz, ref.surface)
      sh.lastX = wx; sh.lastZ = wz; sh.lastSurface = ref.surface; sh.lastVersion = terrain.version
    }
  }

  return {
    setPlayerRefs(a: PlayerRef, b: PlayerRef) { refs = [a, b] },
    update(_dt: number) {
      updateOne(shadows[0], refs[0])
      updateOne(shadows[1], refs[1])
    },
    dispose() {
      for (const sh of shadows) {
        scene.remove(sh.mesh)
        sh.mesh.geometry.dispose()
        sh.mat.dispose()
      }
    },
  }
}

export type FootShadowSystem = ReturnType<typeof createFootShadows>
