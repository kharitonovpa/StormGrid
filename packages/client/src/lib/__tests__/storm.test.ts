import { describe, it, expect } from 'bun:test'
import * as THREE from 'three'
import { createStormSystem, skyGradient } from '../storm.js'
import { LOOK, srgbHexToLinear } from '../look.js'

describe('createStormSystem sky tint', () => {
  it('starts untinted', () => {
    expect(createStormSystem(new THREE.Scene()).getTint()).toEqual([1, 1, 1])
  })

  it('takes an initial tint', () => {
    expect(createStormSystem(new THREE.Scene(), [1.1, 0.98, 0.9]).getTint()).toEqual([1.1, 0.98, 0.9])
  })

  it('retints through setTint', () => {
    const storm = createStormSystem(new THREE.Scene())
    storm.setTint([0.94, 0.98, 1.08])
    expect(storm.getTint()).toEqual([0.94, 0.98, 1.08])
  })

  it('does not share tint state between instances', () => {
    const tinted = createStormSystem(new THREE.Scene())
    tinted.setTint([1.1, 0.98, 0.9])
    expect(createStormSystem(new THREE.Scene()).getTint()).toEqual([1, 1, 1])
  })
})

describe('skyGradient', () => {
  const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6))

  it('is the zenith colour straight up and straight down', () => {
    const zenith = srgbHexToLinear(LOOK.sky.zenith)
    close(skyGradient(1), zenith)
    close(skyGradient(-1), zenith)
  })

  it('sits between the horizon band and the warm rim at the horizon line', () => {
    const h = srgbHexToLinear(LOOK.sky.horizon), r = srgbHexToLinear(LOOK.sky.rim)
    close(skyGradient(0), [0, 1, 2].map((i) => h[i] + (r[i] - h[i]) * 0.6))
  })

  it('is symmetric for the mirrored underside', () => {
    for (const y of [0.1, 0.3, 0.7]) close(skyGradient(-y), skyGradient(y))
  })

  it('gets darker from the horizon up to the zenith', () => {
    const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    expect(lum(skyGradient(0.9))).toBeLessThan(lum(skyGradient(0.3)))
    expect(lum(skyGradient(0.3))).toBeLessThan(lum(skyGradient(0.1)))
  })
})
