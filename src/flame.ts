import * as THREE from 'three'

export function createFlame(): THREE.Group {
  const group = new THREE.Group()

  // --- Main body: lathe from flame silhouette ---
  const pts: THREE.Vector2[] = []
  const steps = 32
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    let r: number
    if (t < 0.15) {
      r = t / 0.15 * 0.55
    } else if (t < 0.5) {
      r = 0.55 + Math.sin((t - 0.15) / 0.35 * Math.PI) * 0.15
    } else if (t < 0.8) {
      const s = (t - 0.5) / 0.3
      r = 0.7 * (1 - s * 0.6)
    } else {
      const s = (t - 0.8) / 0.2
      r = 0.28 * (1 - s)
    }
    pts.push(new THREE.Vector2(r, t * 2.2 - 0.3))
  }

  const bodyGeo = new THREE.LatheGeometry(pts, 24)
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xffaa00,
    emissive: 0xff6600,
    emissiveIntensity: 0.3,
    roughness: 0.6,
  })
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  group.add(body)

  // --- Flame tips ---
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0xff6600,
    emissive: 0xff4400,
    emissiveIntensity: 0.5,
    roughness: 0.5,
  })

  const tips = [
    { x: 0, z: 0, h: 1.0, r: 0.22, lean: 0 },
    { x: -0.25, z: 0.05, h: 0.7, r: 0.15, lean: -0.25 },
    { x: 0.28, z: -0.05, h: 0.65, r: 0.14, lean: 0.3 },
    { x: -0.08, z: -0.22, h: 0.55, r: 0.12, lean: 0.1 },
    { x: 0.1, z: 0.2, h: 0.5, r: 0.11, lean: -0.15 },
  ]

  for (const tip of tips) {
    const cone = new THREE.ConeGeometry(tip.r, tip.h, 8)
    const m = new THREE.Mesh(cone, tipMat)
    m.position.set(tip.x, 1.85 + tip.h * 0.35, tip.z)
    m.rotation.z = tip.lean
    group.add(m)
  }

  // --- Eyes ---
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 })
  const eyeGeo = new THREE.SphereGeometry(0.09, 12, 12)

  const eyeL = new THREE.Mesh(eyeGeo, eyeMat)
  eyeL.position.set(-0.18, 0.75, 0.52)
  group.add(eyeL)

  const eyeR = new THREE.Mesh(eyeGeo, eyeMat)
  eyeR.position.set(0.18, 0.75, 0.52)
  group.add(eyeR)

  const highlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.8,
  })
  const hlGeo = new THREE.SphereGeometry(0.035, 8, 8)

  const hlL = new THREE.Mesh(hlGeo, highlightMat)
  hlL.position.set(-0.2, 0.78, 0.57)
  group.add(hlL)

  const hlR = new THREE.Mesh(hlGeo, highlightMat)
  hlR.position.set(0.16, 0.78, 0.57)
  group.add(hlR)

  // --- Smile ---
  const smileCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.12, 0.55, 0.58),
    new THREE.Vector3(0, 0.48, 0.62),
    new THREE.Vector3(0.12, 0.55, 0.58),
  )
  const smileGeo = new THREE.TubeGeometry(smileCurve, 12, 0.02, 6, false)
  const smileMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4 })
  group.add(new THREE.Mesh(smileGeo, smileMat))

  return group
}
