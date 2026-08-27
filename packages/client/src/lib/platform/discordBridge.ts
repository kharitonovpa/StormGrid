/**
 * SDK-free window into the Discord adapter. The adapter (a lazily imported
 * chunk that owns @discord/embedded-app-sdk) registers its live handles here
 * during init(); on every other platform the getters return inert defaults —
 * so App.vue and analytics can import this file statically without dragging
 * the SDK into non-discord builds.
 */
export type DiscordHandles = {
  instanceCode: string | null
  customId: string | null
  referrerId: string | null
  guildId: string | null
  shareLink: (code: string, message: string) => Promise<boolean>
  onParticipantCount: (cb: (count: number) => void) => () => void
}

let handles: DiscordHandles | null = null

export function registerDiscordHandles(h: DiscordHandles): void {
  handles = h
}

export function getDiscordInstanceCode(): string | null {
  return handles?.instanceCode ?? null
}

export function getDiscordCustomId(): string | null {
  return handles?.customId ?? null
}

export function getDiscordReferrerId(): string | null {
  return handles?.referrerId ?? null
}

/**
 * Where the activity was launched from. Discord hands back a guildId only for
 * launches inside a server voice channel; DMs, group DMs and the App Launcher
 * all arrive with it null — so this is the guild/everything-else split, not a
 * full breakdown of the three surfaces.
 */
export function getDiscordSurface(): string | null {
  return handles ? (handles.guildId ? 'guild' : 'dm') : null
}

export function getDiscordGuildId(): string | null {
  return handles?.guildId ?? null
}

export function shareDiscordLink(code: string, message: string): Promise<boolean> {
  return handles ? handles.shareLink(code, message) : Promise.resolve(false)
}

export function onDiscordParticipantCount(cb: (count: number) => void): () => void {
  return handles ? handles.onParticipantCount(cb) : () => {}
}
