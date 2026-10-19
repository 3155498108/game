/**
 * 欧式轮盘 roulette —— 渲染与输入层。
 *
 * 盘的公转、球的下落全部走 render/anim 的动画旁路（progressSince），
 * 动画进度不进入 State；State 里只有落点号码这一「事实」。
 * 下注按钮一律由 controls() 交给站点壳渲染成 DOM 按钮，画布上只画盘面与 HUD。
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { meta } from './meta'
import {
  BET_DEFS,
  BET_ORDER,
  MAX_CHIPS,
  ROUNDS,
  SLOT_ANGLE,
  SPIN_TICKS,
  TICK_MS,
  VH,
  VW,
  WHEEL,
  chipOf,
  create,
  isRed,
  reduce,
  slotOf,
  totalStake,
} from './rules'
import type { Action, BetKind, State } from './rules'
import { COLORS, background, disc, fillRoundRect, shadowText, text, withAlpha } from '../../render/draw'
import { progressSince } from '../../render/anim'
import { clamp } from '../../core/geom'

// ---------------- 版面常量 ----------------
const CX = VW / 2
const CY = 430
const R = 300
const BALL_TRACK = R * 1.0
const BALL_HOME = R * 0.86
const SLOT_TEXT_R = R * 0.86
const POINTER_Y = CY - R - 54
const RESULT_Y = 792
const CHIP_PANEL_Y = 862
const HUD_Y = VH - 96

const RED_C = '#c62f33'
const BLACK_C = '#22222a'
const GREEN_C = '#2e9e4f'
const WOOD = '#7b5628'

/** 盘面旋转动画时长（毫秒），与 SPIN_TICKS 对齐 */
const SPIN_MS = SPIN_TICKS * TICK_MS

function slotColor(n: number): string {
  if (n === 0) return GREEN_C
  return isRed(n) ? RED_C : BLACK_C
}

/** 号码配色：红格用白字，黑格用金字 */
function slotTextColor(n: number): string {
  if (n === 0) return COLORS.white
  return isRed(n) ? COLORS.white : COLORS.accent
}

// ---------------- 盘面 ----------------

function drawWheel(ctx: CanvasRenderingContext2D, rot: number, hot: number | null): void {
  // 外圈木轮
  disc(ctx, CX, CY, R + 26, WOOD, { ring: '#4d3418' })
  ctx.fillStyle = '#2a1c0c'
  ctx.beginPath()
  ctx.arc(CX, CY, R + 8, 0, Math.PI * 2)
  ctx.fill()

  for (let i = 0; i < WHEEL.length; i++) {
    const n = WHEEL[i]
    const mid = i * SLOT_ANGLE + rot
    const a0 = mid - SLOT_ANGLE / 2 - Math.PI / 2
    const a1 = mid + SLOT_ANGLE / 2 - Math.PI / 2
    ctx.beginPath()
    ctx.moveTo(CX, CY)
    ctx.arc(CX, CY, R, a0, a1)
    ctx.closePath()
    ctx.fillStyle = hot === n ? COLORS.yellow : slotColor(n)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  // 号码：沿半径摆放，跟随盘一起转
  for (let i = 0; i < WHEEL.length; i++) {
    const n = WHEEL[i]
    const ang = i * SLOT_ANGLE + rot - Math.PI / 2
    const x = CX + Math.cos(ang) * SLOT_TEXT_R
    const y = CY + Math.sin(ang) * SLOT_TEXT_R
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(ang + Math.PI / 2)
    ctx.font = 'bold 26px system-ui,sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = slotTextColor(n)
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 4
    ctx.fillText(String(n), 0, 0)
    ctx.restore()
  }

  // 落点高亮：金色描线圈住中奖号码
  if (hot !== null) {
    const ang = slotOf(hot) * SLOT_ANGLE + rot - Math.PI / 2
    const x = CX + Math.cos(ang) * SLOT_TEXT_R
    const y = CY + Math.sin(ang) * SLOT_TEXT_R
    ctx.save()
    ctx.strokeStyle = COLORS.yellow
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.arc(x, y, 24, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  // 轮毂
  disc(ctx, CX, CY, 54, '#5a4426', { ring: COLORS.accent })
  shadowText(ctx, 'R', CX, CY + 1, { size: 44, color: COLORS.accent })
}

/** 顶部指针 */
function drawPointer(ctx: CanvasRenderingContext2D): void {
  ctx.save()
  ctx.fillStyle = COLORS.accent
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(CX, POINTER_Y + 48)
  ctx.lineTo(CX - 22, POINTER_Y)
  ctx.lineTo(CX + 22, POINTER_Y)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** 球：先在盘外圈公转，再收进中奖格 */
function drawBall(ctx: CanvasRenderingContext2D, angle: number, radius: number, hot: number | null): void {
  const x = CX + Math.cos(angle) * radius
  const y = CY + Math.sin(angle) * radius
  if (hot !== null) {
    ctx.save()
    ctx.globalAlpha = 0.55
    ctx.strokeStyle = COLORS.accent2
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(CX, CY, BALL_HOME, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  disc(ctx, x, y, 15, COLORS.white, { ring: hot !== null ? COLORS.accent : undefined })
}

// ---------------- HUD ----------------

/** 落点与盈亏横幅（纯信息，不是控件） */
function drawResult(ctx: CanvasRenderingContext2D, s: State): void {
  const n = s.result
  if (n === null) {
    shadowText(ctx, '下注后开始旋转', CX, RESULT_Y, { size: 34, color: COLORS.textDim })
    return
  }
  if (s.phase === 'spin') return
  ctx.save()
  ctx.globalAlpha = 0.85
  disc(ctx, CX - 132, RESULT_Y, 34, slotColor(n), { ring: COLORS.accent })
  shadowText(ctx, String(n), CX - 132, RESULT_Y + 1, { size: 34, color: COLORS.white })
  ctx.restore()

  if (s.phase === 'settle' || s.phase === 'over') {
    const win = s.lastDelta > 0
    const sign = s.lastDelta > 0 ? '+' : ''
    shadowText(ctx, `${sign}${s.lastDelta} 注`, CX + 78, RESULT_Y - 16, {
      size: 44,
      color: win ? COLORS.accent : s.lastDelta < 0 ? COLORS.red : COLORS.textDim,
    })
    const won = s.lastWon.length
      ? `命中 ${s.lastWon.map((k) => BET_DEFS[k].short).join('、')}`
      : '未命中'
    text(ctx, won, CX + 78, RESULT_Y + 30, { size: 24, color: COLORS.textDim })
  } else {
    text(ctx, '上一盘落点', CX + 78, RESULT_Y + 4, { size: 24, color: COLORS.textDim })
  }
}

/** 本盘已下筹码清单：只读展示，不在画布上做按钮 */
function drawChipList(ctx: CanvasRenderingContext2D, s: State): void {
  const rows = Math.max(1, s.chips.length)
  const top = CHIP_PANEL_Y
  const h = 44 + rows * 32
  fillRoundRect(ctx, 36, top, VW - 72, h, 20, 'rgba(0,0,0,0.24)', COLORS.line, 2)
  text(ctx, '本盘下注', 60, top + 24, { size: 24, align: 'left', color: COLORS.textDim })

  if (s.chips.length === 0) {
    text(ctx, '在下方按钮区选注码（可叠注）', VW / 2, top + 60, { size: 26, color: COLORS.textDim })
    return
  }
  s.chips.forEach((c, i) => {
    const y = top + 60 + i * 32
    const def = BET_DEFS[c.kind]
    disc(ctx, 62, y, 11, def.color, { ring: 'rgba(255,255,255,0.5)' })
    text(ctx, `${def.short} × ${c.count}`, 86, y, { size: 24, align: 'left', weight: 'bold' })
    text(ctx, `${def.odds}:1`, VW - 62, y, { size: 22, align: 'right', color: COLORS.textDim })
  })
  text(ctx, `合计 ${totalStake(s.chips)} 注`, VW - 62, top + 24, {
    size: 22,
    align: 'right',
    color: COLORS.accent,
  })
}

/** 底部 HUD：累计盈亏 + 盘数进度 */
function drawHud(ctx: CanvasRenderingContext2D, s: State): void {
  fillRoundRect(ctx, 36, HUD_Y, VW - 72, 68, 22, 'rgba(0,0,0,0.35)', withAlpha(COLORS.accent2, 0.5), 2)
  const profit = s.bankroll
  shadowText(ctx, `累计 ${profit > 0 ? '+' : ''}${profit} 注`, CX, HUD_Y + 34, {
    size: 38,
    color: profit > 0 ? COLORS.accent : profit < 0 ? COLORS.red : COLORS.text,
  })
  text(ctx, `第 ${Math.min(s.round + 1, ROUNDS)} / ${ROUNDS} 盘`, 60, HUD_Y - 22, {
    size: 24,
    align: 'left',
    color: COLORS.textDim,
  })
  const phaseLabel =
    s.phase === 'bet' ? '下注中' : s.phase === 'spin' ? '旋转中' : s.phase === 'settle' ? '结算中' : '本场结束'
  text(ctx, phaseLabel, VW - 60, HUD_Y - 22, { size: 24, align: 'right', color: COLORS.accent2 })
}

// ---------------- render ----------------

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, '#17402e', '#0a1a12')

  // 盘面公转：动画旁路，State 不含任何动画量。
  // 签名用 spinId（每次旋转只变一次），结算后签名保持不变，进度稳定停在 1。
  const sig = `${s.spinId}:${s.result}`
  const t = s.result === null ? 1 : progressSince('roulette-spin', sig, SPIN_MS, easeOutSpin)
  const target = s.result === null ? 0 : slotOf(s.result) * SLOT_ANGLE
  const rot = (Math.PI * 2 * s.turns - target) * t

  const showHot = s.phase === 'settle' || s.phase === 'over' || s.phase === 'bet'
  drawWheel(ctx, rot, showHot ? s.result : null)
  drawPointer(ctx)

  if (s.result !== null) {
    const rotFinal = Math.PI * 2 * s.turns - target
    const settle = clamp((t - 0.72) / 0.28, 0, 1)
    const radius = BALL_TRACK + (BALL_HOME - BALL_TRACK) * settle
    drawBall(ctx, rotFinal - rot - Math.PI / 2, radius, showHot ? s.result : null)
  }

  drawResult(ctx, s)
  drawChipList(ctx, s)
  drawHud(ctx, s)

  if (s.phase === 'over') {
    ctx.save()
    ctx.fillStyle = 'rgba(5,10,20,0.66)'
    ctx.fillRect(0, 0, VW, VH)
    ctx.restore()
    shadowText(ctx, '十盘结束', CX, VH / 2 - 60, { size: 64, color: COLORS.accent })
    shadowText(ctx, `累计净盈亏 ${s.bankroll > 0 ? '+' : ''}${s.bankroll} 注`, CX, VH / 2 + 20, {
      size: 38,
      color: s.bankroll >= 0 ? COLORS.text : COLORS.red,
    })
    text(ctx, '按「重新开局」再来一场', CX, VH / 2 + 86, { size: 26, color: COLORS.textDim })
  }
}

/** 起步慢、中段快、收尾稳的手感曲线 */
function easeOutSpin(t: number): number {
  return 1 - Math.pow(1 - t, 3.4)
}

// ---------------- 输入 ----------------

function input(s: State, p: PointerInput): Action | null {
  // 画布上只有盘面与 HUD，点哪儿都不改注；按钮全在提示区
  if (p.kind !== 'down') return null
  return s.phase === 'settle' ? { type: 'next' } : null
}

function key(_s: State, k: string): Action | null {
  if (k === ' ' || k === 'Enter') return { type: 'spin' }
  if (k === 'Backspace' || k === 'Delete') return { type: 'clear' }
  if (k >= '1' && k <= '9') {
    const kind = BET_ORDER[Number(k) - 1]
    return kind ? { type: 'bet', kind } : null
  }
  return null
}

function controls(s: State): Control<Action>[] {
  if (s.phase === 'over') return [{ label: '重新开局', action: { type: 'restart' }, primary: true }]
  if (s.phase === 'spin') return [{ label: '旋转中…', action: { type: 'spin' }, disabled: true }]
  if (s.phase === 'settle') return [{ label: '马上继续', action: { type: 'next' } }]

  const list: Control<Action>[] = BET_ORDER.map((kind) => ({
    label: BET_DEFS[kind].label,
    action: { type: 'bet', kind } as Action,
    disabled: chipOf(s.chips, kind) >= MAX_CHIPS,
  }))
  list.push({ label: '清空', action: { type: 'clear' }, disabled: s.chips.length === 0 })
  list.push({
    label: s.chips.length > 0 ? '开始旋转' : '先选注码',
    action: { type: 'spin' },
    primary: true,
    disabled: s.chips.length === 0,
  })
  return list
}

function hint(s: State): string {
  if (s.phase === 'over') return `十盘结束 · 累计净盈亏 ${s.bankroll} 注｜可重新开局`
  if (s.phase === 'spin') return '球在盘上飞，转完自动结算'
  if (s.phase === 'settle') {
    const sign = s.lastDelta > 0 ? '+' : ''
    return `落点 ${s.result} · 本盘 ${sign}${s.lastDelta} 注｜累计 ${s.bankroll} 注`
  }
  return `第 ${s.round + 1}/${ROUNDS} 盘 · 选注码（可叠注，键盘 1-9）· 红黑大小单双 1:1，零 35:1`
}

// ---------------- 成绩与金币 ----------------

function outcome(s: State): Outcome | null {
  if (s.phase !== 'over') return null
  return { score: s.bankroll, better: 'higher', unit: '金币', win: s.bankroll > 0 }
}

/**
 * 金币结算：把「注」换算成金币，按玩家设定注额线性缩放，不写死面值。
 * 净盈亏为正即赚、为负即输。
 */
function coins(_s: State, o: Outcome, bet: number): number {
  if (!Number.isFinite(bet) || bet <= 0) return 0
  return Math.round(o.score * bet)
}

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (next.chips.length > prev.chips.length) out.push({ kind: 'sound', name: 'place' })
  if (next.chips.length < prev.chips.length) out.push({ kind: 'sound', name: 'click' })
  if (next.phase === 'spin' && prev.phase !== 'spin') out.push({ kind: 'sound', name: 'click' })
  if (next.phase === 'settle' && prev.phase !== 'settle') {
    if (next.lastDelta > 0) {
      out.push({ kind: 'sound', name: 'win' })
      out.push({ kind: 'burst', x: CX, y: RESULT_Y, color: COLORS.accent, count: 26 })
      out.push({ kind: 'flash', color: withAlpha(COLORS.accent, 0.28) })
    } else if (next.lastDelta < 0) {
      out.push({ kind: 'sound', name: 'lose' })
      out.push({ kind: 'shake', power: 8 })
    } else {
      out.push({ kind: 'sound', name: 'tick' })
    }
  }
  if (next.phase === 'over' && prev.phase !== 'over') {
    out.push({ kind: 'sound', name: 'score' })
    out.push({ kind: 'burst', x: CX, y: VH / 2, color: COLORS.accent2, count: 32 })
  }
  return out
}

// ---------------- 组装 ----------------

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  input,
  key,
  /** 真实 dt(ms) → 整数定步数，交给 rules 推进阶段 */
  tick: (dt: number) => ({ type: 'step', n: clamp(Math.round(dt / TICK_MS), 0, 3) }),
  hint,
  controls,
  outcome,
  effects,
  coins,
}

export type { BetKind }
export { meta, create, reduce, render, controls, hint, outcome, coins, effects }
export default game
