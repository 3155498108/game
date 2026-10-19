/**
 * 三轴老虎机 —— 渲染与输入层。
 *
 * 分工：
 * - rules.ts 定死赔付与计分，`reduce` 只走定步；
 * - 转轴的滚动、中奖高亮、待机走马灯全部走 `render/anim` 旁路（`elapsedSince` / `keepAlive`），
 *   不进入 state，因此动画只是「怎么画」，不影响任何判定；
 * - 拉杆/快转/再来一局只在 `controls()` 里声明，画布不再重复自绘这些控件。
 */
import type { GameModule, Effect, Outcome, Control } from '../../core/types'
import { meta } from './meta'
import {
  VW,
  VH,
  DT,
  ROUNDS,
  SYMBOL_COUNT,
  SYMBOL_IDS,
  TRIPLE_PAY,
  PAIR_PAY,
  THEORETIC_RTP,
  REEL_STOP_TICK,
  SETTLE_TICK,
  create,
  reduce,
} from './rules'
import type { Action, State, SymbolId } from './rules'
import {
  COLORS,
  PALETTE,
  background,
  text,
  shadowText,
  disc,
  fillRoundRect,
  roundRectPath,
  withAlpha,
  lighten,
  darken,
  ease,
} from '../../render/draw'
import { elapsedSince, now, keepAlive } from '../../render/anim'
import { clamp } from '../../core/geom'

// ------------------------------------------------------------------ 布局常量

/** 机台外框 */
const CAB_X = 36
const CAB_Y = 112
const CAB_W = VW - 72
/** 机台高度由转轴高度推出：转轴 3 格 + 上下留白，赔付表另有一整块空间 */
const CAB_H = 588

/** 三列转轴 */
const REEL_W = 182
const REEL_H = 480
const REEL_Y = CAB_Y + 56
const REEL_X = [CAB_X + 18, CAB_X + 18 + 215, CAB_X + 18 + 430]
const CELL_H = REEL_H / 3
/** 中奖行（赔付线）所在的 y */
const PAY_Y = REEL_Y + CELL_H * 1.5
const SYM = 78

/**
 * 赔付表面板。
 *
 * 面板底部高度刻意与「转轴高度」联锁：早先 REEL_H=522 / TBL_H=330 时，
 * 末行「三连 ×N」的子行基线落在 1026（占 1015~1037），
 * 而面板底部说明文字基线在 1042（占 1030~1054）——**两者重叠 7px，
 * 「三连 ×46」被压在说明文字下面**。这类叠字冒烟测试查不出来（它只验证 render 不抛错），
 * 是靠真机截图发现的。现在把转轴压矮 42px，把省出来的空间全部给赔付表。
 */
const TBL_X = 36
const TBL_Y = CAB_Y + CAB_H + 24
const TBL_W = VW - 72
const TBL_H = 372

/** 滚动动画窗口（由 rules 的定步表推导，保证画面与结算同一时刻收尾） */
const TICK_MS = DT * 1000
const REEL_DELAY_MS = REEL_STOP_TICK.map((t) => t * TICK_MS)
const REEL_DUR_MS = REEL_DELAY_MS.map((d) => SETTLE_TICK * TICK_MS - d)
const WIN_HOLD_MS = 2200

// ------------------------------------------------------------------ 符号外观

const SYMBOL_COLOR: Record<SymbolId, string> = {
  cherry: PALETTE[0],
  bell: PALETTE[3],
  star: PALETTE[5],
  diamond: PALETTE[6],
  seven: PALETTE[7],
  crown: PALETTE[4],
}

const SYMBOL_NAME: Record<SymbolId, string> = {
  cherry: '樱桃',
  bell: '铃铛',
  star: '星星',
  diamond: '钻石',
  seven: '幸运七',
  crown: '皇冠',
}

/** 五角星路径 */
function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, inner = 0.46): void {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * inner
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const px = x + Math.cos(a) * rr
    const py = y + Math.sin(a) * rr
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

/** 画一个符号：底衬圆盘 + 图形，绝不只靠文字 */
function drawSymbol(
  ctx: CanvasRenderingContext2D,
  sym: SymbolId,
  x: number,
  y: number,
  s: number,
  alpha = 1,
): void {
  const color = SYMBOL_COLOR[sym]
  ctx.save()
  ctx.globalAlpha = alpha

  disc(ctx, x, y, s * 0.96, darken(color, 0.55), { alpha: 0.6, ring: withAlpha(color, 0.55) })
  ctx.lineCap = 'round'

  switch (sym) {
    case 'cherry': {
      ctx.strokeStyle = lighten(color, 0.35)
      ctx.lineWidth = s * 0.1
      ctx.beginPath()
      ctx.moveTo(x - s * 0.2, y + s * 0.12)
      ctx.quadraticCurveTo(x - s * 0.34, y - s * 0.44, x + s * 0.1, y - s * 0.54)
      ctx.moveTo(x + s * 0.24, y + s * 0.2)
      ctx.quadraticCurveTo(x + s * 0.34, y - s * 0.3, x + s * 0.14, y - s * 0.52)
      ctx.stroke()
      ctx.fillStyle = PALETTE[2]
      ctx.beginPath()
      ctx.ellipse(x + s * 0.42, y - s * 0.48, s * 0.26, s * 0.11, -0.4, 0, Math.PI * 2)
      ctx.fill()
      disc(ctx, x - s * 0.2, y + s * 0.18, s * 0.28, color)
      disc(ctx, x + s * 0.24, y + s * 0.26, s * 0.28, color)
      break
    }
    case 'bell': {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(x - s * 0.4, y + s * 0.24)
      ctx.quadraticCurveTo(x - s * 0.42, y - s * 0.34, x, y - s * 0.48)
      ctx.quadraticCurveTo(x + s * 0.42, y - s * 0.34, x + s * 0.4, y + s * 0.24)
      ctx.closePath()
      ctx.fill()
      fillRoundRect(ctx, x - s * 0.47, y + s * 0.23, s * 0.94, s * 0.15, s * 0.07, darken(color, 0.25))
      disc(ctx, x, y + s * 0.47, s * 0.13, lighten(color, 0.2))
      break
    }
    case 'star': {
      starPath(ctx, x, y, s * 0.54)
      ctx.fillStyle = color
      ctx.fill()
      starPath(ctx, x, y, s * 0.3)
      ctx.fillStyle = withAlpha(COLORS.white, 0.45)
      ctx.fill()
      break
    }
    case 'diamond': {
      ctx.beginPath()
      ctx.moveTo(x, y - s * 0.54)
      ctx.lineTo(x + s * 0.45, y)
      ctx.lineTo(x, y + s * 0.54)
      ctx.lineTo(x - s * 0.45, y)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
      ctx.strokeStyle = withAlpha(COLORS.white, 0.65)
      ctx.lineWidth = s * 0.05
      ctx.beginPath()
      ctx.moveTo(x - s * 0.45, y)
      ctx.lineTo(x + s * 0.45, y)
      ctx.moveTo(x, y - s * 0.54)
      ctx.lineTo(x - s * 0.16, y)
      ctx.lineTo(x, y + s * 0.54)
      ctx.stroke()
      break
    }
    case 'seven': {
      fillRoundRect(
        ctx,
        x - s * 0.42,
        y - s * 0.48,
        s * 0.84,
        s * 0.96,
        s * 0.18,
        darken(color, 0.4),
        lighten(color, 0.2),
        s * 0.06,
      )
      shadowText(ctx, '7', x, y + s * 0.04, { size: s * 1.0, color: lighten(color, 0.5), shadowBlur: 2 })
      break
    }
    case 'crown': {
      ctx.beginPath()
      ctx.moveTo(x - s * 0.44, y + s * 0.28)
      ctx.lineTo(x - s * 0.44, y - s * 0.18)
      ctx.lineTo(x - s * 0.18, y + s * 0.02)
      ctx.lineTo(x, y - s * 0.42)
      ctx.lineTo(x + s * 0.18, y + s * 0.02)
      ctx.lineTo(x + s * 0.44, y - s * 0.18)
      ctx.lineTo(x + s * 0.44, y + s * 0.28)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
      fillRoundRect(ctx, x - s * 0.52, y + s * 0.28, s * 1.04, s * 0.16, s * 0.06, lighten(color, 0.3))
      for (const ox of [-0.44, 0, 0.44]) {
        const oy = ox === 0 ? -0.44 : -0.2
        disc(ctx, x + s * ox, y + s * oy, s * 0.09, COLORS.accent)
      }
      break
    }
  }
  ctx.restore()
}

// ------------------------------------------------------------------ 动画旁路

/** 本局动画签名：每次拉杆 +1 */
function spinSig(s: State): string {
  return `${s.spin}`
}

/** 中奖高亮强度：结算后 1 → 0 渐隐 */
function winGlow(s: State): number {
  if (s.phase === 'spinning' || s.spin === 0) return 0
  const e = elapsedSince('sm:win', `${s.spin}/${s.round}`, WIN_HOLD_MS)
  return 1 - clamp(e / WIN_HOLD_MS, 0, 1)
}

/**
 * 第 i 列的连续滚动位置（单位：符号）。
 * 位置只用于「画」，最终落点仍然是 state.reels[i]；这里没有任何随机。
 */
function reelScroll(s: State, i: number): number {
  if (s.phase === 'spinning') {
    const e = elapsedSince(`sm:reel${i}`, spinSig(s), SETTLE_TICK * TICK_MS + 400)
    const k = clamp((e - REEL_DELAY_MS[i]) / REEL_DUR_MS[i], 0, 1)
    const end = s.reels[i] + 18 * SYMBOL_COUNT
    const from = end + (2 + i) * SYMBOL_COUNT
    return from - (from - end) * ease.outQuad(k)
  }
  if (s.spin === 0) {
    // 开局待机：走马灯，同样不进 state
    keepAlive()
    return now() / 90 + i * 2
  }
  return s.reels[i]
}

// ------------------------------------------------------------------ 绘制

function drawReel(ctx: CanvasRenderingContext2D, s: State, i: number): void {
  const x = REEL_X[i]
  const cx = x + REEL_W / 2
  const pos = reelScroll(s, i)
  const base = Math.round(pos)
  const glow = winGlow(s)
  const hit = s.phase !== 'spinning' && s.spin > 0 && s.combo.cols.indexOf(i) >= 0

  ctx.save()
  roundRectPath(ctx, x, REEL_Y, REEL_W, REEL_H, 18)
  ctx.clip()

  ctx.fillStyle = '#0c1626'
  ctx.fillRect(x, REEL_Y, REEL_W, REEL_H)

  if (hit && glow > 0) {
    fillRoundRect(ctx, x + 2, REEL_Y + CELL_H + 2, REEL_W - 4, CELL_H - 4, 14, withAlpha(COLORS.accent, 0.2 * glow))
  }

  // 上下各多画一格，滚动时不会露出空白
  for (let k = -2; k <= 3; k++) {
    const idx = ((base + k) % SYMBOL_COUNT + SYMBOL_COUNT) % SYMBOL_COUNT
    const cy = REEL_Y + (k + 1.5) * CELL_H
    const d = Math.abs(cy - PAY_Y) / (REEL_H / 2)
    drawSymbol(ctx, SYMBOL_IDS[idx], cx, cy, SYM, clamp(1.05 - d * 0.8, 0.22, 1))
  }

  // 行分隔线
  ctx.strokeStyle = withAlpha(COLORS.line, 0.55)
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let r = 1; r <= 2; r++) {
    ctx.moveTo(x, REEL_Y + r * CELL_H)
    ctx.lineTo(x + REEL_W, REEL_Y + r * CELL_H)
  }
  ctx.stroke()
  ctx.restore()

  roundRectPath(ctx, x, REEL_Y, REEL_W, REEL_H, 18)
  ctx.strokeStyle = hit && glow > 0 ? withAlpha(COLORS.accent, 0.4 + 0.6 * glow) : COLORS.line
  ctx.lineWidth = hit && glow > 0 ? 4 : 2
  ctx.stroke()
}

/** 中奖线：横向高亮 + 两侧箭头 */
function drawPayLine(ctx: CanvasRenderingContext2D, glow: number): void {
  ctx.save()
  ctx.strokeStyle = withAlpha(COLORS.accent, 0.45 + 0.55 * glow)
  ctx.lineWidth = 3 + 3 * glow
  ctx.beginPath()
  ctx.moveTo(CAB_X + 10, PAY_Y)
  ctx.lineTo(CAB_X + CAB_W - 10, PAY_Y)
  ctx.stroke()
  ctx.fillStyle = withAlpha(COLORS.accent, 0.6 + 0.4 * glow)
  for (const dir of [-1, 1]) {
    const ax = dir < 0 ? CAB_X + 12 : CAB_X + CAB_W - 12
    ctx.beginPath()
    ctx.moveTo(ax, PAY_Y)
    ctx.lineTo(ax + dir * 16, PAY_Y - 11)
    ctx.lineTo(ax + dir * 16, PAY_Y + 11)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

function drawCabinet(ctx: CanvasRenderingContext2D, s: State): void {
  fillRoundRect(ctx, CAB_X, CAB_Y, CAB_W, CAB_H, 30, withAlpha(COLORS.panel, 0.96), COLORS.line, 3)
  text(ctx, '赔付线', VW / 2, CAB_Y + 34, { size: 26, weight: 'bold', color: COLORS.textDim })
  for (let i = 0; i < 3; i++) drawReel(ctx, s, i)
  const glow = winGlow(s)
  drawPayLine(ctx, glow)
  // 顶部指示灯
  const lampOn = glow > 0.15
  for (let i = 0; i < 6; i++) {
    disc(ctx, CAB_X + 60 + i * 105, CAB_Y + CAB_H - 26, 7, lampOn ? COLORS.accent : COLORS.line, {
      alpha: lampOn ? 0.95 : 0.5,
    })
  }
}

/**
 * 赔付表：与 rules 的 PAY_TABLE 同一数据源，牌面即从它渲染出来
 *
 * 行位置**从面板可用高度推导**（标题之下、底部说明之上的那一段），
 * 不写死行距——写死行距就等于默认「加一行不会挤到说明文字」，
 * 而那正是上一版出重叠的原因。
 */
function drawPayTable(ctx: CanvasRenderingContext2D): void {
  fillRoundRect(ctx, TBL_X, TBL_Y, TBL_W, TBL_H, 24, withAlpha(COLORS.panel, 0.9), COLORS.line, 2)
  text(ctx, '赔付表（单位：注额倍）', VW / 2, TBL_Y + 36, { size: 28, weight: 'bold', color: COLORS.accent })

  const ROW_TOP = TBL_Y + 76
  const ROW_PITCH = 66
  const colW = TBL_W / 2
  for (let i = 0; i < SYMBOL_COUNT; i++) {
    const sym = SYMBOL_IDS[i]
    const cx = TBL_X + (i % 2) * colW
    const cy = ROW_TOP + ROW_PITCH / 2 + Math.floor(i / 2) * ROW_PITCH
    drawSymbol(ctx, sym, cx + 46, cy, 34)
    text(ctx, SYMBOL_NAME[sym], cx + 88, cy - 13, { size: 26, align: 'left', color: COLORS.text })
    text(ctx, `三连 ×${TRIPLE_PAY[sym]}`, cx + 88, cy + 16, { size: 22, align: 'left', color: COLORS.accent })
  }

  text(ctx, `任意两轴同图 ×${PAIR_PAY} · 三轴全不同 空奖`, VW / 2, TBL_Y + TBL_H - 52, {
    size: 24,
    color: COLORS.textDim,
  })
  text(ctx, `理论回报率 ${(THEORETIC_RTP * 100).toFixed(1)}% · 注额由结算层决定`, VW / 2, TBL_Y + TBL_H - 20, {
    size: 22,
    color: COLORS.textDim,
  })
}

function fmtNet(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}`
}

function comboText(s: State): string {
  const c = s.combo
  if (s.spin === 0) return '拉杆开转'
  if (c.kind === 'none') return '上一局：空奖（-1 注）'
  if (c.kind === 'pair') return `上一局：${SYMBOL_NAME[c.symbol!]} 两连 赔付 ×${c.pay}`
  return `上一局：${SYMBOL_NAME[c.symbol!]} 三连 赔付 ×${c.pay}`
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, COLORS.bg2, COLORS.bg)
  drawCabinet(ctx, s)
  drawPayTable(ctx)

  const baseY = TBL_Y + TBL_H
  if (s.phase === 'over') {
    // 终局横幅放在机器下方，不遮挡刚停下的转轴
    fillRoundRect(ctx, CAB_X, baseY + 14, CAB_W, 152, 22, 'rgba(5,10,20,0.78)', COLORS.accent, 3)
    shadowText(ctx, `${ROUNDS} 局结束`, VW / 2, baseY + 66, { size: 46, color: COLORS.accent })
    shadowText(ctx, `净盈亏 ${fmtNet(s.net)} 倍注`, VW / 2, baseY + 128, { size: 32, color: COLORS.text })
    return
  }

  text(ctx, '本场净盈亏（注额倍）', VW / 2, baseY + 34, { size: 24, color: COLORS.textDim })
  shadowText(ctx, `${fmtNet(s.net)} 倍`, VW / 2, baseY + 82, {
    size: 54,
    color: s.net > 0 ? COLORS.green : s.net < 0 ? COLORS.text : COLORS.accent,
  })
  text(ctx, comboText(s), VW / 2, baseY + 134, { size: 24, color: COLORS.textDim })
}

// ------------------------------------------------------------------ 输入与控件

function controls(s: State): Control<Action>[] {
  if (s.phase === 'over') {
    return [{ label: '再来一局', action: { type: 'restart' }, primary: true }]
  }
  if (s.phase === 'spinning') {
    return [
      { label: '拉杆开转', action: { type: 'pull' }, disabled: true },
      { label: '快转', action: { type: 'skip' } },
    ]
  }
  return [{ label: '拉杆开转', action: { type: 'pull' }, primary: true }]
}

function key(s: State, k: string): Action | null {
  if (s.phase === 'over') return k === 'r' || k === 'R' ? { type: 'restart' } : null
  if (k === ' ' || k === 'Enter') return s.phase === 'spinning' ? { type: 'skip' } : { type: 'pull' }
  if (k === 'x' || k === 'X') return { type: 'skip' }
  return null
}

function hint(s: State): string {
  if (s.phase === 'over') return `${ROUNDS} 局结束，净盈亏 ${fmtNet(s.net)} 倍注 · 点「再来一局」重开`
  if (s.phase === 'spinning') return '转轴滚动中… 可点「快转」直接结算'
  return `第 ${Math.min(s.round + 1, ROUNDS)}/${ROUNDS} 局 · 净盈亏 ${fmtNet(s.net)} 倍注｜三连高赔、任意两连 ×${PAIR_PAY}`
}

function outcome(s: State): Outcome | null {
  if (s.phase !== 'over') return null
  return { score: s.net, better: 'higher', unit: '金币', win: s.net > 0 }
}

/** 按注额倍数换算：注额越大，赔付同比例放大，不写死面值 */
function coins(s: State, o: Outcome, bet: number): number {
  if (s.phase !== 'over') return 0
  return Math.round(o.score * bet)
}

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (next.spin !== prev.spin) out.push({ kind: 'sound', name: 'click' })
  if (next.round === prev.round) return out

  const c = next.combo
  if (c.pay > 0) {
    const color = c.symbol ? SYMBOL_COLOR[c.symbol] : COLORS.accent
    out.push({ kind: 'sound', name: 'win' })
    out.push({ kind: 'burst', x: VW / 2, y: PAY_Y, color, count: c.kind === 'triple' ? 40 : 18 })
    out.push({ kind: 'flash', color: withAlpha(COLORS.white, 0.4) })
    if (c.kind === 'triple' && c.pay >= TRIPLE_PAY.crown) out.push({ kind: 'shake', power: 14 })
  } else {
    out.push({ kind: 'sound', name: 'lose' })
  }
  if (next.phase === 'over' && prev.phase !== 'over') out.push({ kind: 'sound', name: 'score' })
  return out
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  key,
  /** 真实 dt(ms) → 整数 tick 数，交给 rules 定步推进 */
  tick: (dt: number) => ({ type: 'step', n: clamp(Math.round(dt / TICK_MS), 0, 4) }),
  hint,
  controls,
  outcome,
  effects,
  coins,
}

export default game
export { meta }
