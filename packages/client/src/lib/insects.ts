import * as THREE from 'three'
import { HALF, CELL_SIZE } from './constants'
import type { CharacterType } from '@wheee/shared'
import type { TerrainState } from './terrain'

/**
 * The opponent is a plant standing on the far face of the slab. Butterflies with
 * gem-cut wings gather over the cell above them — the only hint that anything is
 * down there. Each character draws its own species, so the swarm also tells you
 * who you are facing. Nothing is drawn on the ground and no geometry is touched.
 */

const COUNT = 3
const ORBIT_R = CELL_SIZE * 0.3
const ORBIT_RY = 0.55
const HOVER = 1.5
const SPRITE_SIZE = 1
/** Held below full so the swarm stays a hint and never competes with the board. */
const MAX_OPACITY = 0.7
const EL_AMP = 0.7
const FADE_SPEED = 2.0
const DRIFT_SPEED = 4.5
const SCATTER_RISE = 3.2
const SCATTER_SETTLE = 1.1
const SCATTER_SPREAD = 5
const SCATTER_LIFT = 7
const CELL_TEX = 128

/**
 * One wing-beat as four poses. `open` folds the wings by foreshortening them
 * horizontally, which is what the beat actually looks like from above; `flash`
 * brightens the facets as they fold, so the stone catches the light on the way.
 */
const POSES: { open: number; flash: number }[] = [
  { open: 1, flash: 0 },
  { open: 0.66, flash: 0.2 },
  { open: 0.32, flash: 0.7 },
  { open: 0.62, flash: 0.25 },
]

export interface InsectMark {
  cx: number
  cz: number
  character: CharacterType
  scatter: boolean
}

interface Gem {
  /** Facet fills, from the deepest shadow to the brightest highlight. */
  deep: string
  mid: string
  bright: string
  /** Cut edges catch the light, which is what makes a flat shape read as a stone. */
  edge: string
  span: number
  tilt: number
}

const GEMS: Record<CharacterType, Gem> = {
  // Topaz: warm amber, reads instantly against grass.
  wheat: { deep: '#a8500a', mid: '#f0940f', bright: '#ffd763', edge: '#fff6d0', span: 1, tilt: 0 },
  // Aquamarine: cold cyan, the strongest contrast of the three.
  rice: { deep: '#0a5a8c', mid: '#16a8d2', bright: '#86ecf8', edge: '#e2fdff', span: 0.92, tilt: 0.16 },
  // Amethyst: violet through rose.
  corn: { deep: '#5f1a8a', mid: '#b23bd6', bright: '#f7a6f2', edge: '#ffe6fc', span: 1.08, tilt: -0.14 },
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (sh: number) => {
    const va = (pa >> sh) & 255
    const vb = (pb >> sh) & 255
    return Math.round(va + (vb - va) * t)
  }
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`
}

function drawPose(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  gem: Gem, open: number, flash: number,
) {
  const s = (CELL_TEX / 64) * gem.span
  const deep = mixHex(gem.deep, gem.bright, flash)
  const mid = mixHex(gem.mid, gem.edge, flash * 0.7)
  const bright = mixHex(gem.bright, '#ffffff', flash * 0.35)
  const edge = mixHex(gem.edge, '#ffffff', flash * 0.6)

  const px = (x: number) => cx + x * open * s
  const py = (y: number) => cy + y * s

  const facet = (pts: [number, number][], from: string, to: string, alpha: number) => {
    const g = ctx.createLinearGradient(
      px(pts[0][0]), py(pts[0][1]),
      px(pts[pts.length - 1][0]), py(pts[pts.length - 1][1]),
    )
    g.addColorStop(0, from)
    g.addColorStop(1, to)
    ctx.globalAlpha = alpha
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(px(pts[0][0]), py(pts[0][1]))
    for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i][0]), py(pts[i][1]))
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = edge
    ctx.lineWidth = 0.9
    ctx.stroke()
  }

  for (const dir of [-1, 1] as const) {
    const t = gem.tilt * dir
    const root: [number, number] = [dir * 1.5, 1 + t]
    // Wings held up in a V: the upper pair dominates and the lower pair is
    // tucked in. Four equal lobes would read as a flower once it gets small.
    const up1: [number, number] = [dir * 3, -28]
    const up2: [number, number] = [dir * 17, -24]
    const up3: [number, number] = [dir * 23, -8]
    const low1: [number, number] = [dir * 14, 4]
    const low2: [number, number] = [dir * 10, 13]
    const low3: [number, number] = [dir * 3, 11]

    facet([root, up1, up2], bright, mid, 0.95)
    facet([root, up2, up3], mid, deep, 0.88)
    facet([root, low1, low2], mid, bright, 0.9)
    facet([root, low2, low3], deep, mid, 0.82)
  }

  // Bloom around the stone, so it looks lit rather than painted.
  const halo = ctx.createRadialGradient(cx, cy, s * 4, cx, cy, s * 30)
  halo.addColorStop(0, bright)
  halo.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.globalAlpha = 0.22 + flash * 0.3
  ctx.fillStyle = halo
  ctx.fillRect(cx - CELL_TEX / 2, cy - CELL_TEX / 2, CELL_TEX, CELL_TEX)
  ctx.globalAlpha = 1

  // A long body and antennae are what still say "butterfly" at thirty pixels.
  ctx.fillStyle = 'rgba(38,26,18,0.92)'
  ctx.beginPath()
  ctx.ellipse(cx, cy + 2 * s, 2.2 * s, 13 * s, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = 'rgba(38,26,18,0.85)'
  ctx.lineWidth = 1.1 * s
  for (const dir of [-1, 1] as const) {
    ctx.beginPath()
    ctx.moveTo(cx + dir * 1 * s, cy - 12 * s)
    ctx.quadraticCurveTo(cx + dir * 4 * s, cy - 20 * s, cx + dir * 9 * s, cy - 25 * s)
    ctx.stroke()
  }

  // A single specular glint sells the whole illusion.
  ctx.fillStyle = `rgba(255,255,255,${0.9 * (1 - flash * 0.3)})`
  ctx.beginPath()
  ctx.ellipse(px(-7), py(-9), 2.2 * s * open, 1.3 * s, -0.6, 0, Math.PI * 2)
  ctx.fill()
}

/** All four poses side by side; sprites walk the strip with the texture offset. */
function buildAtlas(gem: Gem): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = CELL_TEX * POSES.length
  canvas.height = CELL_TEX
  const ctx = canvas.getContext('2d')
  if (ctx) {
    POSES.forEach((pose, i) => {
      drawPose(ctx, i * CELL_TEX + CELL_TEX / 2, CELL_TEX / 2, gem, pose.open, pose.flash)
    })
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  return tex
}

interface Insect {
  sprite: THREE.Sprite
  mat: THREE.SpriteMaterial
  /** Own texture clone: the frame offset lives on the texture, not the material. */
  tex: THREE.Texture | null
  wAz: number
  wEl: number
  pAz: number
  pEl: number
  flapHz: number
  pFlap: number
  radius: number
}

export function createInsectSystem(
  scene: THREE.Scene,
  terrain: TerrainState,
  getMark: () => InsectMark | null,
) {
  const atlases = new Map<CharacterType, THREE.CanvasTexture>()
  function atlasFor(character: CharacterType) {
    let tex = atlases.get(character)
    if (!tex) {
      tex = buildAtlas(GEMS[character])
      atlases.set(character, tex)
    }
    return tex
  }

  const group = new THREE.Group()
  group.visible = false
  scene.add(group)

  const insects: Insect[] = []
  for (let i = 0; i < COUNT; i++) {
    const mat = new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.setScalar(SPRITE_SIZE)
    group.add(sprite)
    insects.push({
      sprite,
      mat,
      tex: null,
      // Slightly incommensurate speeds, and not all circling the same way.
      wAz: (0.8 + Math.random() * 0.5) * (i % 2 === 0 ? 1 : -1),
      wEl: 1.3 + Math.random() * 0.9,
      pAz: (i / COUNT) * Math.PI * 2 + Math.random() * 0.6,
      pEl: Math.random() * Math.PI * 2,
      flapHz: 7 + Math.random() * 4,
      pFlap: Math.random(),
      radius: ORBIT_R * (0.7 + Math.random() * 0.55),
    })
  }

  const center = new THREE.Vector3()
  const target = new THREE.Vector3()
  let placed = false
  let opacity = 0
  let scatter = 0
  let species: CharacterType | null = null
  let time = 0

  function setSpecies(character: CharacterType) {
    if (species === character) return
    species = character
    const atlas = atlasFor(character)
    for (const b of insects) {
      b.tex?.dispose()
      const tex = atlas.clone()
      tex.repeat.set(1 / POSES.length, 1)
      tex.needsUpdate = true
      b.tex = tex
      b.mat.map = tex
      b.mat.needsUpdate = true
    }
  }

  function update(dt: number) {
    const mark = getMark()
    time += dt

    // They bolt when the storm arrives and drift back in more slowly.
    const want = mark?.scatter ? 1 : 0
    scatter += (want - scatter) * Math.min(1, dt * (want ? SCATTER_RISE : SCATTER_SETTLE))

    if (!mark) {
      placed = false
      opacity = Math.max(0, opacity - dt * FADE_SPEED)
    } else {
      setSpecies(mark.character)
      const wx = -HALF + (mark.cx + 0.5) * CELL_SIZE
      const wz = -HALF + (mark.cz + 0.5) * CELL_SIZE
      target.set(wx, terrain.getHeight(wx, wz) + HOVER, wz)
      if (!placed) {
        center.copy(target)
        placed = true
      } else {
        // Drifting rather than jumping makes the opponent's move readable.
        center.lerp(target, Math.min(1, dt * DRIFT_SPEED))
      }
      opacity = Math.min(1, opacity + dt * FADE_SPEED)
    }

    const shown = opacity * (1 - scatter) * MAX_OPACITY
    group.visible = shown > 0.01
    if (!group.visible) return

    for (const b of insects) {
      const az = time * b.wAz + b.pAz
      const el = Math.sin(time * b.wEl + b.pEl) * EL_AMP
      const cel = Math.cos(el)
      const r = b.radius * (1 + scatter * SCATTER_SPREAD)
      b.sprite.position.set(
        center.x + Math.cos(az) * cel * r,
        center.y + Math.sin(el) * ORBIT_RY + scatter * SCATTER_LIFT,
        center.z + Math.sin(az) * cel * r,
      )
      // Only a bank into the turn: a full spin would read as a pinwheel.
      b.mat.rotation = Math.sin(az) * 0.32
      b.mat.opacity = shown
      if (b.tex) {
        const frame = Math.floor((time * b.flapHz + b.pFlap) * POSES.length) % POSES.length
        b.tex.offset.x = frame / POSES.length
      }
    }
  }

  return {
    update,
    dispose() {
      scene.remove(group)
      for (const b of insects) {
        b.tex?.dispose()
        b.mat.dispose()
      }
      for (const tex of atlases.values()) tex.dispose()
      atlases.clear()
    },
  }
}
