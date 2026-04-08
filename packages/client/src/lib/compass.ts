import * as THREE from 'three'
import { HALF } from './constants'

export function createCompassSystem(scene: THREE.Scene) {
  const group = new THREE.Group()
  scene.add(group)

  const Y = 0.3
  const FRAME_R = HALF + 4
  const LABEL_DIST = HALF + 8
  const ROSE_R = HALF * 0.7
  const ROSE_DIAG = HALF * 0.35
  const CENTER_R = 2.0
  const CENTER_INNER = 0.7

  const lineMat = new THREE.LineBasicMaterial({
    color: 0x7a8fa3,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  })

  const accentMat = new THREE.LineBasicMaterial({
    color: 0x9ab0c8,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  })

  // --- Compass rose lines (from center outward) ---
  const rv: number[] = []

  // 4 cardinal lines: center gap → rose radius
  rv.push(0, Y, -CENTER_R, 0, Y, -ROSE_R)
  rv.push(0, Y, CENTER_R, 0, Y, ROSE_R)
  rv.push(-CENTER_R, Y, 0, -ROSE_R, Y, 0)
  rv.push(CENTER_R, Y, 0, ROSE_R, Y, 0)

  // 4 ordinal lines (shorter)
  const D = 0.7071
  rv.push(-CENTER_R * D, Y, -CENTER_R * D, -ROSE_DIAG * D, Y, -ROSE_DIAG * D)
  rv.push(CENTER_R * D, Y, -CENTER_R * D, ROSE_DIAG * D, Y, -ROSE_DIAG * D)
  rv.push(-CENTER_R * D, Y, CENTER_R * D, -ROSE_DIAG * D, Y, ROSE_DIAG * D)
  rv.push(CENTER_R * D, Y, CENTER_R * D, ROSE_DIAG * D, Y, ROSE_DIAG * D)

  // Center diamond (outer)
  rv.push(0, Y, -CENTER_R, CENTER_R, Y, 0)
  rv.push(CENTER_R, Y, 0, 0, Y, CENTER_R)
  rv.push(0, Y, CENTER_R, -CENTER_R, Y, 0)
  rv.push(-CENTER_R, Y, 0, 0, Y, -CENTER_R)

  // Center diamond (inner)
  rv.push(0, Y, -CENTER_INNER, CENTER_INNER, Y, 0)
  rv.push(CENTER_INNER, Y, 0, 0, Y, CENTER_INNER)
  rv.push(0, Y, CENTER_INNER, -CENTER_INNER, Y, 0)
  rv.push(-CENTER_INNER, Y, 0, 0, Y, -CENTER_INNER)

  const roseGeo = new THREE.BufferGeometry()
  roseGeo.setAttribute('position', new THREE.Float32BufferAttribute(rv, 3))
  group.add(new THREE.LineSegments(roseGeo, accentMat))

  // --- Outer frame ---
  const fv: number[] = []
  const c = FRAME_R

  // Frame square
  fv.push(-c, Y, -c, c, Y, -c)
  fv.push(c, Y, -c, c, Y, c)
  fv.push(c, Y, c, -c, Y, c)
  fv.push(-c, Y, c, -c, Y, -c)

  // Connector lines: frame → labels
  fv.push(0, Y, -c, 0, Y, -LABEL_DIST + 3)
  fv.push(0, Y, c, 0, Y, LABEL_DIST - 1.5)
  fv.push(-c, Y, 0, -LABEL_DIST + 3, Y, 0)
  fv.push(c, Y, 0, LABEL_DIST - 3, Y, 0)

  // Corner accents (small diamonds)
  const dd = 0.7
  for (const [cx, cz] of [[-c, -c], [c, -c], [c, c], [-c, c]] as [number, number][]) {
    fv.push(cx, Y, cz - dd, cx + dd, Y, cz)
    fv.push(cx + dd, Y, cz, cx, Y, cz + dd)
    fv.push(cx, Y, cz + dd, cx - dd, Y, cz)
    fv.push(cx - dd, Y, cz, cx, Y, cz - dd)
  }

  const frameGeo = new THREE.BufferGeometry()
  frameGeo.setAttribute('position', new THREE.Float32BufferAttribute(fv, 3))
  group.add(new THREE.LineSegments(frameGeo, lineMat))

  // --- North arrow ---
  const arrowMat = new THREE.MeshBasicMaterial({
    color: 0xd45522,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  })

  const aw = 0.7
  const tipZ = -LABEL_DIST + 2.0
  const baseZ = -LABEL_DIST + 3.5
  const arrowGeo = new THREE.BufferGeometry()
  arrowGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, Y, tipZ, -aw, Y, baseZ, aw, Y, baseZ,
  ], 3))
  arrowGeo.setIndex([0, 2, 1, 0, 1, 2])
  arrowGeo.computeVertexNormals()
  group.add(new THREE.Mesh(arrowGeo, arrowMat))

  // --- Text labels ---
  function makeLabel(text: string): THREE.Mesh {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    canvas.width = 128
    canvas.height = 128

    ctx.clearRect(0, 0, 128, 128)
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)'
    ctx.shadowBlur = 6
    ctx.font = 'bold 72px sans-serif'
    ctx.fillStyle = 'rgba(190, 215, 235, 0.9)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 64, 64)

    const tex = new THREE.CanvasTexture(canvas)
    tex.needsUpdate = true

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })

    const geo = new THREE.PlaneGeometry(5, 5)
    geo.rotateX(-Math.PI / 2)
    return new THREE.Mesh(geo, mat)
  }

  const labelN = makeLabel('N')
  labelN.position.set(0, Y, -LABEL_DIST)
  group.add(labelN)

  const labelS = makeLabel('S')
  labelS.position.set(0, Y, LABEL_DIST)
  group.add(labelS)

  const labelW = makeLabel('W')
  labelW.position.set(-LABEL_DIST, Y, 0)
  group.add(labelW)

  const labelE = makeLabel('E')
  labelE.position.set(LABEL_DIST, Y, 0)
  group.add(labelE)

  return {
    update(_dt: number) {},
    dispose() {
      scene.remove(group)
      group.traverse((child) => {
        const obj = child as THREE.Mesh | THREE.LineSegments
        if (obj.geometry) obj.geometry.dispose()
        if (obj.material && 'dispose' in obj.material) {
          const mat = obj.material as THREE.MeshBasicMaterial
          if (mat.map) mat.map.dispose()
          mat.dispose()
        }
      })
    },
  }
}
