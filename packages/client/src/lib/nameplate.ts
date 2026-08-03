import * as THREE from 'three'
import type { PlayerId, PlayerInfo } from '@wheee/shared'
import { badgeFor, BADGE_REPLACES_FLAG_FROM } from '@wheee/shared'
import type { TerrainState } from './terrain'
import { t } from './i18n'

const CANVAS_SCALE = 3
const CANVAS_W = 512
const CANVAS_H = 96
const SPRITE_H = 1.8
const Y_OFFSET = 5.6
const MAX_NAME_LEN = 16

const FONT = `600 ${28 * CANVAS_SCALE}px "SF Pro Text", "Inter", system-ui, -apple-system, sans-serif`
const SUFFIX_FONT = `500 ${22 * CANVAS_SCALE}px "SF Pro Text", "Inter", system-ui, -apple-system, sans-serif`
const FLAG_FONT = `${32 * CANVAS_SCALE}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`

const BG_COLOR = 'rgba(10, 14, 20, 0.55)'
const BORDER_RADIUS = 18 * CANVAS_SCALE
const PADDING_X = 22 * CANVAS_SCALE
const GAP = 10 * CANVAS_SCALE

const COLORS: Record<PlayerId, { text: string; glow: string }> = {
  A: { text: 'rgba(200, 225, 210, 0.92)', glow: 'rgba(74, 222, 128, 0.35)' },
  B: { text: 'rgba(210, 215, 230, 0.92)', glow: 'rgba(139, 180, 255, 0.35)' },
}

/** The name is what you read; the "(You)" behind it only has to be noticed once. */
const SUFFIX_COLOR = 'rgba(255, 255, 255, 0.55)'
const SUFFIX_GAP = 8 * CANVAS_SCALE

function truncateName(name: string): string {
  if (name.length <= MAX_NAME_LEN) return name
  return name.slice(0, MAX_NAME_LEN - 1) + '\u2026'
}

function createPlateCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = CANVAS_W * CANVAS_SCALE
  c.height = CANVAS_H * CANVAS_SCALE
  return c
}

function renderPlate(
  canvas: HTMLCanvasElement,
  name: string,
  suffix: string,
  flag: string,
  pid: PlayerId,
  badgeText: string,
): void {
  const ctx = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  const displayName = truncateName(name)

  ctx.font = FONT
  const nameW = ctx.measureText(displayName).width

  let suffixW = 0
  if (suffix) {
    ctx.font = SUFFIX_FONT
    suffixW = ctx.measureText(suffix).width
  }

  let flagW = 0
  if (flag) {
    ctx.font = FLAG_FONT
    flagW = ctx.measureText(flag).width
  }

  let badgeW = 0
  if (badgeText) {
    ctx.font = FLAG_FONT
    badgeW = ctx.measureText(badgeText).width
  }

  const contentW = nameW
    + (suffix ? SUFFIX_GAP + suffixW : 0)
    + (flag ? GAP + flagW : 0)
    + (badgeText ? GAP + badgeW : 0)
  const maxPillW = w * 0.92
  const pillW = Math.min(contentW + PADDING_X * 2, maxPillW)
  const pillH = h * 0.72
  const pillX = (w - pillW) / 2
  const pillY = (h - pillH) / 2

  const c = COLORS[pid]

  ctx.save()
  ctx.beginPath()
  ctx.roundRect(pillX, pillY, pillW, pillH, BORDER_RADIUS)
  ctx.fillStyle = BG_COLOR
  ctx.fill()

  ctx.shadowColor = c.glow
  ctx.shadowBlur = 12 * CANVAS_SCALE
  ctx.strokeStyle = c.glow
  ctx.lineWidth = 1.2 * CANVAS_SCALE
  ctx.beginPath()
  ctx.roundRect(pillX, pillY, pillW, pillH, BORDER_RADIUS)
  ctx.stroke()
  ctx.restore()

  const textX = (w - contentW) / 2
  const textY = h / 2

  ctx.font = FONT
  ctx.fillStyle = c.text
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
  ctx.shadowBlur = 4 * CANVAS_SCALE
  ctx.fillText(displayName, textX, textY)

  let cursor = textX + nameW
  if (suffix) {
    cursor += SUFFIX_GAP
    ctx.font = SUFFIX_FONT
    ctx.fillStyle = SUFFIX_COLOR
    ctx.fillText(suffix, cursor, textY + 1 * CANVAS_SCALE)
    cursor += suffixW
  }
  ctx.shadowBlur = 0

  if (flag) {
    ctx.font = FLAG_FONT
    ctx.fillText(flag, cursor + GAP, textY + 2 * CANVAS_SCALE)
    cursor += GAP + flagW
  }

  if (badgeText) {
    ctx.font = FLAG_FONT
    ctx.fillText(badgeText, cursor + GAP, textY + 2 * CANVAS_SCALE)
  }
}

interface NameplateHandle {
  sprite: THREE.Sprite
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  hasContent: boolean
  info: PlayerInfo | null
}

function createPlate(scene: THREE.Scene): NameplateHandle {
  const canvas = createPlateCanvas()
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.colorSpace = THREE.SRGBColorSpace

  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
  })

  const sprite = new THREE.Sprite(mat)
  const aspect = CANVAS_W / CANVAS_H
  sprite.scale.set(SPRITE_H * aspect, SPRITE_H, 1)
  sprite.renderOrder = 990
  sprite.visible = false
  scene.add(sprite)

  return { sprite, canvas, texture, hasContent: false, info: null }
}

type PlayerRef = {
  state: { cx: number; cz: number }
  mesh: THREE.Object3D
  surface: 'top' | 'bottom'
}

// _terrain is unused here but kept for the standard visual-system factory signature (architecture rule 8)
export function createNameplateSystem(
  scene: THREE.Scene,
  _terrain: TerrainState,
) {
  const plateA = createPlate(scene)
  const plateB = createPlate(scene)

  const plates: Record<PlayerId, NameplateHandle> = { A: plateA, B: plateB }
  let fadeA = 0
  let fadeB = 0

  let playerRefA: PlayerRef | null = null
  let playerRefB: PlayerRef | null = null
  let enabled = false
  let localId: PlayerId | null = null

  function setPlayerRefs(a: PlayerRef, b: PlayerRef) {
    playerRefA = a
    playerRefB = b
  }

  function draw(pid: PlayerId) {
    const plate = plates[pid]
    if (!plate.info) return
    // A guest's name is rolled fresh for every match, so on its own it never tells
    // them which of the two characters they are driving.
    const suffix = pid === localId ? t('hud.you') : ''
    // The badge only starts showing once it exists, and from the third rung it
    // takes the flag's place so the plate does not keep growing.
    const emoji = badgeFor(plate.info.streak ?? 0)
    const badgeText = emoji ? `${emoji}${plate.info.streak}` : ''
    const showFlag = !badgeText || (plate.info.streak ?? 0) < BADGE_REPLACES_FLAG_FROM
    renderPlate(plate.canvas, plate.info.displayName, suffix, showFlag ? plate.info.flag : '', pid, badgeText)
    plate.texture.needsUpdate = true
    plate.hasContent = true
  }

  function setInfo(pid: PlayerId, info: PlayerInfo) {
    plates[pid].info = info
    draw(pid)
  }

  /** null for watchers and replays, where neither side is the viewer. */
  function setLocalPlayer(pid: PlayerId | null) {
    if (pid === localId) return
    localId = pid
    draw('A')
    draw('B')
  }

  function setVisible(v: boolean) {
    enabled = v
    if (!v) {
      plateA.sprite.visible = false
      plateB.sprite.visible = false
      fadeA = 0
      fadeB = 0
    }
  }

  function positionSprite(plate: NameplateHandle, ref: PlayerRef) {
    const isBottom = ref.surface === 'bottom'
    const dir = isBottom ? -1 : 1

    plate.sprite.position.set(
      ref.mesh.position.x,
      ref.mesh.position.y + dir * Y_OFFSET,
      ref.mesh.position.z,
    )
  }

  function update(dt: number) {
    if (!enabled) return

    const targetA = playerRefA && plateA.hasContent ? 1 : 0
    const targetB = playerRefB && plateB.hasContent ? 1 : 0
    fadeA += (targetA - fadeA) * Math.min(dt * 4, 1)
    fadeB += (targetB - fadeB) * Math.min(dt * 4, 1)

    if (playerRefA && fadeA > 0.01) {
      positionSprite(plateA, playerRefA)
      plateA.sprite.visible = playerRefA.mesh.visible
      ;(plateA.sprite.material as THREE.SpriteMaterial).opacity = fadeA
    } else {
      plateA.sprite.visible = false
    }

    if (playerRefB && fadeB > 0.01) {
      positionSprite(plateB, playerRefB)
      plateB.sprite.visible = playerRefB.mesh.visible
      ;(plateB.sprite.material as THREE.SpriteMaterial).opacity = fadeB
    } else {
      plateB.sprite.visible = false
    }
  }

  function dispose() {
    for (const pid of ['A', 'B'] as PlayerId[]) {
      const p = plates[pid]
      scene.remove(p.sprite)
      p.texture.dispose()
      ;(p.sprite.material as THREE.SpriteMaterial).dispose()
    }
  }

  return {
    setPlayerRefs,
    setInfo,
    setLocalPlayer,
    setVisible,
    update,
    dispose,
  }
}
