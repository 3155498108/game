/**
 * 大富豪 · 规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 玩法：两副牌去掉大小王共 104 张，两人各 52 张轮转发完（牌堆剩余 0）。
 * 出牌必须接上本轮末牌，且是**同花色、点数递减相邻**：
 *   打出 9♥ 之后只能出 8♥ —— 不能出 10♥，也不能跨花色。
 * 点数为 2 的牌是**万能牌**，可当作任意花色、任意相邻点数接出
 * （例如 2♠ 当作 9♥ 接在 10♥ 后面）。
 *
 * 一轮（一次首牌 → 直到无人能接）内的流程：
 *   1. 打出首牌的一方锁定该轮花色，之后只能出同花色（或用 2 当万能牌）；
 *   2. 点数每接一张必然 -1，所以一条链最长 13 张（K→A），达到上限本轮强制结束；
 *   3. 双方都无牌可出 → 连续两次过牌 → 本轮结束；
 *   4. 本轮结束后由**打出首牌的那一方**任选一个花色重新开局（phase = 'chooseSuit'）。
 * 谁先把手牌打完谁赢。
 *
 * 四处明确的取舍：
 * 1) 【发牌张数】题目写「104 张牌堆 + 两人各 54 张」，而 54×2 = 108 > 104，无法同时成立。
 *    这里以「两副无王共 104 张」为准（出现两次），两人各 52 张，正好发完、牌堆剩余 0。
 * 2) 【万能牌 2 的接法】2 只能当 turnRank-1 那一档点数接出，且要求 turnRank ≥ 2。
 *    因此打出 A（有效点数 1）后链条天然终止 —— 这既是规则也是防死锁的一环。
 * 3) 【用 2 开首】把 2 当作**所选花色的 K**（有效点数 13）。首局没有选花色时，
 *    则视为 2 自己花色的 K。若当作 A 会导致开首即死链，所以取 K。
 * 4) 【选花色的合法集合】chooseSuit 阶段只列出「手上真的有牌能出的花色」
 *    （该花色的牌，或万能牌 2），避免出现「选了却一张都打不出」的死局面。
 *
 * 随机全部来自 state.rng（mulberry32 游标），reduce 是纯函数：相同输入 → 相同输出。
 */
import { SUITS, makeDeck, shuffledDeck, type Card, type Suit } from '../../core/cards'
import { Rng } from '../../core/rng'

/** 牌副数 */
export const DECKS = 2

/** 牌堆总张数：2 副去掉大小王 */
export const DECK_SIZE = DECKS * 52

/** 每人开局手牌数（104 张轮流发完，牌堆剩余 0） */
export const HAND_SIZE = DECK_SIZE / 2

/** 一轮内最多连续出牌张数（K→A 共 13 档） */
export const MAX_CHAIN = 13

/** 万能牌点数 */
export const WILDCARD_RANK = 2

/** 万能牌开首时的有效点数（当作所选花色的 K） */
export const LEAD_RANK = 13

/** 行动方：0 号为玩家，1 号为电脑 */
export type Side = 'player' | 'ai'

/** 0 = 玩家，1 = 电脑（数组下标用） */
export const SIDE_INDEX: Record<Side, 0 | 1> = { player: 0, ai: 1 }

export function other(side: Side): Side {
  return side === 'player' ? 'ai' : 'player'
}

/** 阶段：出牌中 / 等待首牌方选花色 / 已结束 */
export type Phase = 'play' | 'chooseSuit' | 'done'

export interface State {
  /** 双方手牌：[0] 玩家，[1] 电脑 */
  hands: [Card[], Card[]]
  /** 洗好的整副 104 张，发牌由 cursor 推进 */
  deck: Card[]
  /** 下一张要发的牌在 deck 中的下标 */
  cursor: number
  /** 弃牌堆：本局所有已打出的牌（按时间先后），牌堆耗尽时洗回 */
  pile: Card[]
  /** 本轮末牌（物理牌）；null 表示本轮还没有首牌 */
  turnCard: Card | null
  /** 本轮末牌的有效点数；0 表示本轮还没有首牌 */
  turnRank: number
  /** 本轮锁定花色；null 表示未锁定（首局可任意花色开局） */
  leadSuit: Suit | null
  /** 打出本轮首牌的一方：一轮结束后由它选花色 */
  leader: Side | null
  /** 当前行动方 */
  turn: Side
  /** 本轮连续出牌数 */
  chainCount: number
  /** 连续过牌数（达到 2 即本轮结束） */
  passStreak: number
  /** 当前阶段 */
  phase: Phase
  /** 累计出牌次数 */
  plays: number
  /** 累计过牌次数 */
  passes: number
  /** 自动洗回次数 */
  reshuffles: number
  /** 已打完的轮数 */
  rounds: number
  /** 最近一手出牌 */
  lastPlay: { side: Side; card: Card } | null
  over: boolean
  winner: Side | null
  rng: number
}

export type Action =
  /** 出一张手牌 */
  | { type: 'play'; cardId: number }
  /** 无牌可出时过牌 */
  | { type: 'pass' }
  /** 一轮结束后由首牌方选定开局花色 */
  | { type: 'lead'; suit: Suit }

/** 一张牌打出后，本轮末牌的有效值 */
export interface Effective {
  rank: number
  suit: Suit
}

export interface DealResult {
  cards: Card[]
  deck: Card[]
  cursor: number
  reshuffles: number
  rng: number
}

/**
 * 出牌判定（本游戏唯一的规则入口，AI 试算也走这里）：
 *   - turnRank === 0：本轮还没首牌。未锁定花色时任意牌可出；已锁定时只能出该花色或 2。
 *   - turnRank > 0 ：必须同花色且点数恰好小 1；万能牌 2 任意可用，
 *     但要求 turnRank ≥ 2（即存在一个合法的相邻点数）。
 */
export function canPlay(card: Card, turnRank: number, leadSuit: Suit | null): boolean {
  if (card.rank === WILDCARD_RANK) {
    if (turnRank === 0) return true
    return turnRank >= WILDCARD_RANK
  }
  if (turnRank === 0) return leadSuit === null || card.suit === leadSuit
  return card.suit === leadSuit && card.rank === turnRank - 1
}

/** 一张牌打出后成为本轮末牌时的有效值（万能牌按接龙规则换算） */
export function effectiveAfter(state: State, card: Card): Effective {
  if (card.rank === WILDCARD_RANK) {
    // 开首的 2 → 所选花色（未选则用它自己花色）的 K；接出的 2 → turnRank - 1
    if (state.turnRank === 0) return { rank: LEAD_RANK, suit: state.leadSuit ?? (card.suit as Suit) }
    return { rank: state.turnRank - 1, suit: state.leadSuit as Suit }
  }
  return { rank: card.rank, suit: card.suit as Suit }
}

/** side 当前可以打出的手牌（保持手牌原有顺序） */
export function playableCards(state: State, side: Side = state.turn): Card[] {
  return state.hands[SIDE_INDEX[side]].filter((c) => canPlay(c, state.turnRank, state.leadSuit))
}

/** 是否可以选这个花色开局：该花色的牌或万能牌 2 至少要有一张在手 */
export function canLeadSuit(state: State, suit: Suit): boolean {
  return state.hands[SIDE_INDEX[state.turn]].some((c) => c.suit === suit || c.rank === WILDCARD_RANK)
}

/**
 * 枚举当前回合的全部合法动作：
 *   - chooseSuit 阶段：手上真的有牌能出的那些花色；
 *   - play 阶段：所有可打出的手牌；一张都打不出时才把「过牌」列为合法动作。
 */
export function legalActions(state: State): Action[] {
  if (state.over || state.phase === 'done') return []
  if (state.phase === 'chooseSuit') {
    return SUITS.filter((s) => canLeadSuit(state, s)).map((s) => ({ type: 'lead', suit: s }) as Action)
  }
  const plays = playableCards(state).map((c) => ({ type: 'play', cardId: c.id }) as Action)
  if (plays.length === 0) return [{ type: 'pass' }]
  return plays
}

/** 两个动作是否等价（测试里断言 AI 动作合法时使用） */
export function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'play' && b.type === 'play') return a.cardId === b.cardId
  if (a.type === 'lead' && b.type === 'lead') return a.suit === b.suit
  return true
}

/** 动作是否合法（测试与 AI 共用同一判定） */
export function isLegal(state: State, action: Action): boolean {
  return legalActions(state).some((a) => sameAction(a, action))
}

/** 本轮结束：交给首牌方选花色重新开局 */
function endRound(state: State): State {
  return {
    ...state,
    phase: 'chooseSuit',
    turn: state.leader ?? other(state.turn),
    leadSuit: null,
    turnRank: 0,
    turnCard: null,
    chainCount: 0,
    passStreak: 0,
    rounds: state.rounds + 1,
  }
}

/**
 * 从牌堆发 count 张。牌堆不够时把「牌堆剩余 + 弃牌堆」洗回重新发牌，
 * 仍不够再补一副新牌，保证任何局面都不会空堆崩溃。随机源来自 state.rng，纯函数。
 */
export function dealFrom(state: State, count: number): DealResult {
  const r = new Rng(state.rng)
  let deck = state.deck
  let cursor = state.cursor
  let reshuffles = state.reshuffles
  if (cursor + count > deck.length) {
    const pool = deck.slice(cursor).concat(state.pile)
    deck = r.shuffle(pool.length >= count ? pool : pool.concat(makeDeck({ decks: DECKS })))
    cursor = 0
    reshuffles += 1
  }
  const cards = deck.slice(cursor, cursor + count)
  return { cards, deck, cursor: cursor + cards.length, reshuffles, rng: r.s }
}

/** 用给定种子开局：两副无王共 104 张洗好后，两人轮流各取 HAND_SIZE 张（先手固定为玩家） */
export function create(seed: number): State {
  const r = new Rng(seed | 0)
  let s: State = {
    hands: [[], []],
    deck: shuffledDeck(r, { decks: DECKS }),
    cursor: 0,
    pile: [],
    turnCard: null,
    turnRank: 0,
    leadSuit: null,
    leader: null,
    turn: 'player',
    chainCount: 0,
    passStreak: 0,
    phase: 'play',
    plays: 0,
    passes: 0,
    reshuffles: 0,
    rounds: 0,
    lastPlay: null,
    over: false,
    winner: null,
    rng: r.s,
  }
  const hands: [Card[], Card[]] = [[], []]
  for (let i = 0; i < HAND_SIZE; i++) {
    for (let k = 0; k < 2; k++) {
      const d = dealFrom(s, 1)
      hands[k] = hands[k].concat(d.cards)
      s = { ...s, deck: d.deck, cursor: d.cursor, reshuffles: d.reshuffles, rng: d.rng }
    }
  }
  return { ...s, hands }
}

/** 纯函数状态迁移：非法动作原样返回入参（引用相等），合法动作返回新状态 */
export function reduce(state: State, action: Action): State {
  if (state.over || state.phase === 'done') return state

  // ---------- 选花色：锁定本轮花色，回到出牌阶段 ----------
  if (action.type === 'lead') {
    if (state.phase !== 'chooseSuit') return state
    if (!canLeadSuit(state, action.suit)) return state
    return {
      ...state,
      phase: 'play',
      leadSuit: action.suit,
      turnRank: 0,
      turnCard: null,
      turn: state.turn,
      leader: state.turn,
      chainCount: 0,
      passStreak: 0,
    }
  }

  // ---------- 过牌：只在无牌可出时合法，连续两次即本轮结束 ----------
  if (action.type === 'pass') {
    if (state.phase !== 'play') return state
    if (playableCards(state).length > 0) return state
    const next = { ...state, passes: state.passes + 1, turn: other(state.turn), passStreak: state.passStreak + 1 }
    return next.passStreak >= 2 ? endRound(next) : next
  }

  // ---------- 出牌 ----------
  if (state.phase !== 'play') return state
  const side = SIDE_INDEX[state.turn]
  const hand = state.hands[side]
  const at = hand.findIndex((c) => c.id === action.cardId)
  if (at < 0) return state
  const card = hand[at]
  if (!canPlay(card, state.turnRank, state.leadSuit)) return state

  const eff = effectiveAfter(state, card)
  const hands: [Card[], Card[]] = [state.hands[0].slice(), state.hands[1].slice()]
  hands[side] = hand.filter((c) => c.id !== card.id)
  const chain = state.chainCount + 1
  const over = hands[side].length === 0
  const next: State = {
    ...state,
    hands,
    pile: state.pile.concat(card),
    turnCard: card,
    turnRank: eff.rank,
    leadSuit: eff.suit,
    leader: state.chainCount === 0 ? state.turn : state.leader,
    chainCount: chain,
    passStreak: 0,
    plays: state.plays + 1,
    turn: other(state.turn),
    lastPlay: { side: state.turn, card },
    over,
    winner: over ? state.turn : null,
    phase: over ? 'done' : 'play',
  }
  // 一轮内最多 13 张：达到上限本轮必须结束，由最后出牌者（即首牌方）重新选花色
  return !over && chain >= MAX_CHAIN ? endRound(next) : next
}

/** 出牌的直观别名，便于测试复用同一入口 */
export function play(state: State, cardId: number): State {
  return reduce(state, { type: 'play', cardId })
}

/** 过牌的直观别名 */
export function pass(state: State): State {
  return reduce(state, { type: 'pass' })
}

/** 选花色的直观别名 */
export function lead(state: State, suit: Suit): State {
  return reduce(state, { type: 'lead', suit })
}

/** 牌堆剩余张数 */
export function remaining(state: State): number {
  return Math.max(0, state.deck.length - state.cursor)
}

/**
 * AI：与规则共享同一个 reduce —— 枚举合法动作后逐个通过 reduce 试算并评分，
 * 绝不维护第二套规则逻辑。
 * 权重顺序即启发式顺序：
 *   立刻获胜 > 逼对手无牌可出 > 甩万能牌 2（手上还有别的 2 时打折，不一次打光）
 *   > 手牌少时出大牌抢先走完 > 其余局面出小牌保留大牌。
 */
export function aiAction(state: State): Action | null {
  if (state.over || state.phase === 'done') return null
  if (state.turn !== 'ai') return null
  const legal = legalActions(state)
  if (legal.length === 0) return null

  let bestAction = legal[0]
  let bestScore = -Infinity
  for (const a of legal) {
    const s = score(state, a)
    if (s > bestScore) {
      bestScore = s
      bestAction = a
    }
  }
  return bestAction
}

const WIN = 1_000_000 // 立刻出完
const LOCK = 6_000 // 逼对手无牌可出
const WILDCARD_ONLY = 2_000 // 手上只剩这一个 2：甩得最爽
const WILDCARD_SHARED = 900 // 手上还有别的 2：甩掉它但别一次打光
const ENDGAME_HAND = 5 // 手牌少于这个数就转入抢跑模式
const RANK_BIG = 200 // 抢跑模式：点数越大越优先
const RANK_LOW = 150 // 常规模式：点数越小越优先

/** 某个花色从 K 往下能连出的最长长度（纯计算，用来评价开局的收益） */
function longestRun(hand: readonly Card[], suit: Suit): number {
  const ranks = new Set(hand.filter((c) => c.suit === suit && c.rank !== WILDCARD_RANK).map((c) => c.rank))
  let n = 0
  for (let r = LEAD_RANK; r >= 1; r--) {
    if (ranks.has(r)) n++
    else break
  }
  return n
}

/** 对候选动作试算后的评分（评分只依赖 state 与 reduce 的结果，不含任何额外规则逻辑） */
function score(state: State, action: Action): number {
  if (action.type === 'pass') return -1 // 有牌可打时过牌本就是非法的，这里兜底
  const next = reduce(state, action)
  if (next === state) return -1

  // 选花色：优先自己牌最多、其次能连出最长链的花色
  if (action.type === 'lead') {
    const hand = state.hands[1]
    const own = hand.filter((c) => c.suit === action.suit).length
    const wild = hand.filter((c) => c.rank === WILDCARD_RANK).length
    return own * 100 + wild * 40 + longestRun(hand, action.suit) * 60
  }

  const hand = state.hands[1]
  const at = hand.findIndex((c) => c.id === action.cardId)
  if (at < 0) return -1
  const card = hand[at]

  let s = next.over && next.winner === 'ai' ? WIN : 0

  // 手牌少 → 出大牌抢先走完；手牌多 → 出小牌保留大牌
  s += hand.length <= ENDGAME_HAND ? card.rank * RANK_BIG : (LEAD_RANK - card.rank) * RANK_LOW

  // 甩万能牌 2：手上只剩这一个 2 时最划算
  if (card.rank === WILDCARD_RANK) {
    const twosLeft = hand.filter((c) => c.rank === WILDCARD_RANK).length - 1
    s += twosLeft <= 0 ? WILDCARD_ONLY : WILDCARD_SHARED
  }

  // 让对手彻底接不上，只能过牌
  if (!next.over && next.phase === 'play' && playableCards(next).length === 0) s += LOCK

  // 同分时按 cardId 升序，保证 AI 完全可复盘
  return s - card.id * 1e-6
}
