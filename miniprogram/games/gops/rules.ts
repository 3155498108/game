/**
 * 接龙 gops 规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 玩法：一副 54 张牌（四花色各 13 张 + 大小王）均分给双方，各 27 张，轮流接龙。
 *   · 接龙：出牌必须接在「桌面末端牌」之后 —— 同花色且点数相邻（+1 或 -1）。
 *   · 边界：点数只在 1(A)..13(K) 之间相邻，不做循环。
 *     所以桌面是 A 时只有 2 能接（A-1 不存在），桌面是 K 时只有 Q 能接（K+1 不存在）。
 *   · 万能牌：大小王可当作任意花色的任意点数单独打出，且打出后
 *     **桌面末端牌保持不变**（王不建立接龙基准；桌面本来为空时出王，桌面仍为空）。
 *   · 首出：桌面为空时任意手牌都能打出。
 *   · 跳过：当前无牌可出时跳过回合，把回合交给对方（不做洗牌惩罚）。
 *   · 胜负：先打完手牌者胜。
 *
 * 三处明确的取舍：
 * 1) 经典 gops 是 27/27 发牌，因此开局时「牌堆」就是空的（deck 长度 0），
 *    全部 54 张牌永远在手牌与弃牌堆之间流动。为了保证任何情况下都不会空堆崩溃，
 *    仍然实现了 refillStock()：牌堆耗尽时把弃牌堆洗回作为新牌堆，随机源来自 state.rng。
 * 2) 双方同时无牌可出（例如双方各攥着不相邻的两张牌）会形成死循环。
 *    此时触发「死局救援」：牌堆耗尽就把弃牌堆洗回，双方各补 1 张牌，循环被打断。
 * 3) 万一救援也推进不了局面（弃牌堆已空），累计跳过次数达到 PASS_LIMIT 后判平局，
 *    绝不让对局卡死。
 *
 * 随机全部来自 state.rng（mulberry32 游标），reduce 是纯函数：相同输入 → 相同输出。
 */
import { isJoker, makeDeck, sortCards, type Card } from '../../core/cards'
import { Rng } from '../../core/rng'

/** 一副牌的张数（四花色 52 张 + 大小王 2 张） */
export const DECK_SIZE = 54
/** 每人手牌张数（27 + 27 = 54，经典 gops 布局） */
export const HAND_SIZE = 27
/** 累计跳过达到该次数仍无进展 → 判平局，防止互相卡死形成死循环 */
export const PASS_LIMIT = 200

/** 1 = 玩家，2 = 电脑 */
export type Player = 1 | 2

export interface State {
  /** 双方手牌：下标 0 是玩家，下标 1 是电脑 */
  hands: [Card[], Card[]]
  /** 牌堆：尚未发出的牌。经典 27/27 开局时为空，耗尽时由弃牌堆洗回填充 */
  deck: Card[]
  /** 弃牌堆：打出的牌按顺序堆叠，牌堆洗回时整堆回收 */
  pile: Card[]
  /** 桌面末端牌（接龙基准）：打出万能牌时保持不变 */
  tableTop: Card | null
  /** 刚打出的牌（可能是万能牌），仅用于渲染 */
  lastPlayed: Card | null
  /** 当前回合 */
  turn: Player
  /** 累计跳过回合次数 */
  passes: number
  /** 已打出的牌数 */
  moves: number
  /** 洗回补牌次数 */
  recycles: number
  over: boolean
  /** 0 = 未结束或平局，1 / 2 = 获胜方 */
  winner: 0 | Player
  rng: number
}

export type Action =
  | { type: 'play'; cardId: number }
  | { type: 'pass' }

export const other = (p: Player): Player => (p === 1 ? 2 : 1)

/** 某一方的手牌 */
export function handOf(state: State, who: Player): Card[] {
  return state.hands[who - 1]
}

/** 牌堆剩余张数 */
export function stock(state: State): number {
  return state.deck.length
}

/** 全场总牌数守恒：手牌 + 牌堆 + 弃牌堆 永远等于 54 */
export function totalCards(state: State): number {
  return state.hands[0].length + state.hands[1].length + state.deck.length + state.pile.length
}

function findCard(hand: readonly Card[], id: number): Card | null {
  for (const c of hand) if (c.id === id) return c
  return null
}

/**
 * 接龙判定（本游戏唯一的一条合法性规则，渲染、AI、测试全部复用它）。
 * · 桌面为空 → 首出可任选
 * · 万能牌 → 任何时候都能打出
 * · 否则 → 同花色且点数相邻（+1 或 -1）
 * 边界由点数范围自然保证：桌面 A(1) 时 -1 不存在，桌面 K(13) 时 +1 不是普通牌（14 是王，花色不同）。
 */
export function canFollow(card: Card, top: Card | null): boolean {
  if (top === null) return true
  if (isJoker(card)) return true
  if (isJoker(top)) return false
  if (card.suit !== top.suit) return false
  return card.rank === top.rank + 1 || card.rank === top.rank - 1
}

/** 某一方当前能接上手牌 */
export function playableCards(state: State, who: Player): Card[] {
  return handOf(state, who).filter((c) => canFollow(c, state.tableTop))
}

/** 某一方所有「出牌」动作 */
export function playCandidates(state: State, who: Player): Action[] {
  return playableCards(state, who).map((c) => ({ type: 'play' as const, cardId: c.id }))
}

/**
 * 当前回合的全部合法动作：
 * 桌面为空时是全部手牌，接龙时是所有能接上的牌 + 大小王；
 * 一张都出不了时才给「过」。对局已结束返回空数组。
 */
export function legalActions(state: State): Action[] {
  if (state.over) return []
  const plays = playCandidates(state, state.turn)
  return plays.length > 0 ? plays : [{ type: 'pass' }]
}

export function isLegal(state: State, action: Action): boolean {
  for (const a of legalActions(state)) {
    if (a.type !== action.type) continue
    if (a.type === 'pass') return true
    if (action.type === 'play' && a.cardId === action.cardId) return true
  }
  return false
}

/** 用给定种子开局：洗好 54 张牌后各发 27 张，桌面为空，玩家先出 */
export function create(seed: number): State {
  const r = new Rng(seed | 0)
  const deck = r.shuffle(makeDeck({ jokers: true }))
  return {
    hands: [
      sortCards(deck.slice(0, HAND_SIZE)),
      sortCards(deck.slice(HAND_SIZE, HAND_SIZE * 2)),
    ],
    deck: deck.slice(HAND_SIZE * 2),
    pile: [],
    tableTop: null,
    lastPlayed: null,
    turn: 1,
    passes: 0,
    moves: 0,
    recycles: 0,
    over: false,
    winner: 0,
    rng: r.s,
  }
}

/**
 * 牌堆耗尽时把弃牌堆洗回作为新牌堆；随机源来自 state.rng。
 * 牌堆非空、或弃牌堆为空时原样返回（同一个引用），便于调用方无条件串联。
 */
export function refillStock(state: State): State {
  if (state.deck.length > 0 || state.pile.length === 0) return state
  const r = new Rng(state.rng)
  return { ...state, deck: r.shuffle(state.pile), pile: [], rng: r.s }
}

/** 从牌堆顶部给双方各发 1 张（牌堆为空时原样返回） */
function dealEach(state: State): State {
  if (state.deck.length === 0) return state
  let deck = state.deck
  const hands: [Card[], Card[]] = [state.hands[0].slice(), state.hands[1].slice()]
  for (const i of [0, 1] as const) {
    if (deck.length === 0) break
    hands[i] = hands[i].concat(deck[0])
    deck = deck.slice(1)
  }
  return {
    ...state,
    deck,
    hands: [sortCards(hands[0]), sortCards(hands[1])],
    recycles: state.recycles + 1,
  }
}

/** 出牌：校验合法性 → 从手牌移除 → 压入弃牌堆 → 更新桌面基准 → 切换回合或判胜 */
function applyPlay(state: State, cardId: number): State {
  if (!isLegal(state, { type: 'play', cardId })) return state
  const idx = state.turn - 1
  const card = findCard(state.hands[idx], cardId) as Card
  const hands: [Card[], Card[]] = [state.hands[0].slice(), state.hands[1].slice()]
  hands[idx] = hands[idx].filter((c) => c.id !== cardId)
  const won = hands[idx].length === 0
  return {
    ...state,
    hands: [sortCards(hands[0]), sortCards(hands[1])],
    pile: state.pile.concat(card),
    // 万能牌打出后不改变接龙基准
    tableTop: isJoker(card) ? state.tableTop : card,
    lastPlayed: card,
    moves: state.moves + 1,
    over: won,
    winner: won ? state.turn : 0,
    turn: won ? state.turn : other(state.turn),
  }
}

/** 跳过：只有真的无牌可出时才合法；随后判断是否触发死局救援 */
function applyPass(state: State): State {
  if (!isLegal(state, { type: 'pass' })) return state
  const passes = state.passes + 1
  const turn = other(state.turn)
  const base: State = { ...state, passes, turn }
  // 兜底：反复跳过也无法推进 → 判平局，绝不让对局卡死
  if (passes >= PASS_LIMIT) return { ...base, over: true, winner: 0 }
  // 死局救援：接手的对方同样无牌可出，把弃牌堆洗回，双方各补 1 张
  if (playCandidates(base, turn).length === 0) return dealEach(refillStock(base))
  return base
}

/** 纯函数状态迁移：非法动作原样返回（同一引用），绝不修改入参 */
export function reduce(state: State, action: Action): State {
  if (state.over) return state
  if (action.type === 'play') return applyPlay(state, action.cardId)
  return applyPass(state)
}

/** 出牌的直观别名，便于测试与 AI 复用同一入口 */
export function play(state: State, cardId: number): State {
  return reduce(state, { type: 'play', cardId })
}

/** 跳过的直观别名 */
export function pass(state: State): State {
  return reduce(state, { type: 'pass' })
}

/** 手里还能接住桌面末端牌的候选数量（与接龙判定共用 canFollow） */
function followers(hand: readonly Card[], top: Card | null): number {
  let n = 0
  for (const c of hand) if (canFollow(c, top)) n++
  return n
}

/**
 * AI：与规则共享同一个 reduce —— 每个候选动作都通过 reduce 试算，
 * 绝不维护第二套规则逻辑。启发式优先级：
 *   ① 能这一手打完直接赢
 *   ② 保留万能牌（打出王最亏）
 *   ③ 从小往大接：优先出手里最小的牌，把大牌留到最后
 *   ④ 少出 A：桌面变成 A 之后只剩 2 能接，接龙面更窄
 *   ⑤ 接龙之后自己手里的后续选择越多越好、对手越少越好
 * 有牌可出时绝不会选择跳过（跳过只在一张都出不了时才是合法动作）。
 */
export function aiAction(state: State): Action | null {
  if (state.over || state.turn !== 2) return null
  const cands = legalActions(state)
  if (cands.length === 0) return null
  let best: Action = cands[0]
  let bestScore = -Infinity
  for (const a of cands) {
    const s = scoreMove(state, a)
    if (s > bestScore) {
      bestScore = s
      best = a
    }
  }
  return best
}

function scoreMove(state: State, action: Action): number {
  const next = reduce(state, action)
  if (next.winner === 2) return 1_000_000
  if (next.over) return -500_000 // 打成平局最差
  if (action.type === 'pass') return -900_000
  const played = next.pile[next.pile.length - 1]
  let score = 0
  if (isJoker(played)) {
    score -= 900 // ② 万能牌最舍不得用
  } else {
    score -= played.rank * 10 // ③ 优先出最小的牌
    if (played.rank === 1) score -= 70 // ④ 桌面变成 A 之后接龙面最窄
  }
  // ⑤ 自己后续能接的牌越多越好，对手能接的牌越少越好
  score += followers(next.hands[1], next.tableTop) * 14
  score -= followers(next.hands[0], next.tableTop) * 6
  return score
}
