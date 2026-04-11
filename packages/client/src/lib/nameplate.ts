import * as THREE from 'three'
import type { PlayerId, PlayerInfo } from '@wheee/shared'
import type { TerrainState } from './terrain'
import { HALF, CELL_SIZE, THICKNESS } from './constants'

const CANVAS_SCALE = 3
const CANVAS_W = 512
const CANVAS_H = 96
const SPRITE_H = 1.8
const Y_OFFSET = 5.6
const MAX_NAME_LEN = 16

const FONT = `600 ${28 * CANVAS_SCALE}px "SF Pro Text", "Inter", system-ui, -apple-system, sans-serif`
const FLAG_FONT = `${32 * CANVAS_SCALE}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`

const BG_COLOR = 'rgba(10, 14, 20, 0.55)'
const BORDER_RADIUS = 18 * CANVAS_SCALE
const PADDING_X = 22 * CANVAS_SCALE
const GAP = 10 * CANVAS_SCALE

const COLORS: Record<PlayerId, { text: string; glow: string }> = {
  A: { text: 'rgba(200, 225, 210, 0.92)', glow: 'rgba(74, 222, 128, 0.35)' },
  B: { text: 'rgba(210, 215, 230, 0.92)', glow: 'rgba(139, 180, 255, 0.35)' },
}

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

function renderPlate(canvas: HTMLCanvasElement, name: string, flag: string, pid: PlayerId): void {
  const ctx = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  const displayName = truncateName(name)

  ctx.font = FONT
  const nameW = ctx.measureText(displayName).width

  let flagW = 0
  if (flag) {
    ctx.font = FLAG_FONT
    flagW = ctx.measureText(flag).width
  }

  const contentW = nameW + (flag ? GAP + flagW : 0)
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
  ctx.shadowBlur = 0

  if (flag) {
    ctx.font = FLAG_FONT
    ctx.fillText(flag, textX + nameW + GAP, textY + 2 * CANVAS_SCALE)
  }
}

interface NameplateHandle {
  sprite: THREE.Sprite
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  hasContent: boolean
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

  return { sprite, canvas, texture, hasContent: false }
}

type PlayerRef = {
  state: { cx: number; cz: number }
  mesh: THREE.Object3D
  surface: 'top' | 'bottom'
}

export function createNameplateSystem(
  scene: THREE.Scene,
  terrain: TerrainState,
) {
  const plateA = createPlate(scene)
  const plateB = createPlate(scene)

  const plates: Record<PlayerId, NameplateHandle> = { A: plateA, B: plateB }
  let fadeA = 0
  let fadeB = 0

  let playerRefA: PlayerRef | null = null
  let playerRefB: PlayerRef | null = null
  let enabled = false

  function setPlayerRefs(a: PlayerRef, b: PlayerRef) {
    playerRefA = a
    playerRefB = b
  }

  function setInfo(pid: PlayerId, info: PlayerInfo) {
    const plate = plates[pid]
    renderPlate(plate.canvas, info.displayName, info.flag, pid)
    plate.texture.needsUpdate = true
    plate.hasContent = true
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
    setVisible,
    update,
    dispose,
  }
}
