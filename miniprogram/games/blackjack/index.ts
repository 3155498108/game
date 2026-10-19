/**
 * 二十一点渲染 + 输入映射。
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 * 布局常量由 render 与 input 共用，点击命中与画面永远一致。
 */
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import type { Card } from '../../core/cards'
import type { Rect } from '../../core/geom'
import { inRect } from '../../core/geom'
import { COLORS, background, banner, button, ease, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { drawCard, handLayout } from '../../render/cards'
import { progressSince, pulse, tweenTo } from '../../render/anim'
import meta from './meta'
import {
  HOLE_INDEX,
  create,
  dealerAction,
  handValue,
  isWinResult,
  reduce,
  remaining,
  resultLabel,
  type Action,
  type State,
} from './rules'

const VW = 720
const VH = 1280

/** 手牌尺寸与两方位置 */
const CARD_W = 150
const CARD_H = 210
const CARD_MARGIN = 40
const DEALER_LABEL_Y = 164
const DEALER_Y = 196
const PLAYER_LABEL_Y = 606
const PLAYER_Y = 638

/** 中间信息面板 */
const PANEL: Rect = { x: 40, y: 460, w: VW - 80, h: 96 }

/** 画面上的按钮（高度 ≥150 逻辑像素，最小缩放下仍 ≥44px） */
const BTN_Y = 936
const BTN_H = 156
const BTN_W = 316
const HIT_RECT: Rect = { x: 32, y: BTN_Y, w: BTN_W, h: BTN_H }
const STAND_RECT: Rect = { x: VW - 32 - BTN_W, y: BTN_Y, w: BTN_W, h: BTN_H }
/** 结算后替换两个按钮的「再来一手」大按钮 */
const DEAL_RECT: Rect = { x: 32, y: BTN_Y, w: VW - 64, h: BTN_H }

/** 庄家暗牌未翻开时显示的点数（只统计明牌） */
function dealerShown(state: State): string {
  if (state.reveal) {
    const v = handValue(state.dealer)
    return `${v.total}${v.soft ? '（软）' : ''}`
  }
  const visible = state.dealer.filter((_, i) => i !== HOLE_INDEX)
  return `${handValue(visible).total} + ?`
}

/** 中间面板第一行：当前该谁动 */
function statusLine(state: State): string {
  if (state.phase === 'player') return `你的回合 · 注记 ${state.bet} 分`
  if (state.phase === 'dealer') return '庄家翻开暗牌，按规则要牌…'
  return resultLabel(state.result ?? 'lose')
}

/** 结算横幅：标题与副标题 */
function bannerText(state: State): [string, string, string] {
  const result = state.result ?? 'lose'
  const delta = state.payout > 0 ? `+${state.payout} 分` : '0 分'
  const sub = `${resultLabel(result)} · 本手 ${delta} · 累计 ${state.score} 分`
  if (result === 'push') return ['和局', sub, COLORS.blue]
  if (isWinResult(result)) return ['你赢了', sub, COLORS.green]
  return ['你输了', sub, COLORS.red]
}

/** 画一方的手牌：庄家暗牌在 reveal 之前画成牌背，并带一次翻转动画 */
function drawSeat(
  ctx: CanvasRenderingContext2D,
  title: string,
  total: string,
  cards: readonly Card[],
  y: number,
  labelY: number,
  o: { hole?: number; flip?: number } = {},
): void {
  text(ctx, title, 40, labelY, { size: 32, align: 'left', weight: 'bold' })
  text(ctx, total, VW - 40, labelY, { size: 32, align: 'right', weight: 'bold', color: COLORS.accent })
  const rects = handLayout(cards.length, VW, y, CARD_W, CARD_H, CARD_MARGIN)
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]
    const hidden = o.hole !== undefined && i === o.hole
    drawCard(ctx, cards[i], r.x, r.y, CARD_W, CARD_H, {
      faceUp: !hidden,
      flip: hidden && o.flip !== undefined ? o.flip : undefined,
    })
  }
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  background(ctx, VW, VH, COLORS.felt, COLORS.feltDark)
  topBar(ctx, VW, `得分 ${state.score}`, `第 ${state.round} 局`, 96)

  // 玩家决策时给自己的手牌一圈呼吸光
  if (state.phase === 'player') {
    const glow = tweenTo('bj-glow', 1, 240)
    ctx.save()
    ctx.globalAlpha = 0.12 + 0.12 * pulse(1100) * glow
    fillRoundRect(ctx, 24, PLAYER_Y - 12, VW - 48, CARD_H + 24, 28, COLORS.accent)
    ctx.restore()
  }

  drawSeat(ctx, '庄家', dealerShown(state), state.dealer, DEALER_Y, DEALER_LABEL_Y, {
    hole: HOLE_INDEX,
    // 签名带上 reveal：停牌翻开暗牌的那一刻才会重新播一次翻牌动画
    flip: progressSince('bj-reveal', `${state.round}-${state.reveal ? 1 : 0}`, 360, ease.inOutCubic),
  })

  const pv = handValue(state.player)
  drawSeat(ctx, '你', `${pv.total}${pv.soft ? '（软）' : ''}${pv.bust ? ' 爆' : ''}`, state.player, PLAYER_Y, PLAYER_LABEL_Y)

  // 中间面板：状态 + 牌堆余量
  fillRoundRect(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 22, 'rgba(0,0,0,0.3)', withAlpha('#ffffff', 0.12), 2)
  shadowText(ctx, statusLine(state), VW / 2, PANEL.y + 34, { size: 30 })
  text(ctx, `牌堆剩余 ${remaining(state)} 张 · 洗回 ${state.reshuffles} 次`, VW / 2, PANEL.y + 70, {
    size: 23,
    color: COLORS.textDim,
  })

  // 玩家阶段给「要一张 / 停牌」，结算后给「再来一手」
  const canAct = state.phase === 'player'
  if (state.phase === 'done') {
    button(ctx, DEAL_RECT, '再来一手', { color: COLORS.accent, textColor: '#1b1b1f' })
  } else {
    button(ctx, HIT_RECT, '要一张', { color: COLORS.green, disabled: !canAct })
    button(ctx, STAND_RECT, '停牌', { color: COLORS.blue, disabled: !canAct })
  }

  const tip =
    state.phase === 'player'
      ? '到 17 点以上建议停牌 · 点数超过 21 就爆了'
      : state.phase === 'dealer'
        ? '庄家按 ≤16 必加、17 点也要牌的规则行动'
        : '继续下一手累计得分，或点「新的一局」重开'
  fillRoundRect(ctx, 80, 1140, VW - 160, 56, 18, 'rgba(0,0,0,0.26)')
  text(ctx, tip, VW / 2, 1168, { size: 24, color: COLORS.textDim })

  if (state.phase === 'done') {
    const [title, sub, color] = bannerText(state)
    banner(ctx, VW, VH, title, sub, color)
  }
}

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (next.player.length > prev.player.length) out.push({ kind: 'sound', name: 'hit' })
  if (next.dealer.length > prev.dealer.length) out.push({ kind: 'sound', name: 'flip' })
  if (prev.phase === 'done' || next.phase !== 'done') return out
  if (isWinResult(next.result ?? 'lose')) {
    out.push(
      { kind: 'sound', name: 'score' },
      { kind: 'sound', name: 'win' },
      { kind: 'burst', x: VW / 2, y: PLAYER_Y + CARD_H / 2, color: COLORS.green, count: 20 },
    )
  } else if (next.result === 'push') {
    out.push({ kind: 'sound', name: 'score' })
  } else {
    out.push(
      { kind: 'sound', name: 'lose' },
      { kind: 'shake', power: 8 },
      { kind: 'burst', x: VW / 2, y: PLAYER_Y + CARD_H / 2, color: COLORS.red, count: 14 },
    )
  }
  return out
}

function outcome(state: State): Outcome | null {
  if (state.phase !== 'done' || !state.result) return null
  return {
    score: state.score,
    better: 'higher',
    unit: ' 分',
    win: isWinResult(state.result),
  }
}

/** 画面点击：只认 up，避免一次点击同时触发 down/up 而重复动作 */
function input(state: State, p: PointerInput): Action | null {
  if (p.kind !== 'up') return null
  if (state.phase === 'done') return inRect(p, DEAL_RECT) ? { type: 'deal' } : null
  if (state.phase !== 'player') return null
  if (inRect(p, HIT_RECT)) return { type: 'hit' }
  if (inRect(p, STAND_RECT)) return { type: 'stand' }
  return null
}

function key(state: State, k: string): Action | null {
  if (state.phase === 'done') return k === ' ' || k === 'Enter' || k === 'd' || k === 'D' ? { type: 'deal' } : null
  if (state.phase !== 'player') return null
  if (k === ' ' || k === 'Enter' || k === 'h' || k === 'H') return { type: 'hit' }
  if (k === 's' || k === 'S') return { type: 'stand' }
  return null
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
  // 庄家没有可枚举的动作序列，只在 dealer 阶段定时推进一步
  aiAction: dealerAction,
  aiDelay: 620,
  controls: (s) => {
    if (s.phase === 'done') return [{ label: '再来一手', action: { type: 'deal' }, primary: true }]
    if (s.phase !== 'player') return []
    return [
      { label: '要一张', action: { type: 'hit' }, primary: true },
      { label: '停牌', action: { type: 'stand' } },
    ]
  },
  hint: (s) => {
    if (s.phase === 'done')
      return `${resultLabel(s.result ?? 'lose')}，本手 ${s.payout > 0 ? '+' : ''}${s.payout} 分，累计 ${s.score} 分 · 点「再来一手」继续`
    if (s.phase === 'dealer') return '庄家翻开暗牌，按固定策略要牌…'
    const v = handValue(s.player)
    return `你现在 ${v.total} 点${v.soft ? '（软）' : ''}，要一张还是停牌？（每手注记 ${s.bet} 分）`
  },
}

export default game
