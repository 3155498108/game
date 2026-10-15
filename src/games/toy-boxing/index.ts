/**
 * 玩具拳击 —— 渲染层与输入映射（站点壳统一接口）。
 *
 * 渲染层自己按契约绘制画面：血条、擂台、两个玩具兵、蓄力/时机窗口进度条、
 * 底部三个出拳方向按钮与出拳区。
 * 说明：这里刻意不实现 controls()，站点壳会自动追加「新的一局」按钮；
 * 画布上也不自绘任何重开按钮，避免与壳重复。
 */
import { meta } from './meta'
import {
  PUNCHES,
  PUNCH_BY_KIND,
  PUNCH_BUTTONS,
  STRIKE_PAD,
  MAX_HP,
  COMBO_CAP,
  comboMultiplier,
  windupProgress,
  create,
  reduce,
  aiAction,
  type Action,
  type Phase,
  type Side,
  type State,
} from './rules'
import {
  COLORS,
  background,
  fillRoundRect,
  text,
  shadowText,
  disc,
  banner,
  ease,
  lighten,
  darken,
  withAlpha,
} from '../../render/draw'
import { inRect } from '../../core/geom'
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'

// ---------------------------------------------------------------- 布局常量

const VIEW_W = 720
const VIEW_H = 1280
const YOU_X = 172
const FOE_X = 548
const FEET_Y = 740
const GAUGE_Y = 806
const GAUGE_H = 58
/** 受击 / 落空动画持续多少 tick */
const ANIM_TICKS = 14
/** 一个逻辑 tick 折算多少毫秒真实时间 */
const MS_PER_TICK = 30

interface Pose {
  /** 出拳方前冲 0..1 */
  forward: number
  /** 受击/落空方后仰 0..1 */
  back: number
}

const NEUTRAL: Pose = { forward: 0, back: 0 }

// ---------------------------------------------------------------- 动画时钟

/** 距最近一次结算已经过去的动画进度 0..1 */
function animT(state: State): number {
  const t = (state.tickCount - state.animFrom) / ANIM_TICKS
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/** 由最近一次结算推导这一方的姿态 */
function poseFor(state: State, side: Side): Pose {
  if (state.seq === 0) return NEUTRAL
  const mine = state.lastBy === side
  const t = animT(state)
  const easeOut = 1 - ease.outQuad(t)
  const wobble = Math.sin(t * Math.PI)
  if (mine && state.lastEvent === 'hit') return { forward: easeOut, back: 0 }
  if (mine && state.lastEvent === 'whiff') return { forward: 0, back: wobble }
  if (!mine && state.lastEvent === 'hit') return { forward: 0, back: easeOut }
  return NEUTRAL
}

// ---------------------------------------------------------------- 画面元素

/** 玩具兵：圆滚滚的身子、弹簧腿、两只小拳头 */
function drawToy(
  ctx: CanvasRenderingContext2D,
  x0: number,
  base: string,
  face: number,
  pose: Pose,
  tick: number,
): void {
  const dx = (pose.forward * 86 - pose.back * 26) * face
  const cx = x0 + dx
  const lean = pose.forward * 10 * face - pose.back * 8 * face
  const bob = pose.back > 0 ? Math.sin(tick * 1.6) * 4 * pose.back : 0
  const headY = FEET_Y - 246 + bob + lean * 0.6
  const bodyTop = FEET_Y - 206 + bob

  // 影子
  ctx.save()
  ctx.globalAlpha = 0.3
  ctx.fillStyle = '#050b16'
  ctx.beginPath()
  ctx.ellipse(cx, FEET_Y + 12, 84 - Math.abs(dx) * 0.12, 16, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // 弹簧腿
  fillRoundRect(ctx, cx - 50 + lean * 0.3, FEET_Y - 92, 40, 92, 18, darken(base, 0.3))
  fillRoundRect(ctx, cx + 10 + lean * 0.3, FEET_Y - 92, 40, 92, 18, darken(base, 0.3))

  // 后手
  fillRoundRect(ctx, cx - 74 * face, bodyTop + 34, 34, 96, 16, darken(base, 0.12))
  // 身子
  fillRoundRect(ctx, cx - 62, bodyTop, 124, 130, 34, base, darken(base, 0.35), 3)
  fillRoundRect(ctx, cx - 34, bodyTop + 26, 68, 76, 22, lighten(base, 0.3))
  // 领结
  disc(ctx, cx + face * 6, bodyTop + 14, 12, COLORS.red)
  // 前手（出拳时向前伸）
  const reach = pose.forward * 74 * face
  fillRoundRect(ctx, cx + 18 * face + reach * 0.35, bodyTop + 30, 34, 92, 16, lighten(base, 0.12))
  disc(ctx, cx + 40 * face + reach, bodyTop + 122, 24, COLORS.accent, { ring: darken(COLORS.accent, 0.3) })

  // 头
  disc(ctx, cx + lean * 0.4, headY, 52, lighten(base, 0.22), { ring: darken(base, 0.4) })
  // 天线 + 小球
  ctx.strokeStyle = COLORS.line
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(cx + lean * 0.4, headY - 48)
  ctx.lineTo(cx + lean * 0.4 + face * 8, headY - 76)
  ctx.stroke()
  disc(ctx, cx + lean * 0.4 + face * 8, headY - 80, 10, COLORS.accent2)

  // 眼睛（被打时变成 ×）
  const eyeY = headY - 6
  const eyeDX = 16 * face
  if (pose.back > 0.45) {
    ctx.strokeStyle = COLORS.text
    ctx.lineWidth = 4
    for (const s of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx + eyeDX + s * 10 - 7, eyeY - 7)
      ctx.lineTo(cx + eyeDX + s * 10 + 7, eyeY + 7)
      ctx.moveTo(cx + eyeDX + s * 10 + 7, eyeY - 7)
      ctx.lineTo(cx + eyeDX + s * 10 - 7, eyeY + 7)
      ctx.stroke()
    }
  } else {
    for (const s of [-1, 1]) {
      disc(ctx, cx + eyeDX + s * 11, eyeY, 10, COLORS.white)
      disc(ctx, cx + eyeDX + s * 11 + face * 3, eyeY + 1, 5, COLORS.black)
    }
  }
  // 嘴
  ctx.strokeStyle = COLORS.black
  ctx.lineWidth = 4
  ctx.beginPath()
  if (pose.back > 0.45) {
    ctx.ellipse(cx + lean * 0.4, headY + 22, 12, 9, 0, 0, Math.PI * 2)
  } else {
    ctx.arc(cx + lean * 0.4, headY + 14, 14, 0.25 * Math.PI, 0.75 * Math.PI)
  }
  ctx.stroke()
}

/** 顶部血条 + 连击 */
function drawStatBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  name: string,
  hp: number,
  color: string,
  right: boolean,
  combo: number,
  active: boolean,
): void {
  const h = 34
  fillRoundRect(ctx, x, y, w, h, 14, 'rgba(0,0,0,0.45)')
  const ratio = Math.max(0, Math.min(1, hp / MAX_HP))
  const bw = Math.max(0, (w - 8) * ratio)
  const bx = right ? x + 4 + (w - 8 - bw) : x + 4
  fillRoundRect(ctx, bx, y + 4, bw, h - 8, 11, color)
  // 刻度
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 2
  for (let i = 1; i < 10; i++) {
    const gx = x + 4 + ((w - 8) * i) / 10
    ctx.beginPath()
    ctx.moveTo(gx, y + 6)
    ctx.lineTo(gx, y + h - 6)
    ctx.stroke()
  }
  text(ctx, `${name} ${hp}`, x + w / 2, y + h / 2, { size: 22, weight: 'bold', color: COLORS.white })

  const cy = y + h + 22
  text(ctx, `连击 ${combo}`, right ? x + w : x, cy, {
    size: 26,
    weight: 'bold',
    align: right ? 'right' : 'left',
    color: combo > 0 ? COLORS.accent : COLORS.textDim,
  })
  if (combo > 0) {
    text(ctx, `×${comboMultiplier(combo).toFixed(2)}`, right ? x + w - 74 : x + 74, cy, {
      size: 24,
      align: right ? 'right' : 'left',
      color: COLORS.textDim,
    })
  }
  if (active) {
    text(ctx, '▶ 行动中', right ? x + w : x, cy + 30, {
      size: 22,
      align: right ? 'right' : 'left',
      color: COLORS.accent,
      weight: 'bold',
    })
  }
}

/** 蓄力 / 时机窗口进度条 */
function drawGauge(ctx: CanvasRenderingContext2D, state: State): void {
  const x = 60
  const w = VIEW_W - 120
  const spec = state.choice ? PUNCH_BY_KIND[state.choice] : PUNCHES[0]
  const y = GAUGE_Y

  if (state.phase === 'choose') {
    fillRoundRect(ctx, x, y, w, GAUGE_H, 20, COLORS.panel, COLORS.line, 2)
    text(ctx, '选一个出拳方向', VIEW_W / 2, y + GAUGE_H / 2, { size: 26, color: COLORS.textDim })
    return
  }

  fillRoundRect(ctx, x, y, w, GAUGE_H, 20, COLORS.panel, COLORS.line, 2)
  const total = spec.windup + spec.window
  const wx = x + (w * spec.windup) / total
  const ww = Math.max(10, (w * spec.window) / total)

  // 窗口段（绿）：窗口期整段高亮
  fillRoundRect(ctx, wx, y + 3, ww, GAUGE_H - 6, 12, state.phase === 'window' ? COLORS.green : withAlpha(COLORS.green, 0.4))
  // 蓄力段（黄）
  const pw = Math.max(0, Math.min(wx - x, (w * (windupProgress(state) * spec.windup)) / total))
  if (pw > 4) fillRoundRect(ctx, x, y + 3, pw, GAUGE_H - 6, 12, COLORS.accent)

  // 游标
  const passed = state.phase === 'window' ? spec.windup + (spec.window - state.timer) : spec.windup - state.timer
  const px = x + (w * Math.max(0, passed)) / total
  ctx.fillStyle = state.phase === 'window' ? COLORS.white : COLORS.accent
  ctx.fillRect(px - 3, y - 10, 6, GAUGE_H + 20)

  const label =
    state.phase === 'window'
      ? `${spec.name} · 窗口开启，立刻出拳！`
      : `${spec.name} 蓄力中 · 现在打会落空`
  shadowText(ctx, label, VIEW_W / 2, y - 32, {
    size: 28,
    color: state.phase === 'window' ? COLORS.green : COLORS.textDim,
  })
}

/** 底部操作区：选向时是三个拳的按钮，其它时候是出拳区 */
function drawActionPad(ctx: CanvasRenderingContext2D, state: State): void {
  if (state.phase === 'choose') {
    for (let i = 0; i < PUNCH_BUTTONS.length; i++) {
      const r = PUNCH_BUTTONS[i]
      const p = PUNCHES[i]
      const mine = state.turn === 'you'
      fillRoundRect(ctx, r.x, r.y, r.w, r.h, 24, mine ? COLORS.panelLight : COLORS.panel, COLORS.line, 3)
      text(ctx, p.name, r.x + r.w / 2, r.y + 40, { size: 40, weight: 'bold' })
      text(ctx, `伤害 ${p.damage}`, r.x + r.w / 2, r.y + 84, { size: 24, color: COLORS.accent, weight: 'bold' })
      text(ctx, `蓄力 ${p.windup} · 窗口 ${p.window}`, r.x + r.w / 2, r.y + 118, { size: 19, color: COLORS.textDim })
    }
    return
  }

  const r = STRIKE_PAD
  const mine = state.turn === 'you'
  const open = state.phase === 'window'
  const pulse = open ? 1 + Math.sin(state.tickCount * 0.9) * 0.05 : 1
  const w = r.w * pulse
  const h = r.h * pulse
  fillRoundRect(
    ctx,
    r.x + (r.w - w) / 2,
    r.y + (r.h - h) / 2,
    w,
    h,
    26,
    open ? (mine ? COLORS.green : COLORS.red) : COLORS.panel,
    open ? COLORS.white : COLORS.line,
    open ? 5 : 2,
  )
  text(ctx, open ? '出拳！' : '蓄力中 · 提前打会落空', r.x + r.w / 2, r.y + r.h / 2, {
    size: 34,
    weight: 'bold',
    color: open ? COLORS.black : COLORS.textDim,
  })
}

/** 擂台地面与观众灯 */
function drawRing(ctx: CanvasRenderingContext2D): void {
  for (let i = 0; i < 13; i++) {
    const x = 46 + i * 53
    disc(ctx, x, 214 + ((i * 37) % 5) * 6, 6, i % 2 === 0 ? COLORS.accent : COLORS.accent2, { alpha: 0.45 })
  }
  fillRoundRect(ctx, 30, FEET_Y - 8, VIEW_W - 60, 118, 22, COLORS.felt, COLORS.feltDark, 3)
  ctx.save()
  ctx.globalAlpha = 0.16
  ctx.fillStyle = COLORS.white
  ctx.beginPath()
  ctx.ellipse(VIEW_W / 2, FEET_Y + 92, 260, 20, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  text(ctx, 'TOY BOXING', VIEW_W / 2, FEET_Y + 92, { size: 34, weight: 'bold', color: withAlpha(COLORS.white, 0.35) })
}

function drawResult(ctx: CanvasRenderingContext2D, state: State): void {
  const win = state.winner === 'you'
  const title = win ? '你赢了！' : state.winner === 0 ? '平局' : '玩具熊赢了'
  const sub = `最高连击 ${state.you.best} / ${COMBO_CAP} · 剩余体力 ${state.you.hp}`
  banner(ctx, VIEW_W, VIEW_H, title, sub, win ? COLORS.accent : COLORS.red)
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  background(ctx, VIEW_W, VIEW_H, '#274a75', '#0f1b2d')
  drawRing(ctx)

  // 顶部遮罩 + 双方血条
  ctx.fillStyle = 'rgba(6,14,26,0.72)'
  ctx.fillRect(0, 0, VIEW_W, 160)
  drawStatBar(ctx, 40, 30, 270, '你', state.you.hp, COLORS.green, false, state.you.combo, state.turn === 'you')
  drawStatBar(ctx, VIEW_W - 310, 30, 270, '玩具熊', state.foe.hp, COLORS.red, true, state.foe.combo, state.turn === 'foe')

  // 出拳信息条（谁在出拳 / 上一次结算）
  const actor: Side = state.turn
  const phaseText: Record<Phase, string> = {
    choose: '选向阶段',
    windup: '蓄力中',
    window: '窗口开启',
  }
  text(ctx, `${actor === 'you' ? '你' : '玩具熊'} · ${phaseText[state.phase]}`, VIEW_W / 2, 170, {
    size: 26,
    weight: 'bold',
    color: state.turn === 'you' ? COLORS.accent2 : COLORS.pink,
  })
  if (state.lastEvent === 'hit' && animT(state) < 1) {
    shadowText(ctx, `-${state.lastDamage}`, actor === 'you' ? FOE_X : YOU_X, 300, {
      size: 56,
      color: COLORS.accent,
    })
  } else if (state.lastEvent === 'whiff' && animT(state) < 1) {
    shadowText(ctx, '落空！', actor === 'you' ? FOE_X : YOU_X, 320, { size: 44, color: COLORS.textDim })
  }

  drawToy(ctx, YOU_X, COLORS.blue, 1, poseFor(state, 'you'), state.tickCount)
  drawToy(ctx, FOE_X, COLORS.purple, -1, poseFor(state, 'foe'), state.tickCount)

  drawGauge(ctx, state)
  drawActionPad(ctx, state)

  if (state.over) drawResult(ctx, state)
}

// ---------------------------------------------------------------- 壳接口

function tick(dt: number): Action {
  return { type: 'tick', n: dt > 0 ? Math.max(1, Math.round(dt / MS_PER_TICK)) : 0 }
}

function input(state: State, p: PointerInput): Action | null {
  if (p.kind !== 'down' || state.over) return null
  if (state.phase === 'choose') {
    for (let i = 0; i < PUNCH_BUTTONS.length; i++) {
      if (inRect(p, PUNCH_BUTTONS[i])) return { type: 'choose', punch: PUNCHES[i].kind }
    }
    return null
  }
  return inRect(p, STRIKE_PAD) ? { type: 'punch' } : null
}

function key(state: State, k: string): Action | null {
  if (state.over) return null
  if (state.phase === 'choose') {
    if (k === '1') return { type: 'choose', punch: 'jab' }
    if (k === '2') return { type: 'choose', punch: 'cross' }
    if (k === '3') return { type: 'choose', punch: 'hook' }
    return null
  }
  if (k === ' ' || k === 'Enter' || k === 'j' || k === 'J') return { type: 'punch' }
  return null
}

function hint(state: State): string {
  if (state.over) {
    return state.winner === 'you' ? `你赢了！最高连击 ${state.you.best} 连` : '玩具熊站住了，再来一局'
  }
  if (state.phase === 'choose') return '先选一个出拳方向，再在时机窗口里点出拳'
  const spec = state.choice ? PUNCH_BY_KIND[state.choice] : PUNCHES[0]
  const who = state.turn === 'you' ? '你' : '玩具熊'
  return state.phase === 'window' ? `${who}的 ${spec.name} 窗口开启，立刻出拳！` : `${who}正在蓄 ${spec.name}，窗口未开别出手`
}

function outcome(state: State): Outcome | null {
  if (!state.over) return null
  return {
    score: state.you.hp + state.you.best * 10,
    better: 'higher',
    unit: '分',
    win: state.winner === 'you',
  }
}

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (next.seq !== prev.seq) {
    if (next.lastEvent === 'hit') {
      out.push({ kind: 'sound', name: 'hit' })
      out.push({ kind: 'shake', power: Math.min(10, 3 + next.lastDamage * 0.25) })
      out.push({
        kind: 'burst',
        x: next.lastBy === 'you' ? FOE_X : YOU_X,
        y: FEET_Y - 130,
        color: next.lastBy === 'you' ? COLORS.accent : COLORS.purple,
        count: 12,
      })
    } else {
      out.push({ kind: 'sound', name: 'error' })
    }
  }
  if (next.over && !prev.over) {
    out.push({ kind: 'sound', name: next.winner === 'you' ? 'win' : 'lose' })
  }
  return out
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  aiAction,
  input,
  key,
  tick,
  hint,
  outcome,
  effects,
  aiDelay: 200,
}

export default game
