import { describe, it, expect } from 'bun:test'
import * as THREE from 'three'
import { createStormSystem } from '../storm.js'

describe('createStormSystem base tint', () => {
  it('uses the default BASE color when no tint is given', () => {
    const scene = new THREE.Scene()
    const storm = createStormSystem(scene)
    expect(storm.getBaseColor().getHex()).toBe(0x0a0e14)
  })

  it('uses a provided tint for the calm sky base', () => {
    const scene = new THREE.Scene()
    const storm = createStormSystem(scene, new THREE.Color(0x120e0a))
    expect(storm.getBaseColor().getHex()).toBe(0x120e0a)
  })

  it('retints the calm sky base through setBaseColor', () => {
    const scene = new THREE.Scene()
    const storm = createStormSystem(scene)
    storm.setBaseColor(new THREE.Color(0x0a1018))
    expect(storm.getBaseColor().getHex()).toBe(0x0a1018)
  })

  it('does not leak a setBaseColor tint into the shared default', () => {
    const tinted = createStormSystem(new THREE.Scene())
    tinted.setBaseColor(new THREE.Color(0x120e0a))
    const fresh = createStormSystem(new THREE.Scene())
    expect(fresh.getBaseColor().getHex()).toBe(0x0a0e14)
  })
})
