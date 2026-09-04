import { describe, it, expect, beforeEach } from 'bun:test'
import { loadCharacterPreference, saveCharacterPreference } from '../characterPreference.js'
import { hydrateStorage } from '../storage.js'

describe('character preference persistence', () => {
  beforeEach(async () => {
    // storage.ts caches values at module scope; re-hydrating from an empty
    // backend resets that cache between tests instead of leaking state.
    await hydrateStorage({ load: async () => ({}), set: () => {} })
  })

  it('defaults to wheat when nothing has been saved', () => {
    expect(loadCharacterPreference()).toBe('wheat')
  })

  it('round-trips a saved character', () => {
    saveCharacterPreference('rice')
    expect(loadCharacterPreference()).toBe('rice')
  })

  it('falls back to wheat for a corrupted/unknown value', async () => {
    await hydrateStorage({ load: async () => ({ 'wheee:character-v1': 'not-a-crop' }), set: () => {} })
    expect(loadCharacterPreference()).toBe('wheat')
  })
})
