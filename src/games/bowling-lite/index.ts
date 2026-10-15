/**
 * 保龄球简化版 bowling-lite —— 渲染与输入层。
 *
 * 本文件只负责「画」和「把输入翻译成 action」：真实 dt 由 tick() 折算成整数 tick 数，
 * 物理与计分全部在 rules.ts 内以定步纯函数推进。
 */
import type { GameModule, Effect, Outcome, PointerInput, Control } from '../../core/types'
import { meta } from './meta'
import {
  VW,
  VH,
  DT,
  FRAMES,
  PIN_R,
  BALL_R,
  ANGLE_MAX,
  WALL_MARGIN,
  HEADPIN_Y,
  PIT_Y,
  BALL_START_X,
  BALL_START_Y,
  create,
  reduce,
  currentScore,
  totalScore,
  clampAngle,
} from './rules'
import type { Action, State, Pin, FallenPin } from './rules'
import { COLORS, background, fillRoundRect, text, shadowText, banner, topBar, disc, withAlpha } from '../../render/draw'
import { clamp } from '../../core/geom'

const LANE_X = 40
const LANE_W = VW - LANE_X * 2
const LANE_TOP = PIT_Y - 60
const GUTTER_W = 34

/** 瓶的外观：圆身 + 圆颈 + 红环 */
function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha = 1): void {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = COLORS.white
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = r * 0.4
  ctx.shadowOffsetY = r * 0.12
  ctx.beginPath()
  ctx.ellipse(x, y + r * 0.15, r * 0.8, r, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(x, y - r * 0.95, r * 0.38, r * 0.44, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = COLORS.red
  ctx.fillRect(x - r * 0.4, y - r * 0.4, r * 0.8, r * 0.26)
  ctx.restore()
}

/** 倒下的瓶：淡出的小标记，表示「已移出物理世界」 */
function drawFallen(ctx: CanvasRenderingContext2D, f: FallenPin): void {
  const a = clamp(1 - f.life / 260, 0.18, 0.6)
  ctx.save()
  ctx.globalAlpha = a
  ctx.strokeStyle = COLORS.textDim
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(f.x, f.y, PIN_R * 0.7, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(f.x - PIN_R * 0.45, f.y - PIN_R * 0.45)
  ctx.lineTo(f.x + PIN_R * 0.45, f.y + PIN_R * 0.45)
  ctx.moveTo(f.x + PIN_R * 0.45, f.y - PIN_R * 0.45)
  ctx.lineTo(f.x - PIN_R * 0.45, f.y + PIN_R * 0.45)
  ctx.stroke()
  ctx.restore()
}

function drawLane(ctx: CanvasRenderingContext2D): void {
  fillRoundRect(ctx, LANE_X - GUTTER_W, LANE_TOP, LANE_W + GUTTER_W * 2, VH - LANE_TOP, 28, '#3a2a1c')
  fillRoundRect(ctx, LANE_X, LANE_TOP, LANE_W, VH - LANE_TOP, 20, COLORS.wood)
  // 后坑
  ctx.fillStyle = COLORS.black
  ctx.fillRect(LANE_X, LANE_TOP, LANE_W, HEADPIN_Y - 150 - LANE_TOP)
  // 引导线
  ctx.strokeStyle = withAlpha(COLORS.woodDark, 0.55)
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(VW / 2, LANE_TOP)
  ctx.lineTo(VW / 2, VH)
  ctx.stroke()
  // 瞄准箭头
  ctx.fillStyle = withAlpha(COLORS.woodDark, 0.5)
  for (let i = 0; i < 5; i++) {
    const y = 760 + i * 78
    for (const s of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(VW / 2 + s * 16, y)
      ctx.lineTo(VW / 2 + s * 34, y + 22)
      ctx.lineTo(VW / 2 + s * 52, y)
      ctx.closePath()
      ctx.fill()
    }
  }
  // 边界
  ctx.strokeStyle = withAlpha(COLORS.line, 0.7)
  ctx.lineWidth = 4
  ctx.strokeRect(WALL_MARGIN, LANE_TOP, VW - WALL_MARGIN * 2, VH - LANE_TOP - WALL_MARGIN)
}

/**
 * 力度条 + 瞄准线（纯 HUD，不是按钮）。
 *
 * 底部空档很窄：球停在 y=1180（底边约 1194），画布到 1280。力度读数、角度读数、
 * 力度条三者原来各自占一条基线（1200 / 1216 / 1218~1244），后两条直接叠在一起。
 * 现在把两个读数**合并进力度条内部**，底部只留这一个元素。
 */
function drawAim(ctx: CanvasRenderingContext2D, s: State): void {
  const bx = 180
  const bw = VW - 360
  const by = VH - 62
  const bh = 30
  fillRoundRect(ctx, bx, by, bw, bh, bh / 2, 'rgba(0,0,0,0.45)', COLORS.line, 2)
  const w = Math.max(0.04, s.power) * bw
  fillRoundRect(ctx, bx + 3, by + 3, (bw - 6) * w, bh - 6, (bh - 6) / 2, COLORS.accent)
  text(ctx, `力度 ${Math.round(s.power * 100)}% · 角度 ${((s.angle / ANGLE_MAX) * 100).toFixed(0)}%`, VW / 2, by + bh / 2 + 1, {
    size: 22,
    weight: 'bold',
    color: COLORS.text,
  })

  // 瞄准线
  const len = 120 + s.power * 300
  const ex = BALL_START_X + Math.sin(s.angle) * len
  const ey = BALL_START_Y - Math.cos(s.angle) * len
  ctx.save()
  ctx.strokeStyle = withAlpha(COLORS.accent2, 0.75)
  ctx.lineWidth = 5
  ctx.setLineDash([16, 14])
  ctx.beginPath()
  ctx.moveTo(BALL_START_X, BALL_START_Y - BALL_R)
  ctx.lineTo(ex, ey)
  ctx.stroke()
  ctx.restore()
  // 角度读数已并入力度条内部，这里不再单画一行（否则会与力度读数叠字）
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, COLORS.bg2, COLORS.bg)
  drawLane(ctx)
  for (const f of s.fallen) drawFallen(ctx, f)
  for (const p of s.pins) drawPin(ctx, p.x, p.y, PIN_R)
  if (s.ball) {
    disc(ctx, s.ball.x, s.ball.y, BALL_R, '#31456b')
    ctx.fillStyle = '#0b1524'
    for (const [ox, oy] of [
      [-5, 4],
      [0, 6],
      [5, 4],
    ]) {
      ctx.beginPath()
      ctx.arc(s.ball.x + ox, s.ball.y + oy, 2.4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  if (s.phase === 'aim') drawAim(ctx, s)

  topBar(ctx, VW, `第 ${Math.min(s.frame + 1, FRAMES)} 局`, `总分 ${currentScore(s)}`)
  text(ctx, `第 ${s.balls.length + 1} 球`, VW - 150, 130, { size: 28, color: COLORS.textDim })

  if (s.phase === 'done') {
    banner(ctx, VW, VH, `总分 ${totalScore(s)}`, `十局结束 · 新的一局可刷新纪录`)
  } else {
    shadowText(ctx, `本局 ${currentScore(s) - totalScore(s)} 分`, VW / 2, 130, { size: 30, color: COLORS.accent })
  }
}

function input(state: State, p: PointerInput): Action | null {
  if (state.phase === 'done') return null
  if (p.kind === 'down') return { type: 'dragStart', x: p.x, y: p.y }
  if (p.kind === 'move' && p.pressed) return { type: 'dragMove', x: p.x, y: p.y }
  if (p.kind === 'up' && state.drag) return { type: 'swing' }
  return null
}

function key(state: State, k: string): Action | null {
  if (state.phase === 'done') return null
  if (k === 'ArrowLeft') return { type: 'aim', angle: clampAngle(state.angle - 0.02) }
  if (k === 'ArrowRight') return { type: 'aim', angle: clampAngle(state.angle + 0.02) }
  if (k === 'ArrowDown') return { type: 'power', power: state.power - 0.05 }
  if (k === 'ArrowUp') return { type: 'power', power: state.power + 0.05 }
  if (k === ' ' || k === 'Enter') return { type: 'swing' }
  return null
}

function controls(state: State): Control<Action>[] {
  const aiming = state.phase === 'aim'
  return [
    {
      label: '力度−',
      action: { type: 'power', power: state.power - 0.2 },
      disabled: !aiming || state.power <= 0.001,
    },
    {
      label: '力度+',
      action: { type: 'power', power: state.power + 0.2 },
      disabled: !aiming || state.power >= 0.999,
    },
    { label: '出球', action: { type: 'swing' }, disabled: !aiming, primary: true },
  ]
}

function hint(s: State): string {
  if (s.phase === 'done') return `十局结束，总分 ${totalScore(s)}`
  return `第 ${s.frame + 1} 局 · 第 ${s.balls.length + 1} 球 · 总分 ${currentScore(s)}｜拖动瞄准，松手投球`
}

function outcome(s: State): Outcome | null {
  if (s.phase !== 'done') return null
  const score = totalScore(s)
  return { score, better: 'higher', unit: '分', win: score >= 100 }
}

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  const knocked = next.fallen.length - prev.fallen.length
  for (let i = 0; i < Math.min(knocked, 4); i++) out.push({ kind: 'sound', name: 'hit' })
  if (next.ball && !prev.ball) out.push({ kind: 'sound', name: 'click' })
  if (next.frames.length > prev.frames.length) out.push({ kind: 'sound', name: 'score' })
  if (next.phase === 'done' && prev.phase !== 'done') out.push({ kind: 'sound', name: 'win' })
  return out
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  input,
  key,
  /** 真实 dt(ms) → 整数 tick 数，交给 rules 定步推进 */
  tick: (dt: number) => ({ type: 'step', n: clamp(Math.round(dt / (DT * 1000)), 0, 3) }),
  hint,
  controls,
  outcome,
  effects,
}

export default game
export { meta }
export type { Pin }
