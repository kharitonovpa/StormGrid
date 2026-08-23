const dev = import.meta.env.DEV

/**
 * Inside a Discord Activity every request must stay on the activity's own
 * origin ({clientId}.discordsays.com) — the portal's URL Mapping /gameapi →
 * api.wheee.io forwards both https and wss. The hostname check covers a build
 * that reaches Discord without the env pin.
 */
const isDiscord = import.meta.env.VITE_PLATFORM === 'discord'
  || (typeof location !== 'undefined' && location.hostname.endsWith('.discordsays.com'))

export const API_BASE = isDiscord
  ? `${location.origin}/gameapi`
  : dev
    ? `${location.protocol}//${location.hostname}:3001`
    : (import.meta.env.VITE_API_URL || `${location.protocol}//${location.hostname}`)

export const WS_URL = API_BASE.replace(/^http(s?)/, 'ws$1') + '/ws'
