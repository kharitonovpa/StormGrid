const MAX_TOKENS = 25
const REFILL_PER_SEC = 15
const MAX_MESSAGE_BYTES = 1024
const MAX_INVALID_STREAK = 5

export class ConnectionLimiter {
  private tokens: number
  private lastRefill: number
  private invalidStreak = 0

  constructor(
    private maxTokens = MAX_TOKENS,
    private refillPerSec = REFILL_PER_SEC,
  ) {
    this.tokens = maxTokens
    this.lastRefill = Date.now()
  }

  consume(): boolean {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillPerSec)
    this.lastRefill = now

    if (this.tokens < 1) return false
    this.tokens--
    return true
  }

  checkSize(raw: string): boolean {
    return raw.length <= MAX_MESSAGE_BYTES
  }

  trackInvalid(): boolean {
    this.invalidStreak++
    return this.invalidStreak >= MAX_INVALID_STREAK
  }

  resetInvalid(): void {
    this.invalidStreak = 0
  }
}
