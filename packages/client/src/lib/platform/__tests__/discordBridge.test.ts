import { describe, it, expect, mock } from 'bun:test'
import { registerDiscordHandles, setDiscordPresence } from '../discordBridge.js'
import type { DiscordHandles } from '../discordBridge.js'

function makeHandles(setPresence: DiscordHandles['setPresence']): DiscordHandles {
  return {
    instanceCode: null,
    customId: null,
    referrerId: null,
    guildId: null,
    shareLink: async () => false,
    onParticipantCount: () => () => {},
    setPresence,
  }
}

describe('setDiscordPresence', () => {
  // Must run first: no registerDiscordHandles call has happened yet anywhere
  // in this process at this point in the file.
  it('no-ops before any handles are registered', () => {
    expect(() => setDiscordPresence('lobby')).not.toThrow()
  })

  it('does nothing for a null bucket', () => {
    const setPresence = mock(() => {})
    registerDiscordHandles(makeHandles(setPresence))
    setDiscordPresence(null)
    expect(setPresence).not.toHaveBeenCalled()
  })

  it('forwards the first bucket after registration', () => {
    const setPresence = mock(() => {})
    registerDiscordHandles(makeHandles(setPresence))
    setDiscordPresence('queue')
    expect(setPresence).toHaveBeenCalledTimes(1)
    expect(setPresence).toHaveBeenCalledWith('queue')
  })

  it('does not repeat the same bucket twice in a row', () => {
    const setPresence = mock(() => {})
    registerDiscordHandles(makeHandles(setPresence))
    setDiscordPresence('in_match')
    setDiscordPresence('in_match')
    expect(setPresence).toHaveBeenCalledTimes(1)
  })

  it('forwards a genuinely new bucket', () => {
    const setPresence = mock(() => {})
    registerDiscordHandles(makeHandles(setPresence))
    setDiscordPresence('queue')
    setDiscordPresence('in_match')
    expect(setPresence).toHaveBeenCalledTimes(2)
  })
})
