import { describe, it, expect, beforeEach } from 'bun:test'
import { loadCharacterPreference, saveCharacterPreference } from '../characterPreference.js'
import { hydrateStorage } from '../storage.js'

describe('character preference persistence', () => {
  beforeEach(async () => {
    // storage.ts caches values at module scope; re-hydrating from an empty
    // backend resets that cache between tests instead of leaking state.
    await hydrateStorage({ load: async () => ({}), set: () => {} })
  })

  it('returns null when nothing has been saved', () => {
    expect(loadCharacterPreference()).toBeNull()
  })

  it('round-trips a saved character', () => {
    saveCharacterPreference('rice')
    expect(loadCharacterPreference()).toBe('rice')
  })

  it('returns null for a corrupted/unknown value', async () => {
    await hydrateStorage({ load: async () => ({ 'wheee:character-v1': 'not-a-crop' }), set: () => {} })
    expect(loadCharacterPreference()).toBeNull()
  })
})
