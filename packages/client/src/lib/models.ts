import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { CharacterType } from '@wheee/shared'
import { CELL_SIZE } from './constants'

const MODEL_PATHS: Record<CharacterType, string> = {
  wheat: '/models/wheat.glb',
  rice: '/models/rice.glb',
  corn: '/models/corn.glb',
}

const TARGET_HEIGHT = CELL_SIZE * 0.55

const SCALE_OVERRIDES: Partial<Record<CharacterType, number>> = {
  wheat: 1.2,
}

const cache = new Map<CharacterType, THREE.Group>()
let _loaded = false
let _readyResolve: () => void
const _readyPromise = new Promise<void>((r) => { _readyResolve = r })
const loader = new GLTFLoader()

export async function preloadModels(): Promise<void> {
  const types: CharacterType[] = ['wheat', 'rice', 'corn']
  await Promise.all(
    types.map(async (type) => {
      if (cache.has(type)) return
      try {
        const gltf = await loader.loadAsync(MODEL_PATHS[type])
        cache.set(type, normalizeModel(gltf.scene, type))
      } catch (err) {
        console.error(`Failed to load model "${type}":`, err)
      }
    }),
  )
  _loaded = true
  _readyResolve()
}

export function modelsLoaded(): boolean {
  return _loaded
}

export function whenModelsReady(): Promise<void> {
  return _readyPromise
}

export function getModel(type: CharacterType): THREE.Group {
  const original = cache.get(type)
  if (!original) return createPlaceholder()
  return original.clone()
}

function softenColor(color: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 }
  color.getHSL(hsl)
  hsl.s *= 0.75
  hsl.l = hsl.l + (0.58 - hsl.l) * 0.2
  return color.setHSL(hsl.h, hsl.s, hsl.l)
}

function mattifyMaterials(root: THREE.Object3D) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
        if (mat.roughnessMap) { mat.roughnessMap.dispose(); mat.roughnessMap = null }
        if (mat.metalnessMap) { mat.metalnessMap.dispose(); mat.metalnessMap = null }

        mat.roughness = 0.92
        mat.metalness = 0.0
        mat.envMapIntensity = 0.4

        if (mat.color) softenColor(mat.color)
        if (mat.emissive) {
          mat.emissiveIntensity = Math.min(mat.emissiveIntensity, 0.25)
        }
        mat.needsUpdate = true
      }
    }
  })
}

/**
 * Wraps the model in a group so the model's base sits at y=0
 * and is centered on x/z. Setting the wrapper's position
 * to terrain height will place the model ON the surface.
 */
function normalizeModel(model: THREE.Group, type: CharacterType): THREE.Group {
  mattifyMaterials(model)

  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  const extra = SCALE_OVERRIDES[type] ?? 1
  if (maxDim > 0) {
    model.scale.multiplyScalar((TARGET_HEIGHT * extra) / maxDim)
  }

  box.setFromObject(model)
  const center = box.getCenter(new THREE.Vector3())
  model.position.set(-center.x, -box.min.y, -center.z)

  const wrapper = new THREE.Group()
  wrapper.add(model)
  return wrapper
}

function createPlaceholder(): THREE.Group {
  const g = new THREE.Group()
  const geo = new THREE.ConeGeometry(0.5, TARGET_HEIGHT, 8)
  geo.translate(0, TARGET_HEIGHT / 2, 0)
  const mat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xff6600, emissiveIntensity: 0.3 })
  g.add(new THREE.Mesh(geo, mat))
  return g
}
