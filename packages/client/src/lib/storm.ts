import * as THREE from 'three'
import { HALF } from './constants'
import type { WindDir } from '@wheee/shared'
import { LOOK, srgbHexToLinear, type Vec3 } from './look'

/* ── Constants ──────────────────────────────────────────── */

const DOME_RADIUS = 220            // verify: must sit inside the camera far plane
// Sky colours come from lib/look.ts; THREE.Color converts the sRGB hex to
// linear, which is what the shader — and its TypeScript twin skyGradient — use.
const SKY_ZENITH = new THREE.Color(LOOK.sky.zenith)
const SKY_MID = new THREE.Color(LOOK.sky.mid)
const SKY_HORIZON = new THREE.Color(LOOK.sky.horizon)
const SKY_RIM = new THREE.Color(LOOK.sky.rim)
const STORM = new THREE.Color(LOOK.sky.storm)   // storm mass: a dark bank against the horizon
const DIM = new THREE.Color(LOOK.sky.dim)       // the rest of the sky sinks slightly

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * The calm sky's base colour for a view direction with vertical component y
 * (−1..1), in linear RGB — the TypeScript twin of the dome shader's gradient,
 * kept in step so it can be unit-tested. Symmetric in |y| because the slab's
 * underside is a mirrored world that must see the same sky.
 */
export function skyGradient(y: number, sky: typeof LOOK.sky = LOOK.sky): Vec3 {
  const ay = Math.abs(y)
  const H = srgbHexToLinear(sky.horizon), M = srgbHexToLinear(sky.mid)
  const Z = srgbHexToLinear(sky.zenith), R = srgbHexToLinear(sky.rim)
  const t1 = smooth01(0.08, 0.45, ay), t2 = smooth01(0.45, 1.0, ay)
  const rim = (1 - smooth01(0.0, 0.06, ay)) * 0.6
  const out: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const a = H[i] + (M[i] - H[i]) * t1
    const b = a + (Z[i] - a) * t2
    out[i] = b + (R[i] - b) * rim
  }
  return out
}

// CONVENTION: WindDir ('N'/'E'/'S'/'W') names the direction the wind TRAVELS
// (see DIRECTIONS in packages/shared/src/constants.ts and pushPlayer in
// packages/server/src/engine/wind.ts — 'N' pushes players toward -z). The sky
// mass, by contrast, sits over the horizon the wind is coming FROM — the
// upwind/source bearing, which is the opposite of the travel bearing. Do not
// "fix" this back to the travel bearing: that is the inversion this comment
// exists to prevent. N travels toward -z, so its source is +z: atan2(0,+1) = 0.
const DIR_AZIMUTH: Record<WindDir, number> = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 }

// The dial needle's spring feel (ForecastPanel), slowed for a sky-sized mass.
// It is what carries a mass to a NEW bearing (a broken vane's roaming, a
// forecast that changes mid-round); it is deliberately NOT used to interpolate
// between two candidates any more — two candidates get two masses, each nailed
// to its own bearing, because a single mass drifting between them spends almost
// all of its time pointing at a bearing that is neither of them.
const SPRING_K = 3.2
const SPRING_D = 2.6
const BROKEN_JUMP_MIN = 0.5
const BROKEN_JUMP_MAX = 1.2

const SPREAD_MIN = 0.55            // radians, sector half-width at intensity 0
const SPREAD_MAX = 1.15            // swollen mass at intensity 1

const DISCHARGE_RATES = { cataclysm: 1 / 1.8, exhale: 1 / 2.0, fast: 1 / 0.3 }

const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

const FRONT_COUNT = 3000              // a wall of mist needs numbers; each mote is large and faint
const FRONT_FAR = HALF * 3            // far horizon distance at intensity 0
// The board is a SQUARE, not a circle, and the front is a straight WALL, not an
// arc: what it has to clear is the square's whole shadow along the bearing —
// its support function HALF*(|sin θ| + |cos θ|) — not the distance to the
// boundary along the bearing ray (HALF / max(|sin θ|, |cos θ|)). The two agree
// at 0°/90° (HALF) and at 45° (1.41*HALF) and nowhere in between: at 22.5° the
// ray hits the edge at 1.08*HALF while the corner still reaches 1.31*HALF, so a
// wall placed off the ray distance cuts the corner off by up to 0.22*HALF —
// more than FRONT_NEAR_MARGIN, which is the clearance added on top
// (recomputed every frame in update(), per slot, since each slot sits on its
// own bearing and a mass can still spring to a new one). The four forecast
// bearings are all cardinal, where both formulas give HALF; a broken vane's
// roaming mass is what visits the angles in between.
const FRONT_NEAR_MARGIN = HALF * 0.25
const FRONT_HEIGHT = 9
const FRONT_SIZE_MIN = 2.2            // point size, scaled by 200/depth like wind.ts's dust
const FRONT_SIZE_MAX = 5.5
const FRONT_LATERAL = HALF * 1.3      // half-width of the wall, wider than the board so it reads as a front, not a smear
const FRONT_DEPTH = HALF * 0.4        // total depth span of the wall, leading edge through trailing haze
const FRONT_JITTER = HALF * 0.15      // per-particle jitter amplitude, along the wind axis — big enough that no depth band can appear
const SWEEP_MS = 1200
const SWEEP_TARGET = -HALF * 1.2      // across and past the board
const SWEEP_AZ_TAU = 0.25             // seconds; how fast the mass commits to the true bearing mid-sweep
const HOLD_RELEASE = 0.02             // intensity at which a swept front may leave its parking spot
const REENTRY_TAU = 0.35              // seconds; how fast a dropped front walks back to where the mass wants it
const REENTRY_EPS = HALF * 0.05       // close enough to stop easing and track the mass exactly

/**
 * A mass appears/dissolves over this long: the false candidate's wall and sky
 * sector at the cataclysm, and a mass arriving on a bearing that just became
 * real. Slow enough to read as weather dissolving rather than a light switch,
 * short enough that the true wall is still crossing the board when it is gone.
 */
const FADE_RATE = 1 / 0.4
/**
 * Cross-fade for MOVING a slot's particles between bearings (see mergeSlot):
 * they never teleport from one wall to the other, they fade out of the old one
 * and back into the new one. Deliberately the SAME rate as FADE_RATE and
 * combined with it by min(), not by multiplication: at the cataclysm both ramps
 * run at once on the false candidate's motes, and a product would take them out
 * visibly faster than the sky sector above them, which fades on FADE_RATE alone.
 */
const BLEND_RATE = FADE_RATE
/**
 * With two masses each sector is scaled to this, so a two-candidate sky does not
 * read as twice the weather a single-candidate one does. Applied continuously
 * (each sector is scaled by the OTHER's presence), so the survivor of a
 * cataclysm swells back to full weight on the same curve the loser dissolves on.
 */
const DUO_SCALE = 0.8

interface FrontParticle {
  slot: 0 | 1           // which mass this mote belongs to; fixed at creation, never reshuffled
  lateral: number       // offset perpendicular to the wind axis; spans the wall's width
  depthOffset: number   // offset along the wind axis, placing the particle within the wall's depth
  depthT: number        // 0 = leading edge (nearest the board), 1 = trailing haze; drives the brightness/size gradient continuously
  jitterPhase: number
  jitterAmp: number
  height: number
  bobPhase: number
  bobSpeed: number
}

function makeFrontParticles(): FrontParticle[] {
  const arr: FrontParticle[] = []
  for (let i = 0; i < FRONT_COUNT; i++) {
    // Continuous depth, biased toward the leading edge (depthT near 0, nearest
    // the board) so the wall is denser where it is advancing, not just
    // brighter there — squaring a uniform random skews the distribution low
    // without any discrete rows for gaps to open up between.
    const depthT = Math.pow(Math.random(), 2)
    arr.push({
      // Alternating, so the budget splits exactly in half and both slots get a
      // statistically identical mix of depths and heights. Everything else here
      // is an independent random draw, so there is no pattern to alternate with.
      slot: (i % 2) as 0 | 1,
      lateral: (Math.random() * 2 - 1) * FRONT_LATERAL,
      depthOffset: depthT * FRONT_DEPTH + (Math.random() - 0.5) * FRONT_JITTER,
      depthT,
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

export function createStormSystem(scene: THREE.Scene, tint: Vec3 = [1, 1, 1]) {
  /* ── Dome ── */
  const geo = new THREE.SphereGeometry(DOME_RADIUS, 48, 24)
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      // Up to TWO sectors, one per forecast candidate, each nailed to its own
      // source bearing. uMassA/uMassB are their weights: 0 = that candidate has
      // no mass (single-candidate round, or the false one after the cataclysm).
      uAzimuthA:  { value: 0 },
      uAzimuthB:  { value: 0 },
      uMassA:     { value: 0 },
      uMassB:     { value: 0 },
      uIntensity: { value: 0 },
      uSpread:    { value: SPREAD_MIN },
      uZenith:    { value: 0 },      // 1 = calm+stormy: menace overhead, horizon clean
      uCalmClean: { value: 0 },      // 1 = calm+dry: no horizon mass, no zenith either — dim only
      uSkyZenith:  { value: SKY_ZENITH },
      uSkyMid:     { value: SKY_MID },
      uSkyHorizon: { value: SKY_HORIZON },
      uSkyRim:     { value: SKY_RIM },
      uTint:       { value: new THREE.Vector3(tint[0], tint[1], tint[2]) },
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
      uniform float uAzimuthA, uAzimuthB, uMassA, uMassB;
      uniform float uIntensity, uSpread, uZenith, uCalmClean;
      uniform vec3 uSkyZenith, uSkyMid, uSkyHorizon, uSkyRim, uTint, uStorm, uDim;
      varying vec3 vDir;
      // One horizon sector: strongest at the horizon on bearing az, fading by
      // 45 degrees up, and fading out again just BELOW the horizon so no mass
      // glows under the slab when the camera looks down at it from a high angle.
      float sector(float ang, float az, float y) {
        float d = abs(mod(ang - az + 3.14159265, 6.2831853) - 3.14159265);
        return smoothstep(uSpread, 0.0, d) * smoothstep(0.7, 0.05, y) * smoothstep(-0.25, 0.02, y);
      }
      void main() {
        float ang = atan(vDir.x, vDir.z);
        // Killed outright in zenith mode (the darkness moved overhead) and in
        // calm-clean mode (no wind coming and no bolt to hide either — a
        // horizon sector here would paint a bearing the vane never gave).
        float gate = (1.0 - uZenith) * (1.0 - uCalmClean);
        // max(), NOT a sum: two candidate masses must not stack into double the
        // darkness where their sectors meet (adjacent bearings like N and E
        // overlap heavily), and the sky must not read heavier just because the
        // forecast was less certain. Each weight is already scaled down while
        // the other is present — see DUO_SCALE.
        float horizon = max(sector(ang, uAzimuthA, vDir.y) * uMassA,
                            sector(ang, uAzimuthB, vDir.y) * uMassB) * gate;
        // zenith mode: darkness pools overhead instead
        float zenith = smoothstep(0.25, 0.9, vDir.y) * uZenith;
        float mass = clamp(horizon + zenith, 0.0, 1.0) * uIntensity;
        // Calm sky: a dusk gradient by |y| (the underside is a mirrored world
        // and sees the same sky), tinted per crop. Keep in step with
        // skyGradient() in this file.
        float ay = abs(vDir.y);
        vec3 base = mix(uSkyHorizon, uSkyMid, smoothstep(0.08, 0.45, ay));
        base = mix(base, uSkyZenith, smoothstep(0.45, 1.0, ay));
        base = mix(base, uSkyRim, (1.0 - smoothstep(0.0, 0.06, ay)) * 0.6);
        base *= uTint;
        vec3 sky = mix(base, uDim, uIntensity * 0.6);   // the whole world dims a little
        gl_FragColor = vec4(mix(sky, uStorm, mass), 1.0);
        // Colour management: THREE.Color holds linear-sRGB, and three.js appends the
        // output transform only to its own materials — a ShaderMaterial that writes
        // gl_FragColor has to ask for it. Without this line every colour above is
        // written raw into an sRGB framebuffer and the whole sky lands ~9x too dark —
        // far too dark and barely visible, darker than the scene background it replaces.
        //
        // The renderer tone-maps its own materials; a ShaderMaterial has to ask.
        #include <tonemapping_fragment>
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
  const frontSlots = new Float32Array(FRONT_COUNT)
  for (let i = 0; i < FRONT_COUNT; i++) {
    const p = frontParticles[i]
    // Vertical taper: dense/large/bright near the ground, sparse/small/faint
    // higher up (density itself comes from height's low-biased distribution
    // above); the continuous depthT gradient layers the leading-edge falloff
    // on top of that instead of a handful of discrete row brightnesses.
    const heightT = p.height / FRONT_HEIGHT
    const sizeMul = (1.2 - 0.65 * heightT) * (1 - 0.45 * p.depthT)
    const alphaMul = (1.0 - 0.82 * heightT) * (1 - 0.45 * p.depthT)
    frontSizes[i] = (FRONT_SIZE_MIN + Math.random() * (FRONT_SIZE_MAX - FRONT_SIZE_MIN)) * sizeMul
    frontAlphas[i] = (0.2 + Math.random() * 0.6) * alphaMul
    frontSlots[i] = p.slot
  }
  const frontGeo = new THREE.BufferGeometry()
  frontGeo.setAttribute('position', new THREE.BufferAttribute(frontPositions, 3))
  frontGeo.setAttribute('aSize', new THREE.BufferAttribute(frontSizes, 1))
  frontGeo.setAttribute('aAlpha', new THREE.BufferAttribute(frontAlphas, 1))
  frontGeo.setAttribute('aSlot', new THREE.BufferAttribute(frontSlots, 1))
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
   *
   * Each slot's fade rides in as a uniform (uMul0/uMul1) picked by the static
   * per-particle aSlot, rather than as a per-frame rewrite of aAlpha: the fade
   * is per SLOT, not per particle, so there is nothing per-particle to upload.
   */
  const frontMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(0x9d8fd0) },
      uOpacity: { value: 0 },
      uMul0: { value: 0 },
      uMul1: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      attribute float aSlot;
      uniform float uMul0, uMul1;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha * mix(uMul0, uMul1, aSlot);
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
  let brokenT = 0
  let brokenTarget = 0
  let progress = 0                  // set by ticks
  let intensity = 0                 // eased toward progress, or drained by discharge
  let discharging: keyof typeof DISCHARGE_RATES | null = null
  let sleeping = true               // true while intensity === 0 and target === 0

  /**
   * TWO MASSES, one per forecast candidate. Slot 0 is the primary: a
   * single-candidate round (and a broken vane's single roaming mass) lives
   * there, and slot 1's motes are lent to it so the wall is exactly as dense as
   * it was when there was only ever one. With two candidates each slot sits on
   * its OWN candidate's source bearing and stays there — no drifting between
   * them, so the sky never points at a bearing the forecast did not name.
   *
   * Everything below is a fixed-length pair, allocated once: update() must not
   * allocate.
   */
  const slotAz = [0, 0]             // each slot's own bearing (spring position)
  const slotVel = [0, 0]
  const slotFade = [0, 0]           // 0..1 presence of each mass
  const slotDist = [FRONT_FAR, FRONT_FAR]   // each wall's centre distance, frozen while halted
  const slotReentry = [false, false]
  // Per-slot wall basis, recomputed at the top of every active frame (see
  // update()) and then read 3000 times in the placement loop.
  const slotAxisX = [0, 0]
  const slotAxisZ = [0, 0]
  const slotPerpX = [0, 0]
  const slotPerpZ = [0, 0]
  /** How many masses the forecast asks for: 0 (calm), 1, or 2. */
  let activeCount = 0
  /** With one mass, the slot carrying it. */
  let liveSlot: 0 | 1 = 0
  /**
   * Slot whose motes are borrowed by the other one (so a single mass gets the
   * whole particle budget), or -1 while both slots stand on their own bearing.
   * Switching it is always cross-faded through `blend` — a mote must never
   * teleport from one wall to the other.
   */
  let mergeSlot: -1 | 0 | 1 = -1
  let mergeTarget: -1 | 0 | 1 = -1
  let blend = 1

  let frontTime = 0                  // clock for jitter/bob animation
  let sweepOverride: number | null = null   // takes precedence over the intensity-derived distance
  /** The slot doing the crossing: the one standing on the wind's true bearing. */
  let sweepSlot: 0 | 1 = 0
  /**
   * The true source bearing for the in-flight (or held) sweep, set the instant
   * `sweep(dir)` fires and used ONLY for the sweeping slot's front placement —
   * never for its `slotAz` spring, which must never visibly jump. Without this
   * the curtain marches wherever the still-settling spring happens to be (up to
   * ~3s, longer than the whole crossing), which can leave it visibly off the
   * true horizon for the whole cataclysm.
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

  /* ── Tremor (tick 5: the last, worst tick before the strike) ── */
  let oscT = 0                       // shared clock for the tremor
  let tremorActive = false
  let tremorAmp = 0                  // eased 0..1 envelope, never a snap on/off
  const tremorOffset = new THREE.Vector3()

  /**
   * Give the curtain's distance back to the intensity — always eased, never a
   * jump. Pass `ownerToken` when calling from a sweep's own step loop (the
   * only call site that can race a newer, superseding sweep): `sweepAngle` is
   * only cleared if no newer sweep has claimed it since. Call sites outside a
   * step loop (releaseSweepHold, halt) have no such race — they always clear.
   *
   * Re-entry is armed on BOTH slots: a stale step loop may no longer own the
   * slot it started on, and a slot already sitting where the mass wants it
   * clears the flag on its first frame without moving.
   */
  function dropOverride(ownerToken?: number) {
    sweepHold = false
    sweepOverride = null
    if (ownerToken === undefined || sweepAngleGen === ownerToken) sweepAngle = null
    slotReentry[0] = true
    slotReentry[1] = true
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

  /** Where slot k's spring wants to be. An unused slot holds its bearing: it is
   * fading out on it, and must not drift toward the survivor while still seen. */
  function slotTarget(k: 0 | 1): number {
    if (activeCount === 0) return slotAz[k]
    if (vaneBroken) return k === liveSlot ? brokenTarget : slotAz[k]
    if (activeCount === 1) return k === liveSlot && candidates.length > 0 ? DIR_AZIMUTH[candidates[0]] : slotAz[k]
    return DIR_AZIMUTH[candidates[k]]
  }

  function fadeTarget(k: 0 | 1): number {
    if (activeCount === 2) return 1
    return activeCount === 1 && k === liveSlot ? 1 : 0
  }

  /** The active slot already closest to a bearing — the one that should sweep. */
  function pickSlot(az: number): 0 | 1 {
    if (activeCount < 2) return liveSlot
    return Math.abs(shortestArc(slotAz[0], az)) <= Math.abs(shortestArc(slotAz[1], az)) ? 0 : 1
  }

  /** Recompute how many masses there are and which slot carries a lone one. */
  function relayout(prevCount: number) {
    activeCount = vaneBroken ? 1 : Math.min(2, candidates.length)
    if (activeCount === 1 && prevCount === 2 && !vaneBroken && candidates.length > 0) {
      // Two masses collapsing to one: the survivor is whichever slot already
      // stands on the surviving bearing, so it does not have to move at all.
      liveSlot = pickSlot(DIR_AZIMUTH[candidates[0]])
    }
    mergeTarget = activeCount === 2 ? -1 : (1 - liveSlot) as 0 | 1
  }

  /** Apply the layout instantly. Only legal while nothing is visible. */
  function snapLayout() {
    for (let k = 0 as 0 | 1; k < 2; k = (k + 1) as 0 | 1) {
      slotAz[k] = slotTarget(k)
      slotVel[k] = 0
      slotFade[k] = fadeTarget(k)
    }
    mergeSlot = mergeTarget
    blend = 1
  }

  function dischargeImpl(mode: 'cataclysm' | 'exhale' | 'fast') {
    discharging = mode
    progress = 0
    halted = false
  }

  return {
    getTint(): Vec3 {
      const v = mat.uniforms.uTint.value as THREE.Vector3
      return [v.x, v.y, v.z]
    },
    setTint(t: Vec3): void {
      ;(mat.uniforms.uTint.value as THREE.Vector3).set(t[0], t[1], t[2])
    },
    setForecast(c: WindDir[], broken: boolean, stormy: boolean, baroBroken: boolean) {
      const prevCount = activeCount
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
      // A dead sky may take its whole new shape at once — bearings, mass count,
      // which slot lends its motes to which — because none of it is on screen.
      // A forecast landing while the last storm is still visible instead eases
      // into place: springs carry the bearings, fades carry the masses, and
      // slot 1's motes cross-fade rather than teleport between walls.
      const invisible = sleeping || intensity < 0.02
      if (invisible) liveSlot = 0
      relayout(prevCount)
      if (invisible) snapLayout()
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
      const trueAz = DIR_AZIMUTH[dir]
      // The cataclysm names the real bearing: the mass already standing on it
      // does the crossing, and the other one — if the forecast offered two —
      // dissolves where it stands (relayout below drives its fade to 0, and its
      // motes are lent to the survivor once they are invisible).
      const prevCount = activeCount
      sweepSlot = pickSlot(trueAz)
      liveSlot = sweepSlot
      candidates = [dir]              // the storm commits to its real direction
      // By now the direction is public — weather:result has already announced it —
      // so a broken vane stops mattering: the front must march the same way the
      // gale and the bodies do, not off at the needle's last random bearing.
      vaneBroken = false
      relayout(prevCount)
      const from = slotDist[sweepSlot]
      const to = SWEEP_TARGET
      const started = performance.now()
      slotVel[sweepSlot] = 0
      sweepHold = false
      // The crossing itself must always follow the TRUE source bearing, not
      // wherever the spring happens to be — with two candidates the surviving
      // slot is already there, but a broken vane's roaming mass is not. See
      // sweepAngle's declaration and its use in update()'s particle placement.
      sweepAngleGen = token
      sweepAngle = trueAz
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

      // Per-slot azimuth spring (a mass moves to a new bearing, never jumps).
      // While a sweep is actually in flight (not yet parked in its hold), the
      // sweeping slot commits to the true bearing on a fast ~0.25s time
      // constant instead of chasing its (possibly still-settling) spring target
      // — still eased, never a teleport, so the sky stops contradicting the
      // crossing curtain. Outside a sweep the ordinary spring feel is untouched,
      // including the broken-vane roaming target.
      for (let k = 0 as 0 | 1; k < 2; k = (k + 1) as 0 | 1) {
        if (k === sweepSlot && sweepAngle !== null && !sweepHold) {
          slotAz[k] += shortestArc(slotAz[k], sweepAngle) * Math.min(1, dt / SWEEP_AZ_TAU)
          slotVel[k] = 0
        } else {
          const force = shortestArc(slotAz[k], slotTarget(k)) * SPRING_K - slotVel[k] * SPRING_D
          slotVel[k] += force * dt
          slotAz[k] += slotVel[k] * dt
        }
      }

      // Mass presence: each slot fades in when the forecast names its bearing
      // and out when it stops — which is how the false candidate dissolves at
      // the cataclysm, sky sector and wall together, on one curve.
      const fadeStep = FADE_RATE * dt
      for (let k = 0 as 0 | 1; k < 2; k = (k + 1) as 0 | 1) {
        const target = fadeTarget(k)
        if (slotFade[k] < target) slotFade[k] = Math.min(target, slotFade[k] + fadeStep)
        else if (slotFade[k] > target) slotFade[k] = Math.max(target, slotFade[k] - fadeStep)
      }

      // Lending slot 1's motes to slot 0 (or back) is a cross-fade, never a
      // reassignment mid-flight: they fade off the wall they are on, change
      // wall while invisible, then fade back in on the new one. A single mass
      // therefore ends up with the entire particle budget — as dense as it was
      // before there was ever a second slot.
      if (mergeSlot !== mergeTarget) {
        blend -= BLEND_RATE * dt
        if (blend <= 0) {
          mergeSlot = mergeTarget
          // Landing on "no merge" means both slots now stand on their own
          // bearing and nothing reads `blend` any more (the newly independent
          // slot fades in on its own `slotFade`, which starts at 0). Retiring it
          // to 1 here rather than leaving it to ramp up unwatched is what keeps
          // a merge that starts again moments later from opening on a value
          // below 1 — which would drop that wall's motes in a single frame.
          blend = mergeSlot < 0 ? 1 : 0
        }
      } else if (blend < 1) {
        blend = Math.min(1, blend + BLEND_RATE * dt)
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
      // roaming at random bearings (that ambiguity is deliberate, and one lone
      // roaming mass is all it may ever show — two would leak how many
      // candidates the forecast really held), so it never counts as calm.
      // Calm+stormy pools the darkness overhead (zenith mode, unchanged);
      // calm+dry shows neither — just the global dim.
      const calm = !vaneBroken && candidates.length === 0
      const effectiveStormy = barometerBroken ? brokenStormyVal : stormyRaw
      const zenithTarget = calm && effectiveStormy ? 1 : 0
      const calmCleanTarget = calm && !effectiveStormy ? 1 : 0

      const u = mat.uniforms
      // Which bearing each sector paints: the sweeping slot follows the true
      // bearing anchor, exactly like its wall, so sky and curtain agree from
      // the crossing's first frame.
      const angle0 = sweepSlot === 0 && sweepAngle !== null ? sweepAngle : slotAz[0]
      const angle1 = sweepSlot === 1 && sweepAngle !== null ? sweepAngle : slotAz[1]
      u.uAzimuthA.value = angle0
      u.uAzimuthB.value = angle1
      // Each sector is scaled down by the other's presence, so two masses do not
      // read as more weather than one, and the survivor of a cataclysm swells
      // back to full weight as the loser dissolves.
      u.uMassA.value = slotFade[0] * (1 - (1 - DUO_SCALE) * slotFade[1])
      u.uMassB.value = slotFade[1] * (1 - (1 - DUO_SCALE) * slotFade[0])
      u.uIntensity.value = intensity
      u.uSpread.value = spread
      u.uZenith.value += (zenithTarget - u.uZenith.value) * Math.min(1, dt * 2)
      u.uCalmClean.value += (calmCleanTarget - u.uCalmClean.value) * Math.min(1, dt * 2)

      // A swept-through front waits past the board until it is too faint to be
      // caught returning: the ordinary, invisible end of a crossing.
      if (sweepHold && intensity < HOLD_RELEASE) releaseSweepHold()

      // The curtain costs real per-frame work (3000 particles, a handful of
      // trig calls, a 36KB attribute re-upload) for zero visual return whenever the
      // storm is asleep — lobby, replays, menus, the whole time nothing is
      // building. Skipped outright there, and the mesh hidden so a frozen,
      // stale buffer never gets a frame to render.
      front.visible = !sleeping
      if (!sleeping) {
        // Each slot's wall is placed on ITS OWN bearing. This is the SAME
        // bearing convention the dome uses: axis = (sin, cos) points at the
        // source; perp (axis rotated 90°) is the wall's own width, so the
        // curtain is a straight line perpendicular to the bearing rather than
        // an arc — a line clears the board's square corners at every angle,
        // where a circle of fixed radius cuts across them.
        for (let k = 0 as 0 | 1; k < 2; k = (k + 1) as 0 | 1) {
          const angle = k === 0 ? angle0 : angle1
          const axisX = Math.sin(angle), axisZ = Math.cos(angle)
          slotAxisX[k] = axisX
          slotAxisZ[k] = axisZ
          slotPerpX[k] = -axisZ
          slotPerpZ[k] = axisX
          // curtain center distance: intensity-derived, unless this slot's sweep is
          // overriding it, unless the front is halted (frozen — no more advancing
          // either way). A front that has just been handed back eases home over a
          // few tenths of a second instead of jumping there, then tracks the mass
          // exactly again.
          //
          // The board is a square, so "just beyond the edge" is bearing-dependent:
          // HALF at 0°/90°, HALF*1.41 at 45°. This is the square's SUPPORT
          // function along the bearing — the far side of its whole shadow, which
          // is what a straight wall has to clear (see FRONT_NEAR_MARGIN).
          // Recomputed every frame, per slot, from that slot's own bearing — so
          // neither wall overlaps the tiles, whether the pair is opposite (E and
          // W) or adjacent (N and E), nor at a broken vane's random bearing.
          const edgeClear = HALF * (Math.abs(axisX) + Math.abs(axisZ)) + FRONT_NEAR_MARGIN
          const distTarget = FRONT_FAR - (FRONT_FAR - edgeClear) * intensity
          if (k === sweepSlot && sweepOverride !== null) slotDist[k] = sweepOverride
          else if (!halted) {
            if (slotReentry[k]) {
              slotDist[k] += (distTarget - slotDist[k]) * Math.min(1, dt / REENTRY_TAU)
              if (Math.abs(distTarget - slotDist[k]) < REENTRY_EPS) slotReentry[k] = false
            } else slotDist[k] = distTarget
          }
        }

        // Where each slot's motes actually live this frame, and how bright they
        // are: a lent slot renders on its host's wall, and the slot in the
        // middle of a lending change carries the cross-fade.
        const render0 = mergeSlot === 0 ? 1 : 0
        const render1 = mergeSlot === 1 ? 0 : 1
        const blendSlot = mergeSlot >= 0 ? mergeSlot : mergeTarget
        frontMat.uniforms.uMul0.value = blendSlot === 0 ? Math.min(slotFade[render0], blend) : slotFade[render0]
        frontMat.uniforms.uMul1.value = blendSlot === 1 ? Math.min(slotFade[render1], blend) : slotFade[render1]

        frontTime += dt
        for (let i = 0; i < FRONT_COUNT; i++) {
          const p = frontParticles[i]
          const r = p.slot === 0 ? render0 : render1
          const jitter = Math.sin(frontTime * 0.5 + p.jitterPhase) * p.jitterAmp
          const dist = slotDist[r] + p.depthOffset + jitter
          const bob = Math.sin(frontTime * p.bobSpeed + p.bobPhase) * 0.6
          const idx = i * 3
          frontPositions[idx] = slotAxisX[r] * dist + slotPerpX[r] * p.lateral
          frontPositions[idx + 1] = p.height + bob
          frontPositions[idx + 2] = slotAxisZ[r] * dist + slotPerpZ[r] * p.lateral
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
