/** Where the camera rests, by screen shape. Direction only — distance is fitted in App.vue. */
const LANDSCAPE = { x: 30, y: 25, z: 30 }
const AZIMUTH = Math.atan2(LANDSCAPE.z, LANDSCAPE.x)
const ELEVATION_LANDSCAPE = Math.atan2(LANDSCAPE.y, Math.hypot(LANDSCAPE.x, LANDSCAPE.z))
/** Steeper on a phone held upright: the diamond gets taller on screen, the bearing stays. */
const ELEVATION_PORTRAIT = 52 * Math.PI / 180
const PORTRAIT_ASPECT = 0.9
/** Fraction of the viewport height the lobby render slides up on portrait, out from under the panel. */
export const LOBBY_PORTRAIT_OFFSET = 0.22

export function isPortrait(aspect: number): boolean {
  return aspect < PORTRAIT_ASPECT
}

export function restDirection(aspect: number): { x: number; y: number; z: number } {
  const elev = isPortrait(aspect) ? ELEVATION_PORTRAIT : ELEVATION_LANDSCAPE
  const flat = Math.cos(elev)
  return { x: flat * Math.cos(AZIMUTH), y: Math.sin(elev), z: flat * Math.sin(AZIMUTH) }
}
