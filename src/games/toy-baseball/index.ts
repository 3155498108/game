/**
 * 玩具棒球 · 渲染与输入层。
 *
 * 时间推进：本层用 performance.now() 拿到壳给的真实 dt（毫秒），
 * 换算成整数 tick 后通过 `{ type: 'tick', n }` 推进规则；规则层不知道真实时间。
 */
import meta from './meta'
import {
  create,
  reduce,
  windowOpen,
  timingOffset,
  RESULT_LABEL,
  GREAT_SCORE,
  PERFECT_TICK,
  RESULT_HOLD_TICKS,
  TICK_MS,
  TOTAL_PITCHES,
  WINDOW_HALF,
  FOUL_HALF,
  type State,
  type Action,
} from './rules'
import { clamp, lerp } from '../../core/geom'
import { COLORS, background, banner, disc, ease, fillRoundRect, roundRectPath, shadowText, text, withAlpha } from '../../render/draw'
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'

const VW = meta.viewport.width
const VH = meta.viewport.height

/** 投手丘 */
const MOUND = { x: 360, y: 470 }
/** 本垒板 */
const PLATE = { x: 360, y: 950 }
/** 好球带矩形尺寸 */
const ZONE_W = 176
const ZONE_H = 216
/** 球飞过本垒后继续下落的 tick 数 */
const PAST_TICKS = 16

/** dt 累加器：把真实帧时间折算成整数 tick，避免低帧率下丢失推进 */
let accumulator = 0

/** 球在 tick t 时的位置与大小（t <= center 为飞向本垒，之后为越过本垒下坠） */
function ballPos(p: State['pitch'], t: number): { x: number; y: number; r: number; alpha: number } {
  const u = clamp(t / p.center, 0, 1)
  const e = ease.inOutQuad(u)
  const baseX = lerp(MOUND.x, p.laneX, e) + p.curve * Math.sin(Math.PI * u)
  const baseY = lerp(MOUND.y, PLATE.y, e)
  const r = lerp(8, 23, e) * p.depth
  if (t <= p.center) return { x: baseX, y: baseY, r, alpha: 1 }
  const over = clamp((t - p.center) / PAST_TICKS, 0, 1)
  return { x: baseX, y: PLATE.y + over * 300, r: r * (1 + over * 0.3), alpha: 1 - over }
}

/** 击球区（好球带）中心 */
function zoneCenter(p: State['pitch']): { x: number; y: number } {
  return { x: p.laneX, y: PLATE.y - 8 }
}

/** 挥棒动画进度 0..1（没挥棒返回 0） */
function swingProgress(s: State): number {
  if (!s.pitch.swung) return 0
  return clamp((RESULT_HOLD_TICKS - s.hold) / 10, 0, 1)
}

/** 场地与人物 */
function drawField(ctx: CanvasRenderingContext2D): void {
  // 观众看台
  ctx.fillStyle = COLORS.bg2
  ctx.fillRect(0, 0, VW, 360)
  ctx.fillStyle = withAlpha(COLORS.line, 0.5)
  for (let i = 0; i < 9; i++) ctx.fillRect(0, 40 + i * 34, VW, 6)
  // 记分牌
  fillRoundRect(ctx, VW / 2 - 190, 22, 380, 66, 14, withAlpha(COLORS.black, 0.55), COLORS.line)
  text(ctx, '玩具棒球 · 十球挑战', VW / 2, 55, { size: 30, color: COLORS.accent, weight: 'bold' })

  // 外野草地
  const grass = ctx.createLinearGradient(0, 340, 0, VH)
  grass.addColorStop(0, COLORS.feltDark)
  grass.addColorStop(0.45, COLORS.felt)
  grass.addColorStop(1, COLORS.feltDark)
  ctx.fillStyle = grass
  ctx.fillRect(0, 340, VW, VH - 340)

  // 内野土区（菱形）
  ctx.fillStyle = COLORS.woodDark
  ctx.beginPath()
  ctx.moveTo(PLATE.x, PLATE.y + 60)
  ctx.lineTo(PLATE.x - 420, 470)
  ctx.lineTo(PLATE.x + 420, 470)
  ctx.closePath()
  ctx.fill()

  // 边线
  ctx.strokeStyle = withAlpha(COLORS.white, 0.6)
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(PLATE.x, PLATE.y + 60)
  ctx.lineTo(PLATE.x - 420, 470)
  ctx.moveTo(PLATE.x, PLATE.y + 60)
  ctx.lineTo(PLATE.x + 420, 470)
  ctx.stroke()

  // 投手丘
  ctx.fillStyle = COLORS.wood
  ctx.beginPath()
  ctx.ellipse(MOUND.x, MOUND.y, 96, 34, 0, 0, Math.PI * 2)
  ctx.fill()
  // 投手
  ctx.fillStyle = COLORS.blue
  fillRoundRect(ctx, MOUND.x - 26, MOUND.y - 92, 52, 92, 20, COLORS.blue)
  disc(ctx, MOUND.x, MOUND.y - 106, 24, COLORS.wood)

  // 本垒板
  ctx.fillStyle = COLORS.white
  ctx.beginPath()
  ctx.moveTo(PLATE.x, PLATE.y - 26)
  ctx.lineTo(PLATE.x + 26, PLATE.y - 4)
  ctx.lineTo(PLATE.x + 17, PLATE.y + 24)
  ctx.lineTo(PLATE.x - 17, PLATE.y + 24)
  ctx.lineTo(PLATE.x - 26, PLATE.y - 4)
  ctx.closePath()
  ctx.fill()
  // 捕手
  ctx.fillStyle = COLORS.black
  fillRoundRect(ctx, PLATE.x - 30, PLATE.y - 96, 60, 84, 18, withAlpha(COLORS.black, 0.85))
  disc(ctx, PLATE.x, PLATE.y - 110, 22, COLORS.red)

  // 底部提示底板
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.fillRect(0, VH - 190, VW, 190)
}

/** 击球区 / 判定窗口 */
function drawZone(ctx: CanvasRenderingContext2D, s: State): void {
  const c = zoneCenter(s.pitch)
  const x = c.x - ZONE_W / 2
  const y = c.y - ZONE_H / 2
  const open = windowOpen(s)

  if (open) {
    const g = ctx.createRadialGradient(c.x, c.y, 10, c.x, c.y, ZONE_W)
    g.addColorStop(0, withAlpha(COLORS.accent, 0.34))
    g.addColorStop(1, withAlpha(COLORS.accent, 0))
    ctx.fillStyle = g
    ctx.fillRect(x - 90, y - 90, ZONE_W + 180, ZONE_H + 180)
  }

  roundRectPath(ctx, x, y, ZONE_W, ZONE_H, 12)
  ctx.fillStyle = open ? withAlpha(COLORS.accent, 0.16) : 'rgba(255,255,255,0.05)'
  ctx.fill()
  ctx.setLineDash(open ? [] : [14, 12])
  ctx.strokeStyle = open ? COLORS.accent : withAlpha(COLORS.white, 0.45)
  ctx.lineWidth = open ? 7 : 4
  ctx.stroke()
  ctx.setLineDash([])

  // 完美时机的内圈（更亮的小框）
  const rw = ZONE_W * (PERFECT_TICK / WINDOW_HALF) * 0.8
  roundRectPath(ctx, c.x - rw / 2, y + 12, rw, ZONE_H - 24, 8)
  ctx.strokeStyle = open ? COLORS.accent2 : withAlpha(COLORS.accent2, 0.3)
  ctx.lineWidth = 3
  ctx.stroke()

  text(ctx, open ? '窗口开启 · 立刻挥棒！' : '等待窗口…', c.x, y - 34, {
    size: 30,
    color: open ? COLORS.accent : COLORS.textDim,
    weight: 'bold',
  })
}

/** 球与拖尾 */
function drawBall(ctx: CanvasRenderingContext2D, s: State): void {
  const p = s.pitch
  if (s.over) return
  for (let i = 6; i >= 1; i--) {
    const t = p.t - i * 1.5
    if (t < 0 || t > p.center + PAST_TICKS) continue
    const q = ballPos(p, t)
    ctx.globalAlpha = 0.13 * (1 - i / 7)
    disc(ctx, q.x, q.y, q.r * (1 - i * 0.06), COLORS.white)
  }
  ctx.globalAlpha = 1
  const q = ballPos(p, p.t)
  ctx.globalAlpha = q.alpha
  // 影子
  ctx.fillStyle = 'rgba(0,0,0,0.28)'
  ctx.beginPath()
  ctx.ellipse(PLATE.x + 30, lerp(MOUND.y, PLATE.y, ease.inOutQuad(clamp(p.t / p.center, 0, 1))) + 34, q.r * 0.9, q.r * 0.35, 0, 0, Math.PI * 2)
  ctx.fill()
  disc(ctx, q.x, q.y, q.r, COLORS.white, { ring: COLORS.red })
  ctx.globalAlpha = 1
}

/** 击球手与球棒 */
function drawBatter(ctx: CanvasRenderingContext2D, s: State): void {
  const bx = PLATE.x + 118
  const by = PLATE.y - 40
  ctx.fillStyle = COLORS.orange
  fillRoundRect(ctx, bx - 26, by - 118, 52, 118, 20, COLORS.orange)
  disc(ctx, bx, by - 132, 24, COLORS.wood)

  const prog = swingProgress(s)
  // 待机 -1.15 弧度（举棒），挥出 0.95 弧度
  const ang = lerp(-1.15, 0.95, ease.outCubic(prog))
  const len = 150
  ctx.save()
  ctx.strokeStyle = COLORS.wood
  ctx.lineWidth = 14
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(bx, by - 40)
  ctx.lineTo(bx + Math.sin(ang) * len, by - 40 - Math.cos(ang) * len)
  ctx.stroke()
  ctx.strokeStyle = COLORS.woodDark
  ctx.lineWidth = 5
  ctx.stroke()
  ctx.restore()
}

/** 底部时机条：把「挥早 / 挥晚」的偏差可视化 */
function drawTimingBar(ctx: CanvasRenderingContext2D, s: State): void {
  const w = 520
  const h = 34
  const x = (VW - w) / 2
  const y = VH - 150
  fillRoundRect(ctx, x, y, w, h, 17, withAlpha(COLORS.black, 0.45), withAlpha(COLORS.line, 0.9))
  // 完美区 / 窗口区 / 界外区
  const mid = x + w / 2
  const unit = w / 2 / (FOUL_HALF + 2)
  fillRoundRect(ctx, mid - PERFECT_TICK * unit, y + 3, PERFECT_TICK * 2 * unit, h - 6, 11, withAlpha(COLORS.accent2, 0.9))
  fillRoundRect(ctx, mid - WINDOW_HALF * unit, y + 3, WINDOW_HALF * 2 * unit, h - 6, 11, withAlpha(COLORS.accent, 0.32))
  // 指针
  if (s.phase === 'pitch') {
    const off = clamp(timingOffset(s), -(FOUL_HALF + 2), FOUL_HALF + 2)
    const px = mid + off * unit
    ctx.fillStyle = COLORS.text
    ctx.beginPath()
    ctx.moveTo(px, y - 6)
    ctx.lineTo(px + 10, y - 20)
    ctx.lineTo(px - 10, y - 20)
    ctx.closePath()
    ctx.fill()
  }
  text(ctx, '挥早', x - 6, y + h + 24, { size: 24, align: 'right', color: COLORS.textDim })
  text(ctx, '完美', mid, y + h + 24, { size: 24, color: COLORS.accent2 })
  text(ctx, '挥晚', x + w + 6, y + h + 24, { size: 24, align: 'left', color: COLORS.textDim })
}

/** 顶栏与本球结果 */
function drawHud(ctx: CanvasRenderingContext2D, s: State): void {
  ctx.fillStyle = 'rgba(0,0,0,0.32)'
  ctx.fillRect(0, 100, VW, 76)
  text(ctx, `第 ${s.pitchNo} / ${TOTAL_PITCHES} 球`, 30, 138, { size: 32, align: 'left', color: COLORS.text, weight: 'bold' })
  text(ctx, `安打 ${s.hits}`, VW / 2, 138, { size: 32, color: COLORS.accent2, weight: 'bold' })
  text(ctx, `${s.score} 分`, VW - 30, 138, { size: 32, align: 'right', color: COLORS.accent, weight: 'bold' })

  // 球数进度点
  for (let i = 0; i < TOTAL_PITCHES; i++) {
    const cx = VW / 2 - ((TOTAL_PITCHES - 1) * 22) / 2 + i * 22
    const done = i < s.results.length
    ctx.fillStyle = done ? COLORS.accent : withAlpha(COLORS.line, 0.9)
    ctx.beginPath()
    ctx.arc(cx, 190, 7, 0, Math.PI * 2)
    ctx.fill()
  }

  if (s.last) {
    const good = s.last.kind === 'homeRun'
    const hit = s.last.kind === 'inPlay'
    const color = good ? COLORS.accent : hit ? COLORS.accent2 : COLORS.textDim
    shadowText(ctx, RESULT_LABEL[s.last.kind], VW / 2, 236, { size: good ? 58 : 42, color })
    if (s.last.kind !== 'take') {
      const dir = s.last.offset < 0 ? '挥早了' : s.last.offset > 0 ? '挥晚了' : '刚刚好'
      text(ctx, `${Math.abs(s.last.offset)} tick · ${dir}`, VW / 2, 292, { size: 26, color: COLORS.textDim })
    }
  }
}

/** 结算横幅 */
function drawOver(ctx: CanvasRenderingContext2D, s: State): void {
  const grade = s.score >= GREAT_SCORE ? '神投手！' : s.score > 0 ? '打者高手' : '再练练手气'
  banner(ctx, VW, VH, '本局结束', `安打 ${s.hits} · 总分 ${s.score}`, COLORS.accent)
  text(ctx, grade, VW / 2, VH / 2 + 118, { size: 40, color: COLORS.accent2, weight: 'bold' })
  text(ctx, '点「新的一局」再来 10 球', VW / 2, VH / 2 + 172, { size: 26, color: COLORS.textDim })
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  ctx.save()
  if (s.shake > 0) {
    // 界外 / 挥空时的轻微抖动，用 tick 数驱动，保证可复现
    ctx.translate(Math.sin(s.shake * 1.9) * s.shake * 0.45, Math.cos(s.shake * 2.3) * s.shake * 0.35)
  }
  background(ctx, VW, VH, COLORS.bg2, COLORS.bg)
  drawField(ctx)
  drawZone(ctx, s)
  drawBatter(ctx, s)
  drawBall(ctx, s)
  drawTimingBar(ctx, s)
  drawHud(ctx, s)
  ctx.restore()
  if (s.over) drawOver(ctx, s)
}

function hint(s: State): string {
  if (s.over) return `十球结束：安打 ${s.hits}，总分 ${s.score} 分。`
  if (s.phase === 'result') return `${RESULT_LABEL[s.last ? s.last.kind : 'take']} · 正在准备下一球…`
  return `第 ${s.pitchNo}/${TOTAL_PITCHES} 球：窗口亮起时点击画面挥棒，打出全垒打。`
}

/** 本作不声明额外控件，新的一局由站点壳统一追加 */
function controls(): Control<Action>[] {
  return []
}

function outcome(s: State): Outcome | null {
  if (!s.over) return null
  return { score: s.score, better: 'higher', unit: '分', win: s.score >= GREAT_SCORE }
}

/** 由状态迁移推导副作用，reduce 保持纯净 */
function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (!prev.over && next.over) out.push({ kind: 'sound', name: 'score' })
  if (next.last && next.last !== prev.last) {
    const kind = next.last.kind
    if (kind === 'homeRun') {
      out.push({ kind: 'sound', name: 'win' })
      out.push({ kind: 'flash', color: COLORS.accent })
      out.push({ kind: 'burst', x: zoneCenter(next.pitch).x, y: PLATE.y - 60, color: COLORS.accent, count: 26 })
    } else if (kind === 'inPlay') {
      out.push({ kind: 'sound', name: 'hit' })
      out.push({ kind: 'burst', x: zoneCenter(next.pitch).x, y: PLATE.y, color: COLORS.accent2, count: 14 })
    } else if (kind === 'miss') {
      out.push({ kind: 'sound', name: 'lose' })
      out.push({ kind: 'shake', power: 6 })
    } else if (kind === 'foul') {
      out.push({ kind: 'sound', name: 'error' })
    } else if (kind === 'take') {
      out.push({ kind: 'sound', name: 'lose' })
    }
  }
  return out
}

/** 把指针事件翻译成动作：击球区内任意位置按下都算挥棒 */
function input(s: State, p: PointerInput): Action | null {
  if (p.kind !== 'down' || p.pressed === false) return null
  if (s.phase !== 'pitch' || s.pitch.swung) return null
  return { type: 'swing' }
}

function key(s: State, k: string): Action | null {
  if (k !== ' ' && k !== 'Enter') return null
  if (s.phase !== 'pitch' || s.pitch.swung) return null
  return { type: 'swing' }
}

/** 每帧调用：把真实 dt(ms) 折算成整数 tick 推进 */
function tick(dt: number): Action {
  accumulator += Math.max(0, dt)
  const n = Math.floor(accumulator / TICK_MS)
  accumulator -= n * TICK_MS
  return { type: 'tick', n }
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  tick,
  input,
  key,
  hint,
  controls,
  outcome,
  effects,
}

export default game
