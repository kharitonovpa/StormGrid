import * as THREE from 'three'
import { HALF, SIZE, THICKNESS } from './constants'
import { noise2d } from './noise'
import type { TerrainState } from './terrain'

const WIND_Y_MIN = -4
const WIND_Y_MAX = 8
const WIND_Y_MIN_BOT = -WIND_Y_MAX - THICKNESS
const WIND_Y_MAX_BOT = -WIND_Y_MIN - THICKNESS

const STREAM_COUNT = 100
const STREAM_PTS = 28
const STREAM_SPEED = 10

const DUST_COUNT = 1500
const DUST_SPEED = 11

interface StreamLine {
  x: number; z: number; speed: number; y: number
  phase: number; length: number
}

interface DustParticle {
  x: number; y: number; z: number
  speed: number; phase: number; drift: number
}

function makeStreams(yMin: number, yMax: number): StreamLine[] {
  const arr: StreamLine[] = []
  for (let i = 0; i < STREAM_COUNT; i++) {
    arr.push({
      x: (Math.random() - 0.5) * SIZE,
      z: -HALF + Math.random() * SIZE,
      speed: STREAM_SPEED * (0.6 + Math.random() * 0.8),
      y: yMin + Math.random() * (yMax - yMin),
      phase: Math.random() * Math.PI * 2,
      length: 6 + Math.random() * 12,
    })
  }
  return arr
}

function makeDust(yMin: number, yMax: number): DustParticle[] {
  const arr: DustParticle[] = []
  for (let i = 0; i < DUST_COUNT; i++) {
    arr.push({
      x: (Math.random() - 0.5) * SIZE,
      y: yMin + Math.random() * (yMax - yMin),
      z: (Math.random() - 0.5) * SIZE,
      speed: DUST_SPEED * (0.4 + Math.random() * 1.2),
      phase: Math.random() * Math.PI * 2,
      drift: (Math.random() - 0.5) * 1.5,
    })
  }
  return arr
}

function createStreamGeo() {
  const verts = new Float32Array(STREAM_COUNT * STREAM_PTS * 2 * 3)
  const colors = new Float32Array(STREAM_COUNT * STREAM_PTS * 2 * 3)
  const geo = new THREE.BufferGeometry()
  const posAttr = new THREE.BufferAttribute(verts, 3)
  const colAttr = new THREE.BufferAttribute(colors, 3)
  geo.setAttribute('position', posAttr)
  geo.setAttribute('color', colAttr)
  return { verts, colors, geo, posAttr, colAttr }
}

function createDustGeo() {
  const positions = new Float32Array(DUST_COUNT * 3)
  const sizes = new Float32Array(DUST_COUNT)
  const opacities = new Float32Array(DUST_COUNT)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geo.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1))
  return { positions, sizes, opacities, geo }
}

export function createWindSystem(scene: THREE.Scene, terrain: TerrainState) {
  const streamMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const dustMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(0.5, 0.8, 1.0) } },
    vertexShader: `
      attribute float aSize;
      attribute float aOpacity;
      varying float vOpacity;
      void main() {
        vOpacity = aOpacity;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (200.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vOpacity;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float alpha = smoothstep(1.0, 0.3, d) * vOpacity;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  })

  const streams = makeStreams(WIND_Y_MIN, WIND_Y_MAX)
  const streamsBot = makeStreams(WIND_Y_MIN_BOT, WIND_Y_MAX_BOT)
  const dustArr = makeDust(WIND_Y_MIN, WIND_Y_MAX)
  const dustArrBot = makeDust(WIND_Y_MIN_BOT, WIND_Y_MAX_BOT)

  const sg = createStreamGeo()
  const sgBot = createStreamGeo()
  const dg = createDustGeo()
  const dgBot = createDustGeo()

  const streamObj = new THREE.LineSegments(sg.geo, streamMat)
  const streamObjBot = new THREE.LineSegments(sgBot.geo, streamMat)
  const dustObj = new THREE.Points(dg.geo, dustMat)
  const dustObjBot = new THREE.Points(dgBot.geo, dustMat)

  scene.add(streamObj)
  scene.add(streamObjBot)
  scene.add(dustObj)
  scene.add(dustObjBot)

  function isBlocked(x: number, y: number, z: number): boolean {
    if (x < -HALF || x > HALF || z < -HALF || z > HALF) return false
    return terrain.getHeight(x, z) >= y
  }
  function isBlockedBottom(x: number, y: number, z: number): boolean {
    if (x < -HALF || x > HALF || z < -HALF || z > HALF) return false
    return y >= terrain.getHeight(x, z) - THICKNESS
  }

  function makeRespawnStream(yMin: number, yMax: number) {
    return (s: StreamLine) => {
      s.z = HALF + Math.random() * 8
      s.x = (Math.random() - 0.5) * SIZE
      s.y = yMin + Math.random() * (yMax - yMin)
    }
  }
  function makeRespawnDust(yMin: number, yMax: number) {
    return (d: DustParticle) => {
      d.z = HALF + Math.random() * 6
      d.x = (Math.random() - 0.5) * SIZE
      d.y = yMin + Math.random() * (yMax - yMin)
    }
  }

  const respawnStream = makeRespawnStream(WIND_Y_MIN, WIND_Y_MAX)
  const respawnStreamBot = makeRespawnStream(WIND_Y_MIN_BOT, WIND_Y_MAX_BOT)
  const respawnDust = makeRespawnDust(WIND_Y_MIN, WIND_Y_MAX)
  const respawnDustBot = makeRespawnDust(WIND_Y_MIN_BOT, WIND_Y_MAX_BOT)

  let windTime = 0

  function updateStreamSet(
    stArr: StreamLine[], stVerts: Float32Array, stColors: Float32Array,
    stPosAttr: THREE.BufferAttribute, stColAttr: THREE.BufferAttribute,
    blockedFn: (x: number, y: number, z: number) => boolean,
    respawn: (s: StreamLine) => void,
    dt: number,
  ) {
    for (let i = 0; i < stArr.length; i++) {
      const s = stArr[i]
      s.z -= s.speed * dt
      if (s.z < -HALF - s.length - 2) respawn(s)
      if (blockedFn(s.x, s.y, s.z)) respawn(s)

      const wave = Math.sin(windTime * 0.8 + s.phase) * 0.8
      let blk = false

      for (let p = 0; p < STREAM_PTS; p++) {
        const t = p / (STREAM_PTS - 1)
        const vi = (i * STREAM_PTS + p) * 6

        if (blk) {
          stVerts[vi] = 0; stVerts[vi+1] = 0; stVerts[vi+2] = 0
          stVerts[vi+3] = 0; stVerts[vi+4] = 0; stVerts[vi+5] = 0
          stColors[vi] = 0; stColors[vi+1] = 0; stColors[vi+2] = 0
          stColors[vi+3] = 0; stColors[vi+4] = 0; stColors[vi+5] = 0
          continue
        }

        const pz = s.z + t * s.length
        const noiseX = noise2d(pz * 0.3 + s.phase, windTime * 0.4) * 2.5 * t
        const noiseY = noise2d(pz * 0.25 + 50, windTime * 0.35 + s.phase) * 1.2 * t
        const px = s.x + Math.sin(t * Math.PI * 2 + s.phase + windTime * 0.5) * wave * t + noiseX
        const py = s.y + noiseY

        if (blockedFn(px, py, pz)) {
          blk = true
          stVerts[vi] = 0; stVerts[vi+1] = 0; stVerts[vi+2] = 0
          stVerts[vi+3] = 0; stVerts[vi+4] = 0; stVerts[vi+5] = 0
          stColors[vi] = 0; stColors[vi+1] = 0; stColors[vi+2] = 0
          stColors[vi+3] = 0; stColors[vi+4] = 0; stColors[vi+5] = 0
          continue
        }

        stVerts[vi]     = px
        stVerts[vi + 1] = py
        stVerts[vi + 2] = pz

        const nt = Math.min(t + 1 / (STREAM_PTS - 1), 1)
        const nz = s.z + nt * s.length
        const nnX = noise2d(nz * 0.3 + s.phase, windTime * 0.4) * 2.5 * nt
        const nnY = noise2d(nz * 0.25 + 50, windTime * 0.35 + s.phase) * 1.2 * nt
        const nx = s.x + Math.sin(nt * Math.PI * 2 + s.phase + windTime * 0.5) * wave * nt + nnX
        const npy = s.y + nnY
        const nextBlk = blockedFn(nx, npy, nz)

        stVerts[vi + 3] = (p === STREAM_PTS - 1 || nextBlk) ? px : nx
        stVerts[vi + 4] = (p === STREAM_PTS - 1 || nextBlk) ? py : npy
        stVerts[vi + 5] = (p === STREAM_PTS - 1 || nextBlk) ? pz : nz

        const fade = (1 - t)
        const bright = fade * fade * (0.6 + 0.4 * Math.sin(windTime * 2 + s.phase))
        stColors[vi]     = 0.3 * bright
        stColors[vi + 1] = 0.7 * bright
        stColors[vi + 2] = 1.0 * bright
        stColors[vi + 3] = 0.3 * bright * 0.7
        stColors[vi + 4] = 0.7 * bright * 0.7
        stColors[vi + 5] = 1.0 * bright * 0.7

        if (nextBlk) blk = true
      }
    }
    stPosAttr.needsUpdate = true
    stColAttr.needsUpdate = true
  }

  function updateDustSet(
    dArr: DustParticle[], dPositions: Float32Array, dSizes: Float32Array, dOpacities: Float32Array,
    dGeo: THREE.BufferGeometry,
    blockedFn: (x: number, y: number, z: number) => boolean,
    respawn: (d: DustParticle) => void,
    dt: number,
  ) {
    for (let i = 0; i < dArr.length; i++) {
      const d = dArr[i]
      const turbX = noise2d(d.z * 0.2 + d.phase, windTime * 0.6) - 0.5
      const turbY = noise2d(d.x * 0.2 + 30, windTime * 0.5 + d.phase) - 0.5
      d.z -= d.speed * dt
      d.x += (turbX * 3.0 + d.drift) * dt
      d.y += turbY * 1.5 * dt

      if (d.z < -HALF - 2) respawn(d)
      if (d.x < -HALF - 3) d.x = HALF + 1
      if (d.x > HALF + 3) d.x = -HALF - 1

      if (blockedFn(d.x, d.y, d.z)) respawn(d)

      dPositions[i * 3]     = d.x
      dPositions[i * 3 + 1] = d.y
      dPositions[i * 3 + 2] = d.z

      const inBounds = d.x >= -HALF && d.x <= HALF && d.z >= -HALF && d.z <= HALF
      const edgeFade = inBounds
        ? Math.min((d.x + HALF) / 5, (HALF - d.x) / 5, (d.z + HALF) / 5, (HALF - d.z) / 5, 1)
        : 0.2
      dSizes[i] = 1.5 + Math.sin(windTime * 3 + d.phase) * 0.8
      dOpacities[i] = (0.3 + 0.3 * Math.sin(windTime * 2 + d.phase)) * edgeFade
    }
    ;(dGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(dGeo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true
    ;(dGeo.attributes.aOpacity as THREE.BufferAttribute).needsUpdate = true
  }

  return {
    update(dt: number) {
      windTime += dt
      updateStreamSet(streams, sg.verts, sg.colors, sg.posAttr, sg.colAttr, isBlocked, respawnStream, dt)
      updateStreamSet(streamsBot, sgBot.verts, sgBot.colors, sgBot.posAttr, sgBot.colAttr, isBlockedBottom, respawnStreamBot, dt)
      updateDustSet(dustArr, dg.positions, dg.sizes, dg.opacities, dg.geo, isBlocked, respawnDust, dt)
      updateDustSet(dustArrBot, dgBot.positions, dgBot.sizes, dgBot.opacities, dgBot.geo, isBlockedBottom, respawnDustBot, dt)
    },
    dispose() {
      scene.remove(streamObj)
      scene.remove(streamObjBot)
      scene.remove(dustObj)
      scene.remove(dustObjBot)
      sg.geo.dispose()
      sgBot.geo.dispose()
      dg.geo.dispose()
      dgBot.geo.dispose()
      streamMat.dispose()
      dustMat.dispose()
    },
  }
}
