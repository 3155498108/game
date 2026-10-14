/**
 * 比大小规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 玩法：一副 52 张牌洗好后先翻开一张「当前牌」；
 * 每轮玩家猜「下一张更大 / 更小」，随即翻开下一张牌结算——
 *   猜中：连对 +1、得分 +1，当前牌换成刚翻开的那张，进入下一轮
 *   猜错：游戏结束
 *
 * 两处明确的取舍：
 * 1) 平局（下一张与当前牌点数相同）不算猜中，两个方向都判为猜错并结束游戏。
 * 2) 牌堆发完时把已用过的牌（当前牌留在手里不重发）洗回去重新发牌，连对不中断。
 *
 * 随机全部来自 state.rng（mulberry32 游标），reduce 是纯函数：相同输入 → 相同输出。
 */
import { makeDeck, type Card } from '../../core/cards'
import { Rng } from '../../core/rng'

/** 一副牌的张数 */
export const DECK_SIZE = 52

/** 猜测方向 */
export type Dir = 'higher' | 'lower'

export interface State {
  /** 已洗好的整副牌；发牌通过 cursor 前进，循环时整体重建 */
  deck: Card[]
  /** 已发出的牌（含当前牌），牌堆发完后洗回去重新发牌 */
  used: Card[]
  /** 下一张要翻的牌在 deck 中的下标 */
  cursor: number
  /** 当前牌：每轮比较的基准，猜中后换成刚翻开的那张 */
  current: Card | null
  /** 上一轮比较前的当前牌，用于展示「上一张 → 下一张」 */
  prevCard: Card | null
  /** 上一轮刚翻开的新牌 */
  lastCard: Card | null
  /** 上一轮猜的方向 */
  lastGuess: Dir | null
  /** 上一轮是否猜中 */
  lastHit: boolean | null
  /** 总分（= 猜中次数） */
  score: number
  /** 当前连对数 */
  streak: number
  /** 本局最高连对纪录 */
  best: number
  /** 已进行的轮数 */
  round: number
  /** 自动补牌次数 */
  reshuffles: number
  over: boolean
  rng: number
}

export type Action = { type: 'guess'; dir: Dir }

/** 牌堆剩余张数 */
export function remaining(state: State): number {
  return Math.max(0, state.deck.length - state.cursor)
}

/**
 * 判定一次猜测是否命中。
 * 注意：平局（点数相同）时两个方向都返回 false —— 无论猜大还是猜小都算猜错。
 */
export function isHit(current: Card, next: Card, dir: Dir): boolean {
  return dir === 'higher' ? next.rank > current.rank : next.rank < current.rank
}

/** 用给定种子开局：洗牌并翻开第一张作为当前牌 */
export function create(seed: number): State {
  const r = new Rng(seed | 0)
  const deck = r.shuffle(makeDeck())
  const current = deck[0]
  return {
    deck,
    used: [current],
    cursor: 1,
    current,
    prevCard: null,
    lastCard: null,
    lastGuess: null,
    lastHit: null,
    score: 0,
    streak: 0,
    best: 0,
    round: 0,
    reshuffles: 0,
    over: false,
    rng: r.s,
  }
}

/** 纯函数状态迁移：猜测并立即翻开下一张牌结算 */
export function reduce(state: State, action: Action): State {
  if (state.over || !state.current) return state

  const r = new Rng(state.rng)
  let deck = state.deck
  let used = state.used
  let cursor = state.cursor
  let reshuffles = state.reshuffles

  // 牌堆发完：把已用过的牌洗回去重新发牌（当前牌留在手里，不重复发出）。
  // 池子不足 2 张（理论上不会发生）时退回一整副新牌，保证下面一定有牌可翻。
  if (cursor >= deck.length) {
    deck = r.shuffle(used.length >= 2 ? used : makeDeck())
    used = [state.current]
    cursor = 1
    reshuffles += 1
  }

  const next = deck[cursor]
  cursor += 1
  used = used.concat(next)

  const hit = isHit(state.current, next, action.dir)
  const streak = hit ? state.streak + 1 : 0

  return {
    ...state,
    deck,
    used,
    cursor,
    reshuffles,
    prevCard: state.current,
    lastCard: next,
    lastGuess: action.dir,
    lastHit: hit,
    current: hit ? next : state.current,
    score: hit ? state.score + 1 : state.score,
    streak,
    best: streak > state.best ? streak : state.best,
    round: state.round + 1,
    over: !hit,
    rng: r.s,
  }
}

/** 猜测的直观别名，便于测试复用同一入口 */
export function guess(state: State, dir: Dir): State {
  return reduce(state, { type: 'guess', dir })
}
