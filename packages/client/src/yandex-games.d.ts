interface YandexGamesPlayer {
  isAuthorized(): boolean
  getUniqueID(): string
  getName(): string
  getPhoto(size: 'small' | 'medium' | 'large'): string
  setData(data: Record<string, unknown>, flush?: boolean): Promise<void>
  getData(keys?: string[]): Promise<Record<string, unknown>>
  setStats(stats: Record<string, number>): Promise<void>
  getStats(keys?: string[]): Promise<Record<string, number>>
  incrementStats(increments: Record<string, number>): Promise<Record<string, number>>
  signature: string
}

interface YandexGamesAdvCallbacks {
  onOpen?: () => void
  onClose?: (wasShown?: boolean) => void
  onError?: (error: unknown) => void
  onRewarded?: () => void
}

interface YandexGamesSDK {
  features: {
    LoadingAPI?: { ready(): void }
    GameplayAPI?: { start(): void; stop(): void }
  }
  auth: {
    openAuthDialog(): Promise<void>
  }
  adv: {
    showFullscreenAdv(params: { callbacks: YandexGamesAdvCallbacks }): void
    showRewardedVideo(params: { callbacks: YandexGamesAdvCallbacks }): void
    showBannerAdv(): Promise<{ stickyAdvIsShowing: boolean }>
    hideBannerAdv(): Promise<{ stickyAdvIsShowing: boolean }>
  }
  environment: {
    app: { id: string }
    i18n: { lang: string; tld: string }
    payload?: string
  }
  getPlayer(opts?: { signed?: boolean }): Promise<YandexGamesPlayer>
  on(event: string, cb: () => void): void
  off(event: string, cb: () => void): void
}

declare const YaGames: {
  init(opts?: { signed?: boolean }): Promise<YandexGamesSDK>
}
