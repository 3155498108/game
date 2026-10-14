/**
 * 数字华容道规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 棋盘为 4×4，一维数组下标 = row * SIZE + col，row 0 在最上面。
 * 空格记作 0，目标态为 1→15 顺序、空格回到右下角。
 */
import { Rng } from '../../core/rng'

export const SIZE = 4
export const CELLS = SIZE * SIZE
/** 空格的值 */
export const BLANK = 0
/** 目标棋盘：1→15 顺序，末尾是右下角的空格 */
export const GOAL: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, BLANK]

export interface State {
  /** 当前棋盘，0 表示空格 */
  board: number[]
  /** 本局初始棋盘快照，供「重置」原样还原 */
  initial: number[]
  /** 已走步数，越少越好 */
  moves: number
  /** 是否已还原目标态；还原后不再接受移动 */
  solved: boolean
  /** 最近一次滑动：被点中的数字块从 from 滑到 to（即原空格位置） */
  lastMove: { from: number; to: number } | null
  /** 自增序号，仅用于渲染旁路的动画签名，保证每次滑动的签名唯一 */
  seq: number
  /** 悬停的格子下标，-1 表示无 */
  hover: number
  /** 随机游标（打乱时推进） */
  rng: number
}

export type Action =
  | { type: 'move'; index: number }
  | { type: 'hover'; index: number }
  | { type: 'leave' }
  | { type: 'shuffle' }
  | { type: 'reset' }

export const idx = (col: number, row: number): number => row * SIZE + col
export const colOf = (i: number): number => i % SIZE
export const rowOf = (i: number): number => Math.floor(i / SIZE)

/** 空格所在下标，没有空格时返回 -1 */
export function blankIndex(board: readonly number[]): number {
  return board.indexOf(BLANK)
}

/** 两个格子是否上下左右相邻 */
export function isAdjacent(a: number, b: number): boolean {
  return Math.abs(colOf(a) - colOf(b)) + Math.abs(rowOf(a) - rowOf(b)) === 1
}

/** 是否已还原为 1→15、空格在右下 */
export function isGoal(board: readonly number[]): boolean {
  for (let i = 0; i < CELLS; i++) if (board[i] !== GOAL[i]) return false
  return true
}

/** 逆序数：忽略空格，统计所有「左边的数大于右边的数」的配对数 */
export function inversions(board: readonly number[]): number {
  let n = 0
  for (let i = 0; i < board.length; i++) {
    const a = board[i]
    if (a === BLANK) continue
    for (let j = i + 1; j < board.length; j++) {
      const b = board[j]
      if (b !== BLANK && a > b) n++
    }
  }
  return n
}

/** 空格所在行「自底向上」的编号，最底行为 1 */
export function blankRowFromBottom(board: readonly number[]): number {
  const i = blankIndex(board)
  return i < 0 ? 0 : SIZE - rowOf(i)
}

/**
 * 可解性判定：偶数宽度棋盘（4 列）下，
 * 「逆序数 + 空格自底向上行号」为奇数时局面可解。
 * 空格在右下角时行号为 1，于是等价于「逆序数为偶数」。
 */
export function isSolvable(board: readonly number[]): boolean {
  if (board.length !== CELLS) return false
  if (blankIndex(board) < 0) return false
  return (inversions(board) + blankRowFromBottom(board)) % 2 === 1
}

/** 打乱的最大尝试次数（单次修复必然成功，这里只是防御性上限） */
const MAX_ATTEMPTS = 24

/** Fisher–Yates 随机排列，再把空格挪到右下角 */
function shuffleRaw(r: Rng): number[] {
  const board = r.shuffle(GOAL).slice()
  const b = blankIndex(board)
  if (b !== CELLS - 1) {
    board[b] = board[CELLS - 1]
    board[CELLS - 1] = BLANK
  }
  return board
}

/** 交换任意两个非空格数字：单次对换必然翻转奇偶性 */
function swapTwoTiles(board: number[], r: Rng): void {
  const spots: number[] = []
  for (let i = 0; i < board.length; i++) if (board[i] !== BLANK) spots.push(i)
  if (spots.length < 2) return
  const a = spots[r.int(spots.length)]
  let b = spots[r.int(spots.length)]
  let guard = 0
  while (b === a && guard++ < 8) b = spots[r.int(spots.length)]
  if (b === a) return
  const t = board[a]
  board[a] = board[b]
  board[b] = t
}

/** 兜底：做 8 组两两对换，偶数次对换 = 偶排列，空格不动，必然可解 */
function fallbackBoard(r: Rng): number[] {
  const board = GOAL.slice()
  for (let k = 0; k < 8; k++) {
    const i = r.range(0, CELLS - 2)
    const j = r.range(i + 1, CELLS - 1)
    const t = board[i]
    board[i] = board[j]
    board[j] = t
  }
  return board
}

/**
 * 生成一个保证可解的 4×4 棋盘（空格固定在右下角，且不等于目标态）。
 * 做法：随机排列 → 空格归位 → 逆序数奇偶校验；不可解就交换两个非空格数字
 * 翻转奇偶性后复检，仍不行则重新随机，最多 MAX_ATTEMPTS 次。
 */
export function shuffleBoard(r: Rng): number[] {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const board = shuffleRaw(r)
    if (isSolvable(board) && !isGoal(board)) return board
    swapTwoTiles(board, r)
    if (isSolvable(board) && !isGoal(board)) return board
  }
  return fallbackBoard(r)
}

export function create(seed: number): State {
  const r = new Rng(seed)
  const board = shuffleBoard(r)
  return {
    board,
    initial: board.slice(),
    moves: 0,
    solved: false,
    lastMove: null,
    seq: 0,
    hover: -1,
    rng: r.s,
  }
}

/** 纯函数状态迁移：不读时间、不读全局随机数、不修改入参 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'leave':
      return state.hover === -1 ? state : { ...state, hover: -1 }

    case 'hover': {
      const i = action.index
      if (state.solved || !Number.isInteger(i) || i < 0 || i >= CELLS) return state
      if (state.hover === i) return state
      return { ...state, hover: i }
    }

    case 'move': {
      if (state.solved) return state
      const i = action.index
      if (!Number.isInteger(i) || i < 0 || i >= CELLS) return state
      const blank = blankIndex(state.board)
      if (blank < 0 || i === blank || !isAdjacent(i, blank)) return state
      const board = state.board.slice()
      board[i] = BLANK
      board[blank] = state.board[i]
      return {
        ...state,
        board,
        moves: state.moves + 1,
        solved: isGoal(board),
        lastMove: { from: i, to: blank },
        seq: state.seq + 1,
      }
    }

    case 'shuffle': {
      const r = new Rng(state.rng)
      const board = shuffleBoard(r)
      return {
        ...state,
        board,
        initial: board.slice(),
        moves: 0,
        solved: false,
        lastMove: null,
        seq: state.seq + 1,
        hover: -1,
        rng: r.s,
      }
    }

    case 'reset': {
      // 还没走过、也没通关，说明已经在初始局面
      if (state.moves === 0 && !state.solved && state.lastMove === null) return state
      return {
        ...state,
        board: state.initial.slice(),
        moves: 0,
        solved: false,
        lastMove: null,
        seq: state.seq + 1,
        hover: -1,
      }
    }
  }
}

/** 点某一格的直观别名，便于测试复用同一入口 */
export function move(state: State, index: number): State {
  return reduce(state, { type: 'move', index })
}
