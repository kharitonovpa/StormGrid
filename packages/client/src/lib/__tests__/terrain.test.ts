import { describe, it, expect } from 'bun:test'
import * as THREE from 'three'
import { paintColors } from '../terrain.js'

function makeSingleVertexGeo(x: number, y: number, z: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([x, y, z], 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0], 3))
  return geo
}

describe('paintColors accent', () => {
  it('shifts the red channel toward a positive accent', () => {
    const plain = makeSingleVertexGeo(1, 0, 1)
    paintColors(plain)
    const baseRed = (plain.attributes.color as THREE.BufferAttribute).getX(0)

    const tinted = makeSingleVertexGeo(1, 0, 1)
    paintColors(tinted, false, [0.3, 0, 0])
    const tintedRed = (tinted.attributes.color as THREE.BufferAttribute).getX(0)

    expect(tintedRed).toBeGreaterThan(baseRed)
  })
})
