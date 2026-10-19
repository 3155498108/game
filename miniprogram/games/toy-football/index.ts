/**
 * 玩具足球渲染 + 输入映射层。规则全部在 rules.ts（纯逻辑，零 DOM），本文件只做三件事：
 *   1. 把 State 画到 720×1280 的逻辑画布上（运行时已完成换算，指针坐标即逻辑坐标，不再乘 scale）；
 *   2. 把 DOM 按钮 / 键盘 / 画布点击翻译成 rules.ts 的 Action；
 *   3. 用真实时钟折算整数 tick 推进飞行——rules.ts 里没有任何时间源，时间只活在这一层。
 *
 * 力度与角度不放画布上画滑条：它们走 controls()，由站点壳渲染成真正的 DOM 按钮，
 * 画布只负责画瞄准轨迹与数值读数，避免和壳里那份控件重复（项目已踩过 restart 重复的坑）。
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import {
  COLORS,
  background,
  banner,
  disc,
  fillRoundRect,
  shadowText,
  text,
  topBar,
  withAlpha,
} from '../../render/draw'
import { clamp, inRect } from '../../core/geom'
import type { Rect } from '../../core/geom'
import meta from './meta'
import {
  ANGLE_MAX,
  ANGLE_MIN,
  ANGLE_SLIDER,
  BALL_R,
  CHANCES,
  FIELD,
  GOAL_DEPTH,
  GOAL_LEFT,
  GOAL_RIGHT,
  GOAL_Y,
  KICK,
  MAX_TICKS,
  POWER_MAX,
  POWER_MIN,
  TICK_MS,
  VIEW_H,
  VIEW_W,
  create,
  directionOf,
  reduce,
  speedOf,
  type Action,
  type State,
} from './rules'

// ---------------- 布局常量（与 rules 共用同一套逻辑坐标） ----------------

/** 顶部比分面板 */
const STATS: Rect = { x: 24, y: 100, w: VIEW_W - 48, h: 76 }
/** 滑条所在的底部提示带：点在这一带不触发画布射门（按钮由站点壳渲染在提示区） */
const SLIDER_BAND: Rect = {
  x: 0,
  y: ANGLE_SLIDER.y - 12,
  w: VIEW_W,
  h: VIEW_H - ANGLE_SLIDER.y + 12,
}
/** 拿到 6 球算赢 */
const WIN_GOALS = 6

// ---------------- 计时（真实时钟 → 整数 tick） ----------------

let lastNow = -1
let acc = 0

/**
 * 取当前真实时刻（毫秒）。浏览器走 performance.now()，
 * 无 performance 的环境（单测）退回站点壳每帧传来的 dt 累加，保证 tick 仍能工作。
 */
function clock(dt: number): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return lastNow < 0 ? dt : lastNow + dt
}

/**
 * 每帧被站点壳调用：把真实经过时间折算成整数 tick 发给 rules。
 * 单帧最多补 4 个 tick，切后台/掉帧回来不会一次性爆走。
 */
function tick(dt: number): Action {
  const now = clock(dt)
  const prev = lastNow
  lastNow = now
  if (prev < 0 || now <= prev) return { type: 'advance', ticks: 0 }
  acc = Math.min(acc + (now - prev), 4 * TICK_MS)
  const ticks = Math.floor(acc / TICK_MS)
  if (ticks <= 0) return { type: 'advance', ticks: 0 }
  acc -= ticks * TICK_MS
  return { type: 'advance', ticks }
}

/** 非飞行阶段不攒 tick：render 每帧都会拿到 state，这里顺手把累加器清零 */
function resetClockIfIdle(s: State): void {
  if (s.phase === 'flight') return
  lastNow = -1
  acc = 0
}

// ---------------- 绘制 ----------------

/** 球场：深浅相间的草条纹 + 白线 */
function drawPitch(ctx: CanvasRenderingContext2D): void {
  const w = FIELD.right - FIELD.left
  const h = FIELD.bottom - FIELD.top
  const bands = 7
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.06)'
    ctx.fillRect(FIELD.left, FIELD.top + (h * i) / bands, w, h / bands + 1)
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 3
  ctx.strokeRect(FIELD.left, FIELD.top, w, h)
  // 中线与中圈
  ctx.beginPath()
  ctx.moveTo(FIELD.left, FIELD.top + h / 2)
  ctx.lineTo(FIELD.right, FIELD.top + h / 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(VIEW_W / 2, FIELD.top + h / 2, 90, 0, Math.PI * 2)
  ctx.stroke()
  // 禁区（球门侧）
  ctx.strokeRect(VIEW_W / 2 - 160, FIELD.top, 320, 130)
  ctx.strokeRect(VIEW_W / 2 - 80, FIELD.top, 160, 56)
}

/** 球门：门柱 + 网兜 */
function drawGoal(ctx: CanvasRenderingContext2D): void {
  const back = GOAL_Y - GOAL_DEPTH
  ctx.fillStyle = 'rgba(8,20,12,0.72)'
  ctx.fillRect(GOAL_LEFT, back, GOAL_RIGHT - GOAL_LEFT, GOAL_DEPTH)
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'
  ctx.lineWidth = 2
  for (let x = GOAL_LEFT; x <= GOAL_RIGHT; x += 26) {
    ctx.beginPath()
    ctx.moveTo(x, back)
    ctx.lineTo(x, GOAL_Y)
    ctx.stroke()
  }
  for (let y = back; y <= GOAL_Y; y += 14) {
    ctx.beginPath()
    ctx.moveTo(GOAL_LEFT, y)
    ctx.lineTo(GOAL_RIGHT, y)
    ctx.stroke()
  }
  // 门柱
  ctx.strokeStyle = COLORS.text
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(GOAL_LEFT, back)
  ctx.lineTo(GOAL_LEFT, GOAL_Y)
  ctx.moveTo(GOAL_RIGHT, back)
  ctx.lineTo(GOAL_RIGHT, GOAL_Y)
  ctx.stroke()
}

/** 守门员：躯干 + 头 + 双臂，扑救时手臂张开、身形压低 */
function drawKeeper(ctx: CanvasRenderingContext2D, s: State): void {
  const k = s.keeper
  const dive = k.dive && s.phase !== 'aim'
  const bodyW = dive ? 34 : 30
  const bodyH = dive ? 22 : 48
  const y = k.y - (dive ? 6 : 0)

  ctx.fillStyle = dive ? COLORS.orange : COLORS.yellow
  fillRoundRect(ctx, k.x - bodyW / 2, y, bodyW, bodyH, 10, dive ? COLORS.orange : COLORS.yellow)
  // 头
  disc(ctx, k.x, y - 14, 11, '#f3c79b')
  // 手臂
  ctx.strokeStyle = dive ? COLORS.orange : COLORS.yellow
  ctx.lineWidth = 8
  ctx.lineCap = 'round'
  const reach = dive ? 46 : 24
  ctx.beginPath()
  ctx.moveTo(k.x - bodyW / 2, y + bodyH * 0.35)
  ctx.lineTo(k.x - reach, y + (dive ? bodyH * 0.1 : bodyH * 0.6))
  ctx.moveTo(k.x + bodyW / 2, y + bodyH * 0.35)
  ctx.lineTo(k.x + reach, y + (dive ? bodyH * 0.1 : bodyH * 0.6))
  ctx.stroke()
  ctx.lineCap = 'butt'
}

/** 球 */
function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1): void {
  disc(ctx, x, y, BALL_R * scale, '#ffffff', { ring: withAlpha('#101010', 0.5) })
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, BALL_R * scale, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = 'rgba(24,24,28,0.9)'
  ctx.beginPath()
  ctx.arc(x, y - BALL_R * scale * 0.15, BALL_R * scale * 0.42, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * 瞄准轨迹：纯读状态的推演（同样的匀速直线 + 侧墙反弹），
 * 照 rules 的 step 走但不碰守门员，只是给玩家一个落点参考。
 */
function previewPath(s: State): Array<{ x: number; y: number }> {
  const dir = directionOf(s.angle)
  const speed = speedOf(s.power)
  const pts = [{ x: KICK.x, y: KICK.y }]
  let { x, y } = KICK
  let vx = dir.vx * speed
  let vy = dir.vy * speed
  for (let i = 0; i < MAX_TICKS; i++) {
    x += vx
    y += vy
    if (x - BALL_R <= FIELD.left) {
      x = FIELD.left + BALL_R
      vx = Math.abs(vx)
    } else if (x + BALL_R >= FIELD.right) {
      x = FIELD.right - BALL_R
      vx = -Math.abs(vx)
    }
    if (y - BALL_R <= GOAL_Y) {
      pts.push({ x, y: GOAL_Y })
      break
    }
    if (y + BALL_R >= FIELD.bottom) {
      pts.push({ x, y: FIELD.bottom })
      break
    }
    if (i % 3 === 0) pts.push({ x, y })
  }
  return pts
}

/** 准备阶段的瞄准线 + 力度/角度读数（读数不是控件，滑条本体交给站点壳） */
function drawAim(ctx: CanvasRenderingContext2D, s: State): void {
  const pts = previewPath(s)
  ctx.save()
  ctx.setLineDash([12, 10])
  ctx.lineWidth = 4
  ctx.strokeStyle = withAlpha('#ffffff', 0.6)
  ctx.beginPath()
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()
  ctx.setLineDash([])
  const end = pts[pts.length - 1]
  const onGoal = end.y <= GOAL_Y
  ctx.strokeStyle = withAlpha(onGoal ? COLORS.green : COLORS.red, 0.95)
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(end.x, end.y, BALL_R + 6, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  const signed = s.angle > 0 ? `+${s.angle}` : String(s.angle)
  text(ctx, `力度 ${s.power}`, KICK.x, KICK.y + 62, { size: 26, color: COLORS.text })
  text(ctx, `角度 ${signed}°`, KICK.x, KICK.y + 96, { size: 26, color: COLORS.textDim })
}

/** 结算横幅（画在球门上方，不遮挡球的落点） */
function drawResult(ctx: CanvasRenderingContext2D, s: State): void {
  if (s.phase !== 'result' || !s.lastResult) return
  const label = s.lastResult === 'goal' ? '进球！' : s.lastResult === 'saved' ? '被扑出了' : '打偏了'
  const color = s.lastResult === 'goal' ? COLORS.green : s.lastResult === 'saved' ? COLORS.orange : COLORS.red
  shadowText(ctx, label, VIEW_W / 2, GOAL_Y - 84, { size: 52, color })
}

function drawStats(ctx: CanvasRenderingContext2D, s: State): void {
  fillRoundRect(ctx, STATS.x, STATS.y, STATS.w, STATS.h, 20, 'rgba(255,255,255,0.07)')
  const cells: Array<[string, string]> = [
    ['进球', String(s.goals)],
    ['被扑', String(s.saves)],
    ['打偏', String(s.misses)],
    ['机会', `${s.attempt + (s.phase === 'aim' ? 1 : 0)}/${CHANCES}`],
  ]
  cells.forEach(([label, value], i) => {
    const cx = STATS.x + ((i + 0.5) * STATS.w) / cells.length
    text(ctx, label, cx, STATS.y + 22, { size: 21, color: COLORS.textDim })
    shadowText(ctx, value, cx, STATS.y + 50, { size: 30, color: i === 0 ? COLORS.accent : COLORS.text })
  })
}

/** 把开局的 ballHome 球画在踢球点上 */
function drawSpot(ctx: CanvasRenderingContext2D, s: State): void {
  disc(ctx, KICK.x, KICK.y, BALL_R, 'rgba(255,255,255,0.12)', { ring: withAlpha('#ffffff', 0.35) })
  if (s.phase === 'aim') drawBall(ctx, s.ball.x, s.ball.y)
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  resetClockIfIdle(s)
  background(ctx, VIEW_W, VIEW_H, '#16663a', '#04150b')
  topBar(ctx, VIEW_W, '玩具足球', `${s.goals} / ${CHANCES}`, 92)
  drawStats(ctx, s)
  drawPitch(ctx)
  drawGoal(ctx)
  drawKeeper(ctx, s)
  if (s.phase === 'aim') drawAim(ctx, s)
  else drawBall(ctx, s.ball.x, s.ball.y)
  drawSpot(ctx, s)
  drawResult(ctx, s)

  text(ctx, '点画布或按「踢球！」射门', VIEW_W / 2, VIEW_H - 40, { size: 23, color: COLORS.textDim })

  if (s.phase === 'over') {
    banner(ctx, VIEW_W, VIEW_H, '十脚踢完', `进球 ${s.goals} 个 · 被扑 ${s.saves} 个`, COLORS.accent)
  }
}

// ---------------- 输入 ----------------

/** 准备阶段点画布（滑条带除外）直接射门 */
function input(s: State, p: PointerInput): Action | null {
  if (p.kind !== 'down' || s.phase !== 'aim') return null
  if (inRect(p, SLIDER_BAND)) return null
  return { type: 'kick' }
}

/** 桌面便利：方向键调滑条，空格射门/继续 */
function key(s: State, k: string): Action | null {
  if (s.phase === 'over') return null
  if (s.phase === 'aim') {
    if (k === 'ArrowLeft') return { type: 'setAngle', value: clamp(s.angle - 1, ANGLE_MIN, ANGLE_MAX) }
    if (k === 'ArrowRight') return { type: 'setAngle', value: clamp(s.angle + 1, ANGLE_MIN, ANGLE_MAX) }
    if (k === 'ArrowUp') return { type: 'setPower', value: clamp(s.power + 5, POWER_MIN, POWER_MAX) }
    if (k === 'ArrowDown') return { type: 'setPower', value: clamp(s.power - 5, POWER_MIN, POWER_MAX) }
    if (k === ' ' || k === 'Enter') return { type: 'kick' }
    return null
  }
  if (s.phase === 'result' && (k === ' ' || k === 'Enter')) return { type: 'next' }
  return null
}

// ---------------- 提示 / 控件 / 结算 / 副作用 ----------------

function hint(s: State): string {
  const signed = s.angle > 0 ? `+${s.angle}` : String(s.angle)
  if (s.phase === 'over') return `十脚踢完：进球 ${s.goals} 个，被扑 ${s.saves} 个，打偏 ${s.misses} 个`
  if (s.phase === 'result') {
    const what = s.lastResult === 'goal' ? '进球了' : s.lastResult === 'saved' ? '被守门员扑出' : '打偏了'
    return `第 ${s.attempt} 脚${what} · 累计进球 ${s.goals}，点「下一脚」继续`
  }
  if (s.phase === 'flight') return `球在飞…… 第 ${s.attempt + 1} 脚 / 共 ${CHANCES} 次机会`
  return `调好力度 ${s.power} 与角度 ${signed}°，点「踢球！」射门 · 键盘 ←→ 调角度、↑↓ 调力度、空格射门`
}

/** 力度与角度用 DOM 按钮调；重启按钮由站点壳统一追加，这里不画也不声明 */
function controls(s: State): Control<Action>[] {
  if (s.phase === 'aim') {
    return [
      { label: '力度 −10', action: { type: 'setPower', value: s.power - 10 }, disabled: s.power <= POWER_MIN },
      { label: '力度 +10', action: { type: 'setPower', value: s.power + 10 }, disabled: s.power >= POWER_MAX },
      { label: '角度 −5°', action: { type: 'setAngle', value: s.angle - 5 }, disabled: s.angle <= ANGLE_MIN },
      { label: '角度 +5°', action: { type: 'setAngle', value: s.angle + 5 }, disabled: s.angle >= ANGLE_MAX },
      { label: '踢球！', action: { type: 'kick' }, primary: true },
    ]
  }
  if (s.phase === 'result') return [{ label: '下一脚', action: { type: 'next' }, primary: true }]
  return []
}

function outcome(s: State): Outcome | null {
  if (s.phase !== 'over') return null
  return { score: s.goals, better: 'higher', unit: ' 球', win: s.goals >= WIN_GOALS }
}

function effects(prev: State, next: State): Effect[] {
  if (next === prev) return []
  if (prev.phase === 'aim' && next.phase === 'flight') return [{ kind: 'sound', name: 'click' }]
  if (next.attempt <= prev.attempt) return []

  const out: Effect[] = []
  if (next.lastResult === 'goal') {
    out.push({ kind: 'sound', name: 'score' })
    out.push({
      kind: 'burst',
      x: (GOAL_LEFT + GOAL_RIGHT) / 2,
      y: GOAL_Y,
      color: COLORS.green,
      count: 16,
    })
  } else if (next.lastResult === 'saved') {
    out.push({ kind: 'sound', name: 'hit' })
  } else {
    out.push({ kind: 'sound', name: 'error' })
  }
  if (next.phase === 'over') out.push({ kind: 'sound', name: next.goals >= WIN_GOALS ? 'win' : 'lose' })
  return out
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  input,
  key,
  tick,
  hint,
  controls,
  outcome,
  effects,
}

export default game
