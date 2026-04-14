import { Howl, Howler } from 'howler'

// ---------------------------------------------------------------------------
// Sound IDs
// ---------------------------------------------------------------------------

const LOOP_IDS = [
  'lobby-pad', 'game-drone',
  'lobby-music', 'match-music',
  'wind-loop', 'rain-loop',
] as const

const SFX_IDS = [
  'terrain-raise', 'terrain-lower',
  'player-move', 'wind-push', 'water-rise', 'death',
  'tick-clock', 'tick-urgent', 'action-submit',
  'ui-click', 'match-found', 'victory', 'defeat', 'draw-end', 'queue-enter',
  'predict-correct', 'predict-wrong', 'instrument-break', 'weather-confirm',
] as const

export type LoopId = (typeof LOOP_IDS)[number]
export type SfxId = (typeof SFX_IDS)[number]
export type SoundId = LoopId | SfxId

// ---------------------------------------------------------------------------
// Layer volumes (persisted to localStorage)
// ---------------------------------------------------------------------------

interface AudioSettings {
  master: number    // 0-1
  music: number     // 0-1
  sfx: number       // 0-1
  muted: boolean
}

const STORAGE_KEY = 'wheee-audio-v1'

const DEFAULTS: AudioSettings = {
  master: 0.8,
  music: 0.1,
  sfx: 0.5,
  muted: false,
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)) }

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return {
      master: clamp01(parsed.master ?? DEFAULTS.master),
      music: clamp01(parsed.music ?? DEFAULTS.music),
      sfx: clamp01(parsed.sfx ?? DEFAULTS.sfx),
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULTS.muted,
    }
  } catch { return { ...DEFAULTS } }
}

function saveSettings(s: AudioSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Per-sound config
// ---------------------------------------------------------------------------

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
    case 'wind-loop':    return { src, loop: true,  layer: 'sfx',     baseVolume: 0.70 }
    case 'rain-loop':    return { src, loop: true,  layer: 'sfx',     baseVolume: 0.60 }
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

  function fadeIn(id: SoundId, duration = 800) {
    if (disposed) return
    const h = howls.get(id)!
    const d = defs.get(id)!
    const target = d.baseVolume * layerGain(d.layer)

    if (h.state() === 'unloaded') h.load()

    if (activeLoops.has(id) && h.playing()) {
      h.fade(h.volume() as number, target, duration)
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
      return
    }
    const cur = h.volume() as number
    h.fade(cur, 0, duration)
    activeLoops.delete(id)
    safeTimeout(() => { h.stop() }, duration + 50)
  }

  function fadeOutLayer(layer: 'ambient' | 'music' | 'sfx', duration = 600) {
    for (const id of [...activeLoops]) {
      if (defs.get(id)!.layer === layer) fadeOut(id, duration)
    }
  }

  // ------ Scene transitions ------

  function enterLobby() {
    cancelSceneTimers()
    stopWeather()
    fadeOutLayer('ambient', 1000)
    fadeOutLayer('music', 1000)
    sceneTimers.push(safeTimeout(() => {
      fadeIn('lobby-pad', 1200)
      fadeIn('lobby-music', 1500)
    }, 400))
  }

  function enterMatch() {
    cancelSceneTimers()
    stopWeather()
    fadeOut('lobby-pad', 1000)
    fadeOut('lobby-music', 1000)
    sceneTimers.push(safeTimeout(() => {
      fadeIn('game-drone', 1200)
      fadeIn('match-music', 1500)
    }, 600))
  }

  function enterFinished() {
    stopWeather()
    fadeOut('game-drone', 800)
    fadeOut('match-music', 800)
  }

  // ------ Weather ------

  function startWind() { fadeIn('wind-loop', 600) }
  function startRain() { fadeIn('rain-loop', 600) }

  function stopWeather() {
    fadeOut('wind-loop', 800)
    fadeOut('rain-loop', 800)
  }

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

  function toggleMute() {
    settings.muted = !settings.muted
    Howler.mute(settings.muted)
    persist()
  }

  function isMuted() { return settings.muted }

  function getSettings(): Readonly<AudioSettings> { return settings }

  // ------ Lifecycle ------

  function update(_dt: number) {
    // reserved for future: ducking, dynamic mixing
  }

  function dispose() {
    disposed = true
    if (persistTimer) clearTimeout(persistTimer)
    saveSettings(settings)
    cancelSceneTimers()
    for (const id of pendingTimers) clearTimeout(id)
    pendingTimers.clear()
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
    play,
    setMasterVolume,
    setMusicVolume,
    setSfxVolume,
    toggleMute,
    isMuted,
    getSettings,
  }
}

export type AudioSystem = ReturnType<typeof createAudioSystem>
