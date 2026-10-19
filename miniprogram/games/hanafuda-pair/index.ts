/**
 * 花牌：渲染 + 输入映射。规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 *
 * 牌面全部用 Canvas 路径程序绘制（月相圆 + 花形符号 + 牌名字），不依赖任何图片或外部字体资源。
 * 翻错后的盖回计时不进 reduce：待盖回时点画面任意处或提示区按钮 → settle，
 * 倒计时只用 anim 的 elapsedSince 做纯视觉反馈，归零不改变状态。
 */
import type { Effect, GameModule, PointerInput } from '../../core/types'
import { COLORS, FONT, background, banner, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { elapsedSince, progressSince, pulse, tweenTo } from '../../render/anim'
import type { Rect } from '../../core/geom'
import { clamp, gridHit, inRect } from '../../core/geom'
import meta from './meta'
import {
  CARD_COUNT,
  COLS,
  MONTHS,
  PAIR_KINDS,
  ROWS,
  create,
  flowerOf,
  kindLabel,
  monthOf,
  reduce,
  type Action,
  type State,
} from './rules'

/** 翻错后倒计时的视觉时长（毫秒）。仅用于动画反馈，不参与规则 */
export const SETTLE_MS = 800

/** 花色（渲染层专用，规则层不关心颜色） */
const FLOWER_COLORS = ['#1f7a4d', '#c62828', '#e0609a', '#3f8f7a'] as const
/** 牌面底色与墨色 */
const FACE_BG = '#fbf3e0'
const INK = '#2c2114'

// ---------------- 布局：render 与 input 共用同一份常量 ----------------
export const LAYOUT = { cardW: 140, cardH: 176, gapX: 18, gapY: 16, x: 53, y: 284 } as const
const PITCH_W = LAYOUT.cardW + LAYOUT.gapX
const PITCH_H = LAYOUT.cardH + LAYOUT.gapY
/** 牌桌矩形（含外边距） */
export const BOARD_RECT: Rect = { x: LAYOUT.x - 18, y: LAYOUT.y - 18, w: COLS * PITCH_W - LAYOUT.gapX + 36, h: ROWS * PITCH_H - LAYOUT.gapY + 36 }

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
export function hitCard(p: { x: number; y: number }): number {
  if (!inRect(p, BOARD_RECT)) return -1
  const c = gridHit(p, LAYOUT.x, LAYOUT.y, PITCH_W, PITCH_H, COLS, ROWS)
  return c ? c[1] * COLS + c[0] : -1
}

// ---------------- 程序绘制的花札图形 ----------------

/** 月相：f = 0 新月、0.5 上弦、1 满月；正月为新月、七月为满月 */
function moonPhase(month: number): number {
  return (1 - Math.cos((month / MONTHS) * Math.PI * 2)) / 2
}

/** 月相圆：暗面打底 + 亮面（终止线用椭圆画出月牙） */
function drawMoon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, f: number): void {
  ctx.save()
  ctx.fillStyle = '#33406b'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff2c4'
  ctx.beginPath()
  ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, false)
  ctx.ellipse(
    cx,
    cy,
    r * (f <= 0.5 ? 1 - 2 * f : 2 * f - 1),
    r,
    0,
    Math.PI / 2,
    f <= 0.5 ? -Math.PI / 2 : 3 * Math.PI / 2,
    f <= 0.5,
  )
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** 松：三叠针叶 + 树干 */
function drawPine(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.fillStyle = '#1f7a4d'
  ctx.beginPath()
  ctx.moveTo(cx, cy + s)
  ctx.lineTo(cx + s * 0.16, cy - s * 0.1)
  ctx.lineTo(cx - s * 0.16, cy - s * 0.1)
  ctx.closePath()
  ctx.fill()
  for (let k = 0; k < 3; k++) {
    const w = s * (0.92 - k * 0.22)
    const top = cy - s * (0.9 - k * 0.34)
    const bot = top + s * 0.62
    ctx.beginPath()
    ctx.moveTo(cx, top)
    ctx.lineTo(cx + w, bot)
    ctx.lineTo(cx - w, bot)
    ctx.closePath()
    ctx.fill()
  }
}

/** 梅：五瓣圆花 + 蕊 */
function drawPlum(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.fillStyle = '#c62828'
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 5
    ctx.beginPath()
    ctx.arc(cx + Math.cos(a) * s * 0.46, cy + Math.sin(a) * s * 0.46, s * 0.4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#f7d774'
  ctx.beginPath()
  ctx.arc(cx, cy, s * 0.24, 0, Math.PI * 2)
  ctx.fill()
}

/** 樱：五瓣 + 瓣尖缺口（用底色三角切出来） */
function drawCherry(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.fillStyle = '#e0609a'
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 5
    const px = cx + Math.cos(a) * s * 0.48
    const py = cy + Math.sin(a) * s * 0.48
    ctx.beginPath()
    ctx.arc(px, py, s * 0.42, 0, Math.PI * 2)
    ctx.fill()
    // 瓣尖缺口
    ctx.fillStyle = FACE_BG
    ctx.beginPath()
    ctx.moveTo(px + Math.cos(a) * s * 0.42, py + Math.sin(a) * s * 0.42)
    ctx.lineTo(px + Math.cos(a + 0.26) * s * 0.62, py + Math.sin(a + 0.26) * s * 0.62)
    ctx.lineTo(px + Math.cos(a - 0.26) * s * 0.62, py + Math.sin(a - 0.26) * s * 0.62)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#e0609a'
  }
  ctx.fillStyle = '#f7d774'
  ctx.beginPath()
  ctx.arc(cx, cy, s * 0.18, 0, Math.PI * 2)
  ctx.fill()
}

/** 柳：垂枝 + 细叶 */
function drawWillow(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.strokeStyle = '#3f8f7a'
  ctx.lineWidth = Math.max(2, s * 0.1)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - s * 0.95, cy - s * 0.9)
  ctx.quadraticCurveTo(cx + s * 0.2, cy - s * 0.1, cx - s * 0.35, cy + s * 0.95)
  ctx.stroke()
  ctx.fillStyle = '#3f8f7a'
  for (let k = 0; k < 6; k++) {
    const t = k / 5
    const x = cx - s * 0.95 + (s * 1.1) * t - s * 0.6 * t * t
    const y = cy - s * 0.9 + s * 1.85 * t * t
    const dir = k % 2 === 0 ? 1 : -1
    ctx.beginPath()
    ctx.ellipse(x + dir * s * 0.24, y, s * 0.24, s * 0.11, dir * 0.5, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawFlower(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, flower: number): void {
  switch (flower) {
    case 0:
      drawPine(ctx, cx, cy, s)
      break
    case 1:
      drawPlum(ctx, cx, cy, s)
      break
    case 2:
      drawCherry(ctx, cx, cy, s)
      break
    default:
      drawWillow(ctx, cx, cy, s)
      break
  }
}

// ---------------- 绘制 ----------------

function statusText(s: State): string {
  if (s.won) return '八对全中，通关'
  if (s.pending) return '不是一对，点任意处盖回'
  if (s.first >= 0) return `已翻开 ${kindLabel(s.kinds[s.first])}，再翻一张`
  return '翻开两张同月同花的牌'
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  const vw = 720
  const vh = 1280
  background(ctx, vw, vh, '#2b1c4d', '#120a26')

  topBar(ctx, vw, '花牌', `已配 ${state.pairs} / ${PAIR_KINDS} 对`, 96)
  shadowText(ctx, statusText(state), vw / 2, 152, { size: 26, color: COLORS.textDim, weight: 'normal' })

  // 牌桌底板
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, BOARD_RECT.x, BOARD_RECT.y, BOARD_RECT.w, BOARD_RECT.h, 26, 'rgba(10,5,22,0.5)')
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
  const p = progressSince('hana-flip-' + i, sig, 300)
  const scale = p < 1 ? 0.86 + 0.14 * p : 1

  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)
  ctx.translate(-cx, -cy)

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 14
  ctx.shadowOffsetY = 6
  fillRoundRect(ctx, r.x, r.y, r.w, r.h, 14, up ? FACE_BG : '#2f3f77')
  ctx.restore()

  if (up) drawFace(ctx, r, state.kinds[i])
  else drawBack(ctx, r)

  // 配对成功：金色描边
  if (isMatch) {
    const g = tweenTo('hana-match-' + i, 1, 340)
    ctx.save()
    ctx.globalAlpha = 0.35 + 0.65 * g
    fillRoundRect(ctx, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 13, 'rgba(0,0,0,0)', COLORS.accent, 5)
    ctx.restore()
  }

  // 待盖回的两张：呼吸描边，提示「点任意处继续」
  if (isPendingCard) {
    const beat = pulse(800)
    ctx.save()
    ctx.globalAlpha = 0.25 + 0.45 * beat
    fillRoundRect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 13, 'rgba(0,0,0,0)', COLORS.red, 5)
    ctx.restore()
  }

  // 悬停高亮
  if (state.hover === i && !state.won && !state.pending && !up) {
    fillRoundRect(ctx, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 13, 'rgba(0,0,0,0)', 'rgba(255,255,255,0.55)', 3)
  }

  ctx.restore()
}

/** 牌背：靛蓝底 + 三日月纹样 */
function drawBack(ctx: CanvasRenderingContext2D, r: Rect): void {
  fillRoundRect(ctx, r.x + 9, r.y + 9, r.w - 18, r.h - 18, 10, 'rgba(255,255,255,0.06)')
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, r.w * 0.3, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 0.55
  drawMoon(ctx, cx, cy, r.w * 0.18, 0.25)
  ctx.restore()
}

/** 牌面：月相圆 + 花形符号 + 牌名，全部程序绘制 */
function drawFace(ctx: CanvasRenderingContext2D, r: Rect, kind: number): void {
  const month = monthOf(kind)
  const flower = flowerOf(kind)
  const cx = r.x + r.w / 2

  // 顶部：月相圆 + 月份数字
  drawMoon(ctx, cx, r.y + 42, 21, moonPhase(month))
  ctx.save()
  ctx.fillStyle = INK
  ctx.font = `bold 21px ${FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(month + 1), r.x + 10, r.y + 42)
  ctx.restore()

  // 中部：花形符号
  drawFlower(ctx, cx, r.y + r.h * 0.56, 34, flower)

  // 底部：牌名
  ctx.save()
  ctx.fillStyle = FLOWER_COLORS[flower]
  ctx.font = `bold 24px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(kindLabel(kind), cx, r.y + r.h - 22)
  ctx.restore()

  // 四周细边
  fillRoundRect(ctx, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 12, 'rgba(0,0,0,0)', withAlpha(FLOWER_COLORS[flower], 0.55), 2)
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
    const e = elapsedSince('hana-settle', `${state.first}:${state.second}`, SETTLE_MS)
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
    text(
      ctx,
      `已翻 ${state.flips} 次 · 配对 ${state.pairs}/${PAIR_KINDS} 对 · 翻错 ${state.misses} 次`,
      vw / 2,
      y + 96,
      { size: 23, color: COLORS.textDim },
    )
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
      out.push({ kind: 'burst', x, y, color: FLOWER_COLORS[flowerOf(next.kinds[i])], count: 16 })
    }
  }
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
          ? `已翻开${kindLabel(s.kinds[s.first])}，再翻一张找同月同花的牌`
          : '翻开两张同月同花的牌即可配对',
}

export default game
