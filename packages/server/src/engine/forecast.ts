import type { ForecastData, WeatherType, WindDir } from '@wheee/shared'
import { WIND_DIRS, WEATHER_SCHEDULE, hasWind, hasRain, hasLightning } from '@wheee/shared'

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
  const windy = hasWind(decision.type)
  const rainy = hasRain(decision.type)
  const stormy = hasLightning(decision.type)

  const windCandidates: WindDir[] = []
  if (windy) {
    windCandidates.push(decision.dir)
    if (Math.random() < 0.5) {
      const others = WIND_DIRS.filter(d => d !== decision.dir)
      windCandidates.push(others[Math.floor(Math.random() * others.length)])
    }
  }

  let rainProbability: number
  if (rainy) {
    rainProbability = Math.random() < 0.4 ? 0.75 : 1.0
  } else {
    rainProbability = Math.random() < 0.3 ? 0.25 : 0
  }

  const lightningProbability = stormy
    ? (Math.random() < 0.4 ? 0.75 : 1.0)
    : (Math.random() < 0.3 ? 0.25 : 0)

  return {
    windCandidates,
    rainProbability,
    lightningProbability,
    instrumentsBroken: {
      A: { vane: false, barometer: false },
      B: { vane: false, barometer: false },
    },
  }
}

/**
 * Weather for the round, drawn from the round-gated schedule: rounds 1–2 are
 * today's game, lightning creeps in from round 3, late rounds must end matches.
 */
export function randomWeatherDecision(round: number): WeatherDecision {
  const tier = WEATHER_SCHEDULE.find(t => round <= t.upToRound) ?? WEATHER_SCHEDULE[WEATHER_SCHEDULE.length - 1]
  const total = tier.weights.reduce((s, [, w]) => s + w, 0)
  let roll = Math.random() * total
  let type: WeatherType = tier.weights[0][0]
  for (const [t, w] of tier.weights) {
    roll -= w
    if (roll <= 0) { type = t; break }
  }
  const dir = WIND_DIRS[Math.floor(Math.random() * WIND_DIRS.length)]
  return { type, dir }
}
