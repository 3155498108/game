/**
 * 数字合成 2048 规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 设计要点：
 * - 棋盘是一条长度 16 的数组（行优先，索引 = row * COLS + col），0 表示空位，
 *   取值都是 2 的幂。
 * - 滑动分两步：先把该方向的方块压紧，再把**相邻且相等**的两个并成一个双倍值。
 *   一次滑动里每个方块最多参与一次合并 —— 合并出来的新方块不会再跟后面的并，
 *   所以 [2,2,4,0] 左滑得到 [4,4,0,0]（4 分），而不是 [8,0,0,0]（8 分）。
 * - 滑动后若棋盘还有空位，就在空位里随机冒出一个新方块（2 占 90%，4 占 10%）。
 * - 滑动若既没移动也没合并，状态原样返回：不加分、不生成新方块。
 * - 棋盘上出现 2048 就算通关，但**游戏继续**，直到棋盘塞满又没有任何一对相邻同值可合并。
 * - 随机数一律走 core/rng.ts 的 Rng，rng 状态（一个 32 位整数）存在 state.rng，
 *   因此同一个 seed + 同一串操作必然得到完全一样的棋盘与分数（可复盘）。
 * - 本文件不出现时间、DOM、全局随机数：墙上时钟只在 index.ts 的渲染层。
 */
import type { Point } from '../../core/geom'
import { Rng } from '../../core/rng'

// ---------------------------------------------------------------- 常量

/** 棋盘列数 / 行数 */
export const COLS = 4
export const ROWS = 4
/** 格子总数 */
export const SIZE = COLS * ROWS
/** 目标数字：合成出它就算通关 */
export const TARGET = 2048
/** 新方块是 4 的概率（其余是 2） */
export const FOUR_RATE = 0.1
/** 判定为有效滑动的位移阈值（逻辑像素） */
export const SWIPE_THRESHOLD = 24
/** 四个滑动方向 */
export const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right']

/** 滑动方向 */
export type Dir = 'up' | 'down' | 'left' | 'right'

export interface State {
  /** 棋盘：行优先，索引 = row * COLS + col，0 表示空位 */
  board: number[]
  /** 当前分数：每次合并掉的数值累加 */
  score: number
  /** 是否已经合成出过 2048（通关后仍可继续玩） */
  won: boolean
  /** 合成出 2048 时的那一步（moves 计数），null 表示还没通关 */
  wonAt: number | null
  /** 是否已经无路可走 */
  over: boolean
  /** 有效滑动次数 */
  moves: number
  /** 最近一次滑动的方向，null 表示还没滑过 */
  lastDir: Dir | null
  /** 手指按下的位置（逻辑坐标），null 表示当前没有按住 */
  dragStart: Point | null
  /** 手指当前位置（逻辑坐标） */
  dragCur: Point | null
  rng: number
}

export type Action =
  /** 滑动一次 */
  | { type: 'move'; dir: Dir }
  /** 手指按下（记录拖动起点） */
  | { type: 'press'; x: number; y: number }
  /** 手指移动（记录当前位置） */
  | { type: 'drag'; x: number; y: number }
  /** 抬手：按起点→当前位置的位移判定方向 */
  | { type: 'release' }
  /** 重开一局 */
  | { type: 'restart' }
  /** 站点壳每帧发一次；回合制游戏没有时间相关规则，原样返回状态 */
  | { type: 'tick'; ticks: number }

// ---------------------------------------------------------------- 滑动

/** 一条线（行或列）滑动后的结果 */
export interface LineSlide {
  /** 压紧并合并后的取值，长度与输入一致 */
  values: number[]
  /** 第 k 个位置上的方块来自原线的第几个位置；-1 表示该位置是空的 */
  from: number[]
  /** 本次合并掉的数值之和（得分增量） */
  gained: number
}

/**
 * 一条线上的滑动：先压紧，再把相邻且相等的两个并成一个双倍值。
 *
 * 关键：一次滑动里每个方块最多参与一次合并（合并出来的新方块不参与下一次配对）。
 */
export function slideLine(line: readonly number[]): LineSlide {
  // 压紧：非 0 的按原顺序取出来，并记住它们原来在第几格
  const tiles: number[] = []
  const src: number[] = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== 0) {
      tiles.push(line[i])
      src.push(i)
    }
  }

  const values = new Array<number>(line.length).fill(0)
  const from = new Array<number>(line.length).fill(-1)
  let gained = 0
  let write = 0
  let read = 0
  while (read < tiles.length) {
    if (read + 1 < tiles.length && tiles[read] === tiles[read + 1]) {
      // 两个相等 → 并成一个双倍值；read 前进 2，保证这个新方块不再参与配对
      values[write] = tiles[read] * 2
      from[write] = src[read]
      gained += tiles[read] * 2
      read += 2
    } else {
      values[write] = tiles[read]
      from[write] = src[read]
      read += 1
    }
    write += 1
  }
  return { values, from, gained }
}

/** 整盘滑动后的结果 */
export interface BoardSlide {
  /** 滑动（压紧 + 合并）后的棋盘，尚未生成新方块 */
  board: number[]
  /** 新棋盘每个位置上的方块来自旧棋盘的哪个位置（-1 表示该位置是空的） */
  from: number[]
  /** 本次合并掉的数值之和 */
  gained: number
}

/** 第 line 条线（行或列）上的格子索引，按滑动方向排列（最靠近目标的一端在前） */
function lineIndices(dir: Dir, line: number): number[] {
  const out: number[] = []
  for (let k = 0; k < COLS; k++) {
    if (dir === 'left') out.push(line * COLS + k)
    else if (dir === 'right') out.push(line * COLS + (COLS - 1 - k))
    else if (dir === 'up') out.push(k * COLS + line)
    else out.push((ROWS - 1 - k) * COLS + line)
  }
  return out
}

/** 整盘朝某个方向滑动一次（只压紧 + 合并，不生成新方块） */
export function slideBoard(board: readonly number[], dir: Dir): BoardSlide {
  const out = board.slice()
  const from = new Array<number>(SIZE).fill(-1)
  let gained = 0
  for (let line = 0; line < COLS; line++) {
    const idx = lineIndices(dir, line)
    const sl = slideLine(idx.map((i) => board[i]))
    gained += sl.gained
    for (let k = 0; k < COLS; k++) {
      const target = idx[k]
      out[target] = sl.values[k]
      from[target] = sl.from[k] >= 0 ? idx[sl.from[k]] : -1
    }
  }
  return { board: out, from, gained }
}

/** 棋盘上还有没有路可走：有空位，或者有一对相邻且相等的方块 */
export function canMove(board: readonly number[]): boolean {
  for (let i = 0; i < SIZE; i++) {
    if (board[i] === 0) return true
    const c = i % COLS
    const r = Math.floor(i / COLS)
    if (c + 1 < COLS && board[i] === board[i + 1]) return true
    if (r + 1 < ROWS && board[i] === board[i + COLS]) return true
  }
  return false
}

// ---------------------------------------------------------------- 随机落子

/** 在一个空位上随机放一个方块（2 占 90%，4 占 10%）；没有空位就不放 */
function putRandom(board: number[], r: Rng): void {
  const empties: number[] = []
  for (let i = 0; i < SIZE; i++) {
    if (board[i] === 0) empties.push(i)
  }
  if (empties.length === 0) return
  const at = empties[r.int(empties.length)]
  board[at] = r.chance(FOUR_RATE) ? 4 : 2
}

// ---------------------------------------------------------------- 状态

export function create(seed: number): State {
  const r = new Rng(seed)
  const board = new Array<number>(SIZE).fill(0)
  putRandom(board, r)
  putRandom(board, r)
  return {
    board,
    score: 0,
    won: false,
    wonAt: null,
    over: !canMove(board),
    moves: 0,
    lastDir: null,
    dragStart: null,
    dragCur: null,
    rng: r.s,
  }
}

/** 执行一次滑动；没有任何变化时原样返回 state（不加分、不生成新方块） */
function applyMove(state: State, dir: Dir): State {
  const sl = slideBoard(state.board, dir)
  const changed = sl.gained > 0 || sl.board.some((v, i) => v !== state.board[i])
  if (!changed) return state

  const r = new Rng(state.rng)
  const board = sl.board.slice()
  putRandom(board, r)

  const moves = state.moves + 1
  const won = state.won || board.includes(TARGET)
  return {
    ...state,
    board,
    score: state.score + sl.gained,
    won,
    wonAt: state.won ? state.wonAt : won ? moves : null,
    over: !canMove(board),
    moves,
    lastDir: dir,
    rng: r.s,
  }
}

/** 按起点→当前位置的位移判定滑动方向；位移不足阈值时返回 null */
export function swipeDir(state: State): Dir | null {
  if (!state.dragStart || !state.dragCur) return null
  const dx = state.dragCur.x - state.dragStart.x
  const dy = state.dragCur.y - state.dragStart.y
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (Math.max(ax, ay) < SWIPE_THRESHOLD) return null
  if (ax >= ay) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}

/** 纯函数状态迁移 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'move':
      return applyMove(state, action.dir)

    case 'press':
      return {
        ...state,
        dragStart: { x: action.x, y: action.y },
        dragCur: { x: action.x, y: action.y },
      }

    case 'drag':
      // 没有按住就不记录移动
      if (!state.dragStart) return state
      return { ...state, dragCur: { x: action.x, y: action.y } }

    case 'release': {
      const dir = swipeDir(state)
      const cleared: State = { ...state, dragStart: null, dragCur: null }
      // 压根没按过：清掉可能残留的拖动信息即可
      if (!state.dragStart) return state.dragCur === null ? state : cleared
      // 位移不够：当作没滑动
      if (!dir) return cleared
      return applyMove(cleared, dir)
    }

    case 'restart': {
      // 用当前随机数状态重新发牌：重开仍可复盘（同 seed 同操作 → 同结果）
      const r = new Rng(state.rng)
      const board = new Array<number>(SIZE).fill(0)
      putRandom(board, r)
      putRandom(board, r)
      return {
        ...state,
        board,
        score: 0,
        won: false,
        wonAt: null,
        over: false,
        moves: 0,
        lastDir: null,
        dragStart: null,
        dragCur: null,
        rng: r.s,
      }
    }

    case 'tick':
      // 回合制游戏没有与时间相关的规则：时间只在渲染层出现，这里原样返回
      return state
  }
}
