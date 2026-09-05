import { describe, it, expect } from 'bun:test'
import { DIR_AZIMUTH, gustDirection } from '../bearing.js'

describe('gustDirection', () => {
  // wind.ts: streams travel −z in local space; setDirection maps N→(0,−1), E→(+1,0), S→(0,+1), W→(−1,0) in world.
  it('crosses the board the way the gale from that bearing blows', () => {
    const near = (v: [number, number], e: [number, number]) => { expect(v[0]).toBeCloseTo(e[0], 6); expect(v[1]).toBeCloseTo(e[1], 6) }
    near(gustDirection(DIR_AZIMUTH.N), [0, -1])
    near(gustDirection(DIR_AZIMUTH.E), [1, 0])
    near(gustDirection(DIR_AZIMUTH.S), [0, 1])
    near(gustDirection(DIR_AZIMUTH.W), [-1, 0])
  })
  it('keeps the sky\'s bearing values', () => {
    expect(DIR_AZIMUTH).toEqual({ N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 })
  })
})
