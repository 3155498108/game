/**
 * 打地鼠 · 游戏模块装配（渲染 + 输入 + 时间推进旁路）。
 *
 * rules.ts 保持纯逻辑：这里的墙上时钟只用于把真实 dt 折算成整数 tick，
 * 再通过 action 交给 reduce，从不直接写 state。
 *
 * 「探头 → 缩回」的位移插值走 render/anim.ts 的旁路缓存（tweenTo / elapsedSince），
 * 动画状态一律不进 state，因此 reduce 依旧可复盘。
 */
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { COLORS, background, banner, disc, fillRoundRect, shadowText, text, withAlpha } from '../../render/draw'
import { elapsedSince, keepAlive, tweenTo } from '../../render/anim'
import type { Rect } from '../../core/geom'
import { gridHit, inRect } from '../../core/geom'
import meta from './meta'
import {
  HOLE_COUNT,
  TICK_MS,
  TIME_TICKS,
  accuracy,
  create,
  reduce,
  remainingSeconds,
  type Action,
  type State,
} from './rules'

const VW = meta.viewport.width
const VH = meta.viewport.height
/** 顶部信息栏高度 */
const HUD_H = 96

// ---------------- 布局常量（render 与 input 共用同一份，坐标永远不会不一致） ----------------

/** 洞的网格：3×3 */
export const GRID_COLS = 3
export const GRID_ROWS = 3
/** 洞心的列距 / 行距 */
export const COL_STEP = 200
export const ROW_STEP = 220
/** 网格左上角（gridHit 粗定位用） */
export const GRID_X = 60
export const GRID_Y = 320
/** 网格中心列 / 第一行洞的洞心 y */
export const GRID_CX = 360
export const GRID_TOP = 430
/** 坑口椭圆的半径 */
export const HOLE_RX = 76
export const HOLE_RY = 42
/** 地鼠露出坑口的最大高度：命中区上沿比洞心高这么多 */
export const HEAD_H = 92

/** 第 i 个洞（0 起）的洞心 */
export function holeCenter(i: number): [number, number] {
  const c = i % GRID_COLS
  const r = Math.floor(i / GRID_COLS)
  return [GRID_CX + (c - 1) * COL_STEP, GRID_TOP + r * ROW_STEP]
}

/** 第 i 个洞的命中矩形：盖住坑口与地鼠露头的部分，render 与 input 都用它 */
export function holeRect(i: number): Rect {
  const [cx, cy] = holeCenter(i)
  return { x: cx - HOLE_RX, y: cy - HEAD_H, w: HOLE_RX * 2, h: HEAD_H + HOLE_RY }
}

// ---------------- 配色 ----------------

/** 泥土色（坑周围的土堆） */
const DIRT = '#4a3520'
/** 坑底色 */
const PIT = '#150d06'
/** 地鼠身体 */
const MOLE = '#8d6748'
/** 地鼠耳朵 */
const MOLE_DARK = '#6d4b30'

// ---------------- 时间推进（渲染层的运行时状态，不是游戏状态） ----------------

/** 真实 dt 的零头：折算成整数 tick 后把余量留到下一帧，游戏时钟才不会走快 */
let acc = 0

/** 把真实 dt(ms) 折算成整数 tick */
function tick(dt: number): Action {
  const ms = Number.isFinite(dt) ? Math.max(0, dt) : 0
  acc += ms
  const ticks = Math.floor(acc / TICK_MS)
  acc -= ticks * TICK_MS
  return { type: 'tick', ticks }
}

// ---------------- 输入 ----------------

function input(state: State, p: PointerInput): Action | null {
  if (state.over) return null
  if (p.kind !== 'down') return null
  // 先用网格粗定位到 3×3 的哪一格，再用矩形精确判定（命中区含地鼠露头部分）
  const hit = gridHit(p, GRID_X, GRID_Y, COL_STEP, ROW_STEP, GRID_COLS, GRID_ROWS)
  if (!hit) return null
  const hole = hit[1] * GRID_COLS + hit[0]
  if (!inRect(p, holeRect(hole))) return null
  return { type: 'whack', hole }
}

function key(state: State, k: string): Action | null {
  if (state.over) return null
  if (k >= '1' && k <= '9') {
    const hole = Number(k) - 1
    if (hole < HOLE_COUNT) return { type: 'whack', hole }
  }
  if (k === 'r' || k === 'R') return { type: 'restart' }
  return null
}

// ---------------- 绘制 ----------------

/** 画一只地鼠（body 中心随 up 上下移动，up=1 完全露出，up=0 缩回坑里） */
function drawMole(ctx: CanvasRenderingContext2D, cx: number, cy: number, up: number): void {
  const my = cy + 62 - up * 88
  const r = 46
  // 耳朵
  disc(ctx, cx - 33, my - 34, 15, MOLE_DARK)
  disc(ctx, cx + 33, my - 34, 15, MOLE_DARK)
  // 身体
  disc(ctx, cx, my, r, MOLE)
  // 门牙
  ctx.fillStyle = '#f6f1e4'
  ctx.fillRect(cx - 9, my + 18, 7, 11)
  ctx.fillRect(cx + 2, my + 18, 7, 11)
  // 眼睛
  disc(ctx, cx - 17, my - 8, 12, '#fafafa')
  disc(ctx, cx + 17, my - 8, 12, '#fafafa')
  disc(ctx, cx - 15, my - 6, 6, '#1b1b1f')
  disc(ctx, cx + 15, my - 6, 6, '#1b1b1f')
  // 鼻子
  ctx.beginPath()
  ctx.ellipse(cx, my + 10, 9, 7, 0, 0, Math.PI * 2)
  ctx.fillStyle = '#e59a9a'
  ctx.fill()
}

/** 画一个洞：土堆 → 坑 → 地鼠 → 前沿土堆（把地鼠下半身挡住，做出「钻出来」的层次） */
function renderHole(ctx: CanvasRenderingContext2D, s: State, i: number): void {
  const [cx, cy] = holeCenter(i)
  const h = s.holes[i]

  // 坑周围的土堆
  ctx.beginPath()
  ctx.ellipse(cx, cy, HOLE_RX + 16, HOLE_RY + 12, 0, 0, Math.PI * 2)
  ctx.fillStyle = DIRT
  ctx.fill()

  // 坑底
  ctx.beginPath()
  ctx.ellipse(cx, cy, HOLE_RX, HOLE_RY, 0, 0, Math.PI * 2)
  ctx.fillStyle = PIT
  ctx.fill()

  // 地鼠：探头 / 缩回的位移由旁路补间给出，动画状态不进 state
  const up = tweenTo(`wam-hole-${i}`, h.mole ? 1 : 0, 170)
  if (up > 0.002) {
    ctx.save()
    // 裁到坑心以上：地鼠缩回去时被坑沿挡住
    ctx.beginPath()
    ctx.rect(cx - HOLE_RX - 30, cy - 260, (HOLE_RX + 30) * 2, 260)
    ctx.clip()
    drawMole(ctx, cx, cy, up)
    ctx.restore()
  }

  // 前沿土堆（盖住地鼠下半身）
  ctx.beginPath()
  ctx.ellipse(cx, cy, HOLE_RX + 16, HOLE_RY + 12, 0, 0, Math.PI)
  ctx.closePath()
  ctx.fillStyle = DIRT
  ctx.fill()
}

/** 敲中的反馈：冲击圈 + 飘分（签名用敲击只数，敲一次变一次） */
function renderHitFx(ctx: CanvasRenderingContext2D, s: State): void {
  if (!s.lastHit || s.lastHole < 0) return
  const [hx, hy] = holeCenter(s.lastHole)
  const e = elapsedSince('wam-hit', String(s.whacks), 320)
  if (e < 320) {
    const k = e / 320
    ctx.save()
    ctx.globalAlpha = 1 - k
    ctx.strokeStyle = COLORS.accent
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.ellipse(hx, hy, HOLE_RX * (0.45 + k * 0.8), HOLE_RY * (0.45 + k * 0.8), 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  const t = elapsedSince('wam-score', String(s.whacks), 700)
  if (t < 700) {
    shadowText(ctx, '+10', hx, hy - HEAD_H - 16 - t * 0.05, { size: 38, color: COLORS.accent })
  }
}

/** 顶部信息栏：剩余秒数 / 分数 / 命中率 / 剩余时间进度条 */
function renderHud(ctx: CanvasRenderingContext2D, s: State): void {
  const sec = Math.max(0, Math.ceil(remainingSeconds(s)))
  ctx.fillStyle = 'rgba(0,0,0,0.32)'
  ctx.fillRect(0, 0, VW, HUD_H)
  text(ctx, `剩余 ${sec} 秒`, 30, 48, {
    size: 34,
    align: 'left',
    weight: 'bold',
    color: sec <= 10 ? COLORS.red : COLORS.text,
  })
  text(ctx, `得分 ${s.score}`, VW - 30, 48, { size: 34, align: 'right', weight: 'bold', color: COLORS.accent })
  text(ctx, `命中率 ${(accuracy(s) * 100).toFixed(0)}% · 敲中 ${s.whacks} · 失误 ${s.misses}`, VW / 2, 124, {
    size: 26,
    color: COLORS.textDim,
  })
  // 剩余时间进度条
  const barX = 30
  const barW = VW - 60
  const barY = 158
  const barH = 12
  fillRoundRect(ctx, barX, barY, barW, barH, barH / 2, 'rgba(0,0,0,0.35)')
  const left = Math.max(0, s.ticksLeft / TIME_TICKS)
  if (left > 0) {
    const barColor = left <= 0.2 ? COLORS.red : COLORS.accent2
    fillRoundRect(ctx, barX, barY, Math.max(barH, barW * left), barH, barH / 2, barColor)
  }
}

/** 洞区背后的地面 */
function renderGround(ctx: CanvasRenderingContext2D): void {
  fillRoundRect(ctx, 30, 286, VW - 60, 700, 52, withAlpha(DIRT, 0.45))
}

/** 底部提示 */
function renderTip(ctx: CanvasRenderingContext2D, s: State): void {
  const tip = s.over
    ? `本局敲中 ${s.whacks} 只 · 得分 ${s.score} · 命中率 ${(accuracy(s) * 100).toFixed(0)}%`
    : '看到地鼠就点它所在的洞，点空算一次失误'
  fillRoundRect(ctx, 60, VH - 236, VW - 120, 116, 28, 'rgba(0,0,0,0.28)')
  text(ctx, tip, VW / 2, VH - 178, { size: 28, weight: 'bold' })
}

/** 终局结算 */
function renderOver(ctx: CanvasRenderingContext2D, s: State): void {
  const acc = (accuracy(s) * 100).toFixed(1)
  banner(ctx, VW, VH, '时间到', `得分 ${s.score} · 命中率 ${acc}%`)
  const lines = [`敲中 ${s.whacks} 只`, `失误 ${s.misses} 次`, `命中率 ${acc}%`]
  lines.forEach((line, i) => {
    shadowText(ctx, line, VW / 2, VH / 2 + 132 + i * 48, {
      size: 34,
      color: i === 2 ? COLORS.accent : COLORS.text,
      weight: i === 2 ? 'bold' : 'normal',
    })
  })
  text(ctx, '点提示区的「重开」再来一次', VW / 2, VH / 2 + 302, { size: 26, color: COLORS.textDim })
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  keepAlive()
  background(ctx, VW, VH, '#3a2a18', '#150e07')
  renderHud(ctx, s)
  renderGround(ctx)
  for (let i = 0; i < HOLE_COUNT; i++) renderHole(ctx, s, i)
  renderHitFx(ctx, s)
  renderTip(ctx, s)
  if (s.over) renderOver(ctx, s)
}

// ---------------- 提示与成绩 ----------------

function hint(s: State): string {
  if (s.over) {
    return `时间到：得分 ${s.score}，敲中 ${s.whacks} 只，命中率 ${(accuracy(s) * 100).toFixed(0)}%`
  }
  return `点地鼠！剩余 ${Math.max(0, Math.ceil(remainingSeconds(s)))} 秒 · 得分 ${s.score} · 命中率 ${(accuracy(s) * 100).toFixed(0)}%`
}

function outcome(s: State): Outcome | null {
  if (!s.over) return null
  return { score: s.score, better: 'higher', unit: '分' }
}

function controls(_s: State) {
  return [{ label: '重开', action: { type: 'restart' } as Action, primary: true }]
}

/** 从状态迁移推导副作用，reduce 本身保持纯净 */
function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (next.whacks > prev.whacks) {
    const [x, y] = holeCenter(next.lastHole)
    out.push({ kind: 'burst', x, y: y - 30, color: COLORS.accent, count: 14 })
    out.push({ kind: 'sound', name: 'hit' })
  } else if (next.misses > prev.misses) {
    out.push({ kind: 'sound', name: 'error' })
  }
  if (next.over && !prev.over) {
    out.push({ kind: 'sound', name: 'win' })
    out.push({ kind: 'flash', color: 'rgba(255,204,51,0.25)' })
  }
  return out
}

// ---------------- 导出 ----------------

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
  tick,
}

export default game
export { meta, create, reduce, render, input, key, effects, outcome, hint, controls, tick }
