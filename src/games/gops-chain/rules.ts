/**
 * 连环新接龙 gops-chain 规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 玩法：一副 54 张牌（四花色各 13 张 + 大小王）均分给双方，各 27 张，轮流接龙。
 *   · 接龙：必须**同花色且点数恰好 +1**（只能往大接）。桌面 7♠ 之后只能出 8♠，
 *     6♠ 接不上 —— 这是与「接龙 gops」最核心的差别，也是「手牌按花色分组、
 *     组内只能从小往大打」在规则上的落实，而不只是显示顺序。
 *   · 万能牌：大小王任何时候都能打出，且**不改变末牌**（王不建立接龙基准，
 *     也不锁定本轮花色），打出王之后继续接上一张非王牌。
 *   · 必须完整接龙：只要当前行动方还握有「能接上末牌」的牌，就不允许过牌，
 *     必须继续出。因此一轮要一直打到双方都接不上为止（连续两次过牌即一轮结束）。
 *   · 新一轮指定花色起手：一轮结束时由**规则推导**出下一轮的起手花色
 *     （= 本轮最后一张非王牌的花色），并由**最后出牌者**起手；
 *     起手时必须打出该花色的牌（王仍然可出）。若起手方手上确实一张该花色都没有，
 *     限制自动解除，可任选花色 —— 这样任何局面都不会卡死。
 *   · 胜负：先打完手牌者胜。
 *
 * 五处明确的取舍：
 * 1) 【接龙方向】取「只许 +1」而不是 gops 的 ±1。这是「组内只能从小往大打」
 *    的硬规则化，也让「一轮结束指定花色起手」形成闭环：上一轮的花色就是下一轮的起手色。
 * 2) 【必须完整接龙】只约束「过牌」：存在任何可接的牌时 reduce 直接拒绝 pass。
 *    出牌本身不受额外限制，所以每个动作都只需要一次合法性判定。
 * 3) 【指定花色由规则推导】不额外引入「选花色」动作：既少一个交互面，
 *    也让 AI 与提示共用同一份候选枚举。推导依据写在 endRound() 里。
 * 4) 【洗回补牌放在一轮结束时】牌堆耗尽（开局就是如此）时，一轮结束会把弃牌堆洗回
 *    并给双方各补 1 张，因此弃牌与手牌一直在循环；过牌途中不做补牌，因为
 *    「接手方接不上」在本游戏里必然意味着一轮马上结束，那时补牌会等于撤销刚打出的牌。
 * 5) 【悔牌栈】每个动作前压入一帧 BoardState，栈深上限与次数上限同为 3；
 *    对局结束后任何动作（含悔牌）都无效，悔牌无法复活已终局的对局。
 *
 * 随机全部来自 state.rng（mulberry32 游标），reduce 是纯函数：相同输入 → 相同输出。
 */
import { isJoker, makeDeck, sortCards, type Card, type Suit } from '../../core/cards'
import { Rng } from '../../core/rng'

/** 一副牌的张数（四花色 52 张 + 大小王 2 张） */
export const DECK_SIZE = 54
/** 每人手牌张数（27 + 27 = 54，全部分完，牌堆开局为空） */
export const HAND_SIZE = 27
/** 悔牌次数上限（也是悔牌栈的深度上限） */
export const UNDO_LIMIT = 3
/** 累计过牌达到该次数仍无进展 → 判平局，防止互相卡死形成死循环 */
export const STALL_LIMIT = 200

/** 1 = 玩家，2 = 电脑 */
export type Player = 1 | 2
export const PLAYER: Player = 1
export const AI: Player = 2
export function other(p: Player): Player {
  return p === 1 ? 2 : 1
}

/** 出牌判定需要的上下文（由 state + 行动方推导，测试可直接构造） */
export interface PlayCtx {
  /** 本轮末牌（接龙基准）；null 表示本轮还没有首牌 */
  top: Card | null
  /** 本轮指定的起手花色；null 表示不限制 */
  leadSuit: Suit | null
  /** 行动方手上是否真的有指定花色的牌（没有则限制自动解除） */
  hasLeadSuit: boolean
}

/** 悔牌栈里存的一帧：除了悔牌 / 提示 / 终局之外的全部对局状态 */
export interface BoardState {
  /** 双方手牌：下标 0 是玩家，下标 1 是电脑 */
  hands: [Card[], Card[]]
  /** 牌堆：开局为空（54 张全在手），耗尽时由弃牌堆洗回 */
  deck: Card[]
  /** 弃牌堆：打出的牌按顺序堆叠 */
  pile: Card[]
  /** 本轮末牌（接龙基准）：打出万能牌时保持不变 */
  tableTop: Card | null
  /** 最近打出的牌（可能是万能牌），仅用于渲染 */
  lastPlayed: Card | null
  /** 最近打出那张牌的一方：一轮结束后由它起手下一轮 */
  lastSide: Player
  /** 本轮指定的起手花色；null 表示不限制（首局、或上一轮全是王） */
  leadSuit: Suit | null
  /** 当前行动方 */
  turn: Player
  /** 累计出牌次数 */
  moves: number
  /** 累计过牌次数 */
  passes: number
  /** 本轮已出的牌数 */
  chainPlays: number
  /** 连续过牌数（达到 2 即一轮结束） */
  passStreak: number
  /** 已打完的轮数 */
  rounds: number
  /** 洗回补牌次数 */
  recycles: number
  rng: number
}

export interface State extends BoardState {
  /** 悔牌剩余次数，归零后 reduce 拒绝悔牌 */
  undoLeft: number
  /** 悔牌栈（最近若干帧），深度上限 UNDO_LIMIT */
  undo: BoardState[]
  /** 提示高亮的牌 id；null 表示当前没有提示 */
  hintCardId: number | null
  over: boolean
  /** 0 = 未结束或平局，1 / 2 = 获胜方 */
  winner: 0 | Player
}

export type Action =
  /** 出一张手牌（接龙 / 起手都走这一个动作） */
  | { type: 'play'; cardId: number }
  /** 无牌可接时过牌（连续两次即一轮结束） */
  | { type: 'pass' }
  /** 求一次提示：把推荐牌记到 hintCardId 上（不影响牌局，不占悔牌次数） */
  | { type: 'hint' }
  /** 悔牌：回退到上一个动作之前 */
  | { type: 'undo' }

// ---------------- 查询 ----------------

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

/** 本轮锁定花色：等于末牌花色（王不建立基准，所以末牌永远不是王） */
export function roundSuit(state: State): Suit | null {
  const top = state.tableTop
  if (top === null || top.suit === 'J') return null
  return top.suit
}

/** 由 state 与行动方推导出牌判定上下文 */
export function ctxOf(state: State, who: Player): PlayCtx {
  const leadSuit = state.leadSuit
  return {
    top: state.tableTop,
    leadSuit,
    hasLeadSuit: leadSuit !== null && handOf(state, who).some((c) => c.suit === leadSuit),
  }
}

// ---------------- 规则判定 ----------------

/** 同花色且点数恰好 +1（只能往大接）。王不参与相邻判定，它在 canPlay 里单独处理 */
export function canFollow(card: Card, top: Card): boolean {
  if (isJoker(card) || isJoker(top)) return false
  return card.suit === top.suit && card.rank === top.rank + 1
}

/**
 * 出牌判定（本游戏唯一的规则入口，渲染 / AI / 提示 / 测试全部复用它）：
 *   · 万能牌：任何时候都能出，且不改变末牌；
 *   · 本轮还没有末牌（起手）：不限制时任选；有指定花色时必须出该花色；
 *     行动方手上没有该花色时限制自动解除（避免死局）；
 *   · 已有末牌（接龙）：必须同花色且点数 +1。末牌是 K 时自然无人能接。
 */
export function canPlay(card: Card, ctx: PlayCtx): boolean {
  if (isJoker(card)) return true
  if (ctx.top === null) {
    if (ctx.leadSuit === null || !ctx.hasLeadSuit) return true
    return card.suit === ctx.leadSuit
  }
  return canFollow(card, ctx.top)
}

/** 某一方当前能接上的手牌（保持手牌原有顺序 = 花色分组、组内递增） */
export function playableCards(state: State, who: Player = state.turn): Card[] {
  const ctx = ctxOf(state, who)
  return handOf(state, who).filter((c) => canPlay(c, ctx))
}

/** 某一方所有「出牌」动作 */
export function playCandidates(state: State, who: Player = state.turn): Action[] {
  return playableCards(state, who).map((c) => ({ type: 'play' as const, cardId: c.id }))
}

/**
 * 当前回合全部合法的「牌局动作」：
 * 有可接的牌时只给「出牌」（必须完整接龙），一张都接不上时才给「过」。
 * hint / undo 属于界面动作，不参与合法性枚举。
 */
export function legalActions(state: State): Action[] {
  if (state.over) return []
  const plays = playCandidates(state)
  return plays.length > 0 ? plays : [{ type: 'pass' }]
}

/** 两个动作是否等价（测试里断言 AI / 提示动作合法时使用） */
export function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'play' && b.type === 'play') return a.cardId === b.cardId
  return true
}

export function isLegal(state: State, action: Action): boolean {
  return legalActions(state).some((a) => sameAction(a, action))
}

// ---------------- 开局与牌堆 ----------------

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
    lastSide: PLAYER,
    leadSuit: null,
    turn: PLAYER,
    moves: 0,
    passes: 0,
    chainPlays: 0,
    passStreak: 0,
    rounds: 0,
    recycles: 0,
    undoLeft: UNDO_LIMIT,
    undo: [],
    hintCardId: null,
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
  for (const who of [PLAYER, AI] as const) {
    if (deck.length === 0) break
    hands[who - 1] = hands[who - 1].concat(deck[0])
    deck = deck.slice(1)
  }
  return {
    ...state,
    deck,
    hands: [sortCards(hands[0]), sortCards(hands[1])],
    recycles: state.recycles + 1,
  }
}

// ---------------- 悔牌栈 ----------------

function frameOf(state: State): BoardState {
  return {
    hands: state.hands,
    deck: state.deck,
    pile: state.pile,
    tableTop: state.tableTop,
    lastPlayed: state.lastPlayed,
    lastSide: state.lastSide,
    leadSuit: state.leadSuit,
    turn: state.turn,
    moves: state.moves,
    passes: state.passes,
    chainPlays: state.chainPlays,
    passStreak: state.passStreak,
    rounds: state.rounds,
    recycles: state.recycles,
    rng: state.rng,
  }
}

/**
 * 压入一帧悔牌快照，栈深上限 UNDO_LIMIT（超出的最旧帧直接丢弃）。
 * 数组本身从不原地修改，因此帧里的引用是稳定快照。
 */
function withUndo(state: State): State {
  const undo = state.undo.concat(frameOf(state))
  return { ...state, undo: undo.length > UNDO_LIMIT ? undo.slice(undo.length - UNDO_LIMIT) : undo }
}

// ---------------- 动作 ----------------

/**
 * 一轮结束：由规则推导下一轮的起手花色与起手方。
 *   指定花色 = 本轮最后一张**非王**牌的花色（打出的是王就退回末牌花色，
 *   末牌也为空则本轮全是王 → 不限制）；
 *   起手方   = 最近出牌者 lastSide。
 */
function endRound(state: State): State {
  const last = state.lastPlayed
  const suit: Suit | null = last !== null && last.suit !== 'J' ? last.suit : roundSuit(state)
  return {
    ...state,
    leadSuit: suit,
    turn: state.lastSide,
    tableTop: null,
    chainPlays: 0,
    passStreak: 0,
    rounds: state.rounds + 1,
  }
}

/** 出牌：校验合法性 → 移出手牌 → 压入弃牌堆 → 更新末牌 → 切换回合或判胜 */
function applyPlay(state: State, cardId: number): State {
  const who = state.turn
  const hand = handOf(state, who)
  const card = hand.find((c) => c.id === cardId)
  if (card === undefined) return state
  if (!canPlay(card, ctxOf(state, who))) return state

  const marked = withUndo(state)
  const hands: [Card[], Card[]] = [marked.hands[0].slice(), marked.hands[1].slice()]
  hands[who - 1] = sortCards(hand.filter((c) => c.id !== cardId))
  const won = hands[who - 1].length === 0
  return {
    ...marked,
    hands,
    pile: marked.pile.concat(card),
    // 万能牌打出后不改变接龙基准
    tableTop: isJoker(card) ? marked.tableTop : card,
    lastPlayed: card,
    lastSide: who,
    moves: marked.moves + 1,
    chainPlays: marked.chainPlays + 1,
    passStreak: 0,
    hintCardId: null,
    turn: other(who),
    over: won,
    winner: won ? who : 0,
  }
}

/**
 * 过牌：只有「确实一张都接不上」时才合法（必须完整接龙）；连续两次过牌即一轮结束。
 * 一轮结束时才做洗回补牌：本游戏里「接手方也接不上」必然导致一轮结束，
 * 所以死局由「结束一轮 + 指定新花色起手」自然解决，不需要在过牌途中插一手补牌
 * （那会把上一张刚打出的牌立刻发回手里，等于撤销自己的出牌）。
 */
function applyPass(state: State): State {
  if (playableCards(state, state.turn).length > 0) return state

  const marked = withUndo(state)
  const passStreak = marked.passStreak + 1
  const base: State = {
    ...marked,
    passes: marked.passes + 1,
    passStreak,
    turn: other(marked.turn),
    hintCardId: null,
  }
  // 兜底：反复过牌也无法推进 → 判平局，绝不让对局卡死
  if (base.passes >= STALL_LIMIT) return { ...base, over: true, winner: 0 }
  // 一轮结束：双方都接不上。牌堆为空时把弃牌堆洗回，双方各补 1 张再开新一轮
  if (passStreak >= 2) return dealEach(refillStock(endRound(base)))
  return base
}

/** 悔牌：次数用完或栈已空则原样返回（非法动作引用相等） */
function applyUndo(state: State): State {
  if (state.undoLeft <= 0 || state.undo.length === 0) return state
  const frame = state.undo[state.undo.length - 1]
  return {
    ...frame,
    undoLeft: state.undoLeft - 1,
    undo: state.undo.slice(0, -1),
    hintCardId: null,
    over: false,
    winner: 0,
  }
}

/** 提示：只改 hintCardId，不动牌局、不占悔牌次数 */
function applyHint(state: State): State {
  const h = hintAction(state)
  const cardId = h !== null && h.type === 'play' ? h.cardId : null
  if (cardId === state.hintCardId) return state
  return { ...state, hintCardId: cardId }
}

/** 纯函数状态迁移：非法动作原样返回（同一引用），绝不修改入参 */
export function reduce(state: State, action: Action): State {
  if (state.over) return state
  if (action.type === 'undo') return applyUndo(state)
  if (action.type === 'hint') return applyHint(state)
  if (action.type === 'pass') return applyPass(state)
  return applyPlay(state, action.cardId)
}

/** 出牌的直观别名，便于测试与 AI 复用同一入口 */
export function play(state: State, cardId: number): State {
  return reduce(state, { type: 'play', cardId })
}

/** 过牌的直观别名 */
export function pass(state: State): State {
  return reduce(state, { type: 'pass' })
}

/** 悔牌的直观别名 */
export function undo(state: State): State {
  return reduce(state, { type: 'undo' })
}

// ---------------- AI 与提示（共用同一份候选枚举与评分） ----------------

const WIN = 1_000_000 // 这一手直接打完
const LOSE = -500_000 // 打成平局最差
const PASS_SCORE = -900_000 // 有牌可出还过牌（兜底，正常不会走到）
const LOCK = 6_000 // 让对手彻底接不上，拿到本轮主导权
const JOKER_KEEP = 420 // 万能牌尽量留到最后
const FOLLOW_LOW = 26 // 接龙时出小牌，把大牌留到最后
const LEAD_CHAIN = 40 // 起手时能连出越长越好
const LEAD_LOW = 6 // 起手时偏好小牌（A 起的链最长）
const DEAD_END = 180 // 打出后顶到 K，链必然断

/** 从 fromRank+1 起，某花色在 hand 中能连续往上接的长度（纯计算，用来评价起手收益） */
function chainRun(hand: readonly Card[], suit: Suit, fromRank: number): number {
  const ranks = new Set(hand.filter((c) => c.suit === suit).map((c) => c.rank))
  let n = 0
  for (let r = fromRank + 1; r <= 13; r++) {
    if (!ranks.has(r)) break
    n++
  }
  return n
}

/**
 * 对候选动作的评分：只依赖 state 与 reduce 的试算结果，不含任何额外规则逻辑。
 * 与 AI 共用，提示也因此不会给出另一套规则下的建议。
 */
function scoreMove(state: State, action: Action): number {
  if (action.type === 'pass') return PASS_SCORE
  // 候选只可能来自 legalActions（出牌 / 过牌），其余界面动作不参与评分
  if (action.type !== 'play') return -1
  const next = reduce(state, action)
  if (next === state) return -1
  if (next.over) return next.winner === AI ? WIN : LOSE

  const hand = handOf(state, AI)
  const card = hand.find((c) => c.id === action.cardId)
  if (card === undefined) return -1
  const suit: Suit | null = card.suit === 'J' ? null : card.suit

  let s = 0
  // 让对手接不上 → 本轮的主导权回到自己手上
  if (playableCards(next, PLAYER).length === 0) s += LOCK

  if (suit === null) {
    // 万能牌：留到最后；手上只剩这一张且牌不多时甩掉最划算
    s -= JOKER_KEEP
    const jokers = hand.filter((c) => c.suit === 'J').length
    if (jokers === 1 && hand.length <= 2) s += 3 * JOKER_KEEP
  } else if (state.tableTop === null) {
    // 起手：选能往上连出最多的那一档，小牌起点链最长
    const rest = hand.filter((c) => c.id !== card.id)
    s += chainRun(rest, suit, card.rank) * LEAD_CHAIN - card.rank * LEAD_LOW
  } else {
    // 接龙：出小牌保留大牌，顶到 K 是死路
    s -= card.rank * FOLLOW_LOW
    if (card.rank === 13) s -= DEAD_END
  }
  // 同分时按 cardId 升序，保证完全可复盘
  return s - card.id * 1e-6
}

/** 在合法动作里挑评分最高的一个（AI 与提示共用的唯一出口） */
function bestOf(state: State): Action | null {
  const cands = legalActions(state)
  if (cands.length === 0) return null
  let best = cands[0]
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

/**
 * AI：与规则共享同一个 reduce —— 候选全部来自 legalActions，逐个喂给 reduce 试算并评分，
 * 绝不维护第二套规则逻辑。
 */
export function aiAction(state: State): Action | null {
  if (state.over || state.turn !== AI) return null
  return bestOf(state)
}

/** 提示：与 AI 共用同一份候选枚举与评分，返回的动作一定落在 legalActions 内 */
export function hintAction(state: State): Action | null {
  if (state.over) return null
  return bestOf(state)
}