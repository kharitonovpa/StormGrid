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
}

interface Window {
  Telegram?: {
    WebApp?: TelegramWebApp
  }
}
