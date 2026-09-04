import { Howl, Howler } from 'howler'
import { storageGet, storageSet } from './storage'
import { usePlatform } from './platform'
import type { CharacterType } from '@wheee/shared'

// ---------------------------------------------------------------------------
// Sound IDs
// ---------------------------------------------------------------------------

const LOOP_IDS = [
  'lobby-pad', 'game-drone',
  'lobby-music', 'match-music',
  'wind-loop', 'rain-loop',
  'static-crackle',
] as const

const SFX_IDS = [
  'terrain-raise', 'terrain-lower',
  'player-move', 'wind-push', 'water-rise', 'death',
  'tick-clock', 'tick-urgent', 'action-submit',
  'ui-click', 'match-found', 'victory', 'defeat', 'draw-end', 'queue-enter',
  'predict-correct', 'predict-wrong', 'instrument-break', 'weather-confirm',
  'crate-pickup',
  'thunder-crack', 'thunder-distant',
] as const

export type LoopId = (typeof LOOP_IDS)[number]
export type SfxId = (typeof SFX_IDS)[number]
export type SoundId = LoopId | SfxId

// ---------------------------------------------------------------------------
// Layer volumes (persisted through the platform — localStorage or player profile)
// ---------------------------------------------------------------------------

interface AudioSettings {
  master: number    // 0-1
  music: number     // 0-1
  sfx: number       // 0-1
  muted: boolean
  musicMuted: boolean
  sfxMuted: boolean
}

const STORAGE_KEY = 'wheee-audio-v1'

const DEFAULTS: AudioSettings = {
  master: 0.8,
  music: 0.1,
  sfx: 0.5,
  muted: false,
  musicMuted: false,
  sfxMuted: false,
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)) }

function loadSettings(): AudioSettings {
  try {
    const raw = storageGet(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return {
      master: clamp01(parsed.master ?? DEFAULTS.master),
      music: clamp01(parsed.music ?? DEFAULTS.music),
      sfx: clamp01(parsed.sfx ?? DEFAULTS.sfx),
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULTS.muted,
      musicMuted: typeof parsed.musicMuted === 'boolean' ? parsed.musicMuted : DEFAULTS.musicMuted,
      sfxMuted: typeof parsed.sfxMuted === 'boolean' ? parsed.sfxMuted : DEFAULTS.sfxMuted,
    }
  } catch { return { ...DEFAULTS } }
}

function saveSettings(s: AudioSettings) {
  storageSet(STORAGE_KEY, JSON.stringify(s))
}

// ---------------------------------------------------------------------------
// Per-sound config
// ---------------------------------------------------------------------------

/**
 * Per-crop overrides for the two music loops. Empty today — no regional
 * tracks exist yet — so resolveMusicId always falls back to the shared
 * track below. Populating an entry here (plus adding its file under
 * public/sounds and its SoundId case in def()) is the whole integration
 * point for a future crop-specific track.
 */
const MUSIC_TRACKS: Partial<Record<CharacterType, Partial<Record<'lobby-music' | 'match-music', LoopId>>>> = {}

export function resolveMusicId(base: 'lobby-music' | 'match-music', character?: CharacterType): LoopId {
  return (character && MUSIC_TRACKS[character]?.[base]) || base
}

interface SoundDef {
  src: string
  loop: boolean
  layer: 'ambient' | 'music' | 'sfx'
  baseVolume: number
}

function def(id: SoundId): SoundDef {
  const src = `${import.meta.env.BASE_URL}sounds/${id}.mp3`

  switch (id) {
    // Ambient loops (barely-there bed)
    case 'lobby-pad':    return { src, loop: true,  layer: 'ambient', baseVolume: 0.60 }
    case 'game-drone':   return { src, loop: true,  layer: 'ambient', baseVolume: 0.55 }
    // Music loops (clean plucked notes)
    case 'lobby-music':  return { src, loop: true,  layer: 'music',   baseVolume: 0.75 }
    case 'match-music':  return { src, loop: true,  layer: 'music',   baseVolume: 0.70 }
    // Weather loops
    case 'wind-loop':       return { src, loop: true,  layer: 'sfx', baseVolume: 0.70 }
    case 'rain-loop':       return { src, loop: true,  layer: 'sfx', baseVolume: 0.60 }
    case 'static-crackle':  return { src, loop: true,  layer: 'sfx', baseVolume: 0.12 }
    // Storm one-shots
    case 'thunder-crack':   return { src, loop: false, layer: 'sfx', baseVolume: 0.72 }
    case 'thunder-distant': return { src, loop: false, layer: 'sfx', baseVolume: 0.22 }
    // Gameplay SFX
    case 'terrain-raise':  return { src, loop: false, layer: 'sfx', baseVolume: 0.55 }
    case 'terrain-lower':  return { src, loop: false, layer: 'sfx', baseVolume: 0.55 }
    case 'player-move':    return { src, loop: false, layer: 'sfx', baseVolume: 0.50 }
    case 'wind-push':      return { src, loop: false, layer: 'sfx', baseVolume: 0.65 }
    case 'water-rise':     return { src, loop: false, layer: 'sfx', baseVolume: 0.55 }
    case 'death':          return { src, loop: false, layer: 'sfx', baseVolume: 0.70 }
    case 'tick-clock':     return { src, loop: false, layer: 'sfx', baseVolume: 0.30 }
    case 'tick-urgent':    return { src, loop: false, layer: 'sfx', baseVolume: 0.45 }
    case 'action-submit':  return { src, loop: false, layer: 'sfx', baseVolume: 0.45 }
    // UI SFX
    case 'ui-click':       return { src, loop: false, layer: 'sfx', baseVolume: 0.35 }
    case 'match-found':    return { src, loop: false, layer: 'sfx', baseVolume: 0.60 }
    case 'victory':        return { src, loop: false, layer: 'sfx', baseVolume: 0.65 }
    case 'defeat':         return { src, loop: false, layer: 'sfx', baseVolume: 0.55 }
    case 'draw-end':       return { src, loop: false, layer: 'sfx', baseVolume: 0.50 }
    case 'queue-enter':    return { src, loop: false, layer: 'sfx', baseVolume: 0.40 }
    // Watcher / Architect
    case 'predict-correct':  return { src, loop: false, layer: 'sfx', baseVolume: 0.55 }
    case 'predict-wrong':    return { src, loop: false, layer: 'sfx', baseVolume: 0.35 }
    case 'instrument-break': return { src, loop: false, layer: 'sfx', baseVolume: 0.60 }
    case 'weather-confirm':  return { src, loop: false, layer: 'sfx', baseVolume: 0.55 }
    // Struck-gem chime for the crate pickup — the one moment a badge begins.
    case 'crate-pickup':     return { src, loop: false, layer: 'sfx', baseVolume: 0.60 }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAudioSystem() {
  const settings = loadSettings()
  const howls = new Map<SoundId, Howl>()
  const defs = new Map<SoundId, SoundDef>()
  let disposed = false

  // Platform mute, where the platform has one. Never fatal: a missing adapter
  // just means the game keeps its own settings, as it always did.
  let platformSound: ReturnType<typeof usePlatform>['sound'] | null = null
  try { platformSound = usePlatform().sound } catch { /* platform not initialised */ }

  if (platformSound?.managed) {
    // The host stores mute itself, so its answer outranks ours on startup.
    const state = platformSound.getState()
    settings.muted = state.all
    settings.musicMuted = state.music
    settings.sfxMuted = state.sfx
  }

  const ALL_IDS: SoundId[] = [...LOOP_IDS, ...SFX_IDS]

  for (const id of ALL_IDS) {
    const d = def(id)
    defs.set(id, d)
    howls.set(id, new Howl({
      src: [d.src],
      loop: d.loop,
      volume: 0,
      preload: false,
    }))
  }

  const activeLoops = new Set<SoundId>()
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>()
  let sceneTimers: ReturnType<typeof setTimeout>[] = []
  // A fadeOut's h.stop() runs id-less, so it stops every instance of that Howl —
  // if anything restarts the same loop before this timer lands, a stray stop
  // would silence the fresh instance too. Tracked per id so a restart can
  // cancel the stop it would otherwise be run over by.
  const pendingStops = new Map<SoundId, ReturnType<typeof setTimeout>>()

  function safeTimeout(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      pendingTimers.delete(id)
      if (!disposed) fn()
    }, ms)
    pendingTimers.add(id)
    return id
  }

  function cancelSceneTimers() {
    for (const id of sceneTimers) {
      clearTimeout(id)
      pendingTimers.delete(id)
    }
    sceneTimers = []
  }

  // ------ Volume helpers ------

  function layerGain(layer: 'ambient' | 'music' | 'sfx'): number {
    if (settings.muted) return 0
    // Ambient beds are part of the music track as far as muting goes.
    if (layer === 'sfx' ? settings.sfxMuted : settings.musicMuted) return 0
    const lv = layer === 'sfx' ? settings.sfx : settings.music
    return settings.master * lv
  }

  function resolveVolume(id: SoundId): number {
    const d = defs.get(id)!
    return d.baseVolume * layerGain(d.layer)
  }

  function refreshAllVolumes() {
    for (const id of activeLoops) {
      const h = howls.get(id)!
      h.volume(resolveVolume(id))
    }
  }

  let persistTimer: ReturnType<typeof setTimeout> | null = null

  function persist() {
    refreshAllVolumes()
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => { saveSettings(settings) }, 300)
  }

  // ------ Loop management ------

  /** Cancel a fadeOut's pending id-less stop for `id`, if one is scheduled. */
  function cancelPendingStop(id: SoundId) {
    const t = pendingStops.get(id)
    if (t === undefined) return
    clearTimeout(t)
    pendingTimers.delete(t)
    pendingStops.delete(id)
  }

  function fadeIn(id: SoundId, duration = 800) {
    if (disposed) return
    const h = howls.get(id)!
    const d = defs.get(id)!
    const target = d.baseVolume * layerGain(d.layer)

    if (h.state() === 'unloaded') h.load()
    // A restart must never land under a stop scheduled by an earlier fadeOut —
    // that stop is id-less and would silence this fresh instance right along
    // with the one it was meant for.
    cancelPendingStop(id)

    if (h.playing()) {
      // Still sounding (mid fade-out, most likely): reuse the instance rather
      // than layering a second one on top of it.
      h.fade(h.volume() as number, target, duration)
      activeLoops.add(id)
      return
    }

    h.volume(0)
    h.play()
    h.fade(0, target, duration)
    activeLoops.add(id)
  }

  function fadeOut(id: SoundId, duration = 600) {
    const h = howls.get(id)
    if (!h || !h.playing()) {
      activeLoops.delete(id)
      cancelPendingStop(id)
      return
    }
    const cur = h.volume() as number
    h.fade(cur, 0, duration)
    activeLoops.delete(id)
    cancelPendingStop(id)
    const timer = safeTimeout(() => { h.stop(); pendingStops.delete(id) }, duration + 50)
    pendingStops.set(id, timer)
  }

  function fadeOutLayer(layer: 'ambient' | 'music' | 'sfx', duration = 600) {
    for (const id of [...activeLoops]) {
      if (defs.get(id)!.layer === layer) fadeOut(id, duration)
    }
  }

  // ------ Scene transitions ------

  function enterLobby(character?: CharacterType) {
    cancelSceneTimers()
    stopWeather()
    fadeOutLayer('ambient', 1000)
    fadeOutLayer('music', 1000)
    sceneTimers.push(safeTimeout(() => {
      fadeIn('lobby-pad', 1200)
      fadeIn(resolveMusicId('lobby-music', character), 1500)
    }, 400))
  }

  function enterMatch(character?: CharacterType) {
    cancelSceneTimers()
    stopWeather()
    fadeOut('lobby-pad', 1000)
    fadeOutLayer('music', 1000)
    sceneTimers.push(safeTimeout(() => {
      fadeIn('game-drone', 1200)
      fadeIn(resolveMusicId('match-music', character), 1500)
    }, 600))
  }

  function enterFinished() {
    stopWeather()
    fadeOut('game-drone', 800)
    fadeOutLayer('music', 800)
  }

  // ------ Weather ------

  function startWind() { bedOwned = false; fadeIn('wind-loop', 600) }
  function startRain() { fadeIn('rain-loop', 600) }

  function stopWeather() {
    fadeOut('wind-loop', 800)
    fadeOut('rain-loop', 800)
    bedOwned = false
    setStormAmbience(false)
  }

  // ------ Storm bed (rising wind ahead of the cataclysm) ------

  let bedLevel = 0
  let bedOwned = false   // true while the bed, not the cataclysm, owns wind-loop

  /**
   * The forecast's own hum, well under the cataclysm's wind: rises with the
   * ticks so the storm is heard building before startWind()/beginHush() ever
   * run. Whenever the cataclysm actually claims wind-loop (startWind()) it
   * hands ownership away here and this stops touching the loop's volume —
   * the bed never fights the real gale for the fader.
   */
  function setStormBed(level: number) {
    if (disposed) return
    bedLevel = Math.max(0, Math.min(1, level))
    const h = howls.get('wind-loop')!
    if (bedLevel > 0) {
      if (!activeLoops.has('wind-loop')) {
        if (h.state() === 'unloaded') h.load()
        // Same hazard as fadeIn: a fadeOut's pending id-less stop must not be
        // left free to land on the instance we are about to reuse or start.
        cancelPendingStop('wind-loop')
        if (!h.playing()) { h.volume(0); h.play() }
        activeLoops.add('wind-loop')
        bedOwned = true
      }
      if (bedOwned) h.fade(h.volume() as number, resolveVolume('wind-loop') * 0.35 * bedLevel, 500)
    } else if (bedOwned && activeLoops.has('wind-loop')) {
      fadeOut('wind-loop', 800)
      bedOwned = false
    }
  }

  // ------ Storm effects (hush, duck, ambience, crackle) ------

  /** The fixed, non-crop-dependent loops plus whichever music-layer loop is
   *  currently active — the same layer-based lookup fadeOutLayer/duckMusic
   *  use, so this keeps working once a track resolves to a crop-specific id
   *  instead of the literal 'match-music'. */
  function hushIds(): SoundId[] {
    const ids: SoundId[] = ['wind-loop', 'game-drone']
    for (const id of activeLoops) if (defs.get(id)!.layer === 'music') ids.push(id)
    return ids
  }

  /** The hush before the strike: wind and music sink almost to silence. */
  function beginHush() {
    if (disposed) return
    for (const id of hushIds()) {
      const h = howls.get(id)!
      if (activeLoops.has(id)) h.fade(h.volume() as number, resolveVolume(id) * 0.05, 200)
    }
  }

  function endHush() {
    if (disposed) return
    for (const id of hushIds()) {
      const h = howls.get(id)!
      if (activeLoops.has(id)) h.fade(h.volume() as number, resolveVolume(id), 400)
    }
  }

  /** Cinema duck: dip active music-layer loops for `ms` so the crack cuts through. */
  function duckMusic(ms: number) {
    if (disposed) return
    for (const id of activeLoops) {
      if (defs.get(id)!.layer === 'sfx') continue
      const h = howls.get(id)!
      h.fade(h.volume() as number, resolveVolume(id) * 0.2, 60)
      safeTimeout(() => { if (activeLoops.has(id)) h.fade(h.volume() as number, resolveVolume(id), 300) }, ms)
    }
  }

  let stormAmbienceTimer: ReturnType<typeof setTimeout> | null = null

  /** Random distant rumbles every 10-20s while a storm is active over the scene. */
  function setStormAmbience(active: boolean) {
    if (!active) {
      if (stormAmbienceTimer) { clearTimeout(stormAmbienceTimer); pendingTimers.delete(stormAmbienceTimer) }
      stormAmbienceTimer = null
      return
    }
    if (disposed || stormAmbienceTimer) return
    const tick = () => {
      play('thunder-distant')
      stormAmbienceTimer = safeTimeout(tick, 10_000 + Math.random() * 10_000)
    }
    stormAmbienceTimer = safeTimeout(tick, 3_000 + Math.random() * 5_000)
  }

  function startCrackle() { fadeIn('static-crackle', 600) }
  function stopCrackle() { fadeOut('static-crackle', 800) }

  // ------ One-shot SFX ------

  function play(id: SfxId) {
    if (disposed) return
    const h = howls.get(id)!
    if (h.state() === 'unloaded') h.load()
    if (h.playing()) h.stop()
    h.volume(resolveVolume(id))
    h.play()
  }

  // ------ Volume API ------

  function setMasterVolume(v: number) {
    settings.master = clamp01(v)
    persist()
  }

  function setMusicVolume(v: number) {
    settings.music = clamp01(v)
    persist()
  }

  function setSfxVolume(v: number) {
    settings.sfx = clamp01(v)
    persist()
  }

  /**
   * Mute goes through the platform as well as through Howler: on GamePush the
   * host owns the state, shares it with its own audio button and keeps it across
   * reloads, so the toggle has to reach it.
   */
  function toggleMute() {
    settings.muted = !settings.muted
    Howler.mute(settings.muted)
    platformSound?.setMuted('all', settings.muted)
    persist()
  }

  function toggleMusicMute() {
    settings.musicMuted = !settings.musicMuted
    platformSound?.setMuted('music', settings.musicMuted)
    persist()
  }

  function toggleSfxMute() {
    settings.sfxMuted = !settings.sfxMuted
    platformSound?.setMuted('sfx', settings.sfxMuted)
    persist()
  }

  function isMuted() { return settings.muted }
  function isMusicMuted() { return settings.musicMuted }
  function isSfxMuted() { return settings.sfxMuted }

  function getSettings(): Readonly<AudioSettings> { return settings }

  // ------ Lifecycle ------

  function update(_dt: number) {
    // reserved for future: ducking, dynamic mixing
  }

  // Mute pressed on the platform's own control has to reach the game too.
  const unsubPlatformMute = platformSound?.onChange((state) => {
    settings.muted = state.all
    settings.musicMuted = state.music
    settings.sfxMuted = state.sfx
    Howler.mute(settings.muted)
    persist()
  }) ?? (() => {})

  function dispose() {
    disposed = true
    unsubPlatformMute()
    if (persistTimer) clearTimeout(persistTimer)
    saveSettings(settings)
    cancelSceneTimers()
    for (const id of pendingTimers) clearTimeout(id)
    pendingTimers.clear()
    pendingStops.clear()
    for (const h of howls.values()) h.unload()
    howls.clear()
    activeLoops.clear()
  }

  if (settings.muted) Howler.mute(true)

  return {
    update,
    dispose,
    enterLobby,
    enterMatch,
    enterFinished,
    startWind,
    startRain,
    stopWeather,
    setStormBed,
    beginHush,
    endHush,
    duckMusic,
    setStormAmbience,
    startCrackle,
    stopCrackle,
    play,
    setMasterVolume,
    setMusicVolume,
    setSfxVolume,
    toggleMute,
    toggleMusicMute,
    toggleSfxMute,
    isMuted,
    isMusicMuted,
    isSfxMuted,
    getSettings,
  }
}

export type AudioSystem = ReturnType<typeof createAudioSystem>
