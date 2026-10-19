/**
 * 花札配对规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 牌库：一副花札 48 张 = 12 个月 × 4 花（松 / 梅 / 樱 / 柳）。
 * 牌面标识 kind = 月份 × 4 + 花，取值 0..47；**配对只看牌面标识，不看实体牌序号**。
 *
 * 棋盘：4×4 共 16 格 = 8 对。一局只从 48 张里挑 8 种标识（由 seed 决定），
 * 每种放两张，洗匀后发到 16 格。因此「48 张牌库」用于生成牌面图案与牌名，
 * 而不是一局里全部 48 张都上桌。
 *
 * 计时不进 reduce：翻错后的盖回由显式动作 settle 触发，
 * 倒计时只在 index.ts 的 render 里用 anim 的 elapsedSince 做视觉反馈。
 * 本文件不读时间、不读全局随机数、不修改入参。
 */
import { Rng } from '../../core/rng'

/** 月份数（1..12，对应牌库 kind 的高位） */
export const MONTHS = 12
/** 花数（松 / 梅 / 樱 / 柳） */
export const FLOWERS = 4
/** 一副花札的张数：12 × 4 = 48 */
export const DECK_SIZE = MONTHS * FLOWERS

/** 花名，顺序与 kind 的低位一致 */
export const FLOWER_NAMES = ['松', '梅', '樱', '柳'] as const
/** 月名，正月为岁首，对应 kind 的高位 */
export const MONTH_NAMES = [
  '正月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '冬月',
  '腊月',
] as const

export const COLS = 4
export const ROWS = 4
/** 棋盘格数 */
export const CARD_COUNT = COLS * ROWS
/** 一局的配对种数：每种两张 */
export const PAIR_KINDS = CARD_COUNT / 2

/** 由月份与花组成牌面标识：0..47 */
export function makeKind(month: number, flower: number): number {
  return month * FLOWERS + flower
}

/** 牌面标识里的月份，0..11 */
export function monthOf(kind: number): number {
  return Math.floor(kind / FLOWERS)
}

/** 牌面标识里的花，0..3 */
export function flowerOf(kind: number): number {
  return kind % FLOWERS
}

/** 牌名，例如 makeKind(0, 1) → 「正月梅」 */
export function kindLabel(kind: number): string {
  return MONTH_NAMES[monthOf(kind)] + FLOWER_NAMES[flowerOf(kind)]
}

/** 标识是否落在 48 张牌库范围内 */
export function inDeck(kind: number): boolean {
  return Number.isInteger(kind) && kind >= 0 && kind < DECK_SIZE
}

export interface State {
  /** 每格的花札标识（0..47），配对判定只看它 */
  kinds: number[]
  /** 每格是否朝上；配对成功后保持朝上不再盖回 */
  up: boolean[]
  /** 已配对的对数，0..PAIR_KINDS */
  pairs: number
  /** 翻牌次数，每翻开一张 +1 */
  flips: number
  /** 完成的对比轮次：每翻开第二张（结算一对） +1 */
  turns: number
  /** 翻错轮次，等于 turns - pairs */
  misses: number
  /** 第一张已翻开的牌索引，-1 表示无 */
  first: number
  /** 第二张已翻开的牌索引，-1 表示无 */
  second: number
  /** 两张不匹配，等待盖回 */
  pending: boolean
  /** 最近一次配对成功的两张牌索引，用于高亮与粒子 */
  matched: number[]
  /** 最近翻开的牌索引，-1 表示无，仅用于渲染动画 */
  lastFlip: number
  /** 悬停的牌索引，-1 表示无 */
  hover: number
  /** 是否已全部配对 */
  won: boolean
  /** 洗牌后的随机数状态，保证同一 seed 可完整复盘 */
  rng: number
}

export type Action =
  /** 翻开第 index 张牌 */
  | { type: 'flip'; index: number }
  /** 盖回不匹配的两张牌 */
  | { type: 'settle' }
  | { type: 'hover'; index: number }
  | { type: 'leave' }

/**
 * 开局：从 48 张牌库里挑 8 种标识，每种两张，洗匀后发到 4×4。
 * 全部随机来自 seed，故同一 seed 完全可复现。
 */
export function create(seed: number): State {
  const r = new Rng(seed)
  const library: number[] = []
  for (let m = 0; m < MONTHS; m++) for (let f = 0; f < FLOWERS; f++) library.push(makeKind(m, f))
  const picked = r.shuffle(library).slice(0, PAIR_KINDS)
  const kinds = r.shuffle(picked.concat(picked))
  return {
    kinds,
    up: new Array<boolean>(CARD_COUNT).fill(false),
    pairs: 0,
    flips: 0,
    turns: 0,
    misses: 0,
    first: -1,
    second: -1,
    pending: false,
    matched: [],
    lastFlip: -1,
    hover: -1,
    won: false,
    rng: r.s,
  }
}

export function inBounds(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < CARD_COUNT
}

/** 与该牌花札标识相同的另一张牌索引，-1 表示无 */
export function partnerOf(state: State, index: number): number {
  if (!inBounds(index)) return -1
  for (let i = 0; i < CARD_COUNT; i++) {
    if (i !== index && state.kinds[i] === state.kinds[index]) return i
  }
  return -1
}

export function isComplete(state: State): boolean {
  return state.pairs >= PAIR_KINDS
}

/** 纯函数状态迁移：相同输入产生相同输出，且不修改入参 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'flip': {
      // 通关后不再接受翻牌；待盖回期间也不允许翻第三张
      if (state.won || state.pending) return state
      const i = action.index
      if (!inBounds(i) || state.up[i]) return state
      const up = state.up.slice()
      up[i] = true
      const base = { ...state, up, flips: state.flips + 1, lastFlip: i, hover: i }
      if (state.first < 0) return { ...base, first: i }
      // 翻开第二张：花札标识相同即配对，否则进入待盖回
      const turns = state.turns + 1
      if (state.kinds[state.first] === state.kinds[i]) {
        const pairs = state.pairs + 1
        return {
          ...base,
          pairs,
          turns,
          misses: turns - pairs,
          first: -1,
          second: -1,
          pending: false,
          matched: [state.first, i],
          won: pairs >= PAIR_KINDS,
        }
      }
      return { ...base, second: i, turns, misses: turns - state.pairs, pending: true, matched: [] }
    }

    case 'settle': {
      if (!state.pending) return state
      const up = state.up.slice()
      if (state.first >= 0) up[state.first] = false
      if (state.second >= 0) up[state.second] = false
      return { ...state, up, first: -1, second: -1, pending: false }
    }

    case 'hover': {
      if (state.won || state.pending) return state
      if (!inBounds(action.index) || state.hover === action.index) return state
      return { ...state, hover: action.index }
    }

    case 'leave': {
      if (state.hover === -1) return state
      return { ...state, hover: -1 }
    }
  }
}

/** 便于测试与提示区复用的入口 */
export function flip(state: State, index: number): State {
  return reduce(state, { type: 'flip', index })
}
