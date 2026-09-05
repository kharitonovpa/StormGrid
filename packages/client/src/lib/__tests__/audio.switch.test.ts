import { describe, it, expect, mock, beforeEach } from 'bun:test'

/**
 * Switching crops in the lobby switches music files. The regional variants load
 * on first play, so a second switch can land while the first variant is still
 * downloading. Howler queues play()/fade()/stop() on a Howl that has not loaded
 * and reports playing() === false until the queued play runs — the fade-out
 * must still cancel that queued play, or the first variant starts later, on its
 * own, on top of the second one.
 *
 * FakeHowl also models Howler's real *per-Howl sound pool*, not just a single
 * boolean: an id-less play() reuses an existing sound only when exactly one
 * exists and it is paused (see FakeHowl.play), otherwise it allocates a new
 * one. That distinction is what a stale, superseded play() call turns into in
 * production — a second, independent, phased copy of the same loop — so a
 * model that only tracked "is *something* playing" could not have caught it.
 */

type Queued = () => void

/** One playable instance under a Howl — the minimal shape Howler tracks per Sound. */
interface FakeSound {
  id: number
  paused: boolean
  pos: number
}

class FakeHowl {
  static bySrc = new Map<string, FakeHowl>()
  readonly src: string
  private state_: 'unloaded' | 'loading' | 'loaded' = 'unloaded'
  private queue: Queued[] = []
  private sounds: FakeSound[] = []
  private nextSoundId = 1
  private vol = 0
  private loadListeners: Array<() => void> = []
  playCalls = 0
  stopCalls = 0

  constructor(opts: { src: string[]; volume?: number }) {
    this.src = opts.src[0]
    this.vol = opts.volume ?? 1
    FakeHowl.bySrc.set(this.src, this)
  }

  state() { return this.state_ }
  load() { if (this.state_ === 'unloaded') this.state_ = 'loading'; return this }
  /** The download finishes: Howler runs everything queued while it was loading, in order. */
  finishLoad() {
    this.state_ = 'loaded'
    const q = this.queue
    this.queue = []
    for (const fn of q) fn()
    const ls = this.loadListeners
    this.loadListeners = []
    for (const cb of ls) cb()
  }
  /**
   * Mirrors Howler's real `_inactiveSound()`: an id-less play() reuses an
   * existing sound only when exactly one exists and it is paused (a looping
   * Web Audio sound never reaches Howler's "ended" state, so that half of the
   * real guard never matters here) — otherwise it allocates a brand new one.
   * Two id-less play() calls on an already-playing loop therefore produce two
   * independent, phased copies of the same track, exactly as real Howler does.
   */
  play(): number {
    this.playCalls++
    if (this.state_ !== 'loaded') { this.queue.push(() => { this.play() }); return -1 }
    const single = this.sounds.length === 1 ? this.sounds[0] : null
    if (single && single.paused) { single.paused = false; return single.id }
    const sound: FakeSound = { id: this.nextSoundId++, paused: false, pos: 0 }
    this.sounds.push(sound)
    return sound.id
  }
  /** Id-less stop(): pauses every sound under this Howl — real Howler's behaviour. */
  stop() {
    this.stopCalls++
    if (this.state_ !== 'loaded') { this.queue.push(() => this.stop()); return this }
    for (const s of this.sounds) s.paused = true
    return this
  }
  /** Id-less fade(): retargets the Howl's one volume, shared by every sound under it. */
  fade(_from: number, to: number) {
    if (this.state_ !== 'loaded') { this.queue.push(() => this.fade(_from, to)); return this }
    this.vol = to
    return this
  }
  volume(v?: number) { if (v !== undefined) { this.vol = v; return this } return this.vol }
  seek(v?: number) {
    const current = () => this.sounds.find((s) => !s.paused) ?? this.sounds[0]
    if (v === undefined) { const s = current(); return s ? s.pos : 0 }
    if (this.state_ !== 'loaded') { this.queue.push(() => this.seek(v)); return this }
    const s = current()
    if (s) s.pos = v
    // No sound exists yet: stash the position as a paused placeholder so the
    // next play() picks it up as its starting position — same as seeking a
    // real Howl ahead of its first play.
    else this.sounds.push({ id: this.nextSoundId++, paused: true, pos: v })
    return this
  }
  playing() { return this.sounds.some((s) => !s.paused) }
  unload() { this.sounds = []; this.state_ = 'unloaded'; this.queue = [] }
  on() { return this }
  once(event: string, cb: () => void) { if (event === 'load') this.loadListeners.push(cb); return this }

  /** Total sounds ever allocated under this Howl (paused or not). */
  get soundCount() { return this.sounds.length }
  /** Sounds currently unpaused — more than one means a doubled, phased loop. */
  get liveSounds() { return this.sounds.filter((s) => !s.paused).length }
}

mock.module('howler', () => ({
  Howl: FakeHowl,
  Howler: { mute() {}, volume() {}, ctx: null },
}))

const { createAudioSystem } = await import('../audio.js')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const howl = (id: string) => {
  const h = [...FakeHowl.bySrc.values()].find((x) => x.src.endsWith(`/${id}.mp3`))
  if (!h) throw new Error(`no Howl for ${id}`)
  return h
}

describe('lobby music switching while a variant is still loading', () => {
  beforeEach(() => { FakeHowl.bySrc.clear() })

  it('does not leave the first variant playing under the second', async () => {
    const audio = createAudioSystem()
    audio.enterLobby('rice')
    await sleep(450) // enterLobby schedules its fade-ins 400 ms out
    const rice = howl('lobby-music-rice')
    expect(rice.state()).toBe('loading')
    expect(rice.playCalls).toBe(1)

    // Second click before the rice file has arrived.
    audio.enterLobby('corn')
    await sleep(450)
    const corn = howl('lobby-music-corn')

    // Both downloads land.
    rice.finishLoad()
    corn.finishLoad()

    expect(corn.playing()).toBe(true)
    expect(rice.playing()).toBe(false)
    audio.dispose()
  })

  it('still plays the variant when nothing interrupts the load', async () => {
    const audio = createAudioSystem()
    audio.enterLobby('rice')
    await sleep(450)
    const rice = howl('lobby-music-rice')
    rice.finishLoad()
    expect(rice.playing()).toBe(true)
    audio.dispose()
  })
})

describe('switchMusic keeps the playhead across a crop switch', () => {
  beforeEach(() => { FakeHowl.bySrc.clear() })

  it('starts the new variant at the old one\'s position and stops the old one after the fade', async () => {
    const audio = createAudioSystem()
    audio.enterLobby('rice')
    await sleep(450)
    const rice = howl('lobby-music-rice')
    rice.finishLoad()
    expect(rice.playing()).toBe(true)
    rice.seek(7.3)
    // Preloading the siblings is deferred 5 s out now (I3), so load this one
    // explicitly to exercise the already-loaded crossfade path.
    const corn = howl('lobby-music-corn')
    corn.load()
    corn.finishLoad()

    audio.enterLobby('corn')
    expect(corn.seek()).toBe(7.3)
    expect(corn.playing()).toBe(true)
    await sleep(700) // fade 600 ms + stop timer
    expect(rice.playing()).toBe(false)
    audio.dispose()
  })

  it('lands in sync when the incoming file is still loading', async () => {
    const audio = createAudioSystem()
    audio.enterLobby('rice')
    await sleep(450)
    const rice = howl('lobby-music-rice')
    rice.finishLoad()
    const corn = howl('lobby-music-corn')
    expect(corn.state()).toBe('unloaded') // preloading the siblings is deferred 5 s out (I3)

    audio.enterLobby('corn')
    expect(corn.state()).toBe('loading') // switchMusic loads it itself
    rice.seek(9.1) // the base keeps running while corn downloads
    corn.finishLoad()
    expect(corn.seek()).toBe(9.1)
    expect(corn.playing()).toBe(true)
    audio.dispose()
  })

  it('keeps the outgoing loop playing and lands in sync when the file arrives after the fade would have ended', async () => {
    const audio = createAudioSystem()
    audio.enterLobby('rice')
    await sleep(450)
    const rice = howl('lobby-music-rice')
    rice.finishLoad()
    rice.seek(7.3)
    const corn = howl('lobby-music-corn')

    audio.enterLobby('corn')
    expect(corn.state()).toBe('loading')
    // Past where the old fixed-duration fade-out (600 ms) and stop timer (+50 ms)
    // would have silenced rice regardless of whether corn had arrived.
    await sleep(700)
    expect(rice.playing()).toBe(true) // still audible — no gap while corn downloads
    rice.seek(8.0)
    corn.finishLoad()
    expect(corn.seek()).toBe(8.0) // the crossfade only starts now, in sync
    expect(corn.playing()).toBe(true)
    await sleep(700) // fade 600 ms + stop timer, now that the crossfade has actually started
    expect(rice.playing()).toBe(false)
    audio.dispose()
  })
})

describe('switchMusic drops a target superseded before its file lands', () => {
  beforeEach(() => { FakeHowl.bySrc.clear() })

  it('does not resurrect a switch target superseded by a later switchMusic', () => {
    const audio = createAudioSystem()
    audio.switchMusic('lobby-music')
    const base = howl('lobby-music')
    expect(base.state()).toBe('loading')

    // Superseded before the base variant ever finishes loading.
    audio.switchMusic('lobby-music-rice')
    const rice = howl('lobby-music-rice')

    base.finishLoad()
    expect(base.playing()).toBe(false)

    rice.finishLoad()
    expect(rice.playing()).toBe(true)
    audio.dispose()
  })

  it('does not resurrect a lobby switch superseded by enterMatch', async () => {
    const audio = createAudioSystem()
    audio.enterLobby()
    await sleep(450)

    audio.switchMusic('lobby-music-rice')
    const rice = howl('lobby-music-rice')
    expect(rice.state()).toBe('loading') // still downloading when the match starts

    audio.enterMatch()
    rice.finishLoad()
    expect(rice.playing()).toBe(false)
    audio.dispose()
  })

  it('re-entering the lobby does not re-arm a superseded switch', async () => {
    const audio = createAudioSystem()
    audio.enterLobby('rice')
    await sleep(450)
    const rice = howl('lobby-music-rice')
    rice.finishLoad()
    expect(rice.playing()).toBe(true)

    // A crop switch starts downloading lobby-music-corn...
    audio.enterLobby('corn')
    const corn = howl('lobby-music-corn')
    expect(corn.state()).toBe('loading')

    // ...but the match starts before it lands: fadeOutLayer drops both rice and
    // the pending corn switch from activeLoops (match-music/game-drone fade in).
    audio.enterMatch()
    await sleep(700)

    // Back to the lobby with the same crop: current music is 'match-music', so
    // this is the cold fade-out/fade-in path, not another switchMusic — lobby-pad
    // was faded out, so lobby-music-corn re-fades in via fadeIn 400 ms out.
    audio.enterLobby('corn')
    await sleep(450)
    const playCallsBeforeLoad = corn.playCalls

    // corn finally finishes: this replays fadeIn's own queued play(). It also
    // fires the original switchMusic's once('load', start) listener, which is
    // still attached — fadeIn re-adds the same id to activeLoops, so the
    // membership check alone can't tell this start is stale. But fadeIn also
    // bumps musicSwitchSeq for every music-layer id it starts (not just this
    // one — the match-music fadeIn at the top of this test already did, and
    // this corn fadeIn does again), so the stale start's captured seq is long
    // out of date by the time it runs: the token guard blocks it before it can
    // call play()/seek() at all. Before that fix, this stale start *did* run —
    // reusing the model's old single-boolean FakeHowl couldn't show it, but a
    // real Howl only recycles a sound when exactly one is paused, and a
    // playing loop never is, so the stale start's own play() would have
    // allocated a second, independent, phased copy of the same loop.
    corn.finishLoad()
    expect(corn.playing()).toBe(true)
    expect(corn.seek()).toBe(0) // the legitimate fadeIn start — never seeks — landed at 0
    expect(corn.playCalls).toBe(playCallsBeforeLoad + 1) // only the queued play's replay
    expect(corn.liveSounds).toBe(1) // exactly one live sound — the stale start allocated nothing
    expect(corn.soundCount).toBe(1) // not even a second, still-paused sound was left behind
    audio.dispose()
  })
})
