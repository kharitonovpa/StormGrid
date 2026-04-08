import type { WindDir } from '@stormgrid/shared'
import { BOARD_SIZE } from '@stormgrid/shared'
import type { TerrainState } from './terrain'

type WindSystem = { setDirection(dir: WindDir): void; setVisible(v: boolean): void }
type RainSystem = { setVisible(v: boolean): void }
type WaterSystem = { buildTop(): void; buildBot(): void; dispose(): void }

interface DemoCallbacks {
  onTerrainChanged(): void
  onRequestFlood(): void
}

interface DemoPhase {
  name: string
  duration: number
  enter(): void
  exit(): void
}

export interface LobbyDemo {
  start(): void
  stop(): void
  update(dt: number): void
}

const WIND_CYCLE: WindDir[] = ['N', 'E', 'S', 'W']

function randomBoard(): { height: number }[][] {
  const board: { height: number }[][] = []
  for (let z = 0; z < BOARD_SIZE; z++) {
    const row: { height: number }[] = []
    for (let x = 0; x < BOARD_SIZE; x++) {
      const r = Math.random()
      const h = r < 0.25 ? 1 : r < 0.45 ? -1 : 0
      row.push({ height: h })
    }
    board.push(row)
  }
  return board
}

function flatBoard(): { height: number }[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({ height: 0 })),
  )
}

function sculptedBoard(): { height: number }[][] {
  const board = flatBoard()
  const cx = Math.floor(BOARD_SIZE / 2)
  const cz = Math.floor(BOARD_SIZE / 2)
  board[cz][cx].height = 1
  board[cz - 1][cx].height = 1
  board[cz][cx + 1].height = 1
  board[cz + 1][cx - 1].height = -1
  board[cz + 1][cx].height = -1
  board[cz + 1][cx + 1].height = -1
  board[0][0].height = 1
  board[0][BOARD_SIZE - 1].height = 1
  board[BOARD_SIZE - 1][0].height = -1
  return board
}

function basinBoard(): { height: number }[][] {
  const board = flatBoard()
  const c = Math.floor(BOARD_SIZE / 2)
  board[c][c].height = -1
  board[c - 1][c].height = -1
  board[c][c - 1].height = -1
  board[c][c + 1].height = -1
  board[c + 1][c].height = -1
  board[0][0].height = 1
  board[0][BOARD_SIZE - 1].height = 1
  board[BOARD_SIZE - 1][0].height = 1
  board[BOARD_SIZE - 1][BOARD_SIZE - 1].height = 1
  board[c - 1][c - 1].height = 1
  board[c - 1][c + 1].height = 1
  return board
}

export function createLobbyDemo(
  terrain: TerrainState,
  wind: WindSystem,
  rain: RainSystem,
  water: WaterSystem,
  callbacks: DemoCallbacks,
): LobbyDemo {
  let running = false
  let elapsed = 0
  let phaseIndex = 0
  let phaseTime = 0
  let windDirIndex = 0

  const phases: DemoPhase[] = [
    {
      name: 'sculpt',
      duration: 5,
      enter() {
        terrain.applyBoardState(sculptedBoard())
        callbacks.onTerrainChanged()
      },
      exit() {},
    },
    {
      name: 'wind',
      duration: 5,
      enter() {
        wind.setDirection(WIND_CYCLE[windDirIndex % WIND_CYCLE.length])
        windDirIndex++
        wind.setVisible(true)
      },
      exit() {
        wind.setVisible(false)
      },
    },
    {
      name: 'flood',
      duration: 6,
      enter() {
        terrain.applyBoardState(basinBoard())
        callbacks.onTerrainChanged()
        callbacks.onRequestFlood()
        rain.setVisible(true)
      },
      exit() {
        rain.setVisible(false)
        water.dispose()
      },
    },
    {
      name: 'morph',
      duration: 5,
      enter() {
        terrain.applyBoardState(randomBoard())
        callbacks.onTerrainChanged()
      },
      exit() {},
    },
    {
      name: 'rain',
      duration: 5,
      enter() {
        rain.setVisible(true)
        wind.setDirection(WIND_CYCLE[windDirIndex % WIND_CYCLE.length])
        windDirIndex++
        wind.setVisible(true)
      },
      exit() {
        rain.setVisible(false)
        wind.setVisible(false)
      },
    },
    {
      name: 'reset',
      duration: 3,
      enter() {
        terrain.applyBoardState(flatBoard())
        callbacks.onTerrainChanged()
      },
      exit() {},
    },
  ]

  function enterPhase(i: number) {
    phaseIndex = i % phases.length
    phaseTime = 0
    phases[phaseIndex].enter()
  }

  return {
    start() {
      if (running) return
      running = true
      elapsed = 0
      phaseIndex = 0
      phaseTime = 0
      windDirIndex = 0
      wind.setVisible(false)
      rain.setVisible(false)
      terrain.applyBoardState(sculptedBoard())
      callbacks.onTerrainChanged()
      enterPhase(0)
    },

    stop() {
      if (!running) return
      running = false
      phases[phaseIndex].exit()
      wind.setVisible(false)
      rain.setVisible(false)
      water.dispose()
      terrain.resetFlat()
      callbacks.onTerrainChanged()
    },

    update(dt: number) {
      if (!running) return
      elapsed += dt
      phaseTime += dt
      while (running && phaseTime >= phases[phaseIndex].duration) {
        const overflow = phaseTime - phases[phaseIndex].duration
        phases[phaseIndex].exit()
        enterPhase(phaseIndex + 1)
        phaseTime = overflow
      }
    },
  }
}
