/**
 * 高尔夫球：渲染与输入层。
 * 规则全部在 rules.ts，本文件只负责把状态画出来、把指针/键盘翻成 action。
 * 注意：画布上不画「新的一局」按钮，也不重复画 controls() 声明的控件，站点壳会自动追加。
 */
import { clamp } from '../../core/geom'
import type { Effect, GameModule, PointerInput } from '../../core/types'
import {
  COLORS,
  background,
  banner,
  disc,
  fillRoundRect,
  shadowText,
  text,
  topBar,
} from '../../render/draw'
import { meta } from './meta'
import {
  AI,
  BALL_R,
  CELL_H,
  CELL_W,
  COLS,
  CUP_R,
  FIELD_H,
  FIELD_W,
  FIELD_X,
  FIELD_Y,
  PLAYER,
  ROWS,
  TICK_MS,
  TERRAINS,
  TERRAIN_LABEL,
  aimAngle,
  aiAction,
  canPlay,
  controls,
  create,
  currentHole,
  hint,
  outcome,
  reduce,
  totalStrokes,
} from './rules'
import type { Action, State, Terrain } from './rules'

const VW = meta.viewport.width
const VH = meta.viewport.height

/** 方向滑条 */
const SLIDER = { x: 40, y: 872, w: 640, h: 46 }
/** 力度条 */
const POWER = { x: 40, y: 986, w: 640, h: 56 }

const TERRAIN_COLOR: Record<Terrain, string> = {
  fair: '#4c8f57',
  grass: '#2f6b3c',
  sand: '#d9c489',
  water: '#2f6fb5',
}

/** 球场区域（点击 = 按住蓄力） */
const COURSE = { x: FIELD_X, y: FIELD_Y, w: FIELD_W, h: FIELD_H }

function inBox(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

// ---------------------------------------------------------------- 渲染

function renderCourse(ctx: CanvasRenderingContext2D, state: State): void {
  const hole = currentHole(state)
  // 外框
  fillRoundRect(ctx, FIELD_X - 8, FIELD_Y - 8, FIELD_W + 16, FIELD_H + 16, 18, 'rgba(0,0,0,0.28)')

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const tile = hole.tiles[row * COLS + col]
      const x = FIELD_X + col * CELL_W
      const y = FIELD_Y + row * CELL_H
      ctx.fillStyle = TERRAIN_COLOR[tile]
      ctx.fillRect(x, y, CELL_W + 0.5, CELL_H + 0.5)
      ctx.strokeStyle = 'rgba(0,0,0,0.10)'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 0.5, y + 0.5, CELL_W, CELL_H)
      if (tile === 'water') {
        ctx.fillStyle = 'rgba(255,255,255,0.16)'
        ctx.fillRect(x + 6, y + CELL_H / 2 - 1.5, CELL_W - 12, 3)
      } else if (tile === 'sand') {
        ctx.fillStyle = 'rgba(120,92,40,0.20)'
        ctx.beginPath()
        ctx.arc(x + CELL_W * 0.35, y + CELL_H * 0.4, 2.2, 0, Math.PI * 2)
        ctx.arc(x + CELL_W * 0.68, y + CELL_H * 0.66, 1.8, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  // 发球点
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(hole.tee.x, hole.tee.y, 10, 0, Math.PI * 2)
  ctx.stroke()

  // 球洞：深色洞口 + 旗杆
  ctx.fillStyle = '#0d2a15'
  ctx.beginPath()
  ctx.arc(hole.cup.x, hole.cup.y, CUP_R, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.strokeStyle = COLORS.text
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(hole.cup.x, hole.cup.y)
  ctx.lineTo(hole.cup.x, hole.cup.y - 46)
  ctx.stroke()
  ctx.fillStyle = COLORS.red
  ctx.beginPath()
  ctx.moveTo(hole.cup.x, hole.cup.y - 46)
  ctx.lineTo(hole.cup.x + 30, hole.cup.y - 36)
  ctx.lineTo(hole.cup.x, hole.cup.y - 26)
  ctx.closePath()
  ctx.fill()
  text(ctx, `洞 ${state.holeIndex + 1} · par ${hole.par}`, hole.cup.x, hole.cup.y - 68, { size: 22, color: COLORS.text })
}

function renderAim(ctx: CanvasRenderingContext2D, state: State): void {
  const playable = canPlay(state) || state.phase === 'charging'
  if (!playable) return
  const angle = aimAngle(state.aim)
  const len = 46 + state.power * 150
  const ex = state.ball.x + Math.cos(angle) * len
  const ey = state.ball.y + Math.sin(angle) * len

  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 4
  ctx.setLineDash([12, 10])
  ctx.beginPath()
  ctx.moveTo(state.ball.x + Math.cos(angle) * (BALL_R + 4), state.ball.y + Math.sin(angle) * (BALL_R + 4))
  ctx.lineTo(ex, ey)
  ctx.stroke()
  ctx.setLineDash([])

  // 箭头
  const head = angle + Math.PI
  ctx.fillStyle = COLORS.accent
  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex + Math.cos(head - 0.4) * 22, ey + Math.sin(head - 0.4) * 22)
  ctx.lineTo(ex + Math.cos(head + 0.4) * 22, ey + Math.sin(head + 0.4) * 22)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function renderPanel(ctx: CanvasRenderingContext2D, state: State): void {
  // 方向滑条
  fillRoundRect(ctx, SLIDER.x, SLIDER.y, SLIDER.w, SLIDER.h, SLIDER.h / 2, 'rgba(0,0,0,0.35)')
  const knobX = SLIDER.x + state.aim * SLIDER.w
  const deg = Math.round((aimAngle(state.aim) * 180) / Math.PI)
  fillRoundRect(ctx, SLIDER.x + 4, SLIDER.y + 4, Math.max(0, knobX - SLIDER.x - 4), SLIDER.h - 8, (SLIDER.h - 8) / 2, 'rgba(79,209,197,0.45)')
  disc(ctx, knobX, SLIDER.y + SLIDER.h / 2, 26, COLORS.accent2, { ring: 'rgba(255,255,255,0.8)' })
  text(ctx, '方向', 34, SLIDER.y + SLIDER.h / 2, { size: 24, align: 'right', color: COLORS.textDim })
  text(ctx, `${deg}°`, SLIDER.x + SLIDER.w + 6, SLIDER.y + SLIDER.h / 2, { size: 24, align: 'left', color: COLORS.accent2 })

  // 力度条
  fillRoundRect(ctx, POWER.x, POWER.y, POWER.w, POWER.h, 12, 'rgba(0,0,0,0.35)')
  const fill = POWER.w * state.power
  if (fill > 4) {
    const g = ctx.createLinearGradient(POWER.x, 0, POWER.x + POWER.w, 0)
    g.addColorStop(0, COLORS.accent2)
    g.addColorStop(1, COLORS.accent)
    ctx.save()
    ctx.beginPath()
    ctx.rect(POWER.x + 3, POWER.y + 3, Math.max(0, fill - 6), POWER.h - 6)
    ctx.clip()
    ctx.fillStyle = g
    ctx.fillRect(POWER.x, POWER.y, fill, POWER.h)
    ctx.restore()
  }
  text(ctx, `力度 ${Math.round(state.power * 100)}%`, POWER.x + POWER.w / 2, POWER.y + POWER.h / 2, { size: 26, weight: 'bold' })

  // 操作提示 + 事件说明
  const tip = state.phase === 'charging' ? '松开即击球' : '按住球场蓄力，松开击球；拖动滑条改方向'
  text(ctx, tip, VW / 2, 1092, { size: 24, color: COLORS.textDim })
  shadowText(ctx, state.note, VW / 2, 1140, { size: 26, color: COLORS.text })

  // 图例
  const sw = 148
  const gap = 16
  const total = TERRAINS.length * sw + (TERRAINS.length - 1) * gap
  const x0 = (VW - total) / 2
  TERRAINS.forEach((t, i) => {
    const x = x0 + i * (sw + gap)
    fillRoundRect(ctx, x, 1188, sw, 46, 10, TERRAIN_COLOR[t], 'rgba(255,255,255,0.22)', 2)
    text(ctx, TERRAIN_LABEL[t], x + sw / 2, 1211, { size: 22, color: t === 'sand' ? '#2b2110' : COLORS.text })
  })
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  background(ctx, VW, VH, '#15402a', '#071a12')

  const you = totalStrokes(state, PLAYER)
  const ai = totalStrokes(state, AI)
  const hole = currentHole(state)
  topBar(ctx, VW, `第 ${state.holeIndex + 1}/${state.holes.length} 洞 · 标准杆 ${hole.par}`, `你 ${you} : AI ${ai}`, 90)

  renderCourse(ctx, state)
  renderAim(ctx, state)

  // 球
  disc(ctx, state.ball.x, state.ball.y, BALL_R, COLORS.white, { ring: 'rgba(0,0,0,0.35)' })
  if (state.penalties > 0) {
    text(ctx, `罚杆 ${state.penalties}`, VW - 34, 56, { size: 22, align: 'right', color: COLORS.red })
  }

  renderPanel(ctx, state)

  if (state.phase === 'holed') {
    banner(ctx, VW, VH, state.strokes[0] <= state.strokes[1] ? '你赢下这一洞' : 'AI 赢下这一洞', `本洞 你 ${state.strokes[0]} : AI ${state.strokes[1]}`)
  } else if (state.phase === 'over') {
    banner(ctx, VW, VH, you < ai ? '你赢了！' : you > ai ? 'AI 获胜' : '平局', `总杆 你 ${you} : AI ${ai}`)
  }
}

// ---------------------------------------------------------------- 输入与音效

/** 把指针事件翻成 action（纯函数） */
function input(state: State, p: PointerInput): Action | null {
  if (state.phase === 'over') return null
  // 松手即击球（两段式的第二段）
  if (p.kind === 'up') return state.phase === 'charging' ? { type: 'shoot' } : null
  if (p.kind !== 'down' && p.kind !== 'move') return null
  const onSlider = inBox(p.x, p.y, { x: SLIDER.x - 20, y: SLIDER.y - 24, w: SLIDER.w + 40, h: SLIDER.h + 48 })
  if (onSlider) return { type: 'aim', value: clamp((p.x - SLIDER.x) / SLIDER.w, 0, 1) }
  // 按住球场开始蓄力
  if (p.kind === 'down' && inBox(p.x, p.y, COURSE)) return { type: 'chargeStart' }
  return null
}

/** 桌面键盘：左右调方向，上下调力度，空格蓄力，回车击球 */
function key(state: State, k: string): Action | null {
  if (state.phase === 'over') return null
  if (k === 'ArrowLeft') return { type: 'aim', value: state.aim - 0.03 }
  if (k === 'ArrowRight') return { type: 'aim', value: state.aim + 0.03 }
  if (k === 'ArrowUp') return { type: 'charge', delta: 0.05 }
  if (k === 'ArrowDown') return { type: 'charge', delta: -0.05 }
  if (k === ' ') return { type: 'chargeStart' }
  if (k === 'Enter') return state.phase === 'charging' ? { type: 'shoot' } : null
  return null
}

/** 每帧按 dt 折算成整数 tick（时间只在这一层出现，rules 里没有任何时间依赖） */
function tickAction(dt: number): Action {
  const ms = Number.isFinite(dt) ? dt : TICK_MS
  return { type: 'tick', ticks: clamp(Math.round(ms / TICK_MS), 1, 6) }
}

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (prev.phase !== next.phase) {
    if (next.phase === 'rolling') out.push({ kind: 'sound', name: 'hit' })
    if (next.phase === 'holed') {
      out.push({ kind: 'sound', name: 'win' })
      out.push({ kind: 'burst', x: next.ball.x, y: next.ball.y, color: COLORS.accent, count: 14 })
    }
  }
  if (next.penalties > prev.penalties) {
    out.push({ kind: 'sound', name: 'error' })
    out.push({ kind: 'shake', power: 5 })
  }
  if (next.holeIndex !== prev.holeIndex) out.push({ kind: 'sound', name: 'place' })
  if (next.phase === 'over' && prev.phase !== 'over') {
    out.push({ kind: 'sound', name: outcome(next)?.win ? 'win' : 'lose' })
  }
  if (next.turn !== prev.turn && next.phase === 'aim' && prev.phase !== 'charging') {
    out.push({ kind: 'sound', name: 'tick' })
  }
  return out
}

const golfModule: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  aiAction,
  input,
  key,
  tick: tickAction,
  hint,
  controls,
  outcome,
  effects,
  aiDelay: 260,
}

export default golfModule
