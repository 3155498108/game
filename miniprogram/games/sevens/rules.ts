/**
 * 排七（Sevens）规则：纯逻辑，零 DOM 依赖，可在 node 环境单测。
 *
 * 玩法：两人各 7 张牌，目标是最先打完手上全部牌者胜。
 *   - 桌面维护「已接龙的面值集合」：初始为空，每打出一张 7 就把 7 记入。
 *   - 7 随时可以打出（开新串）；打出 7 后才能出 6 或 8，之后每打出一个面值，
 *     该面值的 ±1 也随之解锁（即标准接龙逻辑）。
 *   - 开局手上的 7 必须立刻打出（弃牌堆初始为空，所以每张 7 都得先打）。
 *   - 无牌可打时必须弃一张手牌并从牌堆抽一张；抽到的正好是 7 时必须立即打出。
 *   - 用 2 副牌（104 张）以减少牌堆耗尽；牌堆耗尽时把桌面的牌洗回重新发牌。
 *
 * 两处明确的取舍：
 * 1) A(1) 只当小牌、K(13) 只当大牌，不做「A 可当 14」的循环接龙，面值区间固定为 1..13。
 * 2) 一回合只出一张牌（可自选），不做「能出的牌必须一次全出」的强制规则；
 *    正是「无牌可打才允许弃牌」这一条决定了回合的强制换手时机。
 *
 * 随机全部来自 state.rng（mulberry32 游标），reduce 是纯函数：相同输入 → 相同输出。
 */
import { shuffledDeck, type Card } from '../../core/cards'
import { Rng } from '../../core/rng'

/** 牌副数（2 副共 104 张，减少牌堆耗尽） */
export const DECKS = 2
/** 一副 52 张，共 104 张 */
export const DECK_SIZE = 52 * DECKS
/** 锚点点数 */
export const SEVEN = 7
/** 每人开局张数 */
export const HAND_SIZE = 7
/** 面值下界（A 当 1） */
export const MIN_RANK = 1
/** 面值上界（K 当 13） */
export const MAX_RANK = 13

/** 阵营下标：0 = 玩家，1 = 电脑 */
export type Side = 0 | 1
export const PLAYER: Side = 0
export const AI: Side = 1
export const SIDE_NAME: Record<Side, string> = { 0: '玩家', 1: '电脑' }
export const otherSide = (s: Side): Side => (s === PLAYER ? AI : PLAYER)

export interface State {
  /** 两人手牌，索引与 Side 一致 */
  hands: [Card[], Card[]]
  /** 牌堆剩余（从头部抽牌） */
  deck: Card[]
  /** 桌面已打出的牌 */
  discard: Card[]
  /** 被丢弃的牌（不进接龙面值集合，牌堆耗尽时与桌面一起洗回） */
  burn: Card[]
  /** 桌面已接龙的面值集合（升序）；每个点数只第一次被打出时计分 */
  discardRanks: number[]
  /** 当前连续面值串（两端各差 1 的连续区间） */
  chain: Card[]
  /** 本局最长连续串 */
  bestChain: number
  /** 两人得分 */
  scores: [number, number]
  /** 当前行动方 */
  turn: Side
  /** 已执行的合法动作数 */
  moves: number
  /** 牌堆洗回次数 */
  reshuffles: number
  /** 本回合最后打出的牌 */
  lastPlayed: Card | null
  /** 本回合抽到的牌 */
  lastDrawn: Card | null
  over: boolean
  winner: Side | null
  rng: number
}

export type Action = { type: 'play'; cardId: number } | { type: 'discard'; cardId: number }

// ---------------- 规则判定 ----------------

/**
 * 该面值当前是否可以打出。
 * 7 随时可打（锚点）；其余面值必须：桌面上已有 7，且自身或相邻面值已被接龙。
 */
export function canPlayRank(state: State, rank: number): boolean {
  if (rank === SEVEN) return true
  if (state.discardRanks.indexOf(SEVEN) < 0) return false
  return state.discardRanks.indexOf(rank - 1) >= 0 || state.discardRanks.indexOf(rank + 1) >= 0
}

/**
 * 该面值离「已接龙区域」有多远：0 表示现在就能出（7 恒为 0），
 * 数值越小说明离可出的状态越近。抽牌补手时用它衡量一张牌的价值。
 */
export function tableDistance(state: State, rank: number): number {
  if (rank === SEVEN) return 0
  let best = MAX_RANK
  for (const r of state.discardRanks) best = Math.min(best, Math.abs(rank - r))
  return best
}

/** 取一方手牌 */
export function handOf(state: State, side: Side): Card[] {
  return state.hands[side]
}

/** 手里还有没有可出的牌 */
export function hasPlayable(state: State, side: Side): boolean {
  return state.hands[side].some((c) => canPlayRank(state, c.rank))
}

/**
 * 列出当前回合的全部合法动作：
 * 有牌可打时只能出牌（每个可出的牌一个候选），无牌可打时只能弃牌并补一张。
 * AI、提示按钮、输入映射、测试都复用这一个入口。
 */
export function legalActions(state: State): Action[] {
  if (state.over) return []
  const hand = state.hands[state.turn]
  const plays: Action[] = []
  for (const c of hand) if (canPlayRank(state, c.rank)) plays.push({ type: 'play', cardId: c.id })
  if (plays.length > 0) return plays
  return hand.map((c) => ({ type: 'discard', cardId: c.id }))
}

/** 点到某张手牌时应当产生的动作；不合法返回 null */
export function actionForCard(state: State, cardId: number): Action | null {
  if (state.over) return null
  const hand = state.hands[state.turn]
  const card = hand.find((c) => c.id === cardId)
  if (!card) return null
  if (hasPlayable(state, state.turn)) {
    return canPlayRank(state, card.rank) ? { type: 'play', cardId } : null
  }
  return { type: 'discard', cardId }
}

// ---------------- 计分 ----------------

/**
 * 单次出牌得分。chainLen 越大得分越高（同一串内每多接一张就多拿一分），
 * 打 7 与点数首出各有固定奖励，三连以上再按串长加成。
 * 纯函数，方便测试直接断言单调性。
 */
export function playPoints(chainLen: number, rank: number, firstTime: boolean): number {
  let pts = chainLen // 串越长，单次得分越高
  if (rank === SEVEN) pts += 3 // 打出锚点开新串
  if (firstTime) pts += 2 // 该点数第一次被打出
  if (chainLen >= 3) pts += chainLen - 2 // 三连以上再按串长加成
  return pts
}

/** 该点数是否能把当前串延长（接在串的两端之一） */
function extendsChain(chain: readonly Card[], rank: number): boolean {
  if (chain.length === 0) return false
  let lo = Infinity
  let hi = -Infinity
  for (const c of chain) {
    if (c.rank < lo) lo = c.rank
    if (c.rank > hi) hi = c.rank
  }
  return rank === lo - 1 || rank === hi + 1
}

/** 把一张牌打到桌面（同时从 hand 中移除），返回新状态；不消耗随机数 */
function applyPlay(state: State, side: Side, rest: Card[], card: Card): State {
  const firstTime = state.discardRanks.indexOf(card.rank) < 0
  const ranks = firstTime ? state.discardRanks.concat([card.rank]).sort((a, b) => a - b) : state.discardRanks
  const chain = extendsChain(state.chain, card.rank) ? state.chain.concat([card]) : [card]
  const scores: [number, number] = [state.scores[0], state.scores[1]]
  scores[side] += playPoints(chain.length, card.rank, firstTime)
  return {
    ...state,
    hands: replaceHand(state.hands, side, rest),
    discard: state.discard.concat([card]),
    discardRanks: ranks,
    chain,
    bestChain: Math.max(state.bestChain, chain.length),
    scores,
    lastPlayed: card,
    lastDrawn: null,
  }
}

function replaceHand(hands: readonly [Card[], Card[]], side: Side, arr: Card[]): [Card[], Card[]] {
  return side === PLAYER ? [arr, hands[1]] : [hands[0], arr]
}

/**
 * 抽一张牌：返回抽走这一张之后的局面。
 * 牌堆空时把桌面 + 弃牌堆洗回（洗牌结果由 state.rng 决定），桌面已接龙的面值不受影响。
 */
function drawOne(state: State, r: Rng): State & { drawn: Card } {
  let next = state
  if (state.deck.length === 0) {
    const pool = state.discard.concat(state.burn)
    // 兜底：桌面与弃牌堆都空时（理论不可达）重发两副牌，保证一定有牌可抽
    const deck = pool.length > 0 ? r.shuffle(pool) : shuffledDeck(r, { decks: DECKS })
    next = { ...state, deck, discard: [], burn: [], reshuffles: state.reshuffles + 1 }
  }
  return { ...next, deck: next.deck.slice(1), drawn: next.deck[0] }
}

/** 结束一个回合：判胜并换手 */
function finishTurn(state: State, side: Side): State {
  const won = state.hands[side].length === 0
  return {
    ...state,
    moves: state.moves + 1,
    over: won,
    winner: won ? side : null,
    turn: otherSide(side),
  }
}

// ---------------- 状态迁移 ----------------

/** 用给定种子开局：发牌后立刻把双方手上的 7 全部打出 */
export function create(seed: number): State {
  const r = new Rng(seed | 0)
  const deck = shuffledDeck(r, { decks: DECKS })
  const hands: [Card[], Card[]] = [[], []]
  for (let i = 0; i < HAND_SIZE * 2; i++) hands[i % 2].push(deck[i])
  const rest = deck.slice(HAND_SIZE * 2)

  // 开局规则：手上的 7 必须立刻打出（此时还没有任何牌在桌面上）
  const discard: Card[] = []
  for (const side of [PLAYER, AI] as const) {
    const kept: Card[] = []
    for (const c of hands[side]) {
      if (c.rank === SEVEN) discard.push(c)
      else kept.push(c)
    }
    hands[side] = kept
  }

  return {
    hands,
    deck: rest,
    discard,
    burn: [],
    discardRanks: discard.length > 0 ? [SEVEN] : [],
    chain: discard.length > 0 ? [discard[0]] : [],
    bestChain: discard.length > 0 ? 1 : 0,
    scores: [0, 0],
    turn: PLAYER,
    moves: 0,
    reshuffles: 0,
    lastPlayed: discard.length > 0 ? discard[0] : null,
    lastDrawn: null,
    over: false,
    winner: null,
    rng: r.s,
  }
}

/** 纯函数状态迁移：出牌，或无牌可打时弃一张并补一张 */
export function reduce(state: State, action: Action): State {
  if (state.over) return state
  const side = state.turn
  const hand = state.hands[side]
  const pos = hand.findIndex((c) => c.id === action.cardId)
  if (pos < 0) return state

  const playable = hasPlayable(state, side)

  if (action.type === 'play') {
    if (!playable) return state // 无牌可打时不允许出牌
    const card = hand[pos]
    if (!canPlayRank(state, card.rank)) return state
    return finishTurn(applyPlay(state, side, hand.filter((_, i) => i !== pos), card), side)
  }

  // discard：有牌可打时必须出牌，不允许弃牌
  if (playable) return state

  const r = new Rng(state.rng)
  const kept = hand.filter((_, i) => i !== pos)
  const burned = hand[pos]
  // 抽牌（牌堆空时在此自动洗回），抽到的牌先进手牌
  const drawnState = drawOne({ ...state, burn: state.burn.concat([burned]) }, r)
  const { drawn, ...afterDraw } = drawnState
  let next: State = { ...afterDraw, hands: replaceHand(afterDraw.hands, side, kept.concat([drawn])), lastDrawn: drawn, rng: r.s }
  // 关键规则：抽到的正好是 7，必须立即打出
  if (drawn.rank === SEVEN) next = applyPlay(next, side, kept, drawn)
  return finishTurn(next, side)
}

// ---------------- AI ----------------

/**
 * AI：与规则共享同一个 reduce —— 每个候选动作都通过 reduce 试算，绝不维护第二套规则逻辑。
 * 启发式优先级：
 *   1) 本次得分（含长串加成）越高越好
 *   2) 串越长越好（把桌面接成长串能持续解锁两端）
 *   3) 打出 7 最好（开新串、把两端都解锁）
 *   4) 打完之后可出的牌越多越好
 *   5) 留下离桌面更近的牌：弃牌阶段（手上没有可出的牌）会把离已接龙区域最远的一张丢掉
 *   6) 手牌越少越好；同分时优先打 7（候选先按 7 排序，遍历用严格大于）
 */
export function aiAction(state: State): Action | null {
  if (state.over || state.turn !== AI) return null
  const legal = legalActions(state)
  if (legal.length === 0) return null

  const find = (id: number): Card => state.hands[AI].find((c) => c.id === id) as Card
  const ranked = legal
    .slice()
    .sort((a, b) => Number(find(b.cardId).rank === SEVEN) - Number(find(a.cardId).rank === SEVEN))

  let best = ranked[0]
  let bestValue = -Infinity
  for (const act of ranked) {
    const v = evaluate(state, reduce(state, act))
    if (v > bestValue) {
      bestValue = v
      best = act
    }
  }
  return best
}

/** 局面估值：只看 reduce 之后的局面，不含任何规则判断 */
function evaluate(prev: State, next: State): number {
  const hand = next.hands[AI]
  let ready = 0
  for (const c of hand) if (canPlayRank(next, c.rank)) ready++

  let v = (next.scores[AI] - prev.scores[AI]) * 2
  v += next.chain.length * 3
  if (next.lastPlayed && next.lastPlayed.rank === SEVEN) v += 8
  v += ready * 2
  v -= hand.length * 0.5
  // 保留离桌面更近的牌：离已接龙区域越远，价值越低
  for (const c of hand) v -= tableDistance(next, c.rank) * 0.6
  return v
}
