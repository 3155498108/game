/**
 * 纸牌接龙 · 渲染与游戏模块装配（唯一允许接触 Canvas 的地方）
 *
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 *
 * ## 牌面绘制复用共享层
 * `render/cards.ts` 的 `drawCard` 是全站共用的（小程序端也有一份逐字节相同的），
 * 所以这里的牌面风格与其它牌类游戏完全一致，不另起一套。
 *
 * ## 命中判定
 * 桌面堆的牌是**叠着**的，所以命中要**从最上面那张往下找**，
 * 第一个盖住点击位置的牌就是被点到的那张——否则玩家点上面那张，
 * 命中的却是下面那张。
 */
import type { Control, Effect, GameModule, PointerInput } from '../../core/types'
import { COLORS, background, banner, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { drawCard } from '../../render/cards'
import { SUIT_SYMBOL, type Suit } from '../../core/cards'
import type { Rect } from '../../core/geom'
import { inRect } from '../../core/geom'
import meta from './meta'
import {
  FOUNDATION_COUNT,
  PILE_FOUNDATION_BASE,
  PILE_STOCK,
  PILE_WASTE,
  TABLEAU_COUNT,
  type Action,
  type Pile,
  type State,
  create,
  foundationCount,
  reduce,
} from './rules'

const VW = meta.viewport.width
const VH = meta.viewport.height

// ---------------- 布局常量（render 与 input 共用同一份） ----------------

export const CARD_W = 88
export const CARD_H = 123
/** 扣着的牌每张叠起来露出的高度 */
export const DOWN_DY = 16
/** 摊开的牌每张叠起来露出的高度 */
export const UP_DY = 38

/** 上排（牌堆 / 弃牌堆 / 四个基础堆）的 y */
const TOP_Y = 150
/** 牌堆 x */
const STOCK_X = 24
/** 弃牌堆 x */
const WASTE_X = 124
/** 基础堆 x（四个） */
const FOUND_X = 316
const FOUND_DX = 98
/** 桌面堆起点 */
const TAB_Y = 336
const TAB_X0 = 16
const TAB_DX = 100

/** 上排第 n 个槽位的矩形 */
export function slotRect(kind: 'stock' | 'waste' | 'foundation', n = 0): Rect {
  if (kind === 'stock') return { x: STOCK_X, y: TOP_Y, w: CARD_W, h: CARD_H }
  if (kind === 'waste') return { x: WASTE_X, y: TOP_Y, w: CARD_W, h: CARD_H }
  return { x: FOUND_X + n * FOUND_DX, y: TOP_Y, w: CARD_W, h: CARD_H }
}

/** 桌面堆第 i 堆的 x */
export function tabX(i: number): number {
  return TAB_X0 + i * TAB_DX
}

/** 桌面堆里第 index 张（摊开的）的矩形 */
export function tabRect(pile: Pile, tabIndex: number, index: number): Rect {
  const base = TAB_Y + pile.down.length * DOWN_DY
  return { x: tabX(tabIndex), y: base + index * UP_DY, w: CARD_W, h: CARD_H }
}

/**
 * 命中桌面堆：返回 `up` 里的下标，命中不到返回 -1。
 *
 * **从最上面往下找**——叠着的牌下面那张的矩形会被上面那张压住，
 * 必须先判上面那张，否则玩家点上面的牌会命中下面那张。
 */
export function tabHit(pile: Pile, tabIndex: number, p: { x: number; y: number }): number {
  const base = TAB_Y + pile.down.length * DOWN_DY
  for (let i = pile.up.length - 1; i >= 0; i--) {
    const top = base + i * UP_DY
    if (p.y >= top && p.y <= top + CARD_H && p.x >= tabX(tabIndex) && p.x <= tabX(tabIndex) + CARD_W) {
      return i
    }
  }
  return -1
}

// ==================================================================
// 绘制
// ==================================================================

/** 空槽位：一个虚框 + 提示 */
function drawSlot(ctx: CanvasRenderingContext2D, r: Rect, hint: string): void {
  fillRoundRect(ctx, r.x, r.y, r.w, r.h, 10, 'rgba(255,255,255,0.05)', withAlpha(COLORS.line, 0.8), 2)
  text(ctx, hint, r.x + r.w / 2, r.y + r.h / 2, { size: 22, color: withAlpha(COLORS.textDim, 0.6) })
}

/** 基础堆的空槽提示：画一个花色符号 */
function drawFoundationSlot(ctx: CanvasRenderingContext2D, r: Rect, suit: Suit): void {
  fillRoundRect(ctx, r.x, r.y, r.w, r.h, 10, 'rgba(255,255,255,0.05)', withAlpha(COLORS.line, 0.8), 2)
  const c = suit === 'H' || suit === 'D' ? '#d32f2f' : '#1d1d1d'
  ctx.save()
  ctx.globalAlpha = 0.22
  ctx.fillStyle = c
  ctx.font = `bold ${Math.round(r.w * 0.5)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(SUIT_SYMBOL[suit], r.x + r.w / 2, r.y + r.h / 2)
  ctx.restore()
}

const FOUNDATION_SUITS: Suit[] = ['S', 'H', 'D', 'C']

function drawTopRow(ctx: CanvasRenderingContext2D, s: State): void {
  // 牌堆
  const stock = s.piles[PILE_STOCK]
  const sr = slotRect('stock')
  if (stock.down.length > 0) {
    drawCard(ctx, stock.down[stock.down.length - 1], sr.x, sr.y, sr.w, sr.h, { faceUp: false })
    // 剩余张数角标
    shadowText(ctx, String(stock.down.length), sr.x + sr.w - 12, sr.y + 16, {
      size: 22,
      color: COLORS.text,
      align: 'right',
    })
  } else {
    drawSlot(ctx, sr, '空')
  }

  // 弃牌堆
  const waste = s.piles[PILE_WASTE]
  const wr = slotRect('waste')
  if (waste.up.length > 0) {
    drawCard(ctx, waste.up[0], wr.x, wr.y, wr.w, wr.h, {
      selected: s.selected?.pile === PILE_WASTE,
    })
    if (waste.up.length > 1) {
      shadowText(ctx, String(waste.up.length), wr.x + wr.w - 12, wr.y + 16, {
        size: 22,
        color: COLORS.text,
        align: 'right',
      })
    }
  } else {
    drawSlot(ctx, wr, '弃')
  }

  // 基础堆
  for (let f = 0; f < FOUNDATION_COUNT; f++) {
    const pile = s.piles[PILE_FOUNDATION_BASE + f]
    const r = slotRect('foundation', f)
    const isTarget = s.targets.indexOf(PILE_FOUNDATION_BASE + f) >= 0
    if (pile.up.length > 0) {
      drawCard(ctx, pile.up[pile.up.length - 1], r.x, r.y, r.w, r.h, {
        highlight: isTarget,
        selected: s.selected?.pile === PILE_FOUNDATION_BASE + f,
      })
    } else {
      drawFoundationSlot(ctx, r, FOUNDATION_SUITS[f])
      if (isTarget) {
        fillRoundRect(ctx, r.x - 3, r.y - 3, r.w + 6, r.h + 6, 12, withAlpha(COLORS.accent, 0.18), COLORS.accent, 3)
      }
    }
  }
}

function drawTableau(ctx: CanvasRenderingContext2D, s: State): void {
  for (let i = 0; i < TABLEAU_COUNT; i++) {
    const pile = s.piles[i]
    const x = tabX(i)
    const isTarget = s.targets.indexOf(i) >= 0

    // 扣着的牌
    for (let d = 0; d < pile.down.length; d++) {
      const y = TAB_Y + d * DOWN_DY
      drawCard(ctx, pile.down[d], x, y, CARD_W, CARD_H, { faceUp: false })
    }
    // 摊开的牌
    const base = TAB_Y + pile.down.length * DOWN_DY
    for (let u = 0; u < pile.up.length; u++) {
      const y = base + u * UP_DY
      const isSel = s.selected?.pile === i && s.selected.index === u
      drawCard(ctx, pile.up[u], x, y, CARD_W, CARD_H, {
        selected: isSel,
        highlight: isTarget && u === pile.up.length - 1,
      })
    }
    // 空堆：画一个空位
    if (pile.down.length === 0 && pile.up.length === 0) {
      drawSlot(ctx, { x, y: TAB_Y, w: CARD_W, h: CARD_H }, 'K')
      if (isTarget) {
        fillRoundRect(ctx, x - 3, TAB_Y - 3, CARD_W + 6, CARD_H + 6, 12, withAlpha(COLORS.accent, 0.18), COLORS.accent, 3)
      }
    }
  }
}

function drawFooter(ctx: CanvasRenderingContext2D, s: State): void {
  const done = foundationCount(s)
  topBar(ctx, VW, '纸牌接龙', `基础堆 ${done} / 52`, 92)
  const sub =
    s.phase === 'won'
      ? '全部归位，恭喜通关！'
      : s.phase === 'over'
        ? `已放弃 · 完成 ${done} 张`
        : s.selected
          ? '再点一个位置放下它（再点同一张取消）'
          : '点牌堆翻牌 · 点一张摊开的牌再点目标位置'
  shadowText(ctx, sub, VW / 2, 142, { size: 24, color: COLORS.textDim, weight: 'normal' })
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, '#12314a', '#08131f')
  drawFooter(ctx, s)
  drawTopRow(ctx, s)
  drawTableau(ctx, s)
  if (s.phase === 'won') banner(ctx, VW, VH, '通关！', '52 张全部归位')
  else if (s.phase === 'over') banner(ctx, VW, VH, '已结束', `完成 ${foundationCount(s)} 张`, COLORS.red)
}

// ==================================================================
// 输入
// ==================================================================

function input(s: State, p: PointerInput): Action | null {
  if (p.kind !== 'down') return null
  if (s.phase !== 'play') return null

  // 上排：基础堆 / 牌堆 / 弃牌堆
  for (let f = 0; f < FOUNDATION_COUNT; f++) {
    if (inRect(p, slotRect('foundation', f))) return { type: 'tap', pile: PILE_FOUNDATION_BASE + f, index: 0 }
  }
  if (inRect(p, slotRect('waste'))) return { type: 'tap', pile: PILE_WASTE, index: 0 }
  if (inRect(p, slotRect('stock'))) return { type: 'tap', pile: PILE_STOCK, index: 0 }

  // 桌面堆
  for (let i = 0; i < TABLEAU_COUNT; i++) {
    const idx = tabHit(s.piles[i], i, p)
    if (idx >= 0) return { type: 'tap', pile: i, index: idx }
  }
  return null
}

function key(_s: State, k: string): Action | null {
  if (k === ' ' || k === 'Enter') return { type: 'draw' }
  if (k === 'a' || k === 'A') return { type: 'auto' }
  return null
}

// ==================================================================
// 副作用与展示
// ==================================================================

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (next.phase === 'won' && prev.phase !== 'won') {
    out.push({ kind: 'sound', name: 'win' })
    out.push({ kind: 'flash', color: 'rgba(255,204,51,0.3)' })
    return out
  }
  if (next.phase === 'over' && prev.phase !== 'over') {
    out.push({ kind: 'sound', name: 'lose' })
    return out
  }
  if (next.moves > prev.moves) {
    // 上基础堆是好事，给个清脆声；其余移动是普通点击声
    const gained = foundationCount(next) > foundationCount(prev)
    out.push({ kind: 'sound', name: gained ? 'place' : 'click' })
  }
  return out
}

function outcome(s: State) {
  if (s.phase === 'play') return null
  return { score: foundationCount(s), better: 'higher' as const, unit: ' 张', win: s.phase === 'won' }
}

function hint(s: State): string {
  const done = foundationCount(s)
  if (s.phase === 'won') return '通关！52 张全部归位'
  if (s.phase === 'over') return `本局结束，完成 ${done} 张`
  return `已完成 ${done} / 52 张 · 走子 ${s.moves} 步${s.redeals > 0 ? ` · 翻回 ${s.redeals} 次` : ''}`
}

function controls(s: State): Control<Action>[] {
  if (s.phase !== 'play') {
    return [{ label: '重新开始', action: { type: 'newGame' }, primary: true }]
  }
  return [
    { label: '翻一张牌', action: { type: 'draw' }, primary: true },
    { label: '自动上基础', action: { type: 'auto' } },
    { label: '放弃本局', action: { type: 'giveUp' } },
  ]
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  input,
  key,
  effects,
  outcome,
  hint,
  controls,
}

export default game
