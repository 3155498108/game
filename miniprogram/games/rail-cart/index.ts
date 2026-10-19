/**
 * 轨道车渲染 + 输入映射。规则全在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas、
 * 把帧间隔折算成 tick、把指针 / 键盘翻译成 action。
 *
 * 三条分层约定：
 * 1. **时间不进 state**：本文件用 performance.now()（render/anim 的 now()）把 dt(ms)
 *    累加成整数 tick，再派发 `{ type: 'advance', ticks }`。rules.ts 里没有任何时间源。
 *    「新的一局」由壳重新 create() 得到全新 state 对象，本文件据此清零累加器。
 * 2. **动画走旁路缓存**：换道位移用 tweenTo，撞车形变用 progressSince，待发车提示用
 *    pulse，全部不进 reduce。撞击 / 拾取 / 换道的副作用由 effects() 从前后状态差异推导。
 * 3. **控件不重复画**：发车按钮只在 controls() 里声明（由壳渲染成真正的 DOM 按钮），
 *    画布上不再自绘任何按钮，避免和壳自动追加的「新的一局」重复。
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { COLORS, background, banner, disc, fillRoundRect, roundRectPath, text, topBar, withAlpha } from '../../render/draw'
import { keepAlive, progressSince, pulse, tweenTo } from '../../render/anim'
import meta from './meta'
import {
  COIN_SCORE,
  LANES,
  NOSE,
  SPEED_MAX,
  SPEED_MIN,
  TICK_MS,
  create,
  reduce,
  speedAtTick,
  type Action,
  type Item,
  type State,
} from './rules'

// ---------------- 布局常量（render / input 共用） ----------------
const VW = 720
const VH = 1280
/** 单条车道宽度 = VW / LANES = 180 */
const LANE_W = VW / LANES
/** 赛道顶（顶栏之下） */
const ROAD_TOP = 172
/** 车头所在的屏幕 y，车下方留一段让实体自然滑出画面 */
const CART_Y = 1090
const CART_W = 132
const CART_H = 96
/** 地面横档的世界间距，用 dist 取模滚动出速度感 */
const RUNG_GAP = 90
/** 车道分隔虚线的虚线周期（世界单位） */
const DASH_GAP = 66

function laneCenterX(lane: number): number {
  return lane * LANE_W + LANE_W / 2
}

// ---------------- 帧时间 → tick ----------------
/** 上一帧留下的不足一个 tick 的余量 */
let acc = 0
/** 上一次渲染的 state，换局后壳会给出新对象，据此清零余量 */
let lastState: State | null = null

function syncClock(s: State): void {
  if (s !== lastState) {
    lastState = s
    acc = 0
  }
}

/** 站点壳每帧以 dt(ms) 调用：折算成整数 tick 派发给 reduce。dt 为 0 时返回 0 个 tick，reduce 原样返回入参 */
function tick(dt: number): Action {
  acc += Math.max(0, Math.min(50, dt))
  const n = Math.floor(acc / TICK_MS)
  acc -= n * TICK_MS
  return { type: 'advance', ticks: n }
}

// ---------------- 绘制 ----------------
function drawRoad(ctx: CanvasRenderingContext2D, s: State): void {
  // 车道底色
  for (let i = 0; i < LANES; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#1d2c47' : '#243353'
    ctx.fillRect(i * LANE_W, ROAD_TOP, LANE_W, VH - ROAD_TOP)
  }

  // 地面横档：随 dist 向下滚动，速度越快跳得越明显
  const scroll = s.dist % RUNG_GAP
  ctx.strokeStyle = 'rgba(255,255,255,0.055)'
  ctx.lineWidth = 4
  ctx.beginPath()
  for (let y = CART_Y + scroll; y < VH; y += RUNG_GAP) {
    ctx.moveTo(0, y)
    ctx.lineTo(VW, y)
  }
  for (let y = CART_Y + scroll - RUNG_GAP; y > ROAD_TOP; y -= RUNG_GAP) {
    ctx.moveTo(0, y)
    ctx.lineTo(VW, y)
  }
  ctx.stroke()

  // 车道分隔虚线
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 4
  ctx.setLineDash([38, DASH_GAP - 38])
  ctx.lineDashOffset = -(s.dist % DASH_GAP)
  ctx.beginPath()
  for (let i = 1; i < LANES; i++) {
    ctx.moveTo(i * LANE_W, ROAD_TOP)
    ctx.lineTo(i * LANE_W, VH)
  }
  ctx.stroke()
  ctx.restore()

  // 赛道侧边收口
  ctx.fillStyle = withAlpha('#000000', 0.35)
  ctx.fillRect(0, ROAD_TOP, 6, VH - ROAD_TOP)
  ctx.fillRect(VW - 6, ROAD_TOP, 6, VH - ROAD_TOP)
}

function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  disc(ctx, x, y, 27, COLORS.accent, { ring: '#8a6a12' })
  ctx.save()
  ctx.globalAlpha = 0.75
  ctx.fillStyle = '#fff3c4'
  ctx.beginPath()
  ctx.arc(x - 8, y - 9, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawObstacle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const w = 152
  const h = 80
  fillRoundRect(ctx, x - w / 2, y - h / 2, w, h, 16, '#7d3232', COLORS.red, 4)
  // 斜纹警示条
  ctx.save()
  roundRectPath(ctx, x - w / 2, y - h / 2, w, h, 16)
  ctx.clip()
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth = 12
  ctx.beginPath()
  for (let i = -h; i < w + h; i += 36) {
    ctx.moveTo(x - w / 2 + i, y - h / 2)
    ctx.lineTo(x - w / 2 + i + h, y + h / 2)
  }
  ctx.stroke()
  ctx.restore()
  text(ctx, '危', x, y + 1, { size: 40, weight: 'bold', color: '#ffe3e3' })
}

function drawItem(ctx: CanvasRenderingContext2D, it: Item): void {
  const y = CART_Y - it.d
  if (y < ROAD_TOP - 80 || y > VH + 80) return
  const x = laneCenterX(it.lane)
  if (it.kind === 'coin') drawCoin(ctx, x, y)
  else drawObstacle(ctx, x, y)
}

function drawCart(ctx: CanvasRenderingContext2D, s: State): void {
  const target = laneCenterX(s.lane)
  // 换道补间：tweenTo 走旁路缓存，不进 state
  const x = tweenTo('rail-cart-x', target, 150)
  const lean = Math.max(-0.16, Math.min(0.16, (target - x) * 0.004))
  // 撞车瞬间的形变：seq 在终局后不再变化，签名因此稳定
  const crash = s.phase === 'over' ? progressSince('rail-cart-crash', String(s.seq), 300) : 1
  const pop = 1 + (1 - crash) * 0.2

  // 影子
  ctx.save()
  ctx.globalAlpha = 0.32
  ctx.fillStyle = '#000000'
  ctx.beginPath()
  ctx.ellipse(x, CART_Y + CART_H / 2 - 6, (CART_W / 2) * 1.05, 14, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.translate(x, CART_Y)
  ctx.rotate(lean)
  const w = CART_W * pop
  const h = CART_H * pop
  // 车轮
  ctx.fillStyle = '#0b1220'
  for (const sx of [-w / 2 + 6, w / 2 - 40]) {
    fillRoundRect(ctx, sx, -h / 2 - 10, 34, 20, 8, '#0b1220')
  }
  // 车身
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 16
  ctx.shadowOffsetY = 6
  const body = ctx.createLinearGradient(0, -h / 2, 0, h / 2)
  body.addColorStop(0, s.phase === 'over' ? '#e57373' : '#54a0ff')
  body.addColorStop(1, s.phase === 'over' ? '#8e2f2f' : '#1e5f9e')
  fillRoundRect(ctx, -w / 2, -h / 2, w, h, 22, body, '#0b1220', 4)
  ctx.restore()
  // 驾驶舱
  fillRoundRect(ctx, -w * 0.28, -h / 2 + 12, w * 0.56, h * 0.36, 12, 'rgba(255,255,255,0.24)')
  // 车头灯
  ctx.fillStyle = COLORS.accent
  ctx.beginPath()
  ctx.arc(-w * 0.26, h / 2 - 16, 9, 0, Math.PI * 2)
  ctx.arc(w * 0.26, h / 2 - 16, 9, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawHud(ctx: CanvasRenderingContext2D, s: State): void {
  const speed = speedAtTick(s.ticks)
  topBar(ctx, VW, '轨道车', `${s.score} 分`, 84)
  text(ctx, `金币 ${s.coins} · 距离 ${s.dist}`, VW / 2, 116, { size: 25, color: COLORS.textDim })

  // 速度条：从 SPEED_MIN 画到 SPEED_MAX，一眼看出「越来越快」以及上限在哪
  const barW = 280
  const barX = 200
  const barY = 136
  text(ctx, '速度', barX - 16, barY + 7, { size: 22, color: COLORS.textDim, align: 'right' })
  fillRoundRect(ctx, barX, barY, barW, 14, 7, 'rgba(255,255,255,0.14)')
  const k = (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)
  if (k > 0) fillRoundRect(ctx, barX, barY, Math.max(14, barW * k), 14, 7, k > 0.85 ? COLORS.red : COLORS.accent)
  text(ctx, `${speed}/${SPEED_MAX}`, barX + barW + 16, barY + 7, { size: 22, color: COLORS.textDim, align: 'left' })
}

function drawReady(ctx: CanvasRenderingContext2D): void {
  // 只画说明，不画按钮：发车按钮由 controls() 交给壳渲染
  ctx.save()
  ctx.fillStyle = 'rgba(8,17,30,0.6)'
  ctx.fillRect(0, ROAD_TOP, VW, VH - ROAD_TOP)
  text(ctx, '准备发车', VW / 2, 560, { size: 72, weight: 'bold', color: COLORS.accent })
  text(ctx, '车会自己往前开，你只管左右换道', VW / 2, 636, { size: 28, color: COLORS.text })
  text(ctx, '躲红色障碍 · 吃金币 · 速度会越来越快', VW / 2, 680, { size: 26, color: COLORS.textDim })
  const a = 0.55 + pulse(1400) * 0.45
  ctx.globalAlpha = a
  text(ctx, '▼ 点下方「发车」或直接点画面开始', VW / 2, 800, { size: 30, weight: 'bold', color: COLORS.accent })
  ctx.restore()
}

function drawOver(ctx: CanvasRenderingContext2D, s: State): void {
  banner(ctx, VW, VH, '撞车！', `得分 ${s.score} · 距离 ${s.dist} · 金币 ${s.coins} × ${COIN_SCORE}`, COLORS.red)
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  syncClock(s)
  // 行驶中世界持续滚动，需要每帧重绘；待发车与终局则让 anim 自行决定
  if (s.phase === 'run') keepAlive()

  background(ctx, VW, VH, '#24365a', '#0b1220')
  drawRoad(ctx, s)
  for (const it of s.items) drawItem(ctx, it)
  drawCart(ctx, s)
  drawHud(ctx, s)
  if (s.phase === 'ready') drawReady(ctx)
  if (s.phase === 'over') drawOver(ctx, s)
}

// ---------------- 副作用 ----------------
function effects(prev: State, next: State): Effect[] {
  // 撞车优先于拾取：同一 tick 里既吃到金币又撞上障碍时，要播撞车反馈
  if (next.phase === 'over' && prev.phase !== 'over') {
    return [
      { kind: 'sound', name: 'hit' },
      { kind: 'shake', power: 16 },
      { kind: 'flash', color: 'rgba(239,83,80,0.38)' },
      { kind: 'burst', x: laneCenterX(next.lane), y: CART_Y - NOSE, color: COLORS.red, count: 26 },
    ]
  }
  if (next.coins > prev.coins && next.lastPick) {
    return [
      { kind: 'sound', name: 'score' },
      { kind: 'burst', x: laneCenterX(next.lastPick.lane), y: CART_Y - NOSE, color: COLORS.accent, count: 12 },
    ]
  }
  if (next.lane !== prev.lane) return [{ kind: 'sound', name: 'click' }]
  return []
}

// ---------------- 壳接口 ----------------
function outcome(s: State): Outcome | null {
  if (s.phase !== 'over') return null
  return { score: s.score, better: 'higher', unit: ' 分' }
}

function controls(s: State): Control<Action>[] {
  // 行驶中与终局都不额外声明控件，「新的一局」由壳统一追加
  if (s.phase !== 'ready') return []
  return [{ label: '发车', action: { type: 'start' }, primary: true }]
}

function input(s: State, p: PointerInput): Action | null {
  if (p.kind !== 'down') return null
  if (s.phase === 'ready') return { type: 'start' }
  if (s.phase !== 'run') return null
  return { type: 'shift', dir: p.x < VW / 2 ? -1 : 1 }
}

function key(s: State, k: string): Action | null {
  if (s.phase === 'ready') return k === ' ' || k === 'Enter' ? { type: 'start' } : null
  if (s.phase !== 'run') return null
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') return { type: 'shift', dir: -1 }
  if (k === 'ArrowRight' || k === 'd' || k === 'D') return { type: 'shift', dir: 1 }
  return null
}

/**
 * 金币结算：门票制。
 *
 * 轨道车是实时生存游戏，没有「赢/输」，只有活多久。口径同另外三款：
 * 注额是门票，得分不足 `PAR` 打水漂，达标后按整数倍返还。
 *
 * `PAR = 50 分`：得分 = `floor(距离/120) + 金币 × 10`。实测完全不躲的笨 bot
 * 只有 5~78 分，而按 `DECISIONS.md` 4.x 调过的「称职玩家」能活到 69.8 秒。
 * 50 分大致对应「活过一半赛程」。
 */
const PAR = 50

function coins(_s: State, o: Outcome, bet: number): number {
  if (bet <= 0) return 0
  const score = typeof o.score === 'number' && Number.isFinite(o.score) ? o.score : 0
  const mult = Math.floor(score / PAR)
  return mult <= 0 ? -bet : bet * mult
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  tick,
  input,
  key,
  effects,
  outcome,
  controls,
  coins,
  hint: (s) =>
    s.phase === 'ready'
      ? '点「发车」或直接点画面开始，之后左右滑动 / 按 ← → 换道'
      : s.phase === 'over'
        ? `撞车了，得分 ${s.score}，点「新的一局」再来`
        : '左右换道躲红色障碍、吃金币，速度会随时间越来越快',
}

export default game
