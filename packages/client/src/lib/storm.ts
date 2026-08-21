import * as THREE from 'three'
import { HALF } from './constants'
import type { WindDir } from '@wheee/shared'

/* ── Constants ──────────────────────────────────────────── */

const DOME_RADIUS = 220            // verify: must sit inside the camera far plane
const BASE = new THREE.Color(0x0a0e14)          // today's void, exactly
const STORM = new THREE.Color(0x1a1230)         // deep slate-violet mass
const DIM = new THREE.Color(0x070a10)           // the rest of the sky sinks slightly

const DIR_AZIMUTH: Record<WindDir, number> = { N: Math.PI, E: Math.PI / 2, S: 0, W: -Math.PI / 2 }

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

const FRONT_COUNT = 400
const FRONT_FAR = HALF * 3            // far horizon distance at intensity 0
const FRONT_NEAR = HALF * 1.15        // just beyond the board edge at tick 5 (intensity 1)
const FRONT_HEIGHT = 9
const FRONT_JITTER = HALF * 0.08      // per-particle radial jitter amplitude
const SWEEP_MS = 1200
const SWEEP_TARGET = -HALF * 1.2      // across and past the board

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
      height: Math.random() * FRONT_HEIGHT,
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
      uniform float uAzimuth, uIntensity, uSpread, uZenith;
      uniform vec3 uBase, uStorm, uDim;
      varying vec3 vDir;
      void main() {
        float ang = atan(vDir.x, vDir.z);
        float d = abs(mod(ang - uAzimuth + 3.14159265, 6.2831853) - 3.14159265);
        // horizon sector: strongest at the horizon, fading by 45 degrees up
        float horizon = smoothstep(uSpread, 0.0, d) * smoothstep(0.7, 0.05, vDir.y) * (1.0 - uZenith);
        // zenith mode: darkness pools overhead instead
        float zenith = smoothstep(0.25, 0.9, vDir.y) * uZenith;
        float mass = clamp(horizon + zenith, 0.0, 1.0) * uIntensity;
        vec3 sky = mix(uBase, uDim, uIntensity * 0.6);   // the whole world dims a little
        gl_FragColor = vec4(mix(sky, uStorm, mass), 1.0);
      }
    `,
  })
  const dome = new THREE.Mesh(geo, mat)
  dome.renderOrder = -1
  scene.add(dome)

  /* ── Front curtain ── */
  const frontParticles = makeFrontParticles()
  const frontPositions = new Float32Array(FRONT_COUNT * 3)
  const frontGeo = new THREE.BufferGeometry()
  frontGeo.setAttribute('position', new THREE.BufferAttribute(frontPositions, 3))
  const frontPosAttr = frontGeo.getAttribute('position') as THREE.BufferAttribute
  const frontMat = new THREE.PointsMaterial({
    color: 0xb8a9e6,
    size: 1.6,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const front = new THREE.Points(frontGeo, frontMat)
  scene.add(front)

  /* ── State ── */
  let candidates: WindDir[] = []
  let vaneBroken = false
  let zenithTarget = 0
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
  let sweepToken = 0
  let halted = false

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
    setForecast(c: WindDir[], broken: boolean, stormy: boolean) {
      candidates = [...c]
      vaneBroken = broken
      zenithTarget = c.length === 0 && stormy ? 1 : 0
      discharging = null
      // A dead sky may snap its azimuth to the newborn storm — invisible at intensity 0.
      if (sleeping && c.length > 0) { azimuth = DIR_AZIMUTH[c[0]]; azVel = 0 }
    },
    setProgress(t: number) {
      progress = Math.max(0, Math.min(1, t))
      discharging = null
    },
    discharge: dischargeImpl,
    setTremor(_active: boolean) { /* Task 4 */ },
    getCameraOffset() { return new THREE.Vector3() },  // Task 4
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
      candidates = [dir]              // the storm commits to its real direction
      return new Promise((resolve) => {
        const step = () => {
          if (token !== sweepToken) { sweepOverride = null; resolve(); return }
          const t = Math.min(1, (performance.now() - started) / SWEEP_MS)
          sweepOverride = from + (to - from) * (t * t)   // accelerating crossing
          if (t >= 1) { sweepOverride = null; resolve() } else requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      })
    },
    halt() {                          // lightning hush: the front freezes mid-air
      halted = true
      sweepToken++                    // cancels any sweep in flight (its promise resolves)
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
      // azimuth spring (drifting mass, never a visible jump)
      const force = shortestArc(azimuth, azimuthTarget()) * SPRING_K - azVel * SPRING_D
      azVel += force * dt
      azimuth += azVel * dt

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

      const u = mat.uniforms
      u.uAzimuth.value = azimuth
      u.uIntensity.value = intensity
      u.uSpread.value = spread
      u.uZenith.value += (zenithTarget - u.uZenith.value) * Math.min(1, dt * 2)

      // curtain center distance: intensity-derived, unless a sweep is overriding it,
      // unless the front is halted (frozen — no more advancing either way)
      if (sweepOverride !== null) frontDist = sweepOverride
      else if (!halted) frontDist = FRONT_FAR - (FRONT_FAR - FRONT_NEAR) * intensity

      frontTime += dt
      for (let i = 0; i < FRONT_COUNT; i++) {
        const p = frontParticles[i]
        const angle = azimuth + p.arcT * spread
        const jitter = Math.sin(frontTime * 0.5 + p.jitterPhase) * p.jitterAmp
        const dist = frontDist + jitter
        const bob = Math.sin(frontTime * p.bobSpeed + p.bobPhase) * 0.6
        frontPositions[i * 3] = Math.sin(angle) * dist
        frontPositions[i * 3 + 1] = p.height + bob
        frontPositions[i * 3 + 2] = Math.cos(angle) * dist
      }
      frontPosAttr.needsUpdate = true
      // hidden entirely in zenith mode (calm forecast: nothing comes along the ground)
      frontMat.opacity = 0.35 * intensity * (1 - u.uZenith.value)
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
