/**
 * 台球简化版 pool-lite 渲染与接线层。
 * 物理与规则全在 rules.ts（纯逻辑）；这里只做 Canvas 2D 绘制与输入/时间折算。
 * 注意：不在画布上自绘 restart 按钮，也不重复画 controls() 已声明的控件（站点壳会自动追加「新的一局」）。
 */
import meta from './meta'
import type { GameModule } from '../../core/types'
import {
  BALL_R,
  POCKETS,
  POWER_BAR,
  POWER_MAX,
  POWER_MIN,
  RESTITUTION,
  TABLE,
  aiAction,
  controls,
  create,
  effects,
  hint,
  mapKey,
  mapPointer,
  outcome,
  reduce,
  tickAction,
  type Action,
  type Ball,
  type State,
} from './rules'
import { COLORS, background, disc, fillRoundRect, roundRectPath, shadowText, text, topBar, withAlpha } from '../../render/draw'

const VW = meta.viewport.width
const VH = meta.viewport.height

/** 编号球配色：1 黄 2 蓝 3 红 4 紫 5 橙，母球白 */
const BALL_COLOR: Record<number, string> = {
  0: COLORS.white,
  1: COLORS.yellow,
  2: COLORS.blue,
  3: COLORS.red,
  4: COLORS.purple,
  5: COLORS.orange,
}

const BALL_COLOR_DARK: Record<number, string> = {
  0: '#c9c9c9',
  1: '#c9a227',
  2: '#1f6fc4',
  3: '#b71c1c',
  4: '#6a1b9a',
  5: '#b35c00',
}

function drawTable(ctx: CanvasRenderingContext2D): void {
  // 木质外框
  fillRoundRect(ctx, TABLE.x - 24, TABLE.y - 24, TABLE.w + 48, TABLE.h + 48, 26, COLORS.woodDark, COLORS.wood, 3)
  // 台呢
  const g = ctx.createLinearGradient(TABLE.x, TABLE.y, TABLE.x, TABLE.y + TABLE.h)
  g.addColorStop(0, COLORS.felt)
  g.addColorStop(1, COLORS.feltDark)
  roundRectPath(ctx, TABLE.x, TABLE.y, TABLE.w, TABLE.h, 10)
  ctx.fillStyle = g
  ctx.fill()
  // 开球线
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth = 3
  ctx.setLineDash([12, 10])
  ctx.beginPath()
  ctx.moveTo(TABLE.x + TABLE.w * 0.25, TABLE.y + 6)
  ctx.lineTo(TABLE.x + TABLE.w * 0.25, TABLE.y + TABLE.h - 6)
  ctx.stroke()
  ctx.restore()
  // 袋口
  for (const p of POCKETS) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r * 0.62, 0, Math.PI * 2)
    ctx.fillStyle = '#0b1410'
    ctx.fill()
  }
}

function drawAim(ctx: CanvasRenderingContext2D, s: State): void {
  const cue = s.balls[0]
  if (cue.pocketed) return
  const len = 90 + s.power * 300
  const tx = cue.x + Math.cos(s.aimAngle) * len
  const ty = cue.y + Math.sin(s.aimAngle) * len
  ctx.save()
  ctx.strokeStyle = withAlpha(COLORS.white, 0.75)
  ctx.lineWidth = 3
  ctx.setLineDash([14, 12])
  ctx.beginPath()
  ctx.moveTo(cue.x, cue.y)
  ctx.lineTo(tx, ty)
  ctx.stroke()
  ctx.setLineDash([])
  // 瞄准杆
  ctx.strokeStyle = withAlpha('#e8d3a9', 0.9)
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(cue.x - Math.cos(s.aimAngle) * 130, cue.y - Math.sin(s.aimAngle) * 130)
  ctx.lineTo(cue.x - Math.cos(s.aimAngle) * 26, cue.y - Math.sin(s.aimAngle) * 26)
  ctx.stroke()
  // 准星
  ctx.strokeStyle = COLORS.accent
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(tx, ty, 12, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function drawBall(ctx: CanvasRenderingContext2D, b: Ball): void {
  if (b.pocketed) return
  const color = BALL_COLOR[b.id] ?? COLORS.white
  disc(ctx, b.x, b.y, BALL_R, color)
  if (b.id === 0) {
    ctx.beginPath()
    ctx.arc(b.x, b.y, BALL_R * 0.32, 0, Math.PI * 2)
    ctx.fillStyle = '#ef5350'
    ctx.fill()
    return
  }
  // 号码带
  ctx.beginPath()
  ctx.arc(b.x, b.y, BALL_R * 0.56, 0, Math.PI * 2)
  ctx.fillStyle = '#fdfdfd'
  ctx.fill()
  ctx.strokeStyle = BALL_COLOR_DARK[b.id] ?? COLORS.line
  ctx.lineWidth = 1.5
  ctx.stroke()
  text(ctx, String(b.id), b.x, b.y + 1, { size: 20, weight: 'bold', color: '#1b1b1f' })
}

function drawPowerBar(ctx: CanvasRenderingContext2D, s: State): void {
  const { x, y, w, h } = POWER_BAR
  const enabled = s.phase === 'aim' && !s.over && s.turn === 1
  fillRoundRect(ctx, x, y, w, h, h / 2, enabled ? 'rgba(10,18,30,0.85)' : 'rgba(10,18,30,0.5)', COLORS.line, 2)
  const ratio = (s.power - POWER_MIN) / (POWER_MAX - POWER_MIN)
  const t = Math.max(0, Math.min(1, ratio))
  const color = t < 0.4 ? COLORS.green : t < 0.75 ? COLORS.yellow : COLORS.red
  if (t > 0.001) {
    ctx.save()
    roundRectPath(ctx, x, y, w, h, h / 2)
    ctx.clip()
    ctx.fillStyle = color
    ctx.fillRect(x, y, w * t, h)
    ctx.restore()
  }
  // 球滚动时，这一行改显示状态文案而不是力度读数 —— 底部空档只放得下一行，
  // 另起一条基线会直接压在力度条上（见 POWER_BAR 的注释）。
  text(ctx, enabled ? `力度 ${Math.round(s.power * 100)}%` : '球在滚动…', x + w / 2, y + h / 2 + 1, {
    size: 22,
    weight: 'bold',
    color: COLORS.text,
  })
  text(ctx, '力度条', x - 24, y + h / 2, { size: 22, align: 'right', color: COLORS.textDim })
  // 反弹系数提示（规格：恢复系数固定）
  text(ctx, `恢复系数 ${RESTITUTION}`, VW - 12, y + h / 2, { size: 20, align: 'right', color: COLORS.textDim })
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH)
  drawTable(ctx)

  // 顶部信息栏
  topBar(ctx, VW, `目标 ${s.target} 号球`, `比分 ${s.score[0]}:${s.score[1]} · 罚杆 ${s.penalty[0]}:${s.penalty[1]}`, 88)
  text(ctx, s.turn === 1 ? '你' : 'AI', VW / 2, 44, { size: 30, weight: 'bold', color: s.turn === 1 ? COLORS.accent2 : COLORS.accent })

  if (s.phase === 'aim') drawAim(ctx, s)
  for (const b of s.balls) drawBall(ctx, b)

  drawPowerBar(ctx, s)

  // 底部提示（不画按钮，按钮由 controls() 交给站点壳）
  // VH-20 = 1260：力度条底边在 1232，提示字形约 1248~1272，两者留 16px 间隙。
  shadowText(ctx, s.message, VW / 2, VH - 20, { size: 24, weight: 'normal', color: COLORS.textDim, shadowBlur: 2 })

  if (s.over) {
    ctx.save()
    ctx.fillStyle = 'rgba(5,10,20,0.66)'
    ctx.fillRect(0, VH / 2 - 130, VW, 260)
    ctx.restore()
    shadowText(ctx, s.winner === 1 ? '你赢了！' : 'AI 获胜', VW / 2, VH / 2 - 30, {
      size: 68,
      color: s.winner === 1 ? COLORS.accent : COLORS.red,
    })
    shadowText(ctx, `${s.score[0]} : ${s.score[1]}　罚杆 ${s.penalty[0]}:${s.penalty[1]}`, VW / 2, VH / 2 + 55, {
      size: 34,
      weight: 'normal',
      color: COLORS.text,
    })
  }
  // 球滚动时不再另画「球在滚动…」——那行已并入力度条内部（见 drawPowerBar），
  // 在这里再画一次会正好压到力度条上造成叠字。
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  aiAction,
  input: mapPointer,
  key: mapKey,
  tick: tickAction,
  hint,
  controls,
  outcome,
  effects,
  aiDelay: 400,
}

export default game
