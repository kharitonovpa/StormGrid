import { CHARACTERS } from '@wheee/shared'
import type { CharacterType } from '@wheee/shared'
import { storageGet, storageSet } from './storage'

/**
 * The crop picked in the lobby, persisted through `lib/storage.ts` so it
 * survives a reload instead of resetting to wheat every time (same treatment
 * as the streak and audio settings). Returns null when nothing is stored so
 * callers (useGameState) can tell "never played" apart from "explicitly
 * picked wheat" and layer a geo suggestion in between the two.
 */

const STORAGE_KEY = 'wheee:character-v1'

export function loadCharacterPreference(): CharacterType | null {
  const raw = storageGet(STORAGE_KEY)
  return (CHARACTERS as readonly string[]).includes(raw ?? '')
    ? (raw as CharacterType)
    : null
}

export function saveCharacterPreference(character: CharacterType): void {
  storageSet(STORAGE_KEY, character)
}
