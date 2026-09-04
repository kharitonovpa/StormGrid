import { describe, it, expect } from 'bun:test'
import { setLanguage, t } from '../i18n.js'

/**
 * `t()` falls back to the English string when a key is missing from the active
 * language, so "the Russian build shows English" is a silent failure. Asserting
 * the two differ is what actually catches a forgotten ru entry.
 */
const KEYS = [
  'net.offline',
  'net.connectFailed',
  'net.leaderboardFailed',
  'net.replaysFailed',
  'net.replayFailed',
  'net.loginFailed',
  'lobby.connecting',
  'boot.failed',
  'boot.failedHint',
  'boot.reload',
]

describe('network failure copy', () => {
  it('resolves every key in English', () => {
    setLanguage('en')
    for (const key of KEYS) {
      expect(t(key)).not.toBe(key)
      expect(t(key).length).toBeGreaterThan(0)
    }
  })

  it('has a distinct Russian string for every key', () => {
    for (const key of KEYS) {
      setLanguage('en')
      const en = t(key)
      setLanguage('ru')
      const ru = t(key)
      expect(ru).not.toBe(key)
      expect(ru).not.toBe(en)
    }
  })
})
