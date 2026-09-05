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
  playing() { return !this.paused }
  unload() { this.paused = true; this.state_ = 'unloaded'; this.queue = [] }
  on() { return this }
  once() { return this }
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
