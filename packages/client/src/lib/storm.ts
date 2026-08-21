import * as THREE from 'three'
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

// @ts-ignore - used in Task 2/4
const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

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
    discharge(mode: 'cataclysm' | 'exhale' | 'fast') {
      discharging = mode
      progress = 0
    },
    setTremor(_active: boolean) { /* Task 4 */ },
    getCameraOffset() { return new THREE.Vector3() },  // Task 4
    sweep(_dir: WindDir) { return Promise.resolve() }, // Task 2
    halt() { /* Task 2 */ },
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

      const u = mat.uniforms
      u.uAzimuth.value = azimuth
      u.uIntensity.value = intensity
      u.uSpread.value = SPREAD_MIN + (SPREAD_MAX - SPREAD_MIN) * intensity
      u.uZenith.value += (zenithTarget - u.uZenith.value) * Math.min(1, dt * 2)
    },
    dispose() {
      scene.remove(dome)
      geo.dispose()
      mat.dispose()
    },
  }
}

export type StormSystem = ReturnType<typeof createStormSystem>
