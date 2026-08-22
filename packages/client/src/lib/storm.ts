import * as THREE from 'three'
import { HALF } from './constants'
import type { WindDir } from '@wheee/shared'

/* ── Constants ──────────────────────────────────────────── */

const DOME_RADIUS = 220            // verify: must sit inside the camera far plane
const BASE = new THREE.Color(0x0a0e14)          // today's void, exactly
const STORM = new THREE.Color(0x1a1230)         // deep slate-violet mass
const DIM = new THREE.Color(0x070a10)           // the rest of the sky sinks slightly

// CONVENTION: WindDir ('N'/'E'/'S'/'W') names the direction the wind TRAVELS
// (see DIRECTIONS in packages/shared/src/constants.ts and pushPlayer in
// packages/server/src/engine/wind.ts — 'N' pushes players toward -z). The sky
// mass, by contrast, sits over the horizon the wind is coming FROM — the
// upwind/source bearing, which is the opposite of the travel bearing. Do not
// "fix" this back to the travel bearing: that is the inversion this comment
// exists to prevent. N travels toward -z, so its source is +z: atan2(0,+1) = 0.
const DIR_AZIMUTH: Record<WindDir, number> = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 }

// The dial needle's spring feel (ForecastPanel), slowed for a sky-sized mass.
const SPRING_K = 3.2
const SPRING_D = 2.6
const OSC_RATE = 0.65              // needle uses 1.3; the sky drifts at half tempo
const BROKEN_JUMP_MIN = 0.5
const BROKEN_JUMP_MAX = 1.2

const SPREAD_MIN = 0.55            // radians, sector half-width at intensity 0
const SPREAD_MAX = 1.15            // swollen mass at intensity 1

const DISCHARGE_RATES = { cataclysm: 1 / 1.8, exhale: 1 / 2.0, fast: 1 / 0.3 }

const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

const FRONT_COUNT = 1800              // a wall of mist needs numbers; each mote is large and faint
const FRONT_FAR = HALF * 3            // far horizon distance at intensity 0
const FRONT_NEAR = HALF * 1.15        // just beyond the board edge at tick 5 (intensity 1)
const FRONT_HEIGHT = 9
const FRONT_SIZE_MIN = 2.2            // point size, scaled by 200/depth like wind.ts's dust
const FRONT_SIZE_MAX = 5.5
const FRONT_JITTER = HALF * 0.08      // per-particle radial jitter amplitude
const SWEEP_MS = 1200
const SWEEP_TARGET = -HALF * 1.2      // across and past the board
const SWEEP_AZ_TAU = 0.25             // seconds; how fast the mass commits to the true bearing mid-sweep
const HOLD_RELEASE = 0.02             // intensity at which a swept front may leave its parking spot
const REENTRY_TAU = 0.35              // seconds; how fast a dropped front walks back to where the mass wants it
const REENTRY_EPS = HALF * 0.05       // close enough to stop easing and track the mass exactly

interface FrontParticle {
  arcT: number         // slot along the arc, -1..1 (scaled by the dome's current spread)
  jitterPhase: number
  jitterAmp: number
  height: number
  bobPhase: number
  bobSpeed: number
}

function makeFrontParticles(): FrontParticle[] {
  const arr: FrontParticle[] = []
  for (let i = 0; i < FRONT_COUNT; i++) {
    arr.push({
      arcT: Math.random() * 2 - 1,
      jitterPhase: Math.random() * Math.PI * 2,
      jitterAmp: Math.random() * FRONT_JITTER,
      // biased low: the mass is thickest along the ground and thins out upward
      height: Math.pow(Math.random(), 1.7) * FRONT_HEIGHT,
      bobPhase: Math.random() * Math.PI * 2,
      bobSpeed: 0.3 + Math.random() * 0.4,
    })
  }
  return arr
}

export function createStormSystem(scene: THREE.Scene) {
  /* ── Dome ── */
  const geo = new THREE.SphereGeometry(DOME_RADIUS, 48, 24)
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uAzimuth:   { value: 0 },
      uIntensity: { value: 0 },
      uSpread:    { value: SPREAD_MIN },
      uZenith:    { value: 0 },      // 1 = calm+stormy: menace overhead, horizon clean
      uCalmClean: { value: 0 },      // 1 = calm+dry: no horizon mass, no zenith either — dim only
      uBase:  { value: BASE },
      uStorm: { value: STORM },
      uDim:   { value: DIM },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAzimuth, uIntensity, uSpread, uZenith, uCalmClean;
      uniform vec3 uBase, uStorm, uDim;
      varying vec3 vDir;
      void main() {
        float ang = atan(vDir.x, vDir.z);
        float d = abs(mod(ang - uAzimuth + 3.14159265, 6.2831853) - 3.14159265);
        // horizon sector: strongest at the horizon, fading by 45 degrees up.
        // Killed outright in zenith mode (the darkness moved overhead) and in
        // calm-clean mode (no wind coming and no bolt to hide either — a
        // horizon sector here would paint a bearing the vane never gave).
        float horizon = smoothstep(uSpread, 0.0, d) * smoothstep(0.7, 0.05, vDir.y) * (1.0 - uZenith) * (1.0 - uCalmClean);
        // zenith mode: darkness pools overhead instead
        float zenith = smoothstep(0.25, 0.9, vDir.y) * uZenith;
        float mass = clamp(horizon + zenith, 0.0, 1.0) * uIntensity;
        vec3 sky = mix(uBase, uDim, uIntensity * 0.6);   // the whole world dims a little
        gl_FragColor = vec4(mix(sky, uStorm, mass), 1.0);
        // Colour management: THREE.Color holds linear-sRGB, and three.js appends the
        // output transform only to its own materials — a ShaderMaterial that writes
        // gl_FragColor has to ask for it. Without this line every colour above is
        // written raw into an sRGB framebuffer and the whole sky lands ~9x too dark:
        // BASE #0a0e14 renders as #010102 and the storm mass as #030208, which is
        // both invisible and darker than the scene background it replaces.
        #include <colorspace_fragment>
      }
    `,
  })
  const dome = new THREE.Mesh(geo, mat)
  dome.renderOrder = -1
  scene.add(dome)

  /* ── Front curtain ── */
  const frontParticles = makeFrontParticles()
  const frontPositions = new Float32Array(FRONT_COUNT * 3)
  const frontSizes = new Float32Array(FRONT_COUNT)
  const frontAlphas = new Float32Array(FRONT_COUNT)
  for (let i = 0; i < FRONT_COUNT; i++) {
    frontSizes[i] = FRONT_SIZE_MIN + Math.random() * (FRONT_SIZE_MAX - FRONT_SIZE_MIN)
    frontAlphas[i] = 0.2 + Math.random() * 0.6
  }
  const frontGeo = new THREE.BufferGeometry()
  frontGeo.setAttribute('position', new THREE.BufferAttribute(frontPositions, 3))
  frontGeo.setAttribute('aSize', new THREE.BufferAttribute(frontSizes, 1))
  frontGeo.setAttribute('aAlpha', new THREE.BufferAttribute(frontAlphas, 1))
  const frontPosAttr = frontGeo.getAttribute('position') as THREE.BufferAttribute
  // Rewritten every active frame (see update()); StaticDrawUsage's default
  // hint would ask the driver to optimize for a buffer that almost never
  // changes, which this one is the opposite of.
  frontPosAttr.setUsage(THREE.DynamicDrawUsage)
  /**
   * Soft round motes, the same shape wind.ts's dust uses. A plain PointsMaterial
   * draws hard axis-aligned squares, which read as glitch artefacts rather than
   * as weather — the radial falloff on gl_PointCoord is what makes the front a
   * mist instead of a scatter of cubes.
   */
  const frontMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(0x9d8fd0) },
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (200.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float alpha = smoothstep(1.0, 0.2, d) * vAlpha * uOpacity;
        if (alpha <= 0.0) discard;
        gl_FragColor = vec4(uColor, alpha);
        #include <colorspace_fragment>
      }
    `,
  })
  const front = new THREE.Points(frontGeo, frontMat)
  // The boundingSphere three.js culls against is computed once from frame-1
  // positions and never invalidated as the curtain marches — orbiting or
  // zooming toward the board can cull the whole front while the dome still
  // darkens above it. The same idiom lightning.ts already uses for its bolts.
  front.frustumCulled = false
  scene.add(front)

  /* ── State ── */
  let candidates: WindDir[] = []
  let vaneBroken = false
  let stormyRaw = false             // the true lightningProbability >= 0.5, as setForecast last gave it
  let barometerBroken = false
  let brokenStormyVal = false       // barometer-broken stand-in for stormyRaw, re-rolled below
  let brokenStormyT = 0
  let azimuth = 0
  let azVel = 0
  let oscT = 0
  let brokenT = 0
  let brokenTarget = 0
  let progress = 0                  // set by ticks
  let intensity = 0                 // eased toward progress, or drained by discharge
  let discharging: keyof typeof DISCHARGE_RATES | null = null
  let sleeping = true               // true while intensity === 0 and target === 0

  let frontDist = FRONT_FAR          // curtain center distance, frozen while halted
  let frontTime = 0                  // clock for jitter/bob animation
  let sweepOverride: number | null = null   // takes precedence over the intensity-derived distance
  /**
   * The true source bearing for the in-flight (or held) sweep, set the instant
   * `sweep(dir)` fires and used ONLY for the front curtain's placement — never
   * for the dome's `azimuth` spring, which must never visibly jump. Without
   * this the curtain marches wherever the still-oscillating spring's `azimuth`
   * happens to be (up to ~3s to settle, longer than the whole crossing), which
   * can leave it visibly on the wrong horizon for a two-candidate round.
   */
  let sweepAngle: number | null = null
  /**
   * The sweepToken that last set `sweepAngle`. Guards a stale sweep's own
   * cleanup (the `token !== sweepToken` branch in `sweep()`'s step loop) from
   * clobbering a NEWER sweep's angle: if sweep B supersedes sweep A while A's
   * step loop still has one more animation-frame tick queued, that queued tick
   * fires after B has already set its own `sweepAngle` — without this guard
   * A's stale cleanup would null it right back out, and B's front would march
   * on the wrong bearing for its entire crossing. `sweepOverride` doesn't need
   * this because B's step loop re-sets it every frame; `sweepAngle` is set
   * once per sweep and never refreshed, so it has no other way to self-heal.
   */
  let sweepAngleGen = 0
  let sweepToken = 0
  let halted = false
  /**
   * Set once a sweep has finished: the override is kept parked past the board
   * until the mass has all but drained, so a front that crossed the world does
   * not pop back to the horizon while it is still bright enough to be seen.
   */
  let sweepHold = false
  /**
   * Set whenever the override is dropped: the curtain walks back to wherever the
   * mass wants it instead of teleporting there. On the ordinary path it is dropped
   * at an invisible intensity and this costs nothing; on an interrupted one (a
   * round:start landing mid-drain) it is what keeps 400 points from jumping the
   * width of the world in a single frame.
   */
  let reentry = false

  /* ── Tremor (tick 5: the last, worst tick before the strike) ── */
  let tremorActive = false
  let tremorAmp = 0                  // eased 0..1 envelope, never a snap on/off
  const tremorOffset = new THREE.Vector3()

  /**
   * Give the curtain's distance back to the intensity — always eased, never a
   * jump. Pass `ownerToken` when calling from a sweep's own step loop (the
   * only call site that can race a newer, superseding sweep): `sweepAngle` is
   * only cleared if no newer sweep has claimed it since. Call sites outside a
   * step loop (releaseSweepHold, halt) have no such race — they always clear.
   */
  function dropOverride(ownerToken?: number) {
    sweepHold = false
    sweepOverride = null
    if (ownerToken === undefined || sweepAngleGen === ownerToken) sweepAngle = null
    reentry = true
  }

  /** Retire a parked, swept-through front. Nothing parked, nothing to do. */
  function releaseSweepHold() {
    if (sweepHold) dropOverride()
  }

  function shortestArc(from: number, to: number): number {
    let d = to - from
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    return d
  }

  function azimuthTarget(): number {
    if (vaneBroken) return brokenTarget
    if (candidates.length === 0) return azimuth
    if (candidates.length === 1) return DIR_AZIMUTH[candidates[0]]
    const a = DIR_AZIMUTH[candidates[0]]
    const b = DIR_AZIMUTH[candidates[1]]
    const t = (Math.sin(oscT * OSC_RATE) + 1) / 2
    return a + shortestArc(a, b) * t
  }

  function dischargeImpl(mode: 'cataclysm' | 'exhale' | 'fast') {
    discharging = mode
    progress = 0
    halted = false
  }

  return {
    setForecast(c: WindDir[], broken: boolean, stormy: boolean, baroBroken: boolean) {
      candidates = [...c]
      vaneBroken = broken
      stormyRaw = stormy
      barometerBroken = baroBroken
      // Zenith mode (and its calm-clean opposite, see update()) are computed
      // every frame there, not here — the barometer scramble below has its own
      // cadence and must keep re-rolling between forecasts, not just at the
      // instant one arrives.
      //
      // Note: `discharging = null` deliberately does NOT live here any more.
      // This watcher re-fires on every gameState change, so a mid-match
      // resetVisuals() -> discharge('fast') used to get cancelled within the
      // same flush, stretching the ~0.3s fast fade into the ~1s ease. Progress
      // resets (setProgress) still cancel a stale discharge; a forecast update
      // must not.
      //
      // A newborn storm owns the curtain: whatever the last one swept through is
      // handed back to the intensity here rather than left parked past the board
      // for a whole round. Eased, so an interruption mid-drain does not pop.
      releaseSweepHold()
      // A dead sky may snap its azimuth to the newborn storm — invisible at intensity 0.
      if (sleeping && c.length > 0) { azimuth = DIR_AZIMUTH[c[0]]; azVel = 0 }
    },
    setProgress(t: number) {
      progress = Math.max(0, Math.min(1, t))
      discharging = null
      // A storm that is building again owns the curtain's distance too; a hold left
      // over from the last one would park it past the board for the whole round.
      releaseSweepHold()
    },
    discharge: dischargeImpl,
    setTremor(active: boolean) { tremorActive = active },
    getCameraOffset() { return tremorOffset },
    sweep(dir: WindDir): Promise<void> {
      if (REDUCED || halted) {
        // reduced motion (or an already-halted front): cross-fade out instead of marching
        dischargeImpl('cataclysm')
        return Promise.resolve()
      }
      const token = ++sweepToken
      const from = frontDist
      const to = SWEEP_TARGET
      const started = performance.now()
      azVel = 0
      sweepHold = false
      candidates = [dir]              // the storm commits to its real direction
      // The crossing itself must always follow the TRUE source bearing, not
      // wherever the pre-round oscillator spring happens to be — that spring
      // can take ~3s to settle, longer than the whole SWEEP_MS crossing. See
      // sweepAngle's declaration and its use in update()'s particle placement.
      sweepAngleGen = token
      sweepAngle = DIR_AZIMUTH[dir]
      // By now the direction is public — weather:result has already announced it —
      // so a broken vane stops mattering: the front must march the same way the
      // gale and the bodies do, not off at the needle's last random bearing.
      vaneBroken = false
      return new Promise((resolve) => {
        const step = () => {
          if (token !== sweepToken) { dropOverride(token); resolve(); return }
          const t = Math.min(1, (performance.now() - started) / SWEEP_MS)
          sweepOverride = from + (to - from) * (t * t)   // accelerating crossing
          if (t >= 1) {
            // Parked past the board rather than let go: the discharge is slower
            // than the crossing, and a front released here would snap back to
            // the horizon still bright enough to be seen doing it. update()
            // hands the distance back once the mass has all but drained.
            sweepOverride = to
            sweepHold = true
            resolve()
          } else requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      })
    },
    halt() {                          // lightning hush: the front freezes mid-air
      halted = true
      sweepToken++                    // cancels any sweep in flight (its promise resolves)
      // A sweep that already finished has no frame left to run and would keep the
      // override parked. Dropping it here leaves the curtain frozen where the
      // crossing left it — exactly what a halt means — and the discharge that
      // un-halts it later eases it home rather than snapping it back.
      releaseSweepHold()
    },
    update(dt: number) {
      oscT += dt
      if (vaneBroken) {
        brokenT += dt
        if (brokenT > BROKEN_JUMP_MIN + Math.random() * (BROKEN_JUMP_MAX - BROKEN_JUMP_MIN)) {
          brokenTarget = Math.random() * 2 * Math.PI - Math.PI
          brokenT = 0
        }
      }
      // A broken barometer is what hides rain/lightning from the whole sky, not
      // just the dial: re-roll a stand-in for "is it stormy" on the same cadence
      // ForecastPanel's own brokenStormy uses (~0.12-0.30s), so orbiting up to
      // read zenith mode is no better an oracle than staring at the cracked icon.
      if (barometerBroken) {
        brokenStormyT += dt
        if (brokenStormyT > 0.12 + Math.random() * 0.18) {
          brokenStormyVal = Math.random() < 0.5
          brokenStormyT = 0
        }
      }
      // azimuth spring (drifting mass, never a visible jump). While a sweep is
      // actually in flight (not yet parked in its hold), the dome commits to
      // the true bearing on a fast ~0.25s time constant instead of chasing the
      // (soon-stale, possibly two-candidate) oscillator target — still eased,
      // never a teleport, so it stops visibly contradicting the curtain for
      // the last stretch of the crossing without violating "azimuth never
      // jumps while visible." Outside a sweep the ordinary spring feel is
      // untouched, including the broken-vane roaming target.
      if (sweepAngle !== null && !sweepHold) {
        const diff = shortestArc(azimuth, sweepAngle)
        azimuth += diff * Math.min(1, dt / SWEEP_AZ_TAU)
        azVel = 0
      } else {
        const force = shortestArc(azimuth, azimuthTarget()) * SPRING_K - azVel * SPRING_D
        azVel += force * dt
        azimuth += azVel * dt
      }

      // intensity: eased toward progress, or drained by a discharge
      if (discharging) {
        intensity = Math.max(0, intensity - DISCHARGE_RATES[discharging] * dt)
        if (intensity === 0) discharging = null
      } else {
        const target = progress
        intensity += (target - intensity) * Math.min(1, dt * 1.6)
        if (Math.abs(target - intensity) < 0.004) intensity = target
      }
      sleeping = intensity < 0.002 && progress === 0 && !discharging

      const spread = SPREAD_MIN + (SPREAD_MAX - SPREAD_MIN) * intensity

      // A calm forecast is one where the vane has nothing to point at: intact
      // and given zero candidates. A broken vane must keep the horizon mass
      // roaming at random bearings (that ambiguity is deliberate), so it never
      // counts as calm. Calm+stormy pools the darkness overhead (zenith mode,
      // unchanged); calm+dry shows neither — just the global dim.
      const calm = !vaneBroken && candidates.length === 0
      const effectiveStormy = barometerBroken ? brokenStormyVal : stormyRaw
      const zenithTarget = calm && effectiveStormy ? 1 : 0
      const calmCleanTarget = calm && !effectiveStormy ? 1 : 0

      const u = mat.uniforms
      u.uAzimuth.value = azimuth
      u.uIntensity.value = intensity
      u.uSpread.value = spread
      u.uZenith.value += (zenithTarget - u.uZenith.value) * Math.min(1, dt * 2)
      u.uCalmClean.value += (calmCleanTarget - u.uCalmClean.value) * Math.min(1, dt * 2)

      // A swept-through front waits past the board until it is too faint to be
      // caught returning: the ordinary, invisible end of a crossing.
      if (sweepHold && intensity < HOLD_RELEASE) releaseSweepHold()

      // The curtain costs real per-frame work (1800 particles, 4 trig calls
      // each, a 21.6KB attribute re-upload) for zero visual return whenever the
      // storm is asleep — lobby, replays, menus, the whole time nothing is
      // building. Skipped outright there, and the mesh hidden so a frozen,
      // stale buffer never gets a frame to render.
      front.visible = !sleeping
      if (!sleeping) {
        // curtain center distance: intensity-derived, unless a sweep is overriding it,
        // unless the front is halted (frozen — no more advancing either way). A front
        // that has just been handed back eases home over a few tenths of a second
        // instead of jumping there, then tracks the mass exactly again.
        const distTarget = FRONT_FAR - (FRONT_FAR - FRONT_NEAR) * intensity
        if (sweepOverride !== null) frontDist = sweepOverride
        else if (!halted) {
          if (reentry) {
            frontDist += (distTarget - frontDist) * Math.min(1, dt / REENTRY_TAU)
            if (Math.abs(distTarget - frontDist) < REENTRY_EPS) reentry = false
          } else frontDist = distTarget
        }

        frontTime += dt
        for (let i = 0; i < FRONT_COUNT; i++) {
          const p = frontParticles[i]
          // Front placement follows the sweep's true source bearing while one
          // is in flight or parked in its hold; otherwise it tracks the dome's
          // own (never-jumping) spring azimuth exactly as before.
          const angle = (sweepAngle ?? azimuth) + p.arcT * spread
          const jitter = Math.sin(frontTime * 0.5 + p.jitterPhase) * p.jitterAmp
          const dist = frontDist + jitter
          const bob = Math.sin(frontTime * p.bobSpeed + p.bobPhase) * 0.6
          frontPositions[i * 3] = Math.sin(angle) * dist
          frontPositions[i * 3 + 1] = p.height + bob
          frontPositions[i * 3 + 2] = Math.cos(angle) * dist
        }
        frontPosAttr.needsUpdate = true
        // hidden entirely in zenith mode (calm+stormy: nothing comes along the
        // ground) and in calm-clean mode (calm+dry: no front was ever coming)
        frontMat.uniforms.uOpacity.value = 0.5 * intensity * (1 - u.uZenith.value) * (1 - u.uCalmClean.value)
      }

      // Tremor: an eased envelope (never a snap on/off) driving a small jittery
      // offset off the shared oscillator clock. Reduced motion kills it outright.
      tremorAmp += ((tremorActive && !REDUCED ? 1 : 0) - tremorAmp) * Math.min(1, dt * 2.5)
      if (tremorAmp > 0.001) {
        const t = oscT * 9 * 2 * Math.PI
        tremorOffset.set(Math.sin(t) * 0.05, Math.sin(t * 1.31) * 0.03, Math.cos(t * 0.87) * 0.05).multiplyScalar(tremorAmp)
      } else tremorOffset.set(0, 0, 0)
    },
    dispose() {
      scene.remove(dome)
      geo.dispose()
      mat.dispose()
      scene.remove(front)
      frontGeo.dispose()
      frontMat.dispose()
    },
  }
}

export type StormSystem = ReturnType<typeof createStormSystem>
