import { describe, it, expect, beforeEach } from 'bun:test'
import { nextTick } from 'vue'
import { useGameState } from '../useGameState.js'
import { hydrateStorage } from '../../lib/storage.js'
import { loadCharacterPreference } from '../../lib/characterPreference.js'

describe('useGameState character persistence', () => {
  beforeEach(async () => {
    await hydrateStorage({ load: async () => ({}), set: () => {} })
  })

  it('initializes selectedCharacter from the saved preference', async () => {
    await hydrateStorage({ load: async () => ({ 'wheee:character-v1': 'corn' }), set: () => {} })
    const game = useGameState()
    expect(game.selectedCharacter.value).toBe('corn')
  })

  it('persists a change to selectedCharacter', async () => {
    const game = useGameState()
    game.selectedCharacter.value = 'rice'
    await nextTick()
    expect(loadCharacterPreference()).toBe('rice')
  })
})
