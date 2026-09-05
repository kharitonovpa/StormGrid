import { describe, it, expect, mock, beforeEach } from 'bun:test'

/**
 * Switching crops in the lobby switches music files. The regional variants load
 * on first play, so a second switch can land while the first variant is still
 * downloading. Howler queues play()/fade()/stop() on a Howl that has not loaded
 * and reports playing() === false until the queued play runs — the fade-out
 * must still cancel that queued play, or the first variant starts later, on its
 * own, on top of the second one.
 */

type Queued = () => void

class FakeHowl {
  static bySrc = new Map<string, FakeHowl>()
  readonly src: string
  private state_: 'unloaded' | 'loading' | 'loaded' = 'unloaded'
  private queue: Queued[] = []
  private paused = true
  private vol = 0
  private pos = 0
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
  play(id?: number) {
    this.playCalls++
    if (this.state_ !== 'loaded') { this.queue.push(() => this.play(id)); return 1 }
    this.paused = false
    return 1
  }
  stop() {
    this.stopCalls++
    if (this.state_ !== 'loaded') { this.queue.push(() => this.stop()); return this }
    this.paused = true
    return this
  }
  fade(_from: number, to: number) {
    if (this.state_ !== 'loaded') { this.queue.push(() => this.fade(_from, to)); return this }
    this.vol = to
    return this
  }
  volume(v?: number) { if (v !== undefined) { this.vol = v; return this } return this.vol }
  seek(v?: number) {
    if (v === undefined) return this.pos
    if (this.state_ !== 'loaded') { this.queue.push(() => this.seek(v)); return this }
    this.pos = v
    return this
  }
  playing() { return !this.paused }
  unload() { this.paused = true; this.state_ = 'unloaded'; this.queue = [] }
  on() { return this }
  once(event: string, cb: () => void) { if (event === 'load') this.loadListeners.push(cb); return this }
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

    // corn finally finishes: this replays fadeIn's own queued play() *and* fires
    // the original switchMusic's once('load', start) listener, which is still
    // attached (fadeIn re-adds the same id to activeLoops, so neither the seq
    // check nor the activeLoops-membership check can tell this start is stale —
    // that residual is real, and Howler's own semantics keep it harmless: play()
    // resumes the one paused sound rather than cloning it, and seek() computed
    // from a no-longer-playing rice lands on the same 0 fadeIn would have used).
    corn.finishLoad()
    expect(corn.playing()).toBe(true)
    expect(corn.seek()).toBe(0) // no jump to a stale rice position — landed like a fresh start
    // Exactly the queued play's replay (+1) plus the harmless stale start's own
    // play() (+1) — never a third, which would mean something is re-triggering.
    expect(corn.playCalls).toBe(playCallsBeforeLoad + 2)
    audio.dispose()
  })
})
