/**
 * 猪尾巴渲染 + 输入映射。
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 *
 * 回合的「亮灯 / 呼吸 / 出题扫描」全部走 render/anim.ts 的旁路缓存：
 * 每帧用 elapsedSince / progressSince / tweenTo 现算，不把任何时间戳写进 state，
 * 因此 reduce 依旧可复盘。阶段推进只由显式 action（ready / pick / next）触发。
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import type { Rect } from '../../core/geom'
import { inRect } from '../../core/geom'
import { COLORS, PALETTE, background, banner, disc, ease, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { elapsedSince, keepAlive, progressSince, pulse, tweenTo } from '../../render/anim'
import meta from './meta'
import { MAX_TAIL, START_TAIL, create, reduce, type Action, type State } from './rules'

// ---------------- 布局常量（render 与 input 共用同一份，坐标永远不会不一致） ----------------

export const VW = 720
export const VH = 1280

/** 尾巴画成一圈向外舒展的螺线 */
const TAIL_CX = 360
const TAIL_CY = 560
const TAIL_R0 = 54
const TAIL_DR = 18
const TAIL_DA = 0.78
const TAIL_R_MAX = 40
const TAIL_R_MIN = 24

/** 色板：每行最多 4 个，整块居中 */
const SW_COLS = 4
const SW_SIZE = 116
const SW_GAP = 18
const SW_CY = 1060

/** 第 i 节的圆心（i 从 0 到 MAX_TAIL，可越界一格用于扫描动画的插值端点） */
export function segPos(i: number): [number, number] {
  const a = -Math.PI / 2 + i * TAIL_DA
  const r = TAIL_R0 + i * TAIL_DR
  return [TAIL_CX + Math.cos(a) * r, TAIL_CY + Math.sin(a) * r]
}

/** 第 i 节的半径：越靠尾尖越细 */
export function segRadius(i: number, total: number): number {
  const k = total <= 1 ? 0 : i / (total - 1)
  return TAIL_R_MAX + (TAIL_R_MIN - TAIL_R_MAX) * k
}

/** 第 i 个色块（0 起）的矩形 */
export function swatchRect(i: number, colorCount: number): Rect {
  const cols = Math.min(SW_COLS, colorCount)
  const rows = Math.ceil(colorCount / cols)
  const row = Math.floor(i / cols)
  const col = i % cols
  const inRow = row === rows - 1 ? colorCount - row * cols : cols
  const w = inRow * SW_SIZE + (inRow - 1) * SW_GAP
  const h = rows * SW_SIZE + (rows - 1) * SW_GAP
  return {
    x: (VW - w) / 2 + col * (SW_SIZE + SW_GAP),
    y: SW_CY - h / 2 + row * (SW_SIZE + SW_GAP),
    w: SW_SIZE,
    h: SW_SIZE,
  }
}

const colorOf = (i: number): string => PALETTE[i % PALETTE.length]

// ---------------- 文案 ----------------

function statusText(s: State): [string, string] {
  switch (s.phase) {
    case 'ask':
      return ['系统出题中', `AI 正在 ${s.tail.length} 节尾巴里挑一节`]
    case 'show':
      return ['记住这一节', `第 ${s.round + 1} 题 · 点亮的那一节是什么颜色`]
    case 'input':
      return ['轮到你还原', `第 ${s.round + 1} 题 · 被卷起的那一节，选出它原本的颜色`]
    case 'settle':
      return ['答对了！', `尾巴加长一节 · 现在共 ${s.tail.length} 节`]
    case 'won':
      return ['尾巴长到头', `${MAX_TAIL} 节全部还原成功`]
    case 'over':
      return ['还原失败', `本局停在 ${s.tail.length} 节`]
  }
}

// ---------------- 绘制 ----------------

/** 尾巴的连接线：从根到尖画成一串逐渐变细的圆头线段 */
function drawTailSpine(ctx: CanvasRenderingContext2D, s: State): void {
  const total = s.tail.length
  ctx.save()
  ctx.lineCap = 'round'
  for (let i = 0; i + 1 < total; i++) {
    const [x1, y1] = segPos(i)
    const [x2, y2] = segPos(i + 1)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.strokeStyle = withAlpha('#f06292', 0.45)
    ctx.lineWidth = segRadius(i, total) * 1.2
    ctx.stroke()
  }
  ctx.restore()
}

/** 被点亮的那一节的强调强度（0 表示不强调） */
function emphasis(s: State): number {
  if (s.phase === 'show') return 0.55 + 0.45 * pulse(900)
  if (s.phase === 'settle') return 0.4 + 0.3 * pulse(1100)
  return 0
}

/** 出题阶段的扫描光点：沿螺线跑一圈，暗示 AI 正在挑节 */
function drawScan(ctx: CanvasRenderingContext2D, s: State): void {
  const e = elapsedSince('pt-scan', `${s.round}/${s.tail.length}`, 2200)
  const u = ((e % 2000) / 2000) * s.tail.length
  const i = Math.floor(u)
  const f = u - i
  const [x1, y1] = segPos(i)
  const [x2, y2] = segPos(i + 1)
  const x = x1 + (x2 - x1) * f
  const y = y1 + (y2 - y1) * f
  ctx.save()
  ctx.shadowColor = COLORS.accent
  ctx.shadowBlur = 26
  disc(ctx, x, y, 13, COLORS.accent)
  ctx.restore()
}

function drawTail(ctx: CanvasRenderingContext2D, s: State): void {
  const total = s.tail.length
  drawTailSpine(ctx, s)

  const em = emphasis(s)
  // 题目刚点亮时的一次性闪光
  const since = elapsedSince('pt-show', `${s.round}/${s.quizIndex}/${s.quizColor}`, 560)
  const flash = since < 560 ? 1 - since / 560 : 0
  // 新长出来的那一节做一次弹入
  const grow = s.phase === 'ask' ? 1 : progressSince('pt-grow', `${s.round}`, 420, ease.outBack)
  const cover = s.phase === 'input'
  const reveal = s.phase === 'over' || s.phase === 'won'

  for (let i = 0; i < total; i++) {
    const [x, y] = segPos(i)
    const base = segRadius(i, total)
    const asked = i === s.quizIndex
    const on = asked ? em : 0
    const pop = i === total - 1 ? Math.max(0.05, grow) : 1
    const r = base * pop * (1 + on * 0.14)

    // 输入阶段把被问到的那一节卷起来遮住；结束时把它摊开露出真实颜色
    if (asked && cover && !reveal) {
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.5)'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = COLORS.panel
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.lineWidth = 4
      ctx.strokeStyle = withAlpha(COLORS.accent, 0.85)
      ctx.stroke()
      ctx.restore()
      text(ctx, '?', x, y + 2, { size: Math.round(r * 1.1), color: COLORS.accent, weight: 'bold' })
      continue
    }

    const wrong = asked && s.lastWrong && s.phase === 'over'
    const c = wrong ? COLORS.red : colorOf(s.tail[i])
    ctx.save()
    if (on > 0 || flash > 0) {
      ctx.shadowColor = c
      ctx.shadowBlur = 24 + 46 * Math.max(on, flash)
    }
    disc(ctx, x, y, r, c, { ring: asked && reveal ? COLORS.accent : undefined })
    ctx.restore()

    // 节序：给每节标上序号，尾巴越长越容易定位
    text(ctx, String(i + 1), x, y, { size: Math.max(18, Math.round(r * 0.62)), color: 'rgba(0,0,0,0.45)', weight: 'bold' })
  }
}

function drawGrowth(ctx: CanvasRenderingContext2D, s: State): void {
  const span = MAX_TAIL - START_TAIL
  const cur = tweenTo('pt-growth', s.tail.length - START_TAIL, 420, ease.outBack)
  const x = 80
  const y = 214
  const w = VW - x * 2
  text(ctx, `尾巴 ${s.tail.length} / ${MAX_TAIL} 节`, x + w, y - 22, { size: 25, align: 'right', color: COLORS.textDim })
  fillRoundRect(ctx, x, y, w, 16, 8, 'rgba(255,255,255,0.12)')
  fillRoundRect(ctx, x, y, w * Math.min(1, cur / span), 16, 8, COLORS.accent)
}

function drawPalette(ctx: CanvasRenderingContext2D, s: State): void {
  // 未轮到玩家时色板淡出，避免误导成可点
  const live = s.phase === 'input'
  for (let i = 0; i < s.colorCount; i++) {
    const rect = swatchRect(i, s.colorCount)
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    const chosen = s.lastPick === i
    const right = chosen && s.phase === 'settle'
    const wrong = chosen && s.lastWrong && s.phase === 'over'
    const answer = s.phase === 'over' && s.quizColor === i
    const c = wrong ? COLORS.red : colorOf(i)

    ctx.save()
    ctx.globalAlpha = live || chosen || answer ? 1 : 0.42
    if (chosen || answer) {
      ctx.shadowColor = c
      ctx.shadowBlur = 26
    }
    disc(ctx, cx, cy, SW_SIZE / 2 - 10, c, { ring: answer && !chosen ? COLORS.accent : undefined })
    ctx.restore()

    text(ctx, String(i + 1), cx, cy, { size: 34, color: 'rgba(0,0,0,0.42)', weight: 'bold' })
    if (answer) {
      text(ctx, '就是它', cx, rect.y + rect.h - 6, { size: 22, color: COLORS.accent, weight: 'bold' })
    } else if (right) {
      text(ctx, '✓', cx, rect.y + rect.h - 6, { size: 26, color: COLORS.green, weight: 'bold' })
    }
  }
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  keepAlive()
  background(ctx, VW, VH, '#2a1220', '#0d0710')

  const [main, sub] = statusText(s)
  topBar(ctx, VW, `尾巴 ${s.tail.length} 节`, s.phase === 'won' ? '通关' : `第 ${s.round + 1} 题`, 96)
  shadowText(ctx, main, VW / 2, 150, { size: 34 })
  text(ctx, sub, VW / 2, 190, { size: 25, color: COLORS.textDim })

  drawGrowth(ctx, s)
  if (s.phase === 'ask') drawScan(ctx, s)
  drawTail(ctx, s)
  drawPalette(ctx, s)

  if (s.phase === 'won') banner(ctx, VW, VH, '通关！', `${MAX_TAIL} 节尾巴全记住`)
  else if (s.phase === 'over') banner(ctx, VW, VH, '还原失败', `停在 ${s.tail.length} 节`, COLORS.red)
}

// ---------------- 输入 ----------------

function input(s: State, p: PointerInput): Action | null {
  if (p.kind !== 'down') return null
  // 出题 / 展示 / 结算阶段：点画面任意处即可推进
  if (s.phase === 'ask' || s.phase === 'show') return { type: 'ready' }
  if (s.phase === 'settle') return { type: 'next' }
  if (s.phase !== 'input') return null
  for (let i = 0; i < s.colorCount; i++) {
    if (inRect(p, swatchRect(i, s.colorCount))) return { type: 'pick', color: i }
  }
  return null
}

function key(s: State, k: string): Action | null {
  if (k === ' ' || k === 'Enter') {
    if (s.phase === 'ask' || s.phase === 'show') return { type: 'ready' }
    return s.phase === 'settle' ? { type: 'next' } : null
  }
  if (s.phase !== 'input') return null
  const n = Number(k)
  if (k.length !== 1 || !Number.isInteger(n) || n < 1 || n > s.colorCount) return null
  return { type: 'pick', color: n - 1 }
}

// ---------------- 副作用 ----------------

function effects(prev: State, next: State): Effect[] {
  if (next.phase === 'won' && prev.phase !== 'won') {
    const out: Effect[] = [
      { kind: 'sound', name: 'win' },
      { kind: 'flash', color: 'rgba(255,204,51,0.3)' },
    ]
    for (let i = 0; i < next.tail.length; i++) {
      const [x, y] = segPos(i)
      out.push({ kind: 'burst', x, y, color: colorOf(next.tail[i]), count: 8 })
    }
    return out
  }
  if (next.phase === 'over' && prev.phase !== 'over') {
    const out: Effect[] = [{ kind: 'sound', name: 'error' }, { kind: 'shake', power: 12 }]
    if (next.lastPick >= 0) {
      const rect = swatchRect(next.lastPick, next.colorCount)
      out.push({ kind: 'burst', x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, color: COLORS.red, count: 18 })
    }
    return out
  }
  // 答对：尾巴长出来的那一节炸一下
  if (next.phase === 'settle' && prev.phase === 'input') {
    const last = next.tail.length - 1
    const [x, y] = segPos(last)
    return [
      { kind: 'sound', name: 'score' },
      { kind: 'burst', x, y, color: colorOf(next.tail[last]), count: 22 },
    ]
  }
  if (next.phase === 'show' && prev.phase === 'ask') return [{ kind: 'sound', name: 'tick' }]
  if (next.phase === 'input' && prev.phase === 'show') return [{ kind: 'sound', name: 'flip' }]
  if (next.phase === 'ask' && prev.phase === 'settle') return [{ kind: 'sound', name: 'place' }]
  return []
}

function outcome(s: State): Outcome | null {
  if (s.phase !== 'over' && s.phase !== 'won') return null
  return { score: s.tail.length, better: 'higher', unit: ' 节', win: s.phase === 'won' }
}

function hint(s: State): string {
  switch (s.phase) {
    case 'ask':
      return `第 ${s.round + 1} 题：系统正在出题，点画面开始`
    case 'show':
      return `记住点亮的那一节是什么颜色（尾巴共 ${s.tail.length} 节）`
    case 'input':
      return `第 ${s.round + 1} 题：那一节已被卷起，选出它原本的颜色`
    case 'settle':
      return `答对了！尾巴长到 ${s.tail.length} 节，点「下一题」继续`
    case 'won':
      return `通关！${MAX_TAIL} 节尾巴全部还原成功`
    case 'over':
      return `还原失败，本局停在 ${s.tail.length} 节`
  }
}

function controls(s: State): Control<Action>[] {
  if (s.phase === 'ask') return [{ label: '让系统出题', action: { type: 'ready' }, primary: true }]
  if (s.phase === 'show') return [{ label: '记住了，开始还原', action: { type: 'ready' }, primary: true }]
  if (s.phase === 'settle') return [{ label: '下一题', action: { type: 'next' }, primary: true }]
  return []
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
