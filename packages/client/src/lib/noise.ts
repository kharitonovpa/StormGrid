export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}

function hash(n: number) {
  const x = Math.sin(n) * 43758.5453
  return x - Math.floor(x)
}

export function noise2d(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix + iy * 57)
  const b = hash(ix + 1 + iy * 57)
  const c = hash(ix + (iy + 1) * 57)
  const d = hash(ix + 1 + (iy + 1) * 57)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

export function fbm(x: number, y: number) {
  return noise2d(x, y) * 0.5
       + noise2d(x * 2, y * 2) * 0.25
       + noise2d(x * 4, y * 4) * 0.125
       + noise2d(x * 8, y * 8) * 0.0625
       - 0.45
}

export function sstep(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function mix(a: number, b: number, t: number) { return a + (b - a) * t }
