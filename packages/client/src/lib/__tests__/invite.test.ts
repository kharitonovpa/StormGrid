import { afterEach, describe, expect, it } from 'bun:test'

Object.defineProperty(globalThis, 'location', {
  configurable: true,
  value: {
    hostname: 'html-classic.itch.zone',
    protocol: 'https:',
    origin: 'https://html-classic.itch.zone',
    pathname: '/html/123456/index.html',
    search: '',
  },
})

const { buildInviteUrl } = await import('../invite')

describe('buildInviteUrl', () => {
  const saved = process.env.VITE_PLATFORM

  afterEach(() => {
    if (saved === undefined) delete process.env.VITE_PLATFORM
    else process.env.VITE_PLATFORM = saved
  })

  it('sends friends from itch.io to wheee.io, not to the sandbox frame', () => {
    process.env.VITE_PLATFORM = 'itch'
    expect(buildInviteUrl('ABC234', 'web')).toBe('https://wheee.io/?join=ABC234')
  })

  it('uses the current page on the plain web build', () => {
    delete process.env.VITE_PLATFORM
    expect(buildInviteUrl('ABC234', 'web'))
      .toBe('https://html-classic.itch.zone/html/123456/index.html?join=ABC234')
  })
})
