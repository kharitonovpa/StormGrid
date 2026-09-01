import { describe, it, expect, beforeEach } from 'bun:test'
import { loadReconnectToken, saveReconnectToken, clearReconnectToken } from '../sessionToken.js'

function installFakeSessionStorage(): void {
  const store = new Map<string, string>()
  // Object.defineProperty (not a plain assignment) so this can always
  // overwrite whatever a previous test left in place — including the
  // getter-only stand-in the "blocked storage" test below installs, which a
  // plain assignment would throw against under strict-mode property
  // semantics.
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
      clear: () => store.clear(),
      key: () => null,
      get length() { return store.size },
    } as Storage,
  })
}

describe('reconnect token persistence', () => {
  beforeEach(() => {
    installFakeSessionStorage()
  })

  it('returns null when nothing has been saved', () => {
    expect(loadReconnectToken()).toBeNull()
  })

  it('round-trips a saved token', () => {
    saveReconnectToken('abc-123')
    expect(loadReconnectToken()).toBe('abc-123')
  })

  it('clears a saved token', () => {
    saveReconnectToken('abc-123')
    clearReconnectToken()
    expect(loadReconnectToken()).toBeNull()
  })

  it('degrades silently when sessionStorage is unavailable', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() { throw new Error('blocked in this context') },
    })
    expect(() => saveReconnectToken('x')).not.toThrow()
    expect(loadReconnectToken()).toBeNull()
    expect(() => clearReconnectToken()).not.toThrow()
  })
})
