/**
 * 章鱼烧 takoyaki —— 网格堆叠消除（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 硬约束（见 DECISIONS.md 命名裁决表）：本玩法是「网格堆叠」，**明确禁止刚体物理**。
 * 因此「下落」不是连续运动学，而是一次性的离散定位：
 *   球从顶部生成区进入某一列 → 从底行往上找该列的第一个空格 → 直接落在那里静止。
 * 全程没有任何速度、加速度、碰撞体、旋转或时间参数；动画完全由渲染层的旁路缓存负责。
 *
 * 网格为 COLS 列 × ROWS 行，一维下标 = row * COLS + col，row 0 在最上面。
 * 单元格 0 表示空格，1..COLOR_COUNT 表示球色。
 */
import { Rng } from '../../core/rng'

/** 列数 */
export const COLS = 8
/** 行数 */
export const ROWS = 12
/** 总格数 */
export const CELLS = COLS * ROWS
/** 球色种类；0 是空格，实际取值 1..COLOR_COUNT */
export const COLOR_COUNT = 6

export const idx = (col: number, row: number): number => row * COLS + col
export const colOf = (i: number): number => i % COLS
export const rowOf = (i: number): number => Math.floor(i / COLS)

/** 是否合法的列号（整数且在 0..COLS-1 内） */
export function isCol(col: number): boolean {
  return Number.isInteger(col) && col >= 0 && col < COLS
}

/**
 * 该列的落点：从底行往上找第一个空格，返回行号；整列已满返回 -1。
 *
 * 这是「不做物理」的核心：球不会下落，而是直接判定它停在哪个格子上。
 * 因为落点永远是最底下的空格，「上方有球」的列不会漏出空洞。
 */
export function landingRow(grid: readonly number[], col: number): number {
  if (!isCol(col)) return -1
  for (let r = ROWS - 1; r >= 0; r--) if (grid[idx(col, r)] === 0) return r
  return -1
}

/** 某一列是否还能接球（该列还有空格） */
export function canDrop(grid: readonly number[], col: number): boolean {
  return landingRow(grid, col) >= 0
}

/** 该列已有的球数（自底向上连续堆叠，故等于底部连续球的数量） */
export function stackHeight(grid: readonly number[], col: number): number {
  if (!isCol(col)) return 0
  let n = 0
  for (let r = ROWS - 1; r >= 0; r--) {
    if (grid[idx(col, r)] === 0) break
    n++
  }
  return n
}

/** 顶行（第 0 行）是否已被占用 —— 即「堆到顶部」 */
export function isTopOut(grid: readonly number[]): boolean {
  for (let c = 0; c < COLS; c++) if (grid[idx(c, 0)] !== 0) return true
  return false
}

/** 棋盘上的球总数 */
export function countBalls(grid: readonly number[]): number {
  let n = 0
  for (let i = 0; i < grid.length; i++) if (grid[i] !== 0) n++
  return n
}

/** 某行是否填满 */
export function isFullRow(grid: readonly number[], row: number): boolean {
  if (row < 0 || row >= ROWS) return false
  for (let c = 0; c < COLS; c++) if (grid[idx(c, row)] === 0) return false
  return true
}

/**
 * 一次消除的得分：消除球数 × 消除行数 = COLS * rows * rows。
 * 单行 8 分、双行 32 分、三行 72 分 —— 基准就是「消除的球数」，多行再按行数加成，
 * 让「一次消多行」比「消多次单行」更划算。
 */
export function scoreGain(rows: number): number {
  return COLS * rows * rows
}

/**
 * 消行 + 重力：填满的行整体删除，其上方所有行整体下移一格。
 * 返回新棋盘（不修改入参）与被消除的行号（自上而下）。
 */
export function clearRows(grid: readonly number[]): { grid: number[]; rows: number[] } {
  const rows: number[] = []
  for (let r = 0; r < ROWS; r++) if (isFullRow(grid, r)) rows.push(r)
  if (rows.length === 0) return { grid: grid.slice(), rows }
  const out = new Array<number>(CELLS).fill(0)
  let w = ROWS - 1
  for (let r = ROWS - 1; r >= 0; r--) {
    if (isFullRow(grid, r)) continue
    for (let c = 0; c < COLS; c++) out[idx(c, w)] = grid[idx(c, r)]
    w--
  }
  return { grid: out, rows }
}

export interface State {
  /** 网格，长度恒为 CELLS；0 为空，1..COLOR_COUNT 为球色 */
  grid: number[]
  /** 下一个要落的球的颜色（由 seed 决定，可复盘） */
  nextColor: number
  /** 总得分 */
  score: number
  /** 本局「最高单次消除球数」，作为成绩之一展示 */
  bestClear: number
  /** 累计消除的球数 */
  cleared: number
  /** 累计落球数 */
  drops: number
  /** 是否已结束（堆到顶部） */
  over: boolean
  /** 悬停列，-1 表示无 */
  hover: number
  /** 最近一次成功落子的「列 + 最终落点行」（供渲染插值，不含任何时间戳） */
  lastDrop: { col: number; row: number } | null
  /** 最近一次落子产生的消除（落子时若无消除则为 null），同样不含时间戳 */
  lastClear: { rows: number[]; count: number } | null
  /** 自增序号，仅用于渲染旁路的动画签名 */
  seq: number
  /** 随机游标（只在落子时推进） */
  rng: number
}

export type Action =
  | { type: 'drop'; col: number }
  | { type: 'hover'; col: number }
  | { type: 'leave' }

export function create(seed: number): State {
  const r = new Rng(seed)
  return {
    grid: new Array<number>(CELLS).fill(0),
    nextColor: 1 + r.int(COLOR_COUNT),
    score: 0,
    bestClear: 0,
    cleared: 0,
    drops: 0,
    over: false,
    hover: -1,
    lastDrop: null,
    lastClear: null,
    seq: 0,
    rng: r.s,
  }
}

/** 纯函数状态迁移：不读时间、不读全局随机数、不修改入参 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'leave':
      return state.hover === -1 ? state : { ...state, hover: -1 }

    case 'hover': {
      const col = action.col
      if (state.over || !isCol(col) || state.hover === col) return state
      // 已经堆满的列不接受悬停，避免玩家点一个注定失败的列
      if (!canDrop(state.grid, col)) return state
      return { ...state, hover: col }
    }

    case 'drop': {
      if (state.over) return state
      const col = action.col
      if (!isCol(col)) return state

      const row = landingRow(state.grid, col)
      if (row < 0) {
        // 该列已满：球无处可落，只能停在顶部堆积区之外 → 判结束。
        // 棋盘保持不变，便于结算时展示最后局面。
        return { ...state, over: true, hover: -1 }
      }

      // 落子：直接写在落点格，不做任何连续位移
      const landed = state.grid.slice()
      landed[idx(col, row)] = state.nextColor

      // 消行 + 重力（纯函数，内部另建数组）
      const cleared = clearRows(landed)
      const count = cleared.rows.length * COLS

      // 下一个球色由 rng 推进，保证同 seed 完全可复盘
      const r = new Rng(state.rng)
      const nextColor = 1 + r.int(COLOR_COUNT)

      return {
        ...state,
        grid: cleared.grid,
        nextColor,
        rng: r.s,
        score: state.score + scoreGain(cleared.rows.length),
        bestClear: Math.max(state.bestClear, count),
        cleared: state.cleared + count,
        drops: state.drops + 1,
        // 先消行、再判顶：最后一球填满一整行并被消除时可以续命
        over: isTopOut(cleared.grid),
        hover: -1,
        lastDrop: { col, row },
        lastClear: cleared.rows.length > 0 ? { rows: cleared.rows, count } : null,
        seq: state.seq + 1,
      }
    }
  }
}

/** 点某一列落子的直观别名，便于测试复用同一入口 */
export function drop(state: State, col: number): State {
  return reduce(state, { type: 'drop', col })
}