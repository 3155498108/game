/**
 * 记忆卡牌：渲染 + 输入映射。
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 *
 * 关于翻错后的 800ms 自动盖回：计时器不进入 reduce（否则规则不可单测）。
 * reduce 只负责进入 pending（待盖回）状态，之后由显式的 settle 动作盖回：
 *   - 主路径：待盖回时点击画面任意处 → settle
 *   - 备选：底部提示区的「盖回这两张」按钮 → settle
 * 倒计时只用 anim 的 elapsedSince 在 render 里做纯视觉反馈，归零不改变状态。
 */
import type { Effect, GameModule, PointerInput } from '../../core/types'
import { COLORS, PALETTE, background, banner, disc, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { elapsedSince, progressSince, pulse, tweenTo } from '../../render/anim'
import type { Point, Rect } from '../../core/geom'
import { clamp, gridHit, inRect } from '../../core/geom'
import meta from './meta'
import { CARD_COUNT, COLS, PAIR_KINDS, ROWS, create, reduce, type Action, type State } from './rules'

/** 翻错后倒计时的视觉时长（毫秒）。仅用于动画反馈，不参与规则 */
export const SETTLE_MS = 800

// ---------------- 布局：render 与 input 共用同一份常量 ----------------
export const LAYOUT = { cardW: 132, cardH: 184, gap: 20, x: 66, y: 300 } as const
const PITCH_W = LAYOUT.cardW + LAYOUT.gap
const PITCH_H = LAYOUT.cardH + LAYOUT.gap
const GRID_W = COLS * PITCH_W - LAYOUT.gap
const GRID_H = ROWS * PITCH_H - LAYOUT.gap
/** 牌桌矩形（含外边距） */
export const BOARD_RECT: Rect = { x: LAYOUT.x - 18, y: LAYOUT.y - 18, w: GRID_W + 36, h: GRID_H + 36 }

/** 第 index 张牌的矩形 */
export function cardRect(index: number): Rect {
  const col = index % COLS
  const row = Math.floor(index / COLS)
  return { x: LAYOUT.x + col * PITCH_W, y: LAYOUT.y + row * PITCH_H, w: LAYOUT.cardW, h: LAYOUT.cardH }
}

export function cardCenter(index: number): [number, number] {
  const r = cardRect(index)
  return [r.x + r.w / 2, r.y + r.h / 2]
}

/** 命中测试：返回牌索引，未命中返回 -1 */
export function hitCard(p: Point): number {
  if (!inRect(p, BOARD_RECT)) return -1
  const c = gridHit(p, LAYOUT.x, LAYOUT.y, PITCH_W, PITCH_H, COLS, ROWS)
  return c ? c[1] * COLS + c[0] : -1
}

// ---------------- 绘制 ----------------

function statusText(s: State): string {
  if (s.won) return '全部配对成功'
  if (s.pending) return '不是一对，点任意处盖回'
  if (s.first >= 0) return '再翻一张看看'
  return '翻开两张图案相同的牌'
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  const vw = 720
  const vh = 1280
  background(ctx, vw, vh, '#4b2d8a', '#170e30')

  topBar(ctx, vw, '记忆卡牌', `已配 ${state.pairs} / ${PAIR_KINDS} 对`, 96)
  shadowText(ctx, statusText(state), vw / 2, 152, { size: 27, color: COLORS.textDim, weight: 'normal' })

  // 牌桌底板
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, BOARD_RECT.x, BOARD_RECT.y, BOARD_RECT.w, BOARD_RECT.h, 26, 'rgba(12,6,28,0.5)')
  ctx.restore()
  fillRoundRect(ctx, BOARD_RECT.x, BOARD_RECT.y, BOARD_RECT.w, BOARD_RECT.h, 26, 'rgba(255,255,255,0.05)', COLORS.line, 2)

  for (let i = 0; i < CARD_COUNT; i++) drawCard(ctx, state, i)

  drawFooter(ctx, vw, vh, state)

  if (state.won) banner(ctx, vw, vh, '通关！', `共翻了 ${state.flips} 次`)
}

function drawCard(ctx: CanvasRenderingContext2D, state: State, i: number): void {
  const r = cardRect(i)
  const [cx, cy] = cardCenter(i)
  const up = state.up[i]
  const isMatch = state.matched.indexOf(i) >= 0
  const isPendingCard = state.pending && (state.first === i || state.second === i)
  // 签名只包含这张牌自身的可见状态，避免每翻一张牌就让全部 16 张牌抖动
  const sig = `${up ? 1 : 0}|${isMatch ? 1 : 0}|${isPendingCard ? 1 : 0}|${state.lastFlip === i ? state.flips : -1}`
  const p = progressSince('mem-flip-' + i, sig, 300)
  const scale = p < 1 ? 0.86 + 0.14 * p : 1

  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)
  ctx.translate(-cx, -cy)

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 14
  ctx.shadowOffsetY = 6
  fillRoundRect(ctx, r.x, r.y, r.w, r.h, 18, up ? COLORS.cardFace : COLORS.cardBack)
  ctx.restore()

  if (up) drawFace(ctx, r, cx, cy, state.faces[i])
  else drawBack(ctx, r)

  // 配对成功：金色描边
  if (isMatch) {
    const g = tweenTo('mem-match-' + i, 1, 340)
    ctx.save()
    ctx.globalAlpha = 0.35 + 0.65 * g
    fillRoundRect(ctx, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 16, 'rgba(0,0,0,0)', COLORS.accent, 5)
    ctx.restore()
  }

  // 待盖回的两张：呼吸描边，提示「点任意处继续」
  if (isPendingCard) {
    const beat = pulse(800)
    ctx.save()
    ctx.globalAlpha = 0.25 + 0.45 * beat
    fillRoundRect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 16, 'rgba(0,0,0,0)', COLORS.red, 5)
    ctx.restore()
  }

  // 悬停高亮
  if (state.hover === i && !state.won && !state.pending && !up) {
    fillRoundRect(ctx, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 16, 'rgba(0,0,0,0)', 'rgba(255,255,255,0.55)', 3)
  }

  ctx.restore()
}

function drawBack(ctx: CanvasRenderingContext2D, r: Rect): void {
  fillRoundRect(ctx, r.x + 10, r.y + 10, r.w - 20, r.h - 20, 12, 'rgba(255,255,255,0.07)')
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const s = r.w * 0.2
  ctx.beginPath()
  ctx.moveTo(cx, cy - s)
  ctx.lineTo(cx + s, cy)
  ctx.lineTo(cx, cy + s)
  ctx.lineTo(cx - s, cy)
  ctx.closePath()
  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.fill()
}

/** 牌面：彩色圆盘 + 程序绘制的符号（不依赖任何外部图片） */
function drawFace(ctx: CanvasRenderingContext2D, r: Rect, cx: number, cy: number, kind: number): void {
  const color = PALETTE[kind % PALETTE.length]
  const rad = r.w * 0.33
  disc(ctx, cx, cy, rad, color)
  drawGlyph(ctx, cx, cy, rad * 0.62, kind)
}

function drawGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, kind: number): void {
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = Math.max(3, r * 0.34)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  switch (kind) {
    case 0: // 心形
      ctx.moveTo(cx, cy + r * 0.95)
      ctx.bezierCurveTo(cx - r * 1.35, cy - r * 0.15, cx - r * 0.8, cy - r * 1.15, cx, cy - r * 0.42)
      ctx.bezierCurveTo(cx + r * 0.8, cy - r * 1.15, cx + r * 1.35, cy - r * 0.15, cx, cy + r * 0.95)
      ctx.closePath()
      ctx.fill()
      break
    case 1: { // 五角星
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5
        const rr = k % 2 === 0 ? r : r * 0.45
        const x = cx + Math.cos(a) * rr
        const y = cy + Math.sin(a) * rr
        if (k === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fill()
      break
    }
    case 2: // 三角
      ctx.moveTo(cx, cy - r)
      ctx.lineTo(cx + r * 0.92, cy + r * 0.72)
      ctx.lineTo(cx - r * 0.92, cy + r * 0.72)
      ctx.closePath()
      ctx.fill()
      break
    case 3: // 菱形
      ctx.moveTo(cx, cy - r)
      ctx.lineTo(cx + r * 0.82, cy)
      ctx.lineTo(cx, cy + r)
      ctx.lineTo(cx - r * 0.82, cy)
      ctx.closePath()
      ctx.fill()
      break
    case 4: { // 十字
      const t = r * 0.34
      ctx.moveTo(cx - t, cy - r)
      ctx.lineTo(cx + t, cy - r)
      ctx.lineTo(cx + t, cy - t)
      ctx.lineTo(cx + r, cy - t)
      ctx.lineTo(cx + r, cy + t)
      ctx.lineTo(cx + t, cy + t)
      ctx.lineTo(cx + t, cy + r)
      ctx.lineTo(cx - t, cy + r)
      ctx.lineTo(cx - t, cy + t)
      ctx.lineTo(cx - r, cy + t)
      ctx.lineTo(cx - r, cy - t)
      ctx.lineTo(cx - t, cy - t)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 5: // 同心圆环
      ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2)
      ctx.fill()
      break
    case 6: // 方框
      ctx.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6)
      ctx.stroke()
      break
    case 7: // 闪电
      ctx.moveTo(cx + r * 0.25, cy - r)
      ctx.lineTo(cx - r * 0.55, cy + r * 0.12)
      ctx.lineTo(cx + r * 0.02, cy + r * 0.12)
      ctx.lineTo(cx - r * 0.2, cy + r)
      ctx.lineTo(cx + r * 0.62, cy - r * 0.1)
      ctx.lineTo(cx + r * 0.04, cy - r * 0.1)
      ctx.closePath()
      ctx.fill()
      break
    default:
      ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2)
      ctx.fill()
      break
  }
  ctx.restore()
}

function drawFooter(ctx: CanvasRenderingContext2D, vw: number, vh: number, state: State): void {
  const y = vh - 200
  const beat = state.pending || state.won ? pulse(1000) : 0
  ctx.save()
  ctx.globalAlpha = 0.9
  fillRoundRect(ctx, 56, y, vw - 112, 140, 22, 'rgba(255,255,255,0.08)', withAlpha(COLORS.accent, 0.15 + 0.35 * beat), 2)
  ctx.restore()

  if (state.pending) {
    // 倒计时条：纯视觉反馈，归零也不会自动改变状态，仍需点击/按钮来盖回
    const e = elapsedSince('mem-settle', `${state.first}:${state.second}`, SETTLE_MS)
    const left = Math.max(0, SETTLE_MS - e)
    const ratio = left / SETTLE_MS
    const bw = vw - 200
    const bh = 14
    const bx = (vw - bw) / 2
    const by = y + 86
    text(ctx, '不是一对 · 点任意处盖回', vw / 2, y + 42, { size: 30, weight: 'bold', color: COLORS.accent })
    fillRoundRect(ctx, bx, by, bw, bh, 7, 'rgba(255,255,255,0.18)')
    fillRoundRect(ctx, bx, by, Math.max(8, bw * ratio), bh, 7, withAlpha(COLORS.accent, 0.9))
    text(ctx, left > 0 ? `${(left / 1000).toFixed(1)}s 后提示结束，现在就能继续` : '现在点任意处即可继续', vw / 2, by + 40, {
      size: 22,
      color: COLORS.textDim,
    })
  } else if (state.won) {
    text(ctx, `用 ${state.flips} 次翻牌完成通关`, vw / 2, y + 48, { size: 30, weight: 'bold', color: COLORS.accent })
    text(ctx, '点「新的一局」再来一次，试试更少次数', vw / 2, y + 96, { size: 24, color: COLORS.textDim })
  } else {
    text(ctx, state.first >= 0 ? '已翻开 1 张，再选一张' : '点击任意一张牌翻开它', vw / 2, y + 48, { size: 30, weight: 'bold' })
    text(ctx, `已翻 ${state.flips} 次 · 配对 ${state.pairs}/${PAIR_KINDS} 对`, vw / 2, y + 96, { size: 24, color: COLORS.textDim })
  }
}

// ---------------- 模块接口 ----------------

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (next.flips > prev.flips) out.push({ kind: 'sound', name: 'flip' })
  if (next.pairs > prev.pairs) {
    out.push({ kind: 'sound', name: 'score' })
    for (const i of next.matched) {
      const [x, y] = cardCenter(i)
      out.push({ kind: 'burst', x, y, color: PALETTE[next.faces[i]], count: 16 })
    }
  }
  // 翻错后盖回
  if (prev.pending && !next.pending && next.flips === prev.flips) out.push({ kind: 'sound', name: 'click' })
  if (next.won && !prev.won) {
    out.push({ kind: 'sound', name: 'win' })
    out.push({ kind: 'flash', color: 'rgba(255,204,51,0.3)' })
  }
  return out
}

function outcome(state: State) {
  if (!state.won) return null
  return { score: state.flips, better: 'lower' as const, unit: ' 次', win: true }
}

function input(state: State, p: PointerInput): Action | null {
  if (p.kind === 'move') {
    if (state.won || state.pending) return null
    const i = hitCard(p)
    if (i < 0) return state.hover === -1 ? null : { type: 'leave' }
    return state.hover === i ? null : { type: 'hover', index: i }
  }
  if (p.kind !== 'down') return null
  // 翻错时点画面任意处即可盖回（主路径）
  if (state.pending) return { type: 'settle' }
  if (state.won) return null
  const i = hitCard(p)
  return i < 0 ? null : { type: 'flip', index: i }
}

function key(state: State, k: string): Action | null {
  if (k === ' ' || k === 'Enter') {
    if (state.pending) return { type: 'settle' }
    if (state.won || state.hover < 0) return null
    return { type: 'flip', index: state.hover }
  }
  if (state.won || state.pending) return null
  const step = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : k === 'ArrowDown' ? COLS : k === 'ArrowUp' ? -COLS : 0
  if (step === 0) return null
  const from = state.hover < 0 ? 0 : state.hover
  const index = clamp(from + step, 0, CARD_COUNT - 1)
  return index === state.hover ? null : { type: 'hover', index }
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
  controls: (s) => (s.pending ? [{ label: '盖回这两张', action: { type: 'settle' }, primary: true }] : []),
  hint: (s) =>
    s.won
      ? `全部配对成功，共翻了 ${s.flips} 次`
      : s.pending
        ? '不是一对，点画面任意处或点「盖回这两张」继续'
        : s.first >= 0
          ? '再翻一张，图案相同就配对成功'
          : '翻开两张图案相同的牌',
}

export default game
