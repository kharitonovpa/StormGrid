const PARTICLE_COUNT = 24
const BURST_DURATION = 400
const FLY_DURATION = 700
const TOTAL_DURATION = BURST_DURATION + FLY_DURATION

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  hue: number
  alpha: number
}

let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let running = false
let rafId = 0

interface Burst {
  particles: Particle[]
  sx: number
  sy: number
  tx: number
  ty: number
  t0: number
  points: number
  onArrive?: () => void
}

const bursts: Burst[] = []

function ensureCanvas() {
  if (canvas) return
  canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none'
  document.body.appendChild(canvas)
  ctx = canvas.getContext('2d')!
  resize()
  window.addEventListener('resize', resize)
}

function resize() {
  if (!canvas) return
  canvas.width = window.innerWidth * devicePixelRatio
  canvas.height = window.innerHeight * devicePixelRatio
  canvas.style.width = window.innerWidth + 'px'
  canvas.style.height = window.innerHeight + 'px'
}

function tick(now: number) {
  if (!ctx || !canvas) return
  const w = canvas.width
  const h = canvas.height
  const dpr = devicePixelRatio

  ctx.clearRect(0, 0, w, h)

  for (let bi = bursts.length - 1; bi >= 0; bi--) {
    const b = bursts[bi]
    const elapsed = now - b.t0
    if (elapsed > TOTAL_DURATION + 100) {
      if (b.onArrive) b.onArrive()
      bursts.splice(bi, 1)
      continue
    }

    const burstPhase = Math.min(elapsed / BURST_DURATION, 1)
    const flyPhase = Math.max(0, (elapsed - BURST_DURATION) / FLY_DURATION)

    for (const p of b.particles) {
      let px: number, py: number, alpha: number, size: number

      if (burstPhase < 1) {
        const ease = 1 - (1 - burstPhase) * (1 - burstPhase)
        px = b.sx + p.vx * ease * 80
        py = b.sy + p.vy * ease * 80
        alpha = p.alpha * (1 - burstPhase * 0.3)
        size = p.size * (1 + burstPhase * 0.5)
      } else {
        const ease = flyPhase * flyPhase * (3 - 2 * flyPhase)
        const bx = b.sx + p.vx * 80
        const by = b.sy + p.vy * 80
        px = bx + (b.tx - bx) * ease
        py = by + (b.ty - by) * ease
        alpha = p.alpha * (1 - flyPhase * 0.6)
        size = p.size * (1 - flyPhase * 0.5)
      }

      ctx.save()
      ctx.globalAlpha = Math.max(0, alpha)
      ctx.fillStyle = `hsl(${p.hue}, 85%, 65%)`
      ctx.shadowColor = `hsla(${p.hue}, 90%, 60%, 0.6)`
      ctx.shadowBlur = 8 * dpr
      ctx.beginPath()
      ctx.arc(px * dpr, py * dpr, Math.max(0.5, size * dpr), 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    if (flyPhase > 0.85 && flyPhase <= 1) {
      const glow = 1 - (flyPhase - 0.85) / 0.15
      ctx.save()
      ctx.globalAlpha = glow * 0.4
      ctx.fillStyle = 'hsl(42, 90%, 65%)'
      ctx.shadowColor = 'hsla(42, 90%, 60%, 0.5)'
      ctx.shadowBlur = 20 * dpr
      ctx.beginPath()
      ctx.arc(b.tx * dpr, b.ty * dpr, 12 * dpr * glow, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  if (bursts.length === 0) {
    running = false
    ctx.clearRect(0, 0, w, h)
    return
  }
  rafId = requestAnimationFrame(tick)
}

export function celebrate(
  sx: number, sy: number,
  tx: number, ty: number,
  points: number,
  onArrive?: () => void,
) {
  ensureCanvas()
  const particles: Particle[] = []
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + (Math.random() - 0.5) * 0.5
    const speed = 0.6 + Math.random() * 0.8
    particles.push({
      x: sx, y: sy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 2 + Math.random() * 2,
      hue: 38 + Math.random() * 20,
      alpha: 0.7 + Math.random() * 0.3,
    })
  }

  bursts.push({
    particles, sx, sy, tx, ty,
    t0: performance.now(),
    points,
    onArrive,
  })

  if (!running) {
    running = true
    rafId = requestAnimationFrame(tick)
  }
}

export function disposeCelebrate() {
  cancelAnimationFrame(rafId)
  bursts.length = 0
  running = false
  if (canvas) {
    window.removeEventListener('resize', resize)
    canvas.remove()
    canvas = null
    ctx = null
  }
}
