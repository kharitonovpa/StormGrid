import type { Cell, GameState, Height, Player, PlayerId, ForecastData, BonusCell, WeatherResult } from '@stormgrid/shared'
import { BOARD_SIZE, SPAWN_PAIRS } from '@stormgrid/shared'

export function createEmptyBoard(): Cell[][] {
  const board: Cell[][] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    const row: Cell[] = []
    for (let x = 0; x < BOARD_SIZE; x++) {
      row.push({ height: 0, bonus: null })
    }
    board.push(row)
  }
  return board
}

export function cloneBoard(board: Cell[][]): Cell[][] {
  return board.map(row => row.map(c => ({ ...c })))
}

export function cloneState(state: GameState): GameState {
  return {
    ...state,
    board: cloneBoard(state.board),
    players: {
      A: { ...state.players.A },
      B: { ...state.players.B },
    },
    forecast: cloneForecast(state.forecast),
    activeBonus: state.activeBonus ? { ...state.activeBonus } : null,
    weather: state.weather ? { ...state.weather } : null,
  }
}

function cloneForecast(f: ForecastData): ForecastData {
  return {
    windCandidates: [...f.windCandidates],
    rainProbability: f.rainProbability,
    instrumentsBroken: {
      A: { ...f.instrumentsBroken.A },
      B: { ...f.instrumentsBroken.B },
    },
  }
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE
}

export function getCell(board: Cell[][], x: number, y: number): Cell {
  return board[y][x]
}

export function cellOccupied(players: Record<PlayerId, Player>, x: number, y: number): boolean {
  return Object.values(players).some(p => p.alive && p.x === x && p.y === y)
}

export function clampHeight(h: number): Height {
  return Math.max(-1, Math.min(1, h)) as Height
}

export function createInitialState(spawn?: typeof SPAWN_PAIRS[number]): GameState {
  const pair = spawn ?? SPAWN_PAIRS[Math.floor(Math.random() * SPAWN_PAIRS.length)]
  return {
    board: createEmptyBoard(),
    players: {
      A: { id: 'A', x: pair.A.x, y: pair.A.y, character: 'wheat', alive: true },
      B: { id: 'B', x: pair.B.x, y: pair.B.y, character: 'wheat', alive: true },
    },
    tick: 0,
    round: 1,
    phase: 'waiting',
    forecast: {
      windCandidates: [],
      rainProbability: 0,
      instrumentsBroken: {
        A: { vane: false, barometer: false },
        B: { vane: false, barometer: false },
      },
    },
    activeBonus: null,
    weather: null,
    winner: null,
  }
}

function negateBoard(board: Cell[][]): Cell[][] {
  return board.map(row => row.map(c => ({ ...c, height: -c.height as Height })))
}

export function stateForPlayer(state: GameState, pid: PlayerId): GameState {
  if (pid === 'A') return { ...state }
  return { ...state, board: negateBoard(state.board) }
}

export function resultForPlayer(
  result: WeatherResult,
  pid: PlayerId,
): WeatherResult {
  if (pid === 'A') {
    return { ...result, floodedCellsB: [] }
  }
  return {
    ...result,
    state: stateForPlayer(result.state, pid),
    floodedCells: result.floodedCellsB,
    floodedCellsB: [],
  }
}
