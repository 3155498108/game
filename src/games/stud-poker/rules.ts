/**
 * 梭哈（五张牌比牌型）纯规则层。
 *
 * 约定：
 * - 不引用 DOM、不读 Date / performance、不用 Math.random；唯一随机来源是 state.rng 经 Rng 驱动。
 * - reduce 为纯函数：不修改入参，所有状态都是新对象。
 * - 所有牌都是亮牌（公开梭哈），因此电脑能看见玩家的手牌，这是 AI 强度的来源。
 */
import type { Card } from '../../core/cards'
import { rankLabel, shuffledDeck } from '../../core/cards'
import { Rng, hashSeed } from '../../core/rng'

/** 每手固定 5 张 */
export const HAND_SIZE = 5
/** 换牌次数上限，防止无限换 */
export const MAX_REDRAWS = 2
/** 弃 3 张时不是换 3 张，而是丢掉整手换全新 5 张 */
export const MAX_DISCARD = 3

export type Phase = 'player' | 'ai' | 'done'
export type Result = 'win' | 'lose' | 'push'

/** 牌型档位，从低到高 */
export type HandKind =
  | 'high'
  | 'pair'
  | 'twoPair'
  | 'trips'
  | 'straight'
  | 'flush'
  | 'fullHouse'
  | 'quads'
  | 'straightFlush'

export const KIND_ORDER: readonly HandKind[] = [
  'high',
  'pair',
  'twoPair',
  'trips',
  'straight',
  'flush',
  'fullHouse',
  'quads',
  'straightFlush',
]

export const KIND_LABEL: Record<HandKind, string> = {
  high: '散牌',
  pair: '一对',
  twoPair: '两对',
  trips: '三条',
  straight: '顺子',
  flush: '同花',
  fullHouse: '葫芦',
  quads: '四条',
  straightFlush: '同花顺',
}

export interface HandValue {
  kind: HandKind
  /**
   * 同档内比较用：从最重要到最次要的点数，**A 一律记作 14**（轮子顺 A2345 单独处理）。
   *
   * 这一条是整份判定的地基：`Card.rank` 里 A 存的是 1，若直接拿它排序，
   * 「一对 9 带 A」会输给「一对 9 带 K」，「三条 2 带 A 对」也会输给「三条 2 带 3」——
   * 全都反了。所以比较一律走 `cmpRank`，原始 rank 只用于把牌归组。
   * 列表里**不重复**同一点数（葫芦是 `[三条点数, 对子点数]`，不是 `[9,9,9,2,2]`），
   * 因为重复位不携带任何额外信息。
   */
  ranks: number[]
}

// ---------------------------------------------------------------- 牌型判定

/** 比较用的点数：A(1) 按 14 参与一切大小比较 */
function cmpRank(rank: number): number {
  return rank === 1 ? 14 : rank
}

/** rank 为 1..13（A=1）。以 top 为最高牌的 5 连窗口能否覆盖该点数；A 可当 1 或 14 */
function inWindow(rank: number, top: number): boolean {
  if (rank === 1) return top === 5 || top === 14
  return rank >= top - 4 && rank <= top
}

/**
 * 顺子判定：输入是**已按 cmpRank 降序、已去重**的点数，返回顺子最大牌（不能则 0）。
 *
 * 只有两种折法：A2345（轮子，记 5 高）与 10JQKA（记 A 高）。
 * 直接在 rank 原值上判「首尾相差 4」会漏掉 A 高顺——[1,10,11,12,13] 首尾差 12。
 */
function straightTop(desc: readonly number[]): number {
  const set = new Set(desc)
  if (set.size !== 5) return 0
  // 轮子 A2345：A 记作 14，要先单独认出来，否则 min=2 max=14 直接被否掉
  if (set.has(14) && set.has(2) && set.has(3) && set.has(4) && set.has(5)) return 5
  const hi = Math.max(...set)
  const lo = Math.min(...set)
  return hi - lo === 4 ? hi : 0
}

/**
 * 判定五张牌的牌型。
 * 评分口径：同花顺 > 四条 > 葫芦 > 同花 > 顺子 > 三条 > 两对 > 一对 > 散牌。
 */
export function evaluateHand(cards: readonly Card[]): HandValue {
  if (cards.length !== HAND_SIZE) throw new Error(`手牌必须是 ${HAND_SIZE} 张`)
  // 比较用点数（A 记作 14）降序；`desc` 是所有「踢脚 / 高牌」的唯一来源
  const desc = cards.map((c) => cmpRank(c.rank)).slice().sort((x, y) => y - x)
  // 归组仍用原始 rank（同点数的牌归成一组）
  const counts = new Map<number, number>()
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1)
  // 先按张数降序、再按点数降序排列各组
  const groups = Array.from(counts.entries()).sort((x, y) => y[1] - x[1] || cmpRank(y[0]) - cmpRank(x[0]))
  const isFlush = cards.every((c) => c.suit === cards[0].suit)
  const top = straightTop(Array.from(new Set(desc)))

  if (isFlush && top > 0) return { kind: 'straightFlush', ranks: [top] }
  const quads = groups[0]
  if (quads[1] === 4) {
    const kicker = desc.find((r) => r !== cmpRank(quads[0]))
    if (kicker !== undefined) return { kind: 'quads', ranks: [cmpRank(quads[0]), kicker] }
  }
  const triple = groups[0][1] === 3 ? groups[0] : null
  const double = triple && groups[1] && groups[1][1] === 2 ? groups[1] : null
  if (triple && double) return { kind: 'fullHouse', ranks: [cmpRank(triple[0]), cmpRank(double[0])] }
  if (isFlush) return { kind: 'flush', ranks: desc }
  if (top > 0) return { kind: 'straight', ranks: [top] }
  if (triple) {
    const t = cmpRank(triple[0])
    return { kind: 'trips', ranks: [t, ...desc.filter((r) => r !== t)] }
  }
  const pairs = groups
    .filter((g) => g[1] === 2)
    .map((g) => cmpRank(g[0]))
    .sort((x, y) => y - x)
  if (pairs.length === 2) {
    const kicker = desc.find((r) => r !== pairs[0] && r !== pairs[1])
    if (kicker !== undefined) return { kind: 'twoPair', ranks: [pairs[0], pairs[1], kicker] }
  }
  if (pairs.length === 1) {
    return { kind: 'pair', ranks: [pairs[0], ...desc.filter((r) => r !== pairs[0])] }
  }
  return { kind: 'high', ranks: desc }
}

/** 比较两手牌：1 = a 大，-1 = b 大，0 = 完全同点（平局） */
export function compareHands(a: HandValue, b: HandValue): number {
  const ka = KIND_ORDER.indexOf(a.kind)
  const kb = KIND_ORDER.indexOf(b.kind)
  if (ka !== kb) return ka > kb ? 1 : -1
  const n = Math.max(a.ranks.length, b.ranks.length)
  for (let i = 0; i < n; i++) {
    const x = a.ranks[i] ?? 0
    const y = b.ranks[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/** 中文牌型描述，用于 UI */
export function handLabel(h: HandValue): string {
  const r = h.ranks.map((x) => rankLabel(x))
  switch (h.kind) {
    case 'straightFlush':
      return `同花顺 ${r[0]} 高`
    case 'quads':
      return `四条 ${r[0]} 带 ${r[1]}`
    case 'fullHouse':
      return `葫芦 ${r[0]} 带 ${r[1]}`
    case 'flush':
      return `同花 ${r[0]} 高`
    case 'straight':
      return `顺子 ${r[0]} 高`
    case 'trips':
      return `三条 ${r[0]} 带 ${r[1]}、${r[2]}`
    case 'twoPair':
      return `两对 ${r[0]}/${r[1]} 带 ${r[2]}`
    case 'pair':
      return `一对 ${r[0]} 带 ${r[1]}、${r[2]}、${r[3]}`
    default:
      return `散牌 ${r[0]} 高`
  }
}

/** 牌力归一化到 0..1，供 AI 比较双方强弱 */
/**
 * 给 AI 用的手牌强弱标量（0..1，越大越强）。
 *
 * 权重不是随便定的：牌型一档的间隔必须**大于**踢脚项的整个跨度，
 * 否则 strength 会和 `compareHands` 打架——原实现 base*0.72 + kicker*0.28 时，
 * 牌型间隔只有 0.09、踢脚跨度却有 0.28，于是「J 高散牌」算出来比「7 一对」还强，
 * AI 就会去换掉明明更强的一对牌。
 *
 * 现在 base*0.9（间隔 0.1125）> kicker*0.1（跨度 0.1），保证：
 * **compareHands(a, b) > 0 ⟺ strength(a) > strength(b)**，对任意手牌都成立。
 */
export function strength(h: HandValue): number {
  const base = KIND_ORDER.indexOf(h.kind) / (KIND_ORDER.length - 1)
  // ranks 里 A 记作 14，所以区间是 2..14，刻度取 (r-2)/12 才是 0..1
  const kicker = (h.ranks[0] - 2) / 12
  return base * 0.9 + kicker * 0.1
}

// ---------------------------------------------------------------- AI

/** AI 的一批换牌指令：picks 为具体手牌下标，lowest 为「换掉当前最小的 n 张」 */
export interface AiBatch {
  picks?: number[]
  lowest?: number
}

export interface AiPlan {
  /** 是否弃牌 */
  fold: boolean
  /** 最多 MAX_REDRAWS 批换牌 */
  batches: AiBatch[]
}

/**
 * 散牌时：弃掉哪一张后剩下四张还能用一张新牌凑成顺子（返回点数最低的可弃下标，无解为 -1）
 *
 * 这里用的是 `Card.rank` 原值（A=1），所以 A 必须单独处理：它只在轮子 A2345
 * 与 A 高顺 10JQKA 两种折法里算数，其余窗口都不收。
 */
function bestStraightDiscard(cards: readonly Card[]): number {
  let best = -1
  for (let i = 0; i < cards.length; i++) {
    const keep = cards.filter((_, j) => j !== i).map((c) => c.rank)
    let ok = false
    for (let top = 5; top <= 14 && !ok; top++) ok = keep.every((r) => inWindow(r, top))
    if (!ok) continue
    if (best < 0 || cards[i].rank < cards[best].rank) best = i
  }
  return best
}

/** 散牌时：弃掉哪一张能让剩下四张同花色（同理返回点数最低的可弃下标） */
function bestFlushDiscard(cards: readonly Card[]): number {
  const bySuit = new Map<string, number[]>()
  cards.forEach((c, i) => {
    const arr = bySuit.get(c.suit) ?? []
    arr.push(i)
    bySuit.set(c.suit, arr)
  })
  let best = -1
  bySuit.forEach((idxs) => {
    if (idxs.length < 4) return
    const rest = cards.map((c, i) => ({ c, i })).filter((x) => !idxs.includes(x.i))
    const lowest = rest.slice().sort((x, y) => x.c.rank - y.c.rank)[0]
    if (lowest && (best < 0 || lowest.c.rank < cards[best].rank)) best = lowest.i
  })
  return best
}

/** 电脑想换掉哪些牌（返回手牌下标，升序）。已经是顺子及以上就一张都不换 */
export function aiDiscards(cards: readonly Card[]): number[] {
  if (cards.length !== HAND_SIZE) return []
  const v = evaluateHand(cards)
  const kIdx = KIND_ORDER.indexOf(v.kind)
  // 同花、顺子、同花顺：留着不动
  if (kIdx >= KIND_ORDER.indexOf('flush')) return []
  const indexed = cards.map((c, i) => ({ c, i }))
  if (v.kind === 'trips') {
    // 留下三条，换掉两张单牌博葫芦 / 四条
    const tripRank = v.ranks[0]
    return indexed.filter((x) => x.c.rank !== tripRank).map((x) => x.i)
  }
  if (v.kind === 'twoPair') {
    // 只换掉落单的那张
    const inPair = new Set([v.ranks[0], v.ranks[1]])
    return indexed.filter((x) => !inPair.has(x.c.rank)).map((x) => x.i)
  }
  if (v.kind === 'pair') {
    // 留最大的踢脚，换掉另外两张单牌
    const pairRank = v.ranks[0]
    const kickers = indexed.filter((x) => x.c.rank !== pairRank).sort((a, b) => b.c.rank - a.c.rank)
    return kickers.slice(1).map((x) => x.i)
  }
  const flush = bestFlushDiscard(cards)
  if (flush >= 0) return [flush]
  const straight = bestStraightDiscard(cards)
  if (straight >= 0) return [straight]
  // 没看出门道，换掉最小的两张
  return indexed.sort((a, b) => b.c.rank - a.c.rank).slice(2).map((x) => x.i)
}

/** 把一批指令落成具体下标；已经有对子以上就放弃「换最小牌」这批 */
export function resolveBatch(cards: readonly Card[], batch: AiBatch): number[] {
  if (batch.picks) return batch.picks.slice().sort((a, b) => a - b)
  const n = batch.lowest ?? 0
  if (n <= 0 || n > MAX_DISCARD) return []
  if (KIND_ORDER.indexOf(evaluateHand(cards).kind) >= KIND_ORDER.indexOf('pair')) return []
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.rank - b.c.rank || a.i - b.i)
    .slice(0, n)
    .map((x) => x.i)
    .sort((a, b) => a - b)
}

/**
 * 电脑的完整决策：是否弃牌 + 换牌批次。
 * 牌全是亮的，所以直接读玩家的手牌做对比；既不会必弃也不会必跟。
 */
export function aiPlan(state: State): AiPlan {
  const mine = evaluateHand(state.ai)
  const theirs = evaluateHand(state.player)
  const my = strength(mine)
  const gap = strength(theirs) - my
  const budget = Math.max(0, MAX_REDRAWS - state.aiRedrawsUsed)
  const batches: AiBatch[] = []
  const picks = aiDiscards(state.ai)
  if (picks.length > 0 && picks.length <= MAX_DISCARD && budget > 0) {
    batches.push({ picks })
    // 还有余量且这副牌不怎么样时，再给一次「换掉最小两张」的机会
    if (budget > 1 && KIND_ORDER.indexOf(mine.kind) <= KIND_ORDER.indexOf('pair')) {
      batches.push({ lowest: 2 })
    }
  }
  // 明显落后且没牌可打（或已经没换牌机会）时认输
  const fold = gap > 0.3 && (my < 0.3 || budget === 0)
  return { fold, batches }
}

// ---------------------------------------------------------------- 状态

export interface State {
  /** Rng 状态，唯一随机源 */
  rng: number
  round: number
  /** 牌堆（末尾发牌） */
  deck: Card[]
  /** 已经离开牌堆的牌（手牌 + 被换掉的牌），牌堆耗尽时洗回 */
  spent: Card[]
  player: Card[]
  ai: Card[]
  /** 玩家选中的、要换掉的手牌下标（升序） */
  selected: number[]
  redrawsUsed: number
  aiRedrawsUsed: number
  phase: Phase
  result: Result | null
  playerFolded: boolean
  aiFolded: boolean
  playerHand: HandValue | null
  aiHand: HandValue | null
  /** 累计盈亏，单位是「注」 */
  score: number
  /** 本局盈亏倍数：赢 +1、四条以上 +2、输取负、平局 0 */
  lastMult: number
  reshuffles: number
}

export type Action =
  | { type: 'toggle'; index: number }
  | { type: 'redraw' }
  | { type: 'stay' }
  | { type: 'fold' }
  | { type: 'next' }
  | { type: 'restart' }
  | { type: 'aiMove'; plan: AiPlan }

function blank(rng: number): State {
  return {
    rng,
    round: 0,
    deck: [],
    spent: [],
    player: [],
    ai: [],
    selected: [],
    redrawsUsed: 0,
    aiRedrawsUsed: 0,
    phase: 'player',
    result: null,
    playerFolded: false,
    aiFolded: false,
    playerHand: null,
    aiHand: null,
    score: 0,
    lastMult: 0,
    reshuffles: 0,
  }
}

/** 从牌堆发 count 张；牌堆不够就把已离堆的牌洗回去（spent 与 deck 始终不相交，不会出现重复牌） */
function drawCards(state: State, count: number): { cards: Card[]; next: State } {
  const r = new Rng(state.rng)
  let deck = state.deck
  let spent = state.spent
  let reshuffles = state.reshuffles
  if (deck.length < count) {
    deck = r.shuffle(deck.concat(spent))
    spent = []
    reshuffles += 1
  }
  const cards = deck.slice(deck.length - count)
  deck = deck.slice(0, deck.length - count)
  return { cards, next: { ...state, deck, spent: spent.concat(cards), rng: r.s, reshuffles } }
}

/** 开新一局：沿用累计金币，清空本局字段 */
function startRound(state: State, round: number): State {
  const a = drawCards(state, HAND_SIZE)
  const b = drawCards(a.next, HAND_SIZE)
  return {
    ...state,
    rng: b.next.rng,
    deck: b.next.deck,
    spent: b.next.spent,
    round,
    player: a.cards,
    ai: b.cards,
    selected: [],
    redrawsUsed: 0,
    aiRedrawsUsed: 0,
    phase: 'player',
    result: null,
    playerFolded: false,
    aiFolded: false,
    playerHand: null,
    aiHand: null,
    lastMult: 0,
  }
}

/** 换牌：弃 1/2 张换同数量，弃 3 张则直接换全新 5 张。被弃的牌留在 spent 里等着洗回 */
function applyRedraw(state: State, picks: readonly number[], who: 'player' | 'ai'): State {
  const idx = Array.from(new Set(picks)).filter((i) => Number.isInteger(i) && i >= 0 && i < HAND_SIZE)
  if (idx.length === 0 || idx.length > MAX_DISCARD) return state
  idx.sort((a, b) => a - b)
  if (who === 'ai') {
    if (idx.length === MAX_DISCARD) {
      const drawn = drawCards(state, HAND_SIZE)
      return { ...drawn.next, ai: drawn.cards, aiRedrawsUsed: state.aiRedrawsUsed + 1 }
    }
    const hand = state.ai.slice()
    const drawn = drawCards(state, idx.length)
    idx.forEach((slot, k) => {
      hand[slot] = drawn.cards[k]
    })
    return { ...drawn.next, ai: hand, aiRedrawsUsed: state.aiRedrawsUsed + 1 }
  }
  if (idx.length === MAX_DISCARD) {
    const drawn = drawCards(state, HAND_SIZE)
    return { ...drawn.next, player: drawn.cards }
  }
  const hand = state.player.slice()
  const drawn = drawCards(state, idx.length)
  idx.forEach((slot, k) => {
    hand[slot] = drawn.cards[k]
  })
  return { ...drawn.next, player: hand }
}

function settle(state: State, result: Result, mult: number): State {
  return { ...state, phase: 'done', result, lastMult: mult, score: state.score + mult, selected: [] }
}

/** 开牌比牌型：四条及以上通杀，赢方拿 2 倍注 */
function showdown(state: State): State {
  const playerHand = evaluateHand(state.player)
  const aiHand = evaluateHand(state.ai)
  const cmp = compareHands(playerHand, aiHand)
  if (cmp === 0) return settle({ ...state, playerHand, aiHand }, 'push', 0)
  const winner = cmp > 0 ? playerHand : aiHand
  const base = KIND_ORDER.indexOf(winner.kind) >= KIND_ORDER.indexOf('quads') ? 2 : 1
  return settle({ ...state, playerHand, aiHand }, cmp > 0 ? 'win' : 'lose', cmp > 0 ? base : -base)
}

/** 开局：种子 → 洗好的一副牌 → 直接发第一局 */
export function create(seed: number): State {
  const r = new Rng(hashSeed(seed))
  const deck = shuffledDeck(r)
  return startRound({ ...blank(r.s), deck }, 1)
}

/** 电脑回合：返回一个待执行的动作；其余阶段返回 null */
export function aiAction(state: State): Action | null {
  if (state.phase !== 'ai') return null
  return { type: 'aiMove', plan: aiPlan(state) }
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'toggle': {
      if (state.phase !== 'player' || state.redrawsUsed >= MAX_REDRAWS) return state
      const i = action.index
      if (!Number.isInteger(i) || i < 0 || i >= state.player.length) return state
      const selected = state.selected.includes(i)
        ? state.selected.filter((x) => x !== i)
        : [...state.selected, i].sort((a, b) => a - b)
      return { ...state, selected }
    }
    case 'redraw': {
      if (state.phase !== 'player' || state.redrawsUsed >= MAX_REDRAWS) return state
      const k = state.selected.length
      if (k === 0 || k > MAX_DISCARD) return state
      const next = applyRedraw(state, state.selected, 'player')
      return { ...next, selected: [], redrawsUsed: state.redrawsUsed + 1 }
    }
    case 'stay': {
      if (state.phase !== 'player') return state
      return { ...state, phase: 'ai', selected: [] }
    }
    case 'fold': {
      if (state.phase !== 'player') return state
      // 弃牌立刻结算，不再进入电脑回合
      return settle(
        { ...state, playerFolded: true, playerHand: evaluateHand(state.player), aiHand: evaluateHand(state.ai) },
        'lose',
        -1,
      )
    }
    case 'next': {
      if (state.phase !== 'done') return state
      return startRound(state, state.round + 1)
    }
    case 'restart': {
      const r = new Rng(state.rng)
      const deck = shuffledDeck(r)
      return startRound({ ...blank(r.s), deck }, 1)
    }
    case 'aiMove': {
      if (state.phase !== 'ai') return state
      const { plan } = action
      if (plan.fold) {
        return settle({ ...state, aiFolded: true, aiHand: evaluateHand(state.ai) }, 'win', 1)
      }
      let cur = state
      const budget = Math.max(0, MAX_REDRAWS - state.aiRedrawsUsed)
      for (const batch of plan.batches.slice(0, budget)) {
        const picks = resolveBatch(cur.ai, batch)
        if (picks.length === 0 || picks.length > MAX_DISCARD) continue
        cur = applyRedraw(cur, picks, 'ai')
      }
      return showdown(cur)
    }
  }
}

/** 剩余未发的牌数（给 UI 展示） */
export function remaining(state: State): number {
  return state.deck.length
}

/** 结算文案 */
export function resultLabel(r: Result): string {
  if (r === 'win') return '你赢了'
  if (r === 'lose') return '你输了'
  return '平局'
}
