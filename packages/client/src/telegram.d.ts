interface TelegramWebApp {
  initData: string
  initDataUnsafe: Record<string, unknown>
  ready: () => void
  expand: () => void
  close: () => void
  disableVerticalSwipes: () => void
  isExpanded: boolean
  viewportHeight: number
  viewportStableHeight: number
  platform: string
  colorScheme: 'light' | 'dark'
}

interface Window {
  Telegram?: {
    WebApp?: TelegramWebApp
  }
}
