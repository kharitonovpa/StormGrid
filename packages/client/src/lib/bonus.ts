import * as THREE from 'three'
import type { BonusCell } from '@wheee/shared'
import { HALF, CELL_SIZE, THICKNESS } from './constants'
import type { TerrainState } from './terrain'

/**
 * The crystal that seeds a streak badge.
 *
 * It is a single cluster driven through the slab like an iceberg: half of it
 * stands above one face, half below the other. Both players are looking at the
 * same object from opposite sides, each seeing their own half grow out of the
 * ground — which is the only honest way to show one shared thing on a
 * two-sided board.
 *
 * A ruby: deep red, glassy, lit from inside, and thick enough to hold a
 * silhouette. Red is also the colour furthest from the board's greens, so the
 * stone never sinks into the grass. Only the thin hoop on the ground says whose
 * it is — bright on the side of the player who may collect it, a whisper on the
 * other.
 */

/** How far the crystal stands out of each face. */
const REACH = CELL_SIZE * 0.28
/** Body radius. Thin spikes read as paper; a ruby wants heft. */
const CORE_R = CELL_SIZE * 0.115

const SPIN_HZ = 0.055
const BOB_HZ = 0.3
const BOB_AMP = CELL_SIZE * 0.035
const PULSE_HZ = 0.38
const RIPPLE_PERIOD = 3.0
const RIPPLE_DUR = 1.7

const SPARK_COUNT = 6
const SPARK_ORBIT = CELL_SIZE * 0.27

/** Named once so the take animation cannot drift away from the resting look. */
const GEM_OPACITY = 0.88
const HALO_OPACITY = 0.42
const SPARK_OPACITY = 0.85

/**
 * Ruby: a deep red body lit from inside, with pale pink where the light leaves
 * it. Red also sits furthest from the board's greens, so the stone never sinks
 * into the grass the way the cold blue did.
 */
const RUBY = {
  core: 0xb00f2e,
  glow: 0x7d0620,
  halo: 0xff7f96,
  /**
   * The hoop keeps its own tone. Drawn in the stone's deep red it read as dried
   * blood and pushed the eye away — the opposite of an invitation to walk over.
   */
  hoop: 0xffa3b4,
}
const DIM = { core: 0x8a5560, glow: 0x2a1017, halo: 0x7a5a62 }

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grd.addColorStop(0, inner)
  grd.addColorStop(0.35, outer)
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(c)
}

/**
 * A pocket sky for the stone alone.
 *
 * The game lights everything with two lamps and no environment, so a physical
 * glass material had nothing to reflect or refract and came out as flat paint.
 * Rather than hang an environment on the whole scene — which would repaint the
 * terrain, the crops and the water — the gem carries its own tiny cube: bright
 * overhead, dark below, meadow around. That is all the facets need to come alive.
 */
function pocketSky(): THREE.CubeTexture {
  const S = 64
  const face = (top: string, bottom: string) => {
    const c = document.createElement('canvas')
    c.width = c.height = S
    const g = c.getContext('2d')!
    const grd = g.createLinearGradient(0, 0, 0, S)
    grd.addColorStop(0, top)
    grd.addColorStop(1, bottom)
    g.fillStyle = grd
    g.fillRect(0, 0, S, S)
    return c
  }
  const side = () => face('#cfe3ff', '#3d5a33')
  const tex = new THREE.CubeTexture([
    side(), side(),
    face('#ffffff', '#dbeaff'),   // sky above: the key highlight
    face('#24361c', '#101a0c'),   // ground below: keeps the underside deep
    side(), side(),
  ])
  tex.needsUpdate = true
  return tex
}

/**
 * A double-terminated crystal: hexagonal body tapering to a point at both ends,
 * the way quartz grows when nothing is holding it. Lathing a profile gives the
 * flat faces for free — a stretched octahedron read as a paper triangle, because
 * its thin ends all but vanish behind the glass.
 */
function shardGeometry(radius: number, length: number): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0.0001, -length),
    new THREE.Vector2(radius * 0.55, -length * 0.62),
    new THREE.Vector2(radius, -length * 0.20),
    new THREE.Vector2(radius, length * 0.22),
    new THREE.Vector2(radius * 0.58, length * 0.66),
    new THREE.Vector2(0.0001, length),
  ]
  const geo = new THREE.LatheGeometry(profile, 6)
  geo.computeVertexNormals()
  return geo
}

export function createBonusSystem(scene: THREE.Scene, terrain: TerrainState) {
  const group = new THREE.Group()
  group.visible = false
  scene.add(group)

  /** Everything that pierces the slab, spun as one. */
  const cluster = new THREE.Group()
  group.add(cluster)

  const sky = pocketSky()

  const shardMat = new THREE.MeshPhysicalMaterial({
    color: RUBY.core,
    // Kept low on purpose: a strong inner glow flattens the facets into matte
    // plastic. The stone should be shaped by the light in the scene, not by its
    // own light.
    emissive: RUBY.glow,
    emissiveIntensity: 0.18,
    metalness: 0,
    roughness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    // No `transmission`: it needs its own render pass, and with the slab going
    // translucent on a decisive storm the two fight over draw order. The gem
    // reads as stone from the facet highlights and a little depth instead —
    // cheaper, and it cannot break the glass reveal.
    ior: 1.77,
    transparent: true,
    opacity: GEM_OPACITY,
    depthWrite: true,
    specularIntensity: 1,
    flatShading: true,
    envMap: sky,
    envMapIntensity: 1.6,
  })

  // One tall spine through the middle, a few smaller ones leaning off it.
  const shardSpecs = [
    { r: CORE_R * 1.0, len: REACH + THICKNESS * 0.5, x: 0, z: 0, tiltX: 0, tiltZ: 0 },
    { r: CORE_R * 0.55, len: REACH * 0.68, x: CORE_R * 1.6, z: CORE_R * 0.6, tiltX: 0.08, tiltZ: -0.26 },
    { r: CORE_R * 0.46, len: REACH * 0.56, x: -CORE_R * 1.5, z: CORE_R * 1.2, tiltX: -0.22, tiltZ: 0.18 },
  ]
  const shardGeos: THREE.BufferGeometry[] = []
  for (const s of shardSpecs) {
    const geo = shardGeometry(s.r, s.len)
    shardGeos.push(geo)
    const mesh = new THREE.Mesh(geo, shardMat)
    mesh.position.set(s.x, -THICKNESS / 2, s.z)
    mesh.rotation.set(s.tiltX, Math.random() * Math.PI, s.tiltZ)
    cluster.add(mesh)
  }

  // Halo at each exit point, so the glow reads from either side of the slab.
  const haloTex = radialTexture('rgba(255,190,205,0.95)', 'rgba(230,50,85,0.5)')
  const haloMat = new THREE.SpriteMaterial({
    map: haloTex,
    color: RUBY.halo,
    transparent: true,
    opacity: HALO_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const haloTop = new THREE.Sprite(haloMat)
  const haloBottom = new THREE.Sprite(haloMat)
  haloTop.scale.setScalar(CELL_SIZE * 0.62)
  haloBottom.scale.setScalar(CELL_SIZE * 0.62)
  group.add(haloTop, haloBottom)

  const sparkTex = radialTexture('rgba(255,225,232,1)', 'rgba(240,90,125,0.65)')
  const sparkMat = new THREE.SpriteMaterial({
    map: sparkTex,
    color: RUBY.halo,
    transparent: true,
    opacity: SPARK_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const sparks: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; phase: number; speed: number; lift: number }[] = []
  for (let i = 0; i < SPARK_COUNT; i++) {
    // Each spark owns its material: sharing one made them all twinkle in step,
    // because the last one written each frame decided the opacity for everybody.
    const mat = sparkMat.clone()
    const sprite = new THREE.Sprite(mat)
    sprite.scale.setScalar(CELL_SIZE * 0.07)
    group.add(sprite)
    sparks.push({
      sprite,
      mat,
      phase: (i / SPARK_COUNT) * Math.PI * 2,
      speed: 0.19 + (i % 3) * 0.06,
      // Half of them drift under the slab, so the other side is not bare.
      lift: i % 2 === 0 ? 1 : -1,
    })
  }

  /** A hairline hoop: it marks the cell without drawing a target on it. */
  function makeHoop(inner: number, outer: number, opacity: number) {
    const geo = new THREE.RingGeometry(CELL_SIZE * inner, CELL_SIZE * outer, 64)
    const mat = new THREE.MeshBasicMaterial({
      color: RUBY.hoop,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    group.add(mesh)
    return { mesh, geo, mat }
  }

  const hoopTop = makeHoop(0.285, 0.300, 0.55)
  const hoopBottom = makeHoop(0.285, 0.300, 0.55)
  const ripple = makeHoop(0.26, 0.272, 0)

  let cell: BonusCell | null = null
  let mine = false
  let time = 0
  let takeT = -1

  function applyLook() {
    // An unaddressed crate is a race both players can win, so it burns brightly
    // on both faces. An addressed one is lit only on its owner's side.
    const shared = !cell?.for
    const c = mine ? RUBY : DIM
    shardMat.color.setHex(c.core)
    shardMat.emissive.setHex(c.glow)
    haloMat.color.setHex(c.halo)
    sparkMat.color.setHex(c.halo)
    for (const s of sparks) s.mat.color.setHex(c.halo)
    hoopTop.mat.color.setHex(RUBY.hoop)
    hoopBottom.mat.color.setHex(RUBY.hoop)
    hoopTop.mat.opacity = shared || mine ? 0.6 : 0.12
    hoopBottom.mat.opacity = shared || !mine ? 0.6 : 0.12
    ripple.mesh.visible = shared || mine
  }

  function reposition() {
    if (!cell) return
    const wx = -HALF + (cell.x + 0.5) * CELL_SIZE
    const wz = -HALF + (cell.y + 0.5) * CELL_SIZE
    const topY = terrain.getHeight(wx, wz)
    group.position.set(wx, topY, wz)
    // Anchored to the near face; the cluster reaches through to the far one.
    hoopTop.mesh.position.y = 0.05
    hoopBottom.mesh.position.y = -THICKNESS - 0.05
    ripple.mesh.position.y = 0.06
    haloTop.position.y = REACH * 0.55
    haloBottom.position.y = -THICKNESS - REACH * 0.55
  }

  return {
    setBonus(next: BonusCell | null, isMine: boolean) {
      if (!next && takeT >= 0) return
      cell = next
      mine = isMine
      group.visible = next !== null
      takeT = -1
      group.scale.setScalar(1)
      if (next) { applyLook(); reposition() }
    },

    /** Collected: pull it into the ground and let it flare out. */
    playTake() {
      if (!group.visible) return
      takeT = 0
    },

    update(dt: number) {
      if (!group.visible) return
      time += dt

      if (takeT >= 0) {
        takeT += dt
        const k = Math.min(1, takeT / 0.5)
        const s = k < 0.35 ? 1 - k * 1.5 : 0.48 + (k - 0.35) * 3.0
        group.scale.setScalar(Math.max(0.01, s))
        const fade = 1 - k
        shardMat.opacity = GEM_OPACITY * fade
        haloMat.opacity = HALO_OPACITY * fade
        for (const s of sparks) s.mat.opacity = SPARK_OPACITY * fade
        hoopTop.mat.opacity *= 0.9
        hoopBottom.mat.opacity *= 0.9
        if (k >= 1) {
          group.visible = false
          takeT = -1
          cell = null
          group.scale.setScalar(1)
          shardMat.opacity = GEM_OPACITY
          haloMat.opacity = HALO_OPACITY
          for (const s of sparks) s.mat.opacity = SPARK_OPACITY
        }
        return
      }

      if (!cell) return

      // Turning slowly and rising and settling on a different clock, so the two
      // motions never sync into an obvious loop.
      cluster.rotation.y = time * SPIN_HZ * Math.PI * 2
      const bob = Math.sin(time * BOB_HZ * Math.PI * 2) * BOB_AMP
      cluster.position.y = bob
      const pulse = Math.sin(time * PULSE_HZ * Math.PI * 2)
      shardMat.emissiveIntensity = (mine ? 0.62 : 0.16) + pulse * (mine ? 0.24 : 0.05)
      haloMat.opacity = 0.34 + pulse * 0.14
      const hs = CELL_SIZE * (0.58 + pulse * 0.06)
      haloTop.scale.setScalar(hs)
      haloBottom.scale.setScalar(hs)

      for (const s of sparks) {
        const a = time * s.speed * Math.PI * 2 + s.phase
        s.sprite.position.set(
          Math.cos(a) * SPARK_ORBIT,
          s.lift * (REACH * 0.35 + Math.sin(a * 1.6) * REACH * 0.3) - (s.lift < 0 ? THICKNESS : 0),
          Math.sin(a) * SPARK_ORBIT,
        )
        const tw = 0.3 + 0.7 * Math.abs(Math.sin(a * 2.1 + s.phase))
        s.mat.opacity = tw * (mine ? 1 : 0.25)
        s.sprite.scale.setScalar(CELL_SIZE * (0.05 + tw * 0.04))
      }

      if (mine) {
        const rt = (time % RIPPLE_PERIOD) / RIPPLE_DUR
        if (rt <= 1) {
          ripple.mesh.scale.setScalar(1 + rt * 2.1)
          ripple.mat.opacity = 0.45 * (1 - rt) * (1 - rt)
        } else {
          ripple.mat.opacity = 0
        }
      }

      reposition()
    },

    dispose() {
      scene.remove(group)
      for (const g of shardGeos) g.dispose()
      shardMat.dispose(); sky.dispose()
      haloMat.dispose(); haloTex.dispose()
      sparkMat.dispose(); sparkTex.dispose()
      for (const s of sparks) s.mat.dispose()
      for (const h of [hoopTop, hoopBottom, ripple]) { h.geo.dispose(); h.mat.dispose() }
    },
  }
}

export type BonusSystem = ReturnType<typeof createBonusSystem>
