import * as THREE from 'three'

/**
 * The opponent stands on the far face of the slab, so the storm that decides the
 * match happens out of sight: you are told that you won without ever seeing why.
 * When a cataclysm kills someone, the whole slab turns to glass — the same wind
 * carries you both, and you watch who leaves the board first, or whose hollow
 * closes over them.
 *
 * It only ever opens once the storm has resolved, so nothing about the next move
 * leaks. The grid lines stay solid, which is what keeps the board readable while
 * the ground it is drawn on goes clear.
 */

/**
 * A blending face has to be drawn back to front by hand, and the opponent hangs
 * below the far face, so every layer of the slab needs its own place in the
 * queue for the glass to show anything at all.
 */
export const GLASS_ORDER = {
  /** Water in the opponent's hollows, deepest thing the glass ever shows. */
  farWater: -3,
  /** The face the opponent stands on. */
  farFace: -2,
  /** The face the player stands on. */
  nearFace: -1,
  /** Own water lies on top of the near face, so it comes last. */
  nearWater: 0,
}

/** Ground left standing once the slab is fully clear. */
const GLASS_OPACITY = 0.5
/** Earth is matte, glass is not: the highlight is what names the material. */
const GLASS_ROUGHNESS = 0.25
/**
 * Blending against the night sky costs the ground half its light, which reads as
 * dusk rather than as glass. A lit jade pays that back and gives the slab the
 * inner glow a thick pane has.
 */
const GLASS_GLOW = 0x2f6b52
// Tuned for AgX tone mapping (lib/look.ts), which compresses highlights.
const GLASS_GLOW_GAIN = 0.65
/** The wind starts carrying bodies at once, so the slab has to be clear by then. */
const OPEN_SPEED = 6
const CLOSE_SPEED = 1.5

/**
 * A bolt landing lights the slab it landed on, glass or not. This is a shimmer and
 * nothing more: the plate covers most of the frame, so washing it to white would be
 * a full-screen flash by another name — measured at 0.9 gain it lifted the mean
 * frame from 68 to 125 of 255. It brightens its own jade by under a fifth of that,
 * for a fifth of a second, and never darkens past its resting state.
 */
const PULSE_COLOR = 0x63c79b
const PULSE_GAIN = 0.42
const PULSE_SECONDS = 0.18

/** Patches the terrain material — every face of the slab turns at once. */
export function createGlassSystem(material: THREE.MeshStandardMaterial) {
  const earthRoughness = material.roughness
  material.emissive = new THREE.Color(GLASS_GLOW)
  material.emissiveIntensity = 0
  // Kept blending even while shut: switching it would recompile the shader in
  // the middle of the storm.
  material.transparent = true

  const restColor = new THREE.Color(GLASS_GLOW)
  const flashColor = new THREE.Color(PULSE_COLOR)

  let wanted = false
  let open = 0
  let pulseT = 0

  return {
    /** Holds the slab clear until close(). */
    open() { wanted = true },
    close() { wanted = false },
    /** One strike's worth of light on the plate. */
    pulse() { pulseT = PULSE_SECONDS },
    update(dt: number) {
      const target = wanted ? 1 : 0
      if (open !== target) {
        const speed = wanted ? OPEN_SPEED : CLOSE_SPEED
        open += Math.sign(target - open) * Math.min(Math.abs(target - open), dt * speed)
        material.opacity = 1 - (1 - GLASS_OPACITY) * open
        material.roughness = earthRoughness + (GLASS_ROUGHNESS - earthRoughness) * open
        material.emissiveIntensity = GLASS_GLOW_GAIN * open
      }
      if (pulseT > 0) {
        pulseT = Math.max(0, pulseT - dt)
        const k = pulseT / PULSE_SECONDS
        material.emissive.copy(restColor).lerp(flashColor, k)
        material.emissiveIntensity = GLASS_GLOW_GAIN * open + PULSE_GAIN * k
      }
    },
    dispose() {
      material.transparent = false
      material.opacity = 1
      material.roughness = earthRoughness
      material.emissiveIntensity = 0
    },
  }
}
