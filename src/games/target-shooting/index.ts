/**
 * 射靶 · 游戏模块装配（渲染 + 输入 + 时间推进旁路）。
 *
 * rules.ts 保持纯逻辑：这里的 performance.now() 只用于把真实 dt 折算成整数 tick，
 * 再通过 action 交给 reduce，从不直接写 state。
 */
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import {
  COLORS,
  background,
  banner,
  shadowText,
  text,
  withAlpha,
} from '../../render/draw'
import { meta } from './meta'
import {
  FIELD,
  RING_COLORS,
  RING_EDGES,
  RING_SCORES,
  TICK_MS,
  TIME_TICKS,
  accuracy,
  create,
  levelOf,
  reduce,
  remainingSeconds,
  type Action,
  type State,
} from './rules'

const VW = meta.viewport.width
const VH = meta.viewport.height
/** HUD 信息栏高度 */
const HUD_H = 96

// ---------------- 时间推进 ----------------

/** 把真实 dt(ms) 折算成整数 tick（纯函数，不持有跨帧累加状态） */
function tick(dt: number): Action {
  const ms = Number.isFinite(dt) ? Math.max(0, dt) : 0
  return { type: 'tick', n: Math.round(ms / TICK_MS) }
}

// ---------------- 输入 ----------------

function input(state: State, p: PointerInput): Action | null {
  if (state.over) return null
  if (p.kind !== 'down') return null
  return { type: 'shoot', x: p.x, y: p.y }
}

// ---------------- 渲染 ----------------

function renderField(ctx: CanvasRenderingContext2D): void {
  ctx.save()
  ctx.strokeStyle = withAlpha(COLORS.line, 0.5)
  ctx.lineWidth = 3
  ctx.setLineDash([12, 14])
  ctx.strokeRect(FIELD.left, FIELD.top, FIELD.right - FIELD.left, FIELD.bottom - FIELD.top)
  ctx.restore()
}

function renderTarget(ctx: CanvasRenderingContext2D, state: State): void {
  const t = state.target
  if (!t) return
  // 由外向内逐环填充：外环半径大，内环盖在上面
  for (let i = 0; i < RING_EDGES.length; i++) {
    const r = t.r * RING_EDGES[i]
    ctx.beginPath()
    ctx.arc(t.x, t.y, r, 0, Math.PI * 2)
    ctx.fillStyle = RING_COLORS[i]
    ctx.fill()
    ctx.strokeStyle = withAlpha('#000000', 0.25)
    ctx.lineWidth = 2
    ctx.stroke()
  }
  // 外圈瞄准提示
  ctx.beginPath()
  ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2)
  ctx.strokeStyle = COLORS.line
  ctx.lineWidth = 3
  ctx.stroke()
  // 剩余停留时间进度环（顺时针收缩）
  const ratio = Math.max(0, Math.min(1, t.life / t.life0))
  ctx.save()
  ctx.beginPath()
  ctx.arc(t.x, t.y, t.r + 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio)
  ctx.strokeStyle = ratio < 0.35 ? COLORS.red : COLORS.accent2
  ctx.lineWidth = 8
  ctx.lineCap = 'round'
  ctx.stroke()
  ctx.restore()
  // 环分提示
  text(ctx, `${RING_SCORES[RING_SCORES.length - 1]}`, t.x, t.y, {
    size: Math.max(20, t.r * 0.28),
    color: '#8a5a00',
    weight: 'bold',
  })
}

function renderLastShot(ctx: CanvasRenderingContext2D, state: State): void {
  const s = state.last
  if (!s) return
  const color = s.hit ? COLORS.green : COLORS.red
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 4
  const a = s.hit ? 16 : 12
  ctx.beginPath()
  ctx.moveTo(s.x - a, s.y)
  ctx.lineTo(s.x + a, s.y)
  ctx.moveTo(s.x, s.y - a)
  ctx.lineTo(s.x, s.y + a)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(s.x, s.y, 18, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
  if (s.hit) {
    shadowText(ctx, `+${s.points}`, s.x, s.y - 42, { size: 34, color: COLORS.accent })
  }
}

function renderHud(ctx: CanvasRenderingContext2D, state: State): void {
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fillRect(0, 0, VW, HUD_H)
  text(ctx, `得分 ${state.score}`, 30, HUD_H / 2, { size: 34, align: 'left', weight: 'bold' })
  text(ctx, `${remainingSeconds(state).toFixed(1)}s`, VW - 30, HUD_H / 2, {
    size: 34,
    align: 'right',
    weight: 'bold',
    color: remainingSeconds(state) <= 10 ? COLORS.red : COLORS.accent,
  })
  // 剩余时间进度条
  const barW = VW - 60
  const done = Math.min(1, state.t / TIME_TICKS)
  ctx.fillStyle = withAlpha(COLORS.line, 0.6)
  ctx.fillRect(30, HUD_H - 14, barW, 8)
  ctx.fillStyle = COLORS.accent2
  ctx.fillRect(30, HUD_H - 14, barW * (1 - done), 8)
  // 统计
  text(ctx, `命中 ${state.hits} / 发射 ${state.shots}`, VW / 2, 52, { size: 26, color: COLORS.textDim })
}

function renderOver(ctx: CanvasRenderingContext2D, state: State): void {
  const acc = (accuracy(state) * 100).toFixed(1)
  banner(ctx, VW, VH, '时间到', `命中率 ${acc}%`)
  const lines = [
    `得分 ${state.score}`,
    `命中 ${state.hits} · 发射 ${state.shots}`,
    `命中率 ${acc}%`,
  ]
  lines.forEach((s, i) => {
    shadowText(ctx, s, VW / 2, VH / 2 + 130 + i * 48, {
      size: 34,
      color: i === 2 ? COLORS.accent : COLORS.text,
      weight: i === 2 ? 'bold' : 'normal',
    })
  })
  text(ctx, '点击提示区的「新的一局」再来一次', VW / 2, VH / 2 + 300, {
    size: 26,
    color: COLORS.textDim,
  })
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  background(ctx, VW, VH, COLORS.bg2, COLORS.letterbox)
  renderField(ctx)
  if (state.over) {
    renderHud(ctx, state)
    renderLastShot(ctx, state)
    renderOver(ctx, state)
    return
  }
  renderTarget(ctx, state)
  renderLastShot(ctx, state)
  renderHud(ctx, state)
  if (!state.target) {
    shadowText(ctx, '换靶…', VW / 2, VH / 2, { size: 44, color: COLORS.textDim })
  }
}

// ---------------- 提示与成绩 ----------------

function hint(state: State): string {
  if (state.over) {
    return `时间到：得分 ${state.score}，命中 ${state.hits}/${state.shots}，命中率 ${(accuracy(state) * 100).toFixed(1)}%`
  }
  const lv = levelOf(state.spawned)
  return `点击靶子命中，越靠靶心分越高（靶心 ${RING_SCORES[RING_SCORES.length - 1]} 分）· 剩余 ${remainingSeconds(state).toFixed(0)} 秒 · 难度 ${lv}`
}

function outcome(state: State): Outcome | null {
  if (!state.over) return null
  return { score: state.score, better: 'higher', unit: '分' }
}

/** 从状态迁移推导副作用，reduce 本身保持纯净 */
function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (next.last && next.last !== prev.last) {
    if (next.last.hit) {
      out.push({ kind: 'burst', x: next.last.x, y: next.last.y, color: COLORS.accent, count: 12 })
      out.push({ kind: 'sound', name: next.last.ring === RING_SCORES.length ? 'win' : 'hit' })
    } else {
      out.push({ kind: 'sound', name: 'error' })
    }
  }
  if (next.over && !prev.over) out.push({ kind: 'sound', name: 'win' })
  return out
}

// ---------------- 导出 ----------------

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  input,
  tick,
  hint,
  outcome,
  effects,
}

export default game
export {
  meta,
  create,
  reduce,
  render,
  input,
  tick,
  hint,
  outcome,
  effects,
  TIME_TICKS,
  accuracy,
  remainingSeconds,
}
