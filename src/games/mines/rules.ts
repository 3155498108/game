/**
 * 扫雷赌局 mines —— 纯规则层。
 *
 * 约束：不 import DOM、不读 Date / performance、不使用 Math.random；
 * 全部随机性来自 Rng(seed)，雷位在开局（start）一次性埋定并写入 state。
 */
import { Rng, hashSeed } from '../../core/rng'

// ---------------- 棋盘 ----------------
export const COLS = 5
export const ROWS = 5
export const CELL_COUNT = COLS * ROWS

/** 可选雷数（开局前由玩家决定） */
export const MINE_OPTIONS = [3, 5, 10] as const
export type MineCount = (typeof MINE_OPTIONS)[number]
export const DEFAULT_MINE_COUNT: MineCount = 5

// ---------------- 网格布局（渲染与输入共用，纯常量） ----------------
export const GRID_X = 64
export const GRID_Y = 300
export const CELL_SIZE = 112
export const CELL_GAP = 8
export const CELL_W = CELL_SIZE + CELL_GAP
export const CELL_H = CELL_W

export function isMineCount(n: number): n is MineCount {
  return (MINE_OPTIONS as readonly number[]).includes(n)
}

/** 任意坐标转格位；越界返回 null */
export function cellIndex(col: number, row: number): number | null {
  if (!Number.isInteger(col) || !Number.isInteger(row)) return null
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null
  return row * COLS + col
}

export function cellCol(index: number): number {
  return index % COLS
}

export function cellRow(index: number): number {
  return Math.floor(index / COLS)
}

// ---------------- 收益倍数表 ----------------
/**
 * PAYOUT[雷数][已翻开的安全格数 - 1] = 净收益倍数（相对注额）。
 *
 * 数值 = 公平赔率 × 0.96（庄家留 4% 水位）后向下取整到两位小数，
 * 即按 3 / 5 / 10 雷分别贴着各自胜率计算；三行都严格单调递增，
 * 翻得越多拿越多。要调平衡只改这一张表。
 */
export const PAYOUT: Record<MineCount, readonly number[]> = {
  3: [1.09, 1.24, 1.43, 1.66, 1.93, 2.27, 2.7, 3.24, 3.94, 4.85, 6.06, 7.72, 10.03, 13.38, 18.39, 26.28, 39.42, 63.08, 110.4, 220.8, 552.0, 2208.0],
  5: [1.2, 1.51, 1.93, 2.5, 3.28, 4.38, 5.95, 8.24, 11.67, 16.98, 25.47, 39.63, 64.39, 110.39, 202.39, 404.79, 910.79, 2428.79, 8500.79, 51004.79],
  10: [1.6, 2.74, 4.85, 8.89, 16.98, 33.96, 71.71, 161.35, 391.85, 1044.95, 3134.87, 10972.06, 47545.6, 285273.6, 3138009.6],
}

/** 每格雷概率 = 雷数 / 25 */
export function mineProbability(mineCount: number): number {
  return mineCount / CELL_COUNT
}

/** 翻开 flipped 格安全牌后的收益倍数（flipped ≤ 0 表示还没翻，0 倍） */
export function payoutFor(mineCount: number, flipped: number): number {
  const row = PAYOUT[isMineCount(mineCount) ? mineCount : DEFAULT_MINE_COUNT]
  if (flipped <= 0) return 0
  return row[Math.min(flipped, row.length) - 1]
}

/** 安全格总数 */
export function safeCount(mineCount: number): number {
  return CELL_COUNT - mineCount
}

// ---------------- 状态与动作 ----------------
export type Phase = 'setup' | 'playing' | 'done'

export interface State {
  phase: Phase
  /** 玩家选定的雷数 */
  mineCount: MineCount
  /** 开局一次性埋下的雷位（升序）；setup 阶段为空数组 */
  mines: readonly number[]
  /** 已翻开的格位（升序） */
  opened: readonly number[]
  /** 踩雷的格位，-1 = 没踩到 */
  hit: number
  /** 是否通关（把安全格全翻完） */
  cleared: boolean
  /** 随机游标 */
  rng: number
  /** 已结束局数 */
  rounds: number
  /** 历史最高累积倍数 */
  best: number
}

export type Action =
  | { type: 'setMineCount'; count: number }
  | { type: 'start' }
  /** 翻格：用格坐标而非格序号，越界坐标一律忽略 */
  | { type: 'reveal'; col: number; row: number }

export function create(seed: number): State {
  return {
    phase: 'setup',
    mineCount: DEFAULT_MINE_COUNT,
    mines: [],
    opened: [],
    hit: -1,
    cleared: false,
    rng: hashSeed(seed),
    rounds: 0,
    best: 0,
  }
}

/** 埋雷：部分 Fisher–Yates，取前 n 个后升序排列 */
function buryMines(r: Rng, n: number): number[] {
  const pool = Array.from({ length: CELL_COUNT }, (_, i) => i)
  for (let i = 0; i < n; i++) {
    const j = i + r.int(CELL_COUNT - i)
    const tmp = pool[i]
    pool[i] = pool[j]
    pool[j] = tmp
  }
  return pool.slice(0, n).sort((a, b) => a - b)
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'setMineCount': {
      // 只在开局前、且是合法雷数时才改
      if (state.phase !== 'setup') return state
      if (!isMineCount(action.count)) return state
      if (state.mineCount === action.count) return state
      return { ...state, mineCount: action.count }
    }

    case 'start': {
      // 结束后的「再来一局」：把雷位重新埋一次
      if (state.phase === 'playing') return state
      const r = new Rng(state.rng)
      return {
        ...state,
        phase: 'playing',
        mines: buryMines(r, state.mineCount),
        opened: [],
        hit: -1,
        cleared: false,
        rng: r.s,
      }
    }

    case 'reveal': {
      if (state.phase !== 'playing') return state
      const index = cellIndex(action.col, action.row)
      if (index === null) return state
      if (state.opened.includes(index)) return state
      if (state.mines.includes(index)) {
        // 踩雷：本局立刻结束，收益归零
        return { ...state, phase: 'done', hit: index, cleared: false, rounds: state.rounds + 1 }
      }
      const opened = [...state.opened, index].sort((a, b) => a - b)
      if (opened.length >= safeCount(state.mineCount)) {
        // 安全格翻完 = 通关，领取累积收益
        const gain = payoutFor(state.mineCount, opened.length)
        return {
          ...state,
          phase: 'done',
          opened,
          cleared: true,
          rounds: state.rounds + 1,
          best: Math.max(state.best, gain),
        }
      }
      return { ...state, opened }
    }

    default:
      return state
  }
}

// ---------------- 收益结算 ----------------
/** 当前手上的累积倍数（未结束也可读，用于 HUD） */
export function liveMultiple(s: State): number {
  if (s.hit >= 0) return -1
  return payoutFor(s.mineCount, s.opened.length)
}

/** 本局最终净收益倍数：通关为累积倍数，踩雷为 -1（输光注额），未结束为 0 */
export function netMultiple(s: State): number {
  if (s.phase !== 'done') return 0
  return s.cleared ? payoutFor(s.mineCount, s.opened.length) : -1
}

/** 大倍数压缩显示：12345 → 1.2万 */
export function formatMultiple(v: number): string {
  const a = Math.abs(v)
  if (a >= 10000) return `${(v / 10000).toFixed(1)}万`
  if (a >= 100) return String(Math.round(v))
  return v.toFixed(2)
}
