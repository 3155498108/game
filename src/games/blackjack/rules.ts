/**
 * 二十一点规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 玩法：6 副牌洗好后，玩家与庄家各发 2 张（庄家第二张是暗牌，结算前不翻开）。
 * 玩家可 hit（要一张）或 stand（停牌）；庄家按固定策略自动推进：
 * 点数 ≤16 必加、≥18 停、17 点按配置（本项目为「要牌」，含 soft 17）。
 * 一局结束后可 deal 再来一手，得分在本次会话内累计（新的一局重新开始计分）。
 *
 * 计分一律按「注记 × 赔率」记分，单位为分：
 *   黑杰克 3:2（bet×1.5）、普通获胜 1:1（bet×1）、和局退半个注记（bet×0.5）、失败 0。
 * 即和局记 0.5 个胜场，与 3:2 的黑杰克同在一个尺度上比较。
 *
 * 四处明确的取舍：
 * 1) 双方都是天然黑杰克时判和局（退半个注记），其余情况庄家黑杰克直接判负。
 * 2) 牌堆发完时把「已发出的所有牌」（含双方手牌，即弃牌堆）洗回去重新发牌，
 *    洗牌来源是 state.rng，因此依然可复盘。
 * 3) 庄家整轮推进由 { type:'dealer' } action 一步一步完成（每步最多要一张），
 *    由 index.ts 的 dealerAction 接到 aiAction 上，站点壳按 aiDelay 定时驱动。
 * 4) create 与 deal 共用同一套发牌与「天然黑杰克」检查，规则只有一份。
 *
 * 随机全部来自 state.rng（mulberry32 游标），reduce 是纯函数：相同输入 → 相同输出。
 */
import { makeDeck, type Card } from '../../core/cards'
import { Rng } from '../../core/rng'

/** 牌堆副数：6 副共 312 张，避免长局中频繁补牌 */
export const DECKS = 6
/** 整副牌堆张数 */
export const DECK_SIZE = DECKS * 52

/** 每手注记（分） */
export const BET = 10
/** 普通获胜赔付倍数 1:1 */
export const WIN_PAYOUT = 1
/** 黑杰克赔付倍数 3:2 */
export const BLACKJACK_PAYOUT = 1.5
/** 和局退还倍数（半个注记，即半个胜场） */
export const PUSH_PAYOUT = 0.5

/** 庄家是否对 soft 17（A+6 记 17）加牌。本项目配置为「要牌」，即 17 点必加。 */
export const DEALER_HITS_SOFT_17 = true

/** 庄家暗牌在手牌中的下标 */
export const HOLE_INDEX = 1

export interface HandValue {
  /** 按「A 取使总点最大且不爆的值」算出的总点数 */
  total: number
  /** 是否至少还有一张 A 按 11 计 */
  soft: boolean
  /** 是否爆牌（>21） */
  bust: boolean
}

/**
 * 手牌点数：A 先按 11 计，超 21 时逐张降为 1（每降一张减 10 分）。
 * 10/J/Q/K（rank 10..13）一律计 10 点。
 */
export function handValue(cards: readonly Card[]): HandValue {
  let total = 0
  let elevens = 0
  for (const c of cards) {
    if (c.rank === 1) {
      total += 11
      elevens += 1
    } else if (c.rank >= 10) {
      total += 10
    } else {
      total += c.rank
    }
  }
  while (total > 21 && elevens > 0) {
    total -= 10
    elevens -= 1
  }
  return { total, soft: elevens > 0, bust: total > 21 }
}

/** 天然黑杰克：正好两张牌且合计 21 点 */
export function isBlackjack(cards: readonly Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21
}

/** 庄家固定策略：≤16 必加；17 点按 DEALER_HITS_SOFT_17（soft 17 要牌）；≥18 停牌 */
export function dealerShouldHit(v: HandValue): boolean {
  if (v.bust) return false
  if (v.total < 17) return true
  if (v.total === 17) return v.soft && DEALER_HITS_SOFT_17
  return false
}

export type Phase = 'player' | 'dealer' | 'done'

export type Result =
  | 'blackjack'
  | 'win'
  | 'dealer-bust'
  | 'lose'
  | 'dealer-blackjack'
  | 'bust'
  | 'push'

const RESULT_LABEL: Record<Result, string> = {
  blackjack: '黑杰克！按 3:2 赔付',
  win: '你赢了',
  'dealer-bust': '庄家爆牌，你赢了',
  lose: '庄家赢了',
  'dealer-blackjack': '庄家黑杰克，你输了',
  bust: '你爆牌了',
  push: '和局，退半个注记',
}

/** 结算文案（渲染与提示区共用） */
export function resultLabel(r: Result): string {
  return RESULT_LABEL[r]
}

/** 是否算赢（和局不算赢） */
export function isWinResult(r: Result): boolean {
  return r === 'blackjack' || r === 'win' || r === 'dealer-bust'
}

export interface State {
  /** 已洗好的牌堆；发牌通过 cursor 前进，耗尽时整体重建 */
  deck: Card[]
  /** 下一张要发的牌在 deck 中的下标 */
  cursor: number
  /** 已发出的所有牌（弃牌堆），牌堆耗尽后洗回去重新发牌 */
  used: Card[]
  /** 玩家的手牌 */
  player: Card[]
  /** 庄家的手牌，下标 HOLE_INDEX 那张是暗牌 */
  dealer: Card[]
  /** 当前阶段：玩家决策 / 庄家按规则要牌 / 已结算 */
  phase: Phase
  /** 庄家暗牌是否已翻开（结算时为 true） */
  reveal: boolean
  /** 本手注记 */
  bet: number
  /** 本次会话累计得分 */
  score: number
  /** 本手结果，未结算为 null */
  result: Result | null
  /** 本手得分增减（分） */
  payout: number
  /** 第几手 */
  round: number
  /** 自动补牌次数 */
  reshuffles: number
  rng: number
}

export type Action = { type: 'hit' } | { type: 'stand' } | { type: 'dealer' } | { type: 'deal' }

/** 牌堆相关的最小状态面（State 与发牌中间态共用） */
interface DeckState {
  deck: Card[]
  cursor: number
  used: Card[]
  reshuffles: number
}

/** 牌堆剩余张数 */
export function remaining(state: State): number {
  return Math.max(0, state.deck.length - state.cursor)
}

/**
 * 发一张牌；牌堆耗尽时把已发出的牌洗回去（随机源为 state.rng）。
 * 返回全新对象，不修改入参。
 */
function drawOne(r: Rng, s: DeckState): DeckState & { card: Card } {
  let deck = s.deck
  let cursor = s.cursor
  let reshuffles = s.reshuffles
  if (cursor >= deck.length) {
    // 极端情况下已发出的牌为空（理论上不会发生）时退回一整副新牌，保证下面一定有牌可发
    deck = r.shuffle(s.used.length > 0 ? s.used : makeDeck({ decks: DECKS }))
    cursor = 0
    reshuffles += 1
  }
  const card = deck[cursor]
  cursor += 1
  return { deck, cursor, used: s.used.concat(card), reshuffles, card }
}

/** 落定结果：结束本手并结算得分（不改入参） */
function settle(state: State, result: Result, payout: number): State {
  return { ...state, phase: 'done', reveal: true, result, payout, score: state.score + payout }
}

/** 双方都停牌后的点数比较 */
function settleShowdown(state: State): State {
  const p = handValue(state.player)
  const d = handValue(state.dealer)
  if (p.bust) return settle(state, 'bust', 0)
  if (d.bust) return settle(state, 'dealer-bust', state.bet * WIN_PAYOUT)
  if (p.total > d.total) return settle(state, 'win', state.bet * WIN_PAYOUT)
  if (p.total < d.total) return settle(state, 'lose', 0)
  return settle(state, 'push', state.bet * PUSH_PAYOUT)
}

/**
 * 双方各两张牌之后检查天然黑杰克。
 * create / deal / 测试共用这一入口，保证开局与开局后发牌走同一套规则。
 */
export function openHand(state: State): State {
  const pb = isBlackjack(state.player)
  const db = isBlackjack(state.dealer)
  if (pb && db) return settle(state, 'push', state.bet * PUSH_PAYOUT)
  if (db) return settle(state, 'dealer-blackjack', 0)
  if (pb) return settle(state, 'blackjack', state.bet * BLACKJACK_PAYOUT)
  return state
}

/** 按「玩家-庄家-玩家-庄家」发 4 张，并构造出对应的 State 骨架 */
function dealHand(r: Rng, base: State): State {
  let pool: DeckState = { deck: base.deck, cursor: base.cursor, used: base.used, reshuffles: base.reshuffles }
  const take = (): Card => {
    const d = drawOne(r, pool)
    pool = d
    return d.card
  }
  const p1 = take()
  const d1 = take()
  const p2 = take()
  const d2 = take()
  return openHand({
    ...base,
    deck: pool.deck,
    cursor: pool.cursor,
    used: pool.used,
    reshuffles: pool.reshuffles,
    player: [p1, p2],
    dealer: [d1, d2],
    phase: 'player',
    reveal: false,
    result: null,
    payout: 0,
    rng: r.s,
  })
}

/** 用给定种子开局：洗 6 副牌并发第一手 */
export function create(seed: number): State {
  const r = new Rng(seed | 0)
  return dealHand(r, {
    deck: r.shuffle(makeDeck({ decks: DECKS })),
    cursor: 0,
    used: [],
    player: [],
    dealer: [],
    phase: 'player',
    reveal: false,
    bet: BET,
    score: 0,
    result: null,
    payout: 0,
    round: 1,
    reshuffles: 0,
    rng: r.s,
  })
}

/** 纯函数状态迁移 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'hit': {
      if (state.phase !== 'player') return state
      const r = new Rng(state.rng)
      const { card, ...draw } = drawOne(r, state)
      const player = state.player.concat(card)
      const next: State = { ...state, ...draw, player, rng: r.s }
      return handValue(player).bust ? settle(next, 'bust', 0) : next
    }

    case 'stand': {
      if (state.phase !== 'player') return state
      // 停牌即翻开暗牌，接下来由 dealer action 逐步推进庄家
      return { ...state, phase: 'dealer', reveal: true }
    }

    case 'dealer': {
      if (state.phase !== 'dealer') return state
      if (!dealerShouldHit(handValue(state.dealer))) return settleShowdown(state)
      const r = new Rng(state.rng)
      const { card, ...draw } = drawOne(r, state)
      const dealer = state.dealer.concat(card)
      const next: State = { ...state, ...draw, dealer, rng: r.s }
      const v = handValue(dealer)
      if (v.bust) return settle(next, 'dealer-bust', next.bet * WIN_PAYOUT)
      return dealerShouldHit(v) ? next : settleShowdown(next)
    }

    case 'deal': {
      if (state.phase !== 'done') return state
      const r = new Rng(state.rng)
      return dealHand(r, { ...state, round: state.round + 1 })
    }
  }
}

/** 便捷入口，便于测试与提示区复用同一入口 */
export function hit(state: State): State {
  return reduce(state, { type: 'hit' })
}

export function stand(state: State): State {
  return reduce(state, { type: 'stand' })
}

/** 再来一手：牌堆沿用当前会话，累计得分保留 */
export function deal(state: State): State {
  return reduce(state, { type: 'deal' })
}

/**
 * 庄家是规则驱动的确定性策略，没有可枚举的动作序列；
 * 这里只提供一个「庄家该动一步就返回 dealer action」的钩子，
 * 由 index.ts 接到 aiAction 上，站点壳按 aiDelay 定时推进。
 */
export function dealerAction(state: State): Action | null {
  return state.phase === 'dealer' ? { type: 'dealer' } : null
}
