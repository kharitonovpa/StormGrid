/**
 * The one star shape every points readout shares — HUD chips, the lobby
 * badge, the leaderboard and the in-world nameplate all draw this path, so a
 * "★" never falls through to whichever symbol font the platform happens to
 * substitute (JetBrains Mono ships no U+2605, and Google Fonts would not
 * serve it anyway).
 *
 * Five points in a 24×24 box, centred at (12, 12.4) so the visual centre —
 * not the bounding box — sits on the text midline.
 */
export const STAR_VIEWBOX = 24
export const STAR_PATH =
  'M12 2.2L14.53 8.92L21.7 9.25L16.09 13.73L18 20.65L12 16.7L6 20.65L7.91 13.73L2.3 9.25L9.47 8.92Z'
