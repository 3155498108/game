/**
 * 玩具网球 · 渲染与游戏模块装配（唯一允许接触 Canvas 的地方）
 *
 * 时间推进：渲染层用 performance.now() 量出真实 dt，折算成整数 tick 数后通过
 * `{ type: 'tick', steps }` 交给 rules.reduce 推进。规则层本身不读时间、不用 Math.random()。
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { COLORS, background, banner, disc, fillRoundRect, shadowText, text } from '../../render/draw'
import { meta } from './meta'
import * as R from './rules'
import type { Action, State } from './rules'

const VW = meta.viewport.width
const VH = meta.viewport.height

/** 一个逻辑 tick 的目标时长（60fps） */
const TICK_MS = 1000 / 60
/** 单帧最多推进的 tick 数，避免切后台回来后一次性跑太多 */
const MAX_STEPS_PER_FRAME = 5

/** 帧间累积时间：让 tick 数与真实耗时对齐，跨帧保留（渲染层的运行时状态） */
let acc = 0

function create(seed: number): State {
  acc = 0
  return R.create(seed)
}

/** 把真实 dt(ms) 折算成整数 tick 步数 */
function tick(dt: number): Action {
  acc += Math.max(0, Math.min(250, dt))
  let steps = 0
  while (acc >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
    acc -= TICK_MS
    steps++
  }
  if (acc > TICK_MS * MAX_STEPS_PER_FRAME) acc = 0
  return { type: 'tick', steps }
}

/** 指针：按下或移动都让球拍跟过去 */
function input(_state: State, p: PointerInput): Action | null {
  if (p.kind === 'up') return null
  return { type: 'seek', x: p.x }
}

/** 键盘（桌面便利）：左右移动 + 空格发球 */
function key(_state: State, k: string): Action | null {
  const lower = k.length === 1 ? k.toLowerCase() : k
  if (lower === 'ArrowLeft' || lower === 'a') return { type: 'move', side: 0, dir: -1 }
  if (lower === 'ArrowRight' || lower === 'd') return { type: 'move', side: 0, dir: 1 }
  if (lower === ' ' || lower === 'Enter') return { type: 'serve' }
  return null
}

function hint(state: State): string {
  if (state.phase === 'over') {
    const who = state.winner === 0 ? '你赢了' : '电脑赢了'
    return `${who}！本局最长回合 ${state.bestRally} 拍，点「新的一局」再战。`
  }
  if (state.phase === 'serve') {
    return `${state.serveTo === 0 ? '对手' : '你'}将发球 · 拖动或按 ← → 移动球拍，先得 ${R.TARGET_SCORE} 分获胜`
  }
  const speed = R.speedOf(state.rally)
  return `你 ${state.scoreP} : ${state.scoreA} 电脑 · 第 ${state.rally + 1} 拍 · 球速 ${speed.toFixed(1)}`
}

/** 提示区按钮：只在发球等待期给一个「立即发球」；重开由站点壳统一追加 */
function controls(state: State): Control<Action>[] {
  if (state.phase !== 'serve') return []
  return [{ label: '立即发球', action: { type: 'serve' }, primary: true }]
}

/** 成绩：取本局最长回合数（越大越好），最佳纪录由站点壳按 gs:${meta.id}:best 落盘 */
function outcome(state: State): Outcome | null {
  if (state.phase !== 'over') return null
  return { score: state.bestRally, better: 'higher', unit: '回合', win: state.winner === 0 }
}

/** 副作用：仅由状态迁移推导，reduce 保持纯净 */
function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  const scored = next.scoreP !== prev.scoreP || next.scoreA !== prev.scoreA

  if (scored) {
    const side: R.Side = next.scoreP !== prev.scoreP ? 0 : 1
    out.push({ kind: 'sound', name: 'score' })
    out.push({
      kind: 'burst',
      x: side === 0 ? next.px : next.ax,
      y: side === 0 ? R.PLAYER_Y : R.AI_Y,
      color: side === 0 ? COLORS.accent2 : COLORS.accent,
      count: 16,
    })
    if (next.lastReason === 'out' || next.lastReason === 'miss') out.push({ kind: 'shake', power: 9 })
  } else if (next.rally > prev.rally) {
    const side: R.Side = next.lastHitter
    out.push({ kind: 'sound', name: 'hit' })
    out.push({
      kind: 'burst',
      x: side === 0 ? next.px : next.ax,
      y: side === 0 ? R.PLAYER_Y : R.AI_Y,
      color: COLORS.yellow,
      count: 6,
    })
  }

  if (next.phase === 'over' && prev.phase !== 'over') {
    out.push({ kind: 'flash', color: next.winner === 0 ? COLORS.green : COLORS.red })
    out.push({ kind: 'sound', name: next.winner === 0 ? 'win' : 'lose' })
  }
  return out
}

// ---------------------------------------------------------------- 渲染

function drawCourt(ctx: CanvasRenderingContext2D): void {
  background(ctx, VW, VH, '#123a2b', '#0a2018')

  // 上下两个半场
  const inner = R.SIDE_WALL
  const w = VW - inner * 2
  ctx.fillStyle = '#1c6b48'
  ctx.fillRect(inner, R.AI_Y, w, R.PLAYER_Y - R.AI_Y)
  ctx.fillStyle = '#17593c'
  ctx.fillRect(inner, R.AI_Y, w, (R.NET_Y - R.AI_Y) / 2)
  ctx.fillRect(inner, R.NET_Y + (R.NET_Y - R.AI_Y) / 2, w, R.PLAYER_Y - R.NET_Y - (R.NET_Y - R.AI_Y) / 2)

  // 围栏
  ctx.fillStyle = '#2b4468'
  ctx.fillRect(0, R.AI_Y, inner, R.PLAYER_Y - R.AI_Y)
  ctx.fillRect(VW - inner, R.AI_Y, inner, R.PLAYER_Y - R.AI_Y)

  // 底线 + 中线（网）
  ctx.fillStyle = COLORS.text
  ctx.fillRect(inner, R.AI_Y - 4, w, 8)
  ctx.fillRect(inner, R.PLAYER_Y - 4, w, 8)

  ctx.save()
  ctx.globalAlpha = 0.85
  ctx.fillStyle = '#f4f7fb'
  ctx.fillRect(inner, R.NET_Y - 3, w, 6)
  ctx.restore()
  for (let x = inner + 8; x < VW - inner; x += 28) {
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    ctx.fillRect(x, R.NET_Y - 22, 3, 44)
  }

  // 半场中线标记
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  ctx.fillRect(inner, R.AI_Y + (R.NET_Y - R.AI_Y) / 2 - 2, w, 4)
  ctx.fillRect(inner, R.PLAYER_Y - (R.PLAYER_Y - R.NET_Y) / 2 - 2, w, 4)
}

function drawPaddle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, mine: boolean): void {
  fillRoundRect(ctx, x - R.PADDLE_W / 2, y - R.PADDLE_H / 2, R.PADDLE_W, R.PADDLE_H, 20, color, COLORS.text, 3)
  // 手柄
  ctx.fillStyle = color
  ctx.globalAlpha = 0.6
  ctx.fillRect(x - 10, y + (mine ? R.PADDLE_H / 2 - 2 : -R.PADDLE_H / 2 - 46), 20, 46)
  ctx.globalAlpha = 1
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  drawCourt(ctx)

  // 球拍
  drawPaddle(ctx, state.ax, R.AI_Y, COLORS.orange, false)
  drawPaddle(ctx, state.px, R.PLAYER_Y, COLORS.accent2, true)

  // 球：发球等待期停在网心
  if (state.phase !== 'over') {
    disc(ctx, state.bx, state.by, R.BALL_R, COLORS.yellow, { ring: COLORS.white })
  }

  // 记分板
  ctx.fillStyle = 'rgba(0,0,0,0.32)'
  ctx.fillRect(0, 0, VW, 96)
  shadowText(ctx, `${state.scoreP}`, VW / 2 - 70, 48, { size: 52, color: COLORS.accent2 })
  text(ctx, ':', VW / 2, 48, { size: 42, color: COLORS.textDim })
  shadowText(ctx, `${state.scoreA}`, VW / 2 + 70, 48, { size: 52, color: COLORS.orange })
  text(ctx, '你', VW / 2 - 150, 48, { size: 28, color: COLORS.textDim })
  text(ctx, '电脑', VW / 2 + 160, 48, { size: 28, color: COLORS.textDim })

  if (state.phase === 'play') {
    const tag = state.lastHitter === 0 ? '你击球' : state.lastHitter === 1 ? '电脑击球' : '飞行中'
    text(ctx, `${tag} · 球速 ${R.speedOf(state.rally).toFixed(1)}`, VW / 2, R.NET_Y + 64, {
      size: 30,
      color: COLORS.textDim,
    })
  }

  if (state.phase === 'serve') {
    const secs = (state.serveTicks * (TICK_MS / 1000)).toFixed(1)
    const who = state.serveTo === 0 ? '对手' : '你'
    shadowText(ctx, `${who}发球 ${secs}s`, VW / 2, VH - 70, { size: 38, color: COLORS.accent })
  }

  if (state.phase === 'over') {
    const win = state.winner === 0
    banner(
      ctx,
      VW,
      VH,
      win ? '你赢了！' : '电脑赢了',
      `本局最长回合 ${state.bestRally} 拍`,
      win ? COLORS.green : COLORS.orange,
    )
  }
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce: R.reduce,
  render,
  aiAction: R.aiAction,
  input,
  key,
  tick,
  hint,
  controls,
  outcome,
  effects,
  /** 实时游戏：每帧同步调用 AI，不加思考延迟 */
  aiDelay: 0,
}

export default game
