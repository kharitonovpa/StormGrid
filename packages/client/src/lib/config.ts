const dev = import.meta.env.DEV

export const API_BASE = dev
  ? `${location.protocol}//${location.hostname}:3001`
  : (import.meta.env.VITE_API_URL || `${location.protocol}//${location.hostname}`)

export const WS_URL = API_BASE.replace(/^http(s?)/, 'ws$1') + '/ws'
