import type { ForecastData, WeatherType, WindDir } from '@stormgrid/shared'
import { WIND_DIRS } from '@stormgrid/shared'

export type WeatherDecision = {
  type: WeatherType
  dir: WindDir
}

/**
 * Generate a forecast for the upcoming round.
 *
 * The forecast gives players partial information:
 * - windCandidates: 1-2 possible wind directions (the real one is among them)
 * - rainProbability: rough likelihood of rain (0, 0.25, 0.5, 0.75, 1.0)
 *
 * `resolveWeatherDecision` is what actually happens — it picks a concrete
 * weather type and direction. The forecast is a noisy hint derived from it.
 */
export function generateForecast(decision: WeatherDecision): ForecastData {
  const hasWind = decision.type === 'wind' || decision.type === 'wind_rain'
  const hasRain = decision.type === 'rain' || decision.type === 'wind_rain'

  const windCandidates: WindDir[] = []
  if (hasWind) {
    windCandidates.push(decision.dir)
    if (Math.random() < 0.5) {
      const others = WIND_DIRS.filter(d => d !== decision.dir)
      windCandidates.push(others[Math.floor(Math.random() * others.length)])
    }
  }

  let rainProbability: number
  if (hasRain) {
    rainProbability = Math.random() < 0.4 ? 0.75 : 1.0
  } else {
    rainProbability = Math.random() < 0.3 ? 0.25 : 0
  }

  return {
    windCandidates,
    rainProbability,
    instrumentsBroken: {
      A: { vane: false, barometer: false },
      B: { vane: false, barometer: false },
    },
  }
}

/**
 * Generate a random weather decision for a round.
 * Wind is always present; rain may accompany it.
 * Weights: wind-only 55%, wind+rain 45%
 */
export function randomWeatherDecision(): WeatherDecision {
  const type: WeatherType = Math.random() < 0.55 ? 'wind' : 'wind_rain'
  const dir = WIND_DIRS[Math.floor(Math.random() * WIND_DIRS.length)]
  return { type, dir }
}
