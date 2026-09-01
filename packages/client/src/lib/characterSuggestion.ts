import { CHARACTERS } from '@wheee/shared'
import type { CharacterType } from '@wheee/shared'
import { API_BASE } from './config'

/**
 * A crop suggested for first-time players based on connection country
 * (`GET /api/character-suggestion`, server-side mapping in
 * packages/server/src/regionCrop.ts). Fetched once at boot, before the app
 * mounts (see main.ts) — this call must never throw and never meaningfully
 * delay boot, so any failure (timeout, network error, bad payload) just
 * leaves the suggestion null and useGameState falls back to the persisted
 * preference or 'wheat'.
 */

let suggestion: CharacterType | null = null

export async function fetchCharacterSuggestion(timeoutMs = 800): Promise<void> {
  // Reset first so a stale suggestion from an earlier call never survives a
  // later failure — this is only called once at boot in practice, but the
  // function must be idempotent per-call regardless.
  suggestion = null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_BASE}/api/character-suggestion`, { signal: controller.signal })
    if (!res.ok) return
    const body = await res.json() as { character?: unknown }
    if (typeof body.character === 'string' && (CHARACTERS as readonly string[]).includes(body.character)) {
      suggestion = body.character as CharacterType
    }
  } catch {
    // network error, timeout, bad JSON — suggestion stays null
  } finally {
    clearTimeout(timer)
  }
}

export function getSuggestedCharacter(): CharacterType | null {
  return suggestion
}
