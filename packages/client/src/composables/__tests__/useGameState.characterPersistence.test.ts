// packages/client/src/composables/__tests__/useGameState.characterPersistence.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { nextTick, effectScope } from 'vue'
import { useGameState } from '../useGameState.js'
import { hydrateStorage } from '../../lib/storage.js'
import { loadCharacterPreference } from '../../lib/characterPreference.js'
import { fetchCharacterSuggestion } from '../../lib/characterSuggestion.js'

const originalFetch = globalThis.fetch

function mockSuggestion(character: string) {
  globalThis.fetch = (() => Promise.resolve(
    new Response(JSON.stringify({ character }), { status: 200 }),
  )) as unknown as typeof fetch
}

describe('useGameState character persistence', () => {
  // useGameState() calls onScopeDispose(), which warns when run outside an
  // active effect scope. Running it inside one here (and stopping the scope
  // after each test) keeps test output free of that Vue warning.
  let scope: ReturnType<typeof effectScope>

  beforeEach(async () => {
    await hydrateStorage({ load: async () => ({}), set: () => {} })
    scope = effectScope()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    scope.stop()
  })

  it('initializes selectedCharacter from the saved preference', async () => {
    await hydrateStorage({ load: async () => ({ 'wheee:character-v1': 'corn' }), set: () => {} })
    const game = scope.run(() => useGameState())!
    expect(game.selectedCharacter.value).toBe('corn')
  })

  it('persists a change to selectedCharacter', async () => {
    const game = scope.run(() => useGameState())!
    game.selectedCharacter.value = 'rice'
    await nextTick()
    expect(loadCharacterPreference()).toBe('rice')
  })

  it('applies a geo suggestion when no preference is saved', async () => {
    mockSuggestion('rice')
    await fetchCharacterSuggestion()
    const game = scope.run(() => useGameState())!
    expect(game.selectedCharacter.value).toBe('rice')
  })

  it('ignores the suggestion when a preference is already saved', async () => {
    await hydrateStorage({ load: async () => ({ 'wheee:character-v1': 'wheat' }), set: () => {} })
    mockSuggestion('corn')
    await fetchCharacterSuggestion()
    const game = scope.run(() => useGameState())!
    expect(game.selectedCharacter.value).toBe('wheat')
  })
})
