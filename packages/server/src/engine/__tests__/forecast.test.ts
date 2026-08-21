import { describe, expect, test } from 'bun:test'
import { hasLightning, hasWind } from '@wheee/shared'
import { generateForecast, randomWeatherDecision } from '../forecast.js'

describe('randomWeatherDecision schedule', () => {
  test('rounds 1-2 never produce lightning', () => {
    for (let i = 0; i < 500; i++) {
      expect(hasLightning(randomWeatherDecision(1).type)).toBe(false)
      expect(hasLightning(randomWeatherDecision(2).type)).toBe(false)
    }
  })

  test('round 3 produces lightning sometimes, round 7 mostly', () => {
    const hits = (round: number) =>
      Array.from({ length: 1000 }, () => randomWeatherDecision(round))
        .filter(d => hasLightning(d.type)).length
    expect(hits(3)).toBeGreaterThan(100)   // ~25% scheduled
    expect(hits(7)).toBeGreaterThan(600)   // ~80% scheduled
  })
})

describe('generateForecast lightning', () => {
  test('lightning weather reads >= 0.5, dry weather < 0.5, quantized', () => {
    for (let i = 0; i < 200; i++) {
      const stormy = generateForecast({ type: 'wind_lightning', dir: 'N' })
      expect(stormy.lightningProbability).toBeGreaterThanOrEqual(0.5)
      expect([0.75, 1.0]).toContain(stormy.lightningProbability)
      const dry = generateForecast({ type: 'wind_rain', dir: 'N' })
      expect(dry.lightningProbability).toBeLessThan(0.5)
      expect([0, 0.25]).toContain(dry.lightningProbability)
    }
  })

  test('pure lightning has a calm vane and no rain promise', () => {
    for (let i = 0; i < 50; i++) {
      const f = generateForecast({ type: 'lightning', dir: 'N' })
      expect(f.windCandidates).toEqual([])
      expect(f.rainProbability).toBeLessThan(0.5)
      expect(f.lightningProbability).toBeGreaterThanOrEqual(0.5)
    }
  })
})
