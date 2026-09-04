import { describe, it, expect } from 'bun:test'
import { parseClientMessage, parseAnalyticsIdentity } from '../protocol.js'

/*
 * `caps` is client-supplied data on the four matchmaking-entry messages
 * (queue:join, instant:start, friend:create, friend:join) — the server must
 * not trust its shape blindly. Valid: an array of at most 8 strings, each at
 * most 32 chars. Anything else gets the whole message rejected, same as any
 * other malformed field (rate-limit hygiene: the caller's invalid-message
 * counter ticks up, same path as a bad `streak`).
 */
describe('parseClientMessage — caps validation', () => {
  it('accepts a message with no caps field at all (old client)', () => {
    const msg = parseClientMessage(JSON.stringify({ type: 'queue:join', character: 'wheat' }))
    expect(msg).not.toBeNull()
  })

  it('accepts a well-formed caps array', () => {
    const msg = parseClientMessage(JSON.stringify({ type: 'queue:join', character: 'wheat', caps: ['lightning'] }))
    expect(msg).not.toBeNull()
    expect((msg as { caps?: string[] }).caps).toEqual(['lightning'])
  })

  it('accepts an empty caps array', () => {
    const msg = parseClientMessage(JSON.stringify({ type: 'instant:start', character: 'wheat', caps: [] }))
    expect(msg).not.toBeNull()
  })

  it('rejects a caps array longer than 8 entries', () => {
    const caps = Array.from({ length: 9 }, (_, i) => `cap${i}`)
    const msg = parseClientMessage(JSON.stringify({ type: 'queue:join', character: 'wheat', caps }))
    expect(msg).toBeNull()
  })

  it('accepts exactly 8 caps entries', () => {
    const caps = Array.from({ length: 8 }, (_, i) => `cap${i}`)
    const msg = parseClientMessage(JSON.stringify({ type: 'queue:join', character: 'wheat', caps }))
    expect(msg).not.toBeNull()
  })

  it('rejects a caps entry longer than 32 chars', () => {
    const msg = parseClientMessage(JSON.stringify({
      type: 'friend:create', character: 'wheat', caps: ['a'.repeat(33)],
    }))
    expect(msg).toBeNull()
  })

  it('accepts a caps entry exactly 32 chars', () => {
    const msg = parseClientMessage(JSON.stringify({
      type: 'friend:create', character: 'wheat', caps: ['a'.repeat(32)],
    }))
    expect(msg).not.toBeNull()
  })

  it('rejects non-string entries in caps', () => {
    const msg = parseClientMessage(JSON.stringify({ type: 'queue:join', character: 'wheat', caps: [42] }))
    expect(msg).toBeNull()
  })

  it('rejects caps that is not an array', () => {
    const msg = parseClientMessage(JSON.stringify({ type: 'queue:join', character: 'wheat', caps: 'lightning' }))
    expect(msg).toBeNull()
  })

  it('rejects caps on friend:join too', () => {
    const badCaps = Array.from({ length: 20 }, () => 'x')
    const msg = parseClientMessage(JSON.stringify({
      type: 'friend:join', code: 'ABC234', character: 'wheat', caps: badCaps,
    }))
    expect(msg).toBeNull()
  })

  it('accepts caps on friend:join', () => {
    const msg = parseClientMessage(JSON.stringify({
      type: 'friend:join', code: 'ABC234', character: 'wheat', caps: ['lightning'],
    }))
    expect(msg).not.toBeNull()
  })

  it('practice:start does not need caps and ignores an invalid one — it is not among the messages that accept the field', () => {
    // practice:start never gains a `caps` field per the brief, so a client
    // sending it there is a malformed message like any other stray field
    // would be if it were checked — but since the validator does not look at
    // caps for practice:start at all, an oversized one must not reject it.
    const badCaps = Array.from({ length: 20 }, () => 'x')
    const msg = parseClientMessage(JSON.stringify({
      type: 'practice:start', character: 'wheat', caps: badCaps,
    }))
    expect(msg).not.toBeNull()
  })
})

/*
 * friend:create's `code` is optional (the server mints one when absent) but,
 * when present, must be validated same as friend:join's required code —
 * matchmaking.ts calls `.toUpperCase()` on it unconditionally, which throws
 * a TypeError on anything that isn't a string (e.g. a bare number survives
 * `requestedCode?.toUpperCase()`'s null-check but has no such method).
 * A discord instance-automatch code ("DC-" + the SDK's instanceId) must
 * still be accepted, so the shape check is not identical to friend:join's.
 */
describe('parseClientMessage — friend:create code validation', () => {
  it('accepts friend:create with no code (server will mint one)', () => {
    const msg = parseClientMessage(JSON.stringify({ type: 'friend:create', character: 'wheat' }))
    expect(msg).not.toBeNull()
  })

  it('accepts friend:create with a well-formed manual code', () => {
    const msg = parseClientMessage(JSON.stringify({ type: 'friend:create', character: 'wheat', code: 'ABC234' }))
    expect(msg).not.toBeNull()
  })

  it('accepts friend:create with a discord instance-automatch code', () => {
    const msg = parseClientMessage(JSON.stringify({
      type: 'friend:create', character: 'wheat', code: 'DC-1234567890123456789',
    }))
    expect(msg).not.toBeNull()
  })

  it('rejects friend:create with a non-string code', () => {
    const msg = parseClientMessage(JSON.stringify({ type: 'friend:create', character: 'wheat', code: 123 }))
    expect(msg).toBeNull()
  })

  it('rejects friend:create with an oversized code', () => {
    const msg = parseClientMessage(JSON.stringify({
      type: 'friend:create', character: 'wheat', code: 'a'.repeat(200),
    }))
    expect(msg).toBeNull()
  })
})

/*
 * The analytics identity rides in on the socket URL's query string, so it is
 * as untrusted as any other client input. It must pass the same shape checks
 * as POST /api/events applies — a row the server writes on a player's behalf
 * has to be indistinguishable from one that player's own client sent.
 */
describe('parseAnalyticsIdentity', () => {
  const params = (s: string) => new URLSearchParams(s)

  it('returns null when the client sends no analytics params at all', () => {
    expect(parseAnalyticsIdentity(params(''))).toBeNull()
  })

  it('returns null when the device id is too short to be a device id', () => {
    expect(parseAnalyticsIdentity(params('device=abc&asid=1234567890&platform=web'))).toBeNull()
  })

  it('returns null when the device id carries characters the events table rejects', () => {
    const bad = 'device=aaaaaaaa.bbbbbbbb&asid=1234567890&platform=web'
    expect(parseAnalyticsIdentity(params(bad))).toBeNull()
  })

  it('accepts uuids and carries the portal host through', () => {
    const id = parseAnalyticsIdentity(params(
      `device=${crypto.randomUUID()}&asid=${crypto.randomUUID()}&platform=gamepush&host=WG_PLAYGROUND`,
    ))
    expect(id).not.toBeNull()
    expect(id!.platform).toBe('gamepush')
    expect(id!.host).toBe('WG_PLAYGROUND')
  })

  it('keeps the identity but drops a host too long to store', () => {
    const id = parseAnalyticsIdentity(params(
      `device=${crypto.randomUUID()}&asid=${crypto.randomUUID()}&platform=web&host=${'h'.repeat(41)}`,
    ))
    expect(id).not.toBeNull()
    expect(id!.host).toBeNull()
  })

  it('returns null when the platform is missing, since every row needs one', () => {
    const id = parseAnalyticsIdentity(params(`device=${crypto.randomUUID()}&asid=${crypto.randomUUID()}`))
    expect(id).toBeNull()
  })
})

describe('parseClientMessage — ping presence flag', () => {
  it('accepts a bare ping (old client)', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'ping' }))).toEqual({ type: 'ping' })
  })

  it('accepts a boolean active flag', () => {
    const msg = parseClientMessage(JSON.stringify({ type: 'ping', active: false }))
    expect(msg).toEqual({ type: 'ping', active: false })
  })

  it('rejects a non-boolean active flag', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'ping', active: 'yes' }))).toBeNull()
  })
})
