/**
 * 纸牌接龙（Klondike）规则（纯逻辑，零 DOM 依赖，可在 node 环境直接单测）。
 *
 * ## 这是合集里第一款「没有对手」的游戏
 *
 * 其余 43 款要么是 AI 对战、要么是计时挑战。这一款是**纯单人**：
 * 输赢只取决于你能不能把 52 张牌按规矩理到四个基础堆上。
 *
 * ## 牌的表示
 *
 * 复用共享层的 `core/cards.ts` 的 `Card`（id / suit / rank），
 * 牌面绘制直接用 `render/cards.ts`——小程序端也就自动有了。
 *
 * 「正着还是扣着」不进 `Card` 里，而是用**两个数组**表示：
 * - `down`：扣着的牌（永远是这一堆的前缀）
 * - `up`：摊开的牌
 *
 * 为什么不用 `Card.faceUp` 布尔字段：那样每张牌都要多带一个标记，
 * 而「扣着的牌总在下面」这个性质用两个数组表达得更直接——
 * 翻牌只是 `down.pop()` 然后 `up.push()`，没有第三种状态要维护。
 *
 * ## 时间不进 state
 * 本游戏没有计时需求，规则层没有任何时间源。
 */
import { isRed, makeDeck, type Card } from '../../core/cards'
import { Rng } from '../../core/rng'

// ==================================================================
// 牌堆布局
// ==================================================================

export const TABLEAU_COUNT = 7
export const FOUNDATION_COUNT = 4
/** 牌堆（扣着的那一摞） */
export const PILE_STOCK = TABLEAU_COUNT
/** 弃牌堆（摊开的） */
export const PILE_WASTE = TABLEAU_COUNT + 1
/** 基础堆起点：0..3 对应 ♠♥♦♣ */
export const PILE_FOUNDATION_BASE = TABLEAU_COUNT + 2
export const PILE_COUNT = PILE_FOUNDATION_BASE + FOUNDATION_COUNT

export interface Pile {
  /** 扣着的牌（永远是前缀） */
  down: Card[]
  /** 摊开的牌 */
  up: Card[]
}

export type Phase = 'play' | 'won' | 'over'

export interface Selection {
  /** 0..6 = 桌面堆，7 = 牌堆，8 = 弃牌堆，9..12 = 基础堆 */
  pile: number
  /** 该堆 `up` 里的下标 */
  index: number
}

export interface State {
  piles: Pile[]
  /** 当前选中的牌 */
  selected: Selection | null
  /** 选中的牌可以落到哪些堆（渲染时高亮） */
  targets: number[]
  /** 已走步数 */
  moves: number
  /** 弃牌堆翻回牌堆的次数 */
  redeals: number
  phase: Phase
  rng: number
}

export type Action =
  /** 点一下：先看是不是落点，是就移动；不是就选中这张牌 */
  | { type: 'tap'; pile: number; index: number }
  /** 从牌堆翻一张到弃牌堆（牌堆空了就把弃牌堆翻回去） */
  | { type: 'draw' }
  /** 自动把能上基础堆的牌送上去 */
  | { type: 'auto' }
  /** 放弃本局 */
  | { type: 'giveUp' }
  /** 重新发一副牌 */
  | { type: 'newGame' }

// ==================================================================
// 基础判定
// ==================================================================

/** 牌能不能叠在 target 上面：点数大 1 且花色异色 */
export function canStackOn(card: Card, target: Card): boolean {
  return target.rank === card.rank + 1 && isRed(card) !== isRed(target)
}

/** 一摞摊开的牌是不是合法的「异色递减」连牌 */
export function isValidRun(cards: readonly Card[]): boolean {
  for (let i = 0; i + 1 < cards.length; i++) {
    if (!canStackOn(cards[i + 1], cards[i])) return false
  }
  return true
}

/** 基础堆能不能接这张牌 */
export function canPlaceOnFoundation(card: Card, foundation: readonly Card[]): boolean {
  if (foundation.length === 0) return card.rank === 1
  const top = foundation[foundation.length - 1]
  return card.suit === top.suit && card.rank === top.rank + 1
}

/**
 * 一组牌能不能放到第 `to` 堆。
 *
 * `to` 只能是桌面堆或基础堆——牌堆和弃牌堆不是落点。
 */
export function canPlace(state: State, moving: readonly Card[], to: number): boolean {
  if (moving.length === 0) return false
  if (to < 0 || to >= PILE_COUNT) return false
  if (to === PILE_STOCK || to === PILE_WASTE) return false
  const dst = state.piles[to]
  if (to >= PILE_FOUNDATION_BASE) {
    // 基础堆一次只能接一张
    if (moving.length !== 1) return false
    return canPlaceOnFoundation(moving[0], dst.up)
  }
  // 桌面堆：空堆只收 K；否则叠在顶牌上
  if (dst.up.length === 0) return moving[0].rank === 13
  return canStackOn(moving[0], dst.up[dst.up.length - 1])
}

/** 这一堆顶上的那张（桌面堆看最上面一张，基础堆看最上面一张） */
export function topCard(pile: Pile): Card | null {
  if (pile.up.length > 0) return pile.up[pile.up.length - 1]
  return null
}

/** 摸牌时用：牌堆里最上面那张（`down` 的最后一个） */
export function stockTop(pile: Pile): Card | null {
  if (pile.down.length === 0) return null
  return pile.down[pile.down.length - 1]
}

/** 基础堆上已经放了多少张牌 */
export function foundationCount(state: State): number {
  let n = 0
  for (let f = PILE_FOUNDATION_BASE; f < PILE_COUNT; f++) n += state.piles[f].up.length
  return n
}

/** 全部 52 张都上了基础堆 = 通关 */
export function isWon(state: State): boolean {
  return foundationCount(state) === 52
}

// ==================================================================
// 抓牌
// ==================================================================

/**
 * 能不能抓第 `pile` 堆的第 `index` 张。
 *
 * 桌面堆可以抓任意一张**摊开**的牌（连同它下面的牌一起）；
 * 弃牌堆与基础堆只能抓最上面一张；牌堆不能抓（点它等于翻牌）。
 */
export function canGrab(state: State, pile: number, index: number): boolean {
  if (pile < 0 || pile >= PILE_COUNT) return false
  if (pile === PILE_STOCK) return false
  const p = state.piles[pile]
  if (pile === PILE_WASTE) return index === 0 && p.up.length > 0
  if (pile >= PILE_FOUNDATION_BASE) return index === 0 && p.up.length > 0
  if (index < 0 || index >= p.up.length) return false
  return isValidRun(p.up.slice(index))
}

/** 抓起来的那一组牌 */
export function grabbedCards(state: State, sel: Selection): Card[] {
  const p = state.piles[sel.pile]
  if (sel.pile < TABLEAU_COUNT) return p.up.slice(sel.index)
  if (sel.pile === PILE_WASTE) return p.up.slice(0, 1)
  return p.up.slice(p.up.length - 1)
}

/** 选中的牌可以落到哪些堆 */
export function legalTargets(state: State, sel: Selection): number[] {
  const moving = grabbedCards(state, sel)
  const out: number[] = []
  for (let p = 0; p < PILE_COUNT; p++) {
    if (p === PILE_STOCK || p === PILE_WASTE) continue
    if (canPlace(state, moving, p)) out.push(p)
  }
  return out
}

// ==================================================================
// 初始化
// ==================================================================

export function create(seed: number): State {
  const r = new Rng(seed)
  const deck = r.shuffle(makeDeck())
  const piles: Pile[] = []
  let cursor = 0
  // 桌面堆：第 i 堆发 i+1 张，最后一张摊开
  for (let i = 0; i < TABLEAU_COUNT; i++) {
    const down = deck.slice(cursor, cursor + i)
    const top = deck[cursor + i]
    cursor += i + 1
    piles.push({ down, up: [top] })
  }
  // 剩下的进牌堆
  piles.push({ down: deck.slice(cursor), up: [] })
  // 弃牌堆
  piles.push({ down: [], up: [] })
  // 四个基础堆
  for (let f = 0; f < FOUNDATION_COUNT; f++) piles.push({ down: [], up: [] })
  return {
    piles,
    selected: null,
    targets: [],
    moves: 0,
    redeals: 0,
    phase: 'play',
    rng: r.s,
  }
}

// ==================================================================
// 状态迁移
// ==================================================================

/** 把选中的那组牌搬到 `to` 堆 */
function performMove(state: State, sel: Selection, to: number): State {
  const src = state.piles[sel.pile]
  const dst = state.piles[to]
  const moving = grabbedCards(state, sel)

  let newSrc: Pile
  if (sel.pile < TABLEAU_COUNT) {
    const up = src.up.slice(0, sel.index)
    const down = src.down.slice()
    // 搬走之后露出底下的牌 → 把它翻上来
    if (up.length === 0 && down.length > 0) up.push(down.pop() as Card)
    newSrc = { down, up }
  } else if (sel.pile === PILE_WASTE) {
    newSrc = { down: [], up: src.up.slice(1) }
  } else {
    newSrc = { down: [], up: src.up.slice(0, -1) }
  }

  const newDst: Pile =
    to < TABLEAU_COUNT
      ? { down: dst.down, up: dst.up.concat(moving) }
      : { down: [], up: dst.up.concat(moving) }

  const piles = state.piles.slice()
  piles[sel.pile] = newSrc
  piles[to] = newDst

  const next: State = { ...state, piles, moves: state.moves + 1, selected: null, targets: [] }
  if (isWon(next)) return { ...next, phase: 'won' }
  return next
}

/** 找一个能接住这张牌的基础堆；找不到返回 -1 */
function findFoundation(state: State, card: Card): number {
  for (let f = PILE_FOUNDATION_BASE; f < PILE_COUNT; f++) {
    if (canPlaceOnFoundation(card, state.piles[f].up)) return f
  }
  return -1
}

/** 找一张「能安全上基础堆」的牌：弃牌堆顶优先，其次各桌面堆顶 */
function findAutoMove(state: State): { sel: Selection; to: number } | null {
  const waste = state.piles[PILE_WASTE]
  if (waste.up.length > 0) {
    const card = waste.up[0]
    const f = findFoundation(state, card)
    if (f >= 0) return { sel: { pile: PILE_WASTE, index: 0 }, to: f }
  }
  for (let p = 0; p < TABLEAU_COUNT; p++) {
    const pile = state.piles[p]
    if (pile.up.length === 0) continue
    const card = pile.up[pile.up.length - 1]
    const f = findFoundation(state, card)
    if (f >= 0) return { sel: { pile: p, index: pile.up.length - 1 }, to: f }
  }
  return null
}

/** 纯函数状态迁移 */
export function reduce(state: State, action: Action): State {
  if (state.phase !== 'play' && action.type !== 'giveUp' && action.type !== 'newGame') return state

  switch (action.type) {
    case 'tap': {
      // 已经选过牌 → 这一下如果是合法落点就移动
      if (state.selected && state.targets.indexOf(action.pile) >= 0) {
        return performMove(state, state.selected, action.pile)
      }
      // 再点一下同一张 → 取消选择
      if (state.selected && state.selected.pile === action.pile && state.selected.index === action.index) {
        return { ...state, selected: null, targets: [] }
      }
      // 点牌堆 = 翻牌
      if (action.pile === PILE_STOCK) {
        return reduce(state, { type: 'draw' })
      }
      if (!canGrab(state, action.pile, action.index)) {
        return { ...state, selected: null, targets: [] }
      }
      const sel: Selection = { pile: action.pile, index: action.index }
      return { ...state, selected: sel, targets: legalTargets(state, sel) }
    }

    case 'draw': {
      const stock = state.piles[PILE_STOCK]
      const waste = state.piles[PILE_WASTE]
      const piles = state.piles.slice()
      if (stock.down.length > 0) {
        const card = stock.down[stock.down.length - 1]
        piles[PILE_STOCK] = { down: stock.down.slice(0, -1), up: [] }
        piles[PILE_WASTE] = { down: [], up: [card].concat(waste.up) }
        return { ...state, piles, moves: state.moves + 1, selected: null, targets: [] }
      }
      // 牌堆空了 → 把弃牌堆翻回去当新牌堆（次数不限）
      if (waste.up.length > 0) {
        piles[PILE_STOCK] = { down: waste.up.slice().reverse(), up: [] }
        piles[PILE_WASTE] = { down: [], up: [] }
        return { ...state, piles, redeals: state.redeals + 1, selected: null, targets: [] }
      }
      return state
    }

    case 'auto': {
      const m = findAutoMove(state)
      if (!m) return state
      return performMove(state, m.sel, m.to)
    }

    case 'giveUp': {
      if (state.phase !== 'play') return state
      return { ...state, phase: 'over', selected: null, targets: [] }
    }

    case 'newGame': {
      // 重新发牌：种子从当前 rng 状态推进，所以「一直点重新开始」也不会重复同一副牌
      const r = new Rng(state.rng)
      const seed = r.int(0x7fffffff)
      return { ...create(seed), rng: r.s }
    }
  }
}

// ==================================================================
// 便捷别名
// ==================================================================

export function tap(state: State, pile: number, index: number): State {
  return reduce(state, { type: 'tap', pile, index })
}

export function draw(state: State): State {
  return reduce(state, { type: 'draw' })
}

export function auto(state: State): State {
  return reduce(state, { type: 'auto' })
}

export function giveUp(state: State): State {
  return reduce(state, { type: 'giveUp' })
}
