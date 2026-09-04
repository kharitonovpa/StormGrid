import { CHARACTERS } from '@wheee/shared'
import type { CharacterType } from '@wheee/shared'
import { storageGet, storageSet } from './storage'

/**
 * The crop picked in the lobby, persisted through `lib/storage.ts` so it
 * survives a reload instead of resetting to wheat every time (same treatment
 * as the streak and audio settings).
 */

const STORAGE_KEY = 'wheee:character-v1'
const DEFAULT_CHARACTER: CharacterType = 'wheat'

export function loadCharacterPreference(): CharacterType {
  const raw = storageGet(STORAGE_KEY)
  return (CHARACTERS as readonly string[]).includes(raw ?? '')
    ? (raw as CharacterType)
    : DEFAULT_CHARACTER
}

export function saveCharacterPreference(character: CharacterType): void {
  storageSet(STORAGE_KEY, character)
}
