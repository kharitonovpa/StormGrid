interface TelegramSafeAreaInset {
  top: number
  bottom: number
  left: number
  right: number
}

interface TelegramWebApp {
  initData: string
  initDataUnsafe: Record<string, unknown> & { start_param?: string }
  ready: () => void
  expand: () => void
  close: () => void
  disableVerticalSwipes: () => void
  openTelegramLink?: (url: string) => void
  isExpanded: boolean
  viewportHeight: number
  viewportStableHeight: number
  platform: string
  colorScheme: 'light' | 'dark'
  /** Bot API 8.0+. Insets carved out by Telegram's own UI (header, bottom bar). */
  contentSafeAreaInset?: TelegramSafeAreaInset
  /** Bot API 8.0+. Insets carved out by the device (notch, home indicator). */
  safeAreaInset?: TelegramSafeAreaInset
  onEvent?: (eventType: string, callback: () => void) => void
  offEvent?: (eventType: string, callback: () => void) => void
}

interface Window {
  Telegram?: {
    WebApp?: TelegramWebApp
  }
}
