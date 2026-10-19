/**
 * 最后一张牌 · 规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 玩法：两人各持 6 张手牌，场上维护一张「当前最高牌」（开局为空），轮流行动：
 *   出一张满足下列任一条件的牌：
 *     1) 点数小于场上当前最高牌；
 *     2) 与场上当前最高牌同花色（点数不限，可以更大）。
 *   一手牌都没得打则跳过本轮。打出后场上最高牌更新为「场上牌与新牌中点数更大的那张」，
 *   所以出牌只会让场面变大或变成同花色。先把手牌打完的一方获胜。
 *
 * 三处明确的取舍：
 * 1) 点数相同但花色不同 → 不合法（规则一要求「小于」，规则二要求同花色）；点数相同且同花色 → 合法。
 * 2) 场上最高牌点数相同时保留先打出的那张（field 里保留全部出牌记录，便于展示与洗回牌堆）。
 * 3) 双方连续各跳过一次会陷入死循环（谁都比不上场上那张牌），因此连续两次跳过后清空场面，
 *    下一手任意牌都能打出 —— 这是保证对局必然结束的安全阀，不是可选项。
 *
 * 随机全部来自 state.rng（mulberry32 游标），reduce 是纯函数：相同输入 → 相同输出。
 */
import { makeDeck, type Card } from '../../core/cards'
import { Rng } from '../../core/rng'

/** 一副牌的张数 */
export const DECK_SIZE = 52

/** 每人开局手牌数（由本常量控制） */
export const HAND_SIZE = 6

/** 行动方：0 号为玩家，1 号为电脑 */
export type Side = 'player' | 'ai'

/** 0 = 玩家，1 = 电脑（数组下标用） */
export const SIDE_INDEX: Record<Side, 0 | 1> = { player: 0, ai: 1 }

export function other(side: Side): Side {
  return side === 'player' ? 'ai' : 'player'
}

export interface State {
  /** 双方手牌：[0] 玩家，[1] 电脑 */
  hands: [Card[], Card[]]
  /** 已打出的牌（按时间先后），牌堆发完时洗回重新发牌 */
  field: Card[]
  /** 场上当前最高牌；null 表示场面为空（开局、或连续跳过清场后），任意牌都能打 */
  tableTop: Card | null
  /** 剩余牌堆，发牌通过 cursor 前进 */
  deck: Card[]
  /** 下一张要发的牌在 deck 中的下标 */
  cursor: number
  /** 当前行动方 */
  turn: Side
  /** 累计出牌次数 */
  plays: number
  /** 累计跳过次数 */
  skips: number
  /** 连续跳过计数（达到 2 即清空场面，避免死循环） */
  consecutiveSkips: number
  /** 自动补牌（洗回）次数 */
  reshuffles: number
  /** 最近一手出牌记录 */
  lastPlay: { side: Side; card: Card } | null
  /** 最近一次跳过的一方 */
  lastSkip: Side | null
  over: boolean
  winner: Side | null
  rng: number
}

export type Action =
  | { type: 'play'; cardId: number }
  | { type: 'skip' }

export interface DrawResult {
  cards: Card[]
  deck: Card[]
  cursor: number
  reshuffles: number
  rng: number
}

/**
 * 出牌判定：场上为空任意牌可打；否则「点数更小」或「同花色」二者满足其一即可。
 */
export function canPlay(card: Card, top: Card | null): boolean {
  if (top === null) return true
  return card.rank < top.rank || card.suit === top.suit
}

/** side 当前可以打出的手牌（保持手牌原有顺序） */
export function playableCards(state: State, side: Side = state.turn): Card[] {
  const hand = state.hands[SIDE_INDEX[side]]
  return hand.filter((c) => canPlay(c, state.tableTop))
}

/**
 * 枚举当前回合的全部合法动作：所有可打出的手牌；
 * 一张都打不出时才把「跳过」列为合法动作（有牌可打时跳过视为非法）。
 */
export function legalActions(state: State): Action[] {
  const out: Action[] = playableCards(state).map((c) => ({ type: 'play', cardId: c.id }) as Action)
  if (out.length === 0) out.push({ type: 'skip' })
  return out
}

/**
 * 从牌堆发 count 张牌。牌堆不够时把已打出的牌洗回重新发牌（场上的牌不够则再补一副新牌），
 * 保证任何局面都不会空堆崩溃。随机源来自 state.rng，纯函数。
 */
export function drawCards(state: State, count: number): DrawResult {
  const r = new Rng(state.rng)
  let deck = state.deck
  let cursor = state.cursor
  let reshuffles = state.reshuffles
  if (cursor + count > deck.length) {
    // 把牌堆剩下的与已打出的牌一起洗回；仍不够就再补一副新牌，保证不会空堆崩溃
    const pool = deck.slice(cursor).concat(state.field)
    deck = r.shuffle(pool.length >= count ? pool : pool.concat(makeDeck()))
    cursor = 0
    reshuffles += 1
  }
  const cards = deck.slice(cursor, cursor + count)
  return { cards, deck, cursor: cursor + cards.length, reshuffles, rng: r.s }
}

/** 用给定种子开局：洗牌后两人轮流各取 HAND_SIZE 张 */
export function create(seed: number): State {
  const r = new Rng(seed | 0)
  let s: State = {
    hands: [[], []],
    field: [],
    tableTop: null,
    deck: r.shuffle(makeDeck()),
    cursor: 0,
    turn: 'player',
    plays: 0,
    skips: 0,
    consecutiveSkips: 0,
    reshuffles: 0,
    lastPlay: null,
    lastSkip: null,
    over: false,
    winner: null,
    rng: r.s,
  }
  const hands: [Card[], Card[]] = [[], []]
  for (let i = 0; i < HAND_SIZE; i++) {
    for (let k = 0; k < 2; k++) {
      const d = drawCards(s, 1)
      hands[k] = hands[k].concat(d.cards)
      s = { ...s, deck: d.deck, cursor: d.cursor, reshuffles: d.reshuffles, rng: d.rng }
    }
  }
  return { ...s, hands }
}

/** 场上最高牌更新：取点数更大的那张，点数相同保留原牌 */
function nextTableTop(top: Card | null, card: Card): Card {
  return top === null || card.rank > top.rank ? card : top
}

/** 纯函数状态迁移：非法动作原样返回入参（引用相等），合法动作返回新状态 */
export function reduce(state: State, action: Action): State {
  if (state.over) return state
  const side = SIDE_INDEX[state.turn]

  if (action.type === 'skip') {
    // 跳过不抽牌，也不碰牌堆；仍有牌可打时跳过视为非法
    if (playableCards(state).length > 0) return state
    const dead = state.consecutiveSkips + 1 >= 2
    return {
      ...state,
      turn: other(state.turn),
      skips: state.skips + 1,
      consecutiveSkips: dead ? 0 : state.consecutiveSkips + 1,
      // 连续两次跳过说明场面把双方都卡死了，清场让下一手任意牌都能打出
      tableTop: dead ? null : state.tableTop,
      lastPlay: null,
      lastSkip: state.turn,
    }
  }

  const hand = state.hands[side]
  const at = hand.findIndex((c) => c.id === action.cardId)
  if (at < 0) return state
  const card = hand[at]
  if (!canPlay(card, state.tableTop)) return state

  const hands: [Card[], Card[]] = [state.hands[0].slice(), state.hands[1].slice()]
  hands[side] = hand.filter((c) => c.id !== card.id)
  const over = hands[side].length === 0

  return {
    ...state,
    hands,
    field: state.field.concat(card),
    tableTop: nextTableTop(state.tableTop, card),
    turn: over ? state.turn : other(state.turn),
    plays: state.plays + 1,
    consecutiveSkips: 0,
    over,
    winner: over ? state.turn : null,
    lastPlay: { side: state.turn, card },
    lastSkip: null,
  }
}

/** 出牌的直观别名，便于测试复用同一入口 */
export function play(state: State, cardId: number): State {
  return reduce(state, { type: 'play', cardId })
}

/** 跳过的直观别名 */
export function skip(state: State): State {
  return reduce(state, { type: 'skip' })
}

/**
 * AI：与规则共享同一个 reduce —— 枚举合法动作后逐个通过 reduce 试算并评分，
 * 绝不维护第二套规则逻辑。
 * 权重顺序即启发式顺序：
 *   立刻获胜 > 不抬高场面 > 同花色低牌 > 清掉大牌 > 逼对手无牌可出 > 跳过。
 */
export function aiAction(state: State): Action | null {
  if (state.over || state.turn !== 'ai') return null
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

const WIN_SCORE = 1_000_000
const FLAT_SCORE = 10_000 // 不抬高场面
const SUIT_SCORE = 4_000 // 同花色低牌
const BIG_SCORE = 5 // 每点数，清掉大牌
const LOCK_SCORE = 1_500 // 逼对手无牌可出

/** 对候选动作试算后的评分（评分只依赖 state 与 reduce 的结果，不含任何额外规则逻辑） */
function score(state: State, action: Action): number {
  if (action.type === 'skip') return -1 // 有牌可打时跳过本来就是非法的，这里兜底

  const next = reduce(state, action)
  const card = next.lastPlay ? next.lastPlay.card : null
  if (!card) return -1

  let s = next.over && next.winner === 'ai' ? WIN_SCORE : 0
  const top = state.tableTop

  // 1) 不抬高场面：打出后场上最高牌还是原来那张
  if (top && next.tableTop && next.tableTop.id === top.id) s += FLAT_SCORE

  // 2) 同花色低牌：同花色可跨大小接牌，同花色里优先出小的
  if (top && card.suit === top.suit) {
    s += SUIT_SCORE + (14 - card.rank) * 40
  }

  // 3) 清掉大牌：点数越大越优先打出去，减少留在手里的压力
  s += card.rank * BIG_SCORE

  // 4) 让对手彻底接不上，只能跳过
  if (!next.over && playableCards(next).length === 0) s += LOCK_SCORE

  // 同分时按 cardId 升序，保证 AI 完全可复盘
  return s - card.id * 1e-6
}
