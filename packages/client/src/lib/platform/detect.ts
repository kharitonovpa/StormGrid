import type { PlatformType } from './types'

export function detectPlatform(): PlatformType {
  if (import.meta.env.VITE_PLATFORM === 'yandex') return 'yandex'
  if (typeof window !== 'undefined'
    && !!window.Telegram?.WebApp?.initData?.length) return 'telegram'
  return 'web'
}
