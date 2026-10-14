/**
 * 比大小渲染 + 输入映射。
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 */
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { cardLabel, type Card } from '../../core/cards'
import type { Rect } from '../../core/geom'
import { inRect } from '../../core/geom'
import { COLORS, background, banner, button, ease, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { drawCard } from '../../render/cards'
import { progressSince, pulse, tweenTo } from '../../render/anim'
import meta from './meta'
import { create, remaining, reduce, type Action, type Dir, type State } from './rules'

const VW = 720
const VH = 1280

/** 主牌（当前牌）尺寸与位置 */
const CARD_W = 300
const CARD_H = 420
const CARD_X = (VW - CARD_W) / 2
const CARD_Y = 262

/** 结算面板 */
const PANEL: Rect = { x: 48, y: 694, w: 624, h: 176 }
/** 面板内两张对照小牌 */
const MINI_W = 84
const MINI_H = 118
const MINI_Y = 723
const MINI_PREV_X = 96
const MINI_NEXT_X = 252

/** 画面上的两个大按钮（高度 ≥110 逻辑像素，最小缩放下仍 ≥44px） */
const BTN_H = 164
const BTN_Y = 990
const BTN_W = 316
const LOWER_RECT: Rect = { x: 32, y: BTN_Y, w: BTN_W, h: BTN_H }
const HIGHER_RECT: Rect = { x: VW - 32 - BTN_W, y: BTN_Y, w: BTN_W, h: BTN_H }

const dirLabel = (d: Dir): string => (d === 'higher' ? '猜更大' : '猜更小')
const dirArrow = (d: Dir): string => (d === 'higher' ? '▲' : '▼')

function render(ctx: CanvasRenderingContext2D, state: State): void {
  // 绿绒桌面
  background(ctx, VW, VH, '#17603f', '#0c3725')

  topBar(ctx, VW, `得分 ${state.score}`, `最高连对 ${state.best}`, 96)
  const sub = state.over ? '本局结束' : '看当前牌，猜下一张是更大还是更小'
  shadowText(ctx, sub, VW / 2, 152, { size: 26, color: COLORS.textDim, weight: 'normal' })

  // 牌堆余量
  const left = remaining(state)
  const pillW = 300
  fillRoundRect(ctx, VW / 2 - pillW / 2, 178, pillW, 52, 16, 'rgba(0,0,0,0.28)')
  text(ctx, `牌堆剩余 ${left} 张 · 第 ${state.round} 轮`, VW / 2, 204, { size: 25, weight: 'bold' })

  // 当前牌（翻开时做一次翻转动画）
  const flip = state.round === 0 ? 1 : progressSince('hl-flip', String(state.round), 320, ease.inOutCubic)
  const glow = state.over ? 0 : tweenTo('hl-glow', 1, 260)
  ctx.save()
  ctx.globalAlpha = 0.16 + 0.14 * pulse(1100) * glow
  fillRoundRect(ctx, CARD_X - 12, CARD_Y - 12, CARD_W + 24, CARD_H + 24, 30, COLORS.accent)
  ctx.restore()
  drawCard(ctx, state.current, CARD_X, CARD_Y, CARD_W, CARD_H, { flip, highlight: !state.over })

  drawResult(ctx, state)
  drawStreak(ctx, state)

  // 两个大按钮
  button(ctx, LOWER_RECT, '猜更小 ▼', { color: COLORS.blue, disabled: state.over })
  button(ctx, HIGHER_RECT, '猜更大 ▲', { color: COLORS.green, disabled: state.over })

  const tip = state.over ? '点「新的一局」再来一次' : '按钮或画面下方均可选择 · 猜错即结束'
  fillRoundRect(ctx, 80, 1196, VW - 160, 56, 18, 'rgba(0,0,0,0.26)')
  text(ctx, tip, VW / 2, 1224, { size: 25, color: COLORS.textDim })

  if (state.over) banner(ctx, VW, VH, '游戏结束', `得分 ${state.score} · 最高连对 ${state.best}`, COLORS.red)
}

/** 结算面板：上一轮的「上一张 → 下一张」与判定 */
function drawResult(ctx: CanvasRenderingContext2D, state: State): void {
  fillRoundRect(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 24, withAlpha('#08191a', 0.45), 'rgba(255,255,255,0.14)', 2)

  if (state.round === 0) {
    text(ctx, '还没有猜测', VW / 2, PANEL.y + PANEL.h / 2, { size: 28, color: COLORS.textDim })
    return
  }

  const prev = state.prevCard
  const next = state.lastCard
  if (prev) drawCard(ctx, prev, MINI_PREV_X, MINI_Y, MINI_W, MINI_H, { dim: true })
  text(ctx, '→', 216, MINI_Y + MINI_H / 2, { size: 34, weight: 'bold', color: COLORS.textDim })
  if (next) drawCard(ctx, next, MINI_NEXT_X, MINI_Y, MINI_W, MINI_H, { highlight: state.lastHit === true })

  const hit = state.lastHit === true
  const guessText = state.lastGuess ? dirLabel(state.lastGuess) : ''
  const verdict = state.lastGuess ? `${dirArrow(state.lastGuess)} ${guessText}` : ''
  text(ctx, verdict, 504, PANEL.y + 61, { size: 36, weight: 'bold', color: hit ? COLORS.green : COLORS.red })
  const detail = state.round === 0 ? '' : next && prev ? `${cardLabel(prev)} vs ${cardLabel(next)}` : ''
  text(ctx, detail, 504, PANEL.y + 118, { size: 24, color: COLORS.textDim })
}

/** 连对显示：连对数越高数字越大，并带呼吸光 */
function drawStreak(ctx: CanvasRenderingContext2D, state: State): void {
  const active = state.streak > 0 && !state.over
  const grow = active ? 1 + 0.06 * pulse(700) : 1
  ctx.save()
  ctx.translate(VW / 2, 930)
  ctx.scale(grow, grow)
  const label = state.streak > 0 ? `连对 ${state.streak}` : state.over ? '连对中断' : '等待第一猜'
  shadowText(ctx, label, 0, 0, { size: 44, color: active ? COLORS.accent : COLORS.textDim })
  ctx.restore()

  // 连对点数（最多 12 点，超出用数字表示）
  const dots = Math.min(state.streak, 12)
  for (let i = 0; i < dots; i++) {
    const x = VW / 2 - ((dots - 1) * 24) / 2 + i * 24
    ctx.beginPath()
    ctx.arc(x, 962, 8, 0, Math.PI * 2)
    ctx.fillStyle = COLORS.accent
    ctx.fill()
  }
}

function effects(prev: State, next: State): Effect[] {
  if (next.round === prev.round) return []
  const cx = VW / 2
  const cy = CARD_Y + CARD_H / 2
  if (next.over) {
    return [
      { kind: 'sound', name: 'error' },
      { kind: 'shake', power: 8 },
      { kind: 'burst', x: cx, y: cy, color: COLORS.red, count: 18 },
    ]
  }
  return [
    { kind: 'sound', name: 'flip' },
    { kind: 'sound', name: 'score' },
    { kind: 'burst', x: cx, y: cy, color: COLORS.green, count: 14 },
  ]
}

function outcome(state: State): Outcome | null {
  if (!state.over) return null
  return { score: state.score, better: 'higher', unit: ' 分', win: state.score > 0 }
}

/** 画面点击：只认 up，避免一次点击同时触发 down/up 而猜两次 */
function input(state: State, p: PointerInput): Action | null {
  if (state.over || p.kind !== 'up') return null
  if (inRect(p, LOWER_RECT)) return { type: 'guess', dir: 'lower' }
  if (inRect(p, HIGHER_RECT)) return { type: 'guess', dir: 'higher' }
  return null
}

function key(_state: State, k: string): Action | null {
  if (k === 'ArrowUp' || k === 'ArrowRight') return { type: 'guess', dir: 'higher' }
  if (k === 'ArrowDown' || k === 'ArrowLeft') return { type: 'guess', dir: 'lower' }
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
  controls: (s) =>
    s.over
      ? []
      : [
          { label: '猜下一张更大', action: { type: 'guess', dir: 'higher' }, primary: true },
          { label: '猜下一张更小', action: { type: 'guess', dir: 'lower' } },
        ],
  hint: (s) => {
    if (s.over) return `本局得分 ${s.score} 分，最高连对 ${s.best}，点「新的一局」再来一次`
    const cur: Card | null = s.current
    return `当前牌 ${cur ? cardLabel(cur) : '—'}：下一张更大还是更小？`
  },
}

export default game
