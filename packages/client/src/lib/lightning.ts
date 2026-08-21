import * as THREE from 'three'
import type { TerrainState } from './terrain'

/**
 * The bolt. Everything here is additive light on a local scale — a PointLight over
 * the struck cell and a few glowing ribbons. Nothing dims, darkens or chars: the
 * board the player reads has to look exactly the same once the flash is over, and
 * a full-screen white-out is both unreadable and unkind to anyone who asked for
 * less motion.
 */

/** Cloud base. The strand is drawn from here down to the cell it hits. */
const SKY_Y = 9
const SEGMENTS = 6           // midpoint-displacement depth → 2^6 points
const RIBBON_W = 0.14
const FORKS = 3
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

/** Camera-facing ribbon for one strand: two triangles per segment, additive. */
function strandGeometry(pts: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const verts: number[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    // horizontal side vector is enough — the bolt is near-vertical
    const side = new THREE.Vector3(b.z - a.z, 0, -(b.x - a.x)).normalize().multiplyScalar(width / 2)
    verts.push(
      a.x - side.x, a.y, a.z - side.z, a.x + side.x, a.y, a.z + side.z, b.x - side.x, b.y, b.z - side.z,
      a.x + side.x, a.y, a.z + side.z, b.x + side.x, b.y, b.z + side.z, b.x - side.x, b.y, b.z - side.z,
    )
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  return geo
}

export function createLightningSystem(scene: THREE.Scene) {
  const group = new THREE.Group()
  group.visible = false
  scene.add(group)

  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xf4faff, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x86b8ff, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const light = new THREE.PointLight(0xbfd8ff, 0, 30, 1.6)
  scene.add(light)

  const sparkGeo = new THREE.BufferGeometry()
  const sparkPos = new Float32Array(40 * 3)
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3))
  const sparkMat = new THREE.PointsMaterial({
    color: 0xcfe4ff, size: 0.18, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const sparks = new THREE.Points(sparkGeo, sparkMat)
  scene.add(sparks)
  let sparkVel: THREE.Vector3[] = []
  let sparkLife = 0

  /**
   * One bolt at a time. A round reset or a replay scrub can start the next strike
   * while an old one is still awaiting a flash, and the stale one must not leave
   * its ribbons lit on screen.
   */
  let strikeToken = 0
  let disposed = false

  function clearGroup() {
    group.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose() })
    group.clear()
  }

  function build(target: THREE.Vector3) {
    clearGroup()
    const from = new THREE.Vector3(target.x + (Math.random() - 0.5) * 2, SKY_Y, target.z + (Math.random() - 0.5) * 2)
    const main = makeStrand(from, target, 2.4)
    group.add(new THREE.Mesh(strandGeometry(main, RIBBON_W), coreMat))
    group.add(new THREE.Mesh(strandGeometry(main, RIBBON_W * 3.2), glowMat))
    for (let f = 0; f < FORKS; f++) {
      const at = main[Math.floor(main.length * (0.25 + Math.random() * 0.4))]
      const tip = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, -(1 + Math.random() * 2), (Math.random() - 0.5) * 3))
      group.add(new THREE.Mesh(strandGeometry(makeStrand(at, tip, 1.2), RIBBON_W * 0.6), glowMat))
    }
    light.position.copy(target).setY(target.y + 1.5)
  }

  function burst(target: THREE.Vector3) {
    sparkVel = []
    for (let i = 0; i < 40; i++) {
      sparkPos.set([target.x, target.y, target.z], i * 3)
      sparkVel.push(new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 5, (Math.random() - 0.5) * 6))
    }
    sparkGeo.attributes.position.needsUpdate = true
    sparkMat.opacity = 0.9
    sparkLife = 0.7
  }

  const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

  /** Flash pattern: 120ms on, 60 off, 90 on (rebuilt), 60 off, 70 on weaker. ≤3 flashes. */
  async function strike(cell: { x: number; y: number }, terrain: TerrainState): Promise<void> {
    if (disposed) return
    const token = ++strikeToken
    // Same placement math as player.ts — players stand on cell centres, so the
    // bolt lands where the crown that drew it was standing.
    const target = terrain.cellTopWorld(cell.x, cell.y)
    const flashes: [number, number][] = REDUCED ? [[140, 0.7]] : [[120, 1], [90, 0.85], [70, 0.6]]
    build(target)
    burst(target)
    for (let i = 0; i < flashes.length; i++) {
      const [ms, strength] = flashes[i]
      if (i > 0) {
        await wait(60)
        if (disposed || token !== strikeToken) return
        build(target)
      }
      group.visible = true
      coreMat.opacity = strength
      glowMat.opacity = 0.45 * strength
      light.intensity = 26 * strength
      await wait(ms)
      if (disposed || token !== strikeToken) return
      group.visible = false
      light.intensity = 0
    }
  }

  return {
    strike,
    update(dt: number) {
      if (sparkLife <= 0) return
      sparkLife -= dt
      for (let i = 0; i < sparkVel.length; i++) {
        sparkVel[i].y -= 9 * dt
        sparkPos[i * 3] += sparkVel[i].x * dt
        sparkPos[i * 3 + 1] += sparkVel[i].y * dt
        sparkPos[i * 3 + 2] += sparkVel[i].z * dt
      }
      sparkGeo.attributes.position.needsUpdate = true
      sparkMat.opacity = Math.max(0, sparkLife / 0.7) * 0.9
    },
    dispose() {
      disposed = true
      scene.remove(group, light, sparks)
      clearGroup()
      coreMat.dispose(); glowMat.dispose(); sparkGeo.dispose(); sparkMat.dispose()
    },
  }
}
