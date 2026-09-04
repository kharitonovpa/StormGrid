/**
 * The arena's look as data — sky, light rig, terrain palette, water, grid and
 * tone mapping — so every consumer (App.vue's lights, terrain.ts's vertex
 * colours, storm.ts's dome, water.ts, CharacterPreview.vue) reads one source.
 *
 * Hex values are sRGB, the numbers a designer reads off a colour picker.
 * three.js converts them itself when they go through THREE.Color, but code that
 * writes raw vertex colours (terrain, water) must convert with
 * srgbHexToLinear(): MeshStandardMaterial treats vertex colours as linear.
 *
 * No `three` import on purpose: the terrain's CPU shading and the unit tests
 * consume this without a renderer.
 */
export type Vec3 = readonly [number, number, number]

export const LOOK = {
  sky: {
    zenith: 0x10163a,   // overhead indigo
    mid: 0x2b2350,      // half way down
    horizon: 0x8a4a52,  // dusk band along the horizon
    rim: 0xc9754e,      // narrow warm edge right at the horizon line
    storm: 0x2a1636,    // storm mass — darker than the horizon it sits on
    dim: 0x0b0d22,      // what the whole sky sinks toward at full intensity
  },
  sun: {
    color: 0xffc98a,
    intensity: 2.2,
    /** Unit vector toward the sun: low (elevation ≈ 28°), from the camera's left-front. */
    direction: [-0.55, 0.47, 0.69] as Vec3,
  },
  hemi: {
    sky: 0x5a6cc8,      // cool fill on faces that see the sky
    ground: 0x2b2333,   // dark plum, so the mirrored light's wrong-side fill stays small
    intensity: 0.8,
  },
  terrain: {
    grass: 0x3f7a3a,
    rock: 0xb9aa9e,
    mud: 0x8a4b2a,
    snow: 0xf2ead8,
    checkerAmp: 0.08,       // ± relative lightness of alternate grass cells
    aoStrength: 0.35,       // darkening at a block's foot
    shadowStrength: 0.45,   // darkening inside the sun's shadow
    shadowTint: [0.85, 0.95, 1.25] as Vec3,  // at full shadow: sky-lit, so cooler, not just darker
  },
  water: { deep: 0x1e5d6e, rim: 0x3d9aa8, opacity: 0.6 },
  grid: { color: 0xc8c4ff, opacity: 0.28 },
  tone: { mode: 'agx' as const, exposure: 1.05 },
} as const

/** One sRGB channel in 0..1 → linear (the standard piecewise transfer). */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** 0xRRGGBB (sRGB) → linear [r, g, b], each 0..1. */
export function srgbHexToLinear(hex: number): Vec3 {
  return [
    srgbToLinear(((hex >> 16) & 0xff) / 255),
    srgbToLinear(((hex >> 8) & 0xff) / 255),
    srgbToLinear((hex & 0xff) / 255),
  ]
}

/** CIE L* (0..100) of an sRGB hex — perceptual lightness, for legibility checks. */
export function cieLightness(hex: number): number {
  const [r, g, b] = srgbHexToLinear(hex)
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y
}
