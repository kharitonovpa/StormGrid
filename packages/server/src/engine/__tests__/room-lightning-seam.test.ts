import { describe, it, expect } from 'bun:test'
import { Room } from '../../Room.js'
import type { GameEngine } from '../GameEngine.js'

/**
 * Room's constructor computes `lightningEnabled` and hands it straight to
 * `new GameEngine(undefined, this.lightningEnabled)` — see Room.ts. Every
 * other test that touches this feature stops on one side of that hop:
 * matchmaking-caps.test.ts asserts `Room.lightningEnabled` itself (computed
 * one line above the engine construction, so it can't catch the hand-off
 * breaking), and engine.test.ts constructs `GameEngine` directly, never
 * through a `Room`. So if the wiring in the constructor were ever wrong —
 * e.g. `new GameEngine(undefined, true)`, force-enabling lightning
 * regardless of what `Room` computed, exactly the production bug this whole
 * feature exists to prevent — nothing above would notice.
 *
 * This test reaches into the `Room`-constructed engine instance (the same
 * `(engine as unknown as {...}).state.round = ...` trick engine.test.ts uses
 * to force the round counter past the point lightning would normally enter)
 * so it actually crosses that seam.
 */
function makeRoom(lightningEnabled: boolean): Room {
  return new Room('lightning-seam-test', {
    onDispose: () => {},
    gracePeriodMs: 30_000,
  }, { lightningEnabled })
}

function engineOf(room: Room): GameEngine {
  return (room as unknown as { engine: GameEngine }).engine
}

describe('Room -> GameEngine seam: lightningEnabled crosses the constructor hand-off', () => {
  it('a Room built with lightningEnabled: false hands the engine a disabled instance', () => {
    const room = makeRoom(false)
    const engine = engineOf(room)

    for (let sample = 0; sample < 150; sample++) {
      // Force the round counter past the point lightning would normally
      // enter — a disabled engine must clamp the schedule regardless.
      ;(engine as unknown as { state: { round: number } }).state.round = 3 + (sample % 20)
      const s = engine.startRound()
      expect(s.forecast.lightningProbability).toBeLessThan(0.5)
    }

    room.dispose()
  })

  it('a Room built with lightningEnabled: true hands the engine an enabled instance', () => {
    // Sanity check for the test above: with the room explicitly enabled,
    // the same round-forcing trick does produce lightning-tagged forecasts
    // sometimes — proving the disabled test isn't vacuously true because
    // rounds never reach the lightning tiers.
    const room = makeRoom(true)
    const engine = engineOf(room)

    let sawLightning = false
    for (let sample = 0; sample < 150 && !sawLightning; sample++) {
      ;(engine as unknown as { state: { round: number } }).state.round = 5 + (sample % 20)
      const s = engine.startRound()
      if (s.forecast.lightningProbability >= 0.5) sawLightning = true
    }
    expect(sawLightning).toBe(true)

    room.dispose()
  })
})
