/**
 * 记忆卡牌规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 关键设计：800ms 自动盖回的计时不进入 reduce。
 * reduce 只负责把局面推进到「两张不匹配、等待盖回」（pending），
 * 之后的盖回由显式动作 settle 完成（点击任意处或提示区按钮），
 * 倒计时只在 render 里用 anim 的 elapsedSince 做视觉反馈。
 * 因此本文件的任何函数都不读时间、不读全局随机数、不修改入参。
 */
import { Rng } from '../../core/rng'

export const COLS = 4
export const ROWS = 4
/** 4×4 共 16 张牌 */
export const CARD_COUNT = COLS * ROWS
/** 8 种图案，每种各 2 张 */
export const PAIR_KINDS = CARD_COUNT / 2

export interface State {
  /** 每张牌的图案编号，取值 0..PAIR_KINDS-1 */
  faces: number[]
  /** 每张牌是否朝上；配对成功后保持朝上不再盖回 */
  up: boolean[]
  /** 已配对的对数，0..PAIR_KINDS */
  pairs: number
  /** 翻牌次数，每翻开一张 +1 */
  flips: number
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
  /** 盖回不匹配的两张牌（翻错后由用户继续） */
  | { type: 'settle' }
  | { type: 'hover'; index: number }
  | { type: 'leave' }

/** 构造初始牌面：8 种图案各 2 张，用种子打乱 */
export function create(seed: number): State {
  const deck: number[] = []
  for (let k = 0; k < PAIR_KINDS; k++) deck.push(k, k)
  const r = new Rng(seed)
  const faces = r.shuffle(deck)
  return {
    faces,
    up: new Array<boolean>(CARD_COUNT).fill(false),
    pairs: 0,
    flips: 0,
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

/** 该牌的另一张同图案牌索引 */
export function partnerOf(state: State, index: number): number {
  for (let i = 0; i < CARD_COUNT; i++) {
    if (i !== index && state.faces[i] === state.faces[index]) return i
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
      // 翻开第二张：同图案即配对，不同图案进入待盖回
      if (state.faces[state.first] === state.faces[i]) {
        const pairs = state.pairs + 1
        return {
          ...base,
          pairs,
          first: -1,
          second: -1,
          pending: false,
          matched: [state.first, i],
          won: pairs >= PAIR_KINDS,
        }
      }
      return { ...base, second: i, pending: true, matched: [] }
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
