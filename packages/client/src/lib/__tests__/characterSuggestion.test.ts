import { describe, it, expect, afterEach } from 'bun:test'
import { fetchCharacterSuggestion, getSuggestedCharacter } from '../characterSuggestion.js'

const originalFetch = globalThis.fetch

describe('character suggestion fetch', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('stores the suggested character from a successful response', async () => {
    globalThis.fetch = (() => Promise.resolve(
      new Response(JSON.stringify({ character: 'rice' }), { status: 200 }),
    )) as typeof fetch
    await fetchCharacterSuggestion()
    expect(getSuggestedCharacter()).toBe('rice')
  })

  it('ignores a response with an unrecognized character', async () => {
    globalThis.fetch = (() => Promise.resolve(
      new Response(JSON.stringify({ character: 'nope' }), { status: 200 }),
    )) as typeof fetch
    await fetchCharacterSuggestion()
    expect(getSuggestedCharacter()).toBeNull()
  })

  it('resolves to null on a network error', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch
    await fetchCharacterSuggestion()
    expect(getSuggestedCharacter()).toBeNull()
  })

  it('resolves to null when the request exceeds its timeout', async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })) as typeof fetch
    await fetchCharacterSuggestion(20)
    expect(getSuggestedCharacter()).toBeNull()
  })
})
