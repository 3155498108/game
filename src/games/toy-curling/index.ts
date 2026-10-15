/**
 * 玩具冰壶（toy-curling）—— 渲染 + 输入映射。规则在 rules.ts（纯逻辑），本文件只负责画与收输入。
 *
 * 自上而下分四层：
 *   1. 时间源：rules 里没有任何时间戳，渲染层用 performance.now() 把真实 dt 折算成整数 tick 发出去；
 *   2. reduce 包装：只为 DOM 按钮 / 键盘的「按住调向」记一个按毫秒计的按住窗口，
 *      局面本身仍然只由 rules 维护，本文件不新增任何规则；
 *   3. render：冰道 → house 五环 → 冰壶 → 瞄准辅助线 → 蓄力条 → 结算横幅；
 *   4. input / key / controls：把指针、键盘、以及壳渲染出来的 DOM 按钮翻译成 rules 的 action。
 *
 * 画布只画「看得见的局面」：蓄力与调向交给 controls() 让站点壳渲染成真正的 DOM 按钮，
 * 「新的一局」也由壳自动追加，本文件一概不画。
 * PointerInput 的 x/y 已经是 720×1280 的逻辑坐标，不要再乘缩放。
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { COLORS, background, banner, disc, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { clamp } from '../../core/geom'
import meta from './meta'
import {
  BUTTON,
  HOUSE_R,
  MAX_ANGLE,
  MAX_TICK_STEPS,
  MIN_POWER,
  RING_1,
  RING_2,
  RING_3,
  RING_CORE,
  ROUNDS,
  SHEET,
  STONE_R,
  THROW_X,
  THROW_Y,
  THROWS_PER_END,
  VH,
  VW,
  aiAction,
  create as createState,
  reduce as reduceRules,
  winnerOf,
} from './rules'
import type { Action, Owner, State } from './rules'

// ---------------- 布局（与 rules 共用同一套坐标，渲染与判定永远一致） ----------------

/** 一个逻辑 tick 的目标时长（毫秒），用于把真实 dt 折算成 tick 数 */
const TICK_MS = 1000 / 60
/** 底部蓄力条 */
const BAR = { x: 104, y: VH - 96, w: VW - 208, h: 28 }
/** 瞄准辅助线的最大长度 */
const GUIDE_MAX = 640
/** 指针横向拖动超过这个距离才算调向，避免轻微抖动乱打方向 */
const AIM_DEAD = 26
/** 一次「按住调向」持续的真实毫秒数（约 18 个 tick ≈ 0.27 弧度） */
const AIM_HOLD_MS = 300

/** 双方冰壶颜色（index 0 = 玩家，index 1 = AI） */
const STONE_COLORS: readonly string[] = [COLORS.accent, COLORS.blue]

// ---------------- 时间源：把真实 dt 折算成整数 tick ----------------

/**
 * 「按住调向」的按压窗口（纯渲染层的临时量，不进入 state）。
 * 站点壳每帧调用 tick(dt) 只收一个 action，所以松开的那一帧专门发一个 dir=0 的 aim。
 */
let holdDir: -1 | 0 | 1 = 0
let holdUntil = 0

function tick(dt: number): Action {
  const now = performance.now()
  if (holdDir !== 0 && now >= holdUntil) {
    holdDir = 0
    return { type: 'aim', dir: 0, hold: true }
  }
  // 长帧也不会瞬移：steps 由 rules 侧的 MAX_TICK_STEPS 兜底钳制
  const steps = clamp(Math.round(dt / TICK_MS), 1, MAX_TICK_STEPS)
  return { type: 'tick', steps }
}

/** 包装 rules 的 reduce：顺带记录按住调向的窗口，其余原样透传 */
function reduce(state: State, action: Action): State {
  if (action.type === 'aim' && action.hold === true && action.dir !== 0) {
    holdDir = action.dir
    holdUntil = performance.now() + AIM_HOLD_MS
  }
  return reduceRules(state, action)
}

/** 新一局时顺手清掉按住窗口，避免残留的调向渗进第一投 */
function create(seed: number): State {
  holdDir = 0
  holdUntil = 0
  return createState(seed)
}

// ---------------- 绘制 ----------------

/** 画一个圆环（fill 为空时只描边） */
function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | null, stroke?: string, lw = 2): void {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  if (fill) {
    ctx.fillStyle = fill
    ctx.fill()
  }
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = lw
    ctx.stroke()
  }
}

/** 冰道：外框 + 两条中心辅助线 */
function drawSheet(ctx: CanvasRenderingContext2D): void {
  const w = SHEET.right - SHEET.left
  const h = SHEET.bottom - SHEET.top
  fillRoundRect(ctx, SHEET.left, SHEET.top, w, h, 30, 'rgba(150,205,245,0.12)', 'rgba(255,255,255,0.30)', 3)
  ctx.save()
  ctx.setLineDash([12, 14])
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.beginPath()
  ctx.moveTo(VW / 2, SHEET.top + 12)
  ctx.lineTo(VW / 2, SHEET.bottom - 12)
  ctx.stroke()
  // 发球线
  ctx.beginPath()
  ctx.moveTo(SHEET.left + 16, THROW_Y)
  ctx.lineTo(SHEET.right - 16, THROW_Y)
  ctx.stroke()
  ctx.restore()
}

/** house 五环：由外向内画，最外圈到 RING_3 是最外一环 */
function drawHouse(ctx: CanvasRenderingContext2D): void {
  ring(ctx, BUTTON.x, BUTTON.y, HOUSE_R, null, 'rgba(255,255,255,0.30)', 2)
  ring(ctx, BUTTON.x, BUTTON.y, RING_3, 'rgba(255,255,255,0.16)')
  ring(ctx, BUTTON.x, BUTTON.y, RING_2, 'rgba(120,200,255,0.30)')
  ring(ctx, BUTTON.x, BUTTON.y, RING_1, 'rgba(255,120,120,0.42)')
  ring(ctx, BUTTON.x, BUTTON.y, RING_CORE, 'rgba(255,255,255,0.80)')
  ring(ctx, BUTTON.x, BUTTON.y, RING_CORE, null, withAlpha(COLORS.red, 0.8), 2)
}

/** 冰壶本体 + 顶上的把手 */
function drawStone(ctx: CanvasRenderingContext2D, x: number, y: number, owner: Owner, hot: boolean): void {
  const color = STONE_COLORS[owner]
  disc(ctx, x, y, STONE_R, color, { ring: hot ? '#ffffff' : withAlpha('#000000', 0.35) })
  ring(ctx, x, y - STONE_R * 0.18, STONE_R * 0.36, null, withAlpha('#ffffff', 0.85), 4)
}

function drawStones(ctx: CanvasRenderingContext2D, s: State): void {
  for (const st of s.stones) drawStone(ctx, st.x, st.y, st.owner, st.id === s.lastStone)
}

/** 瞄准辅助线：从发球点沿当前方向画一条虚线，长度随蓄力量伸长 */
function drawGuide(ctx: CanvasRenderingContext2D, s: State): void {
  if (s.phase !== 'aim' || s.turn !== 0) return
  const len = 180 + s.power * GUIDE_MAX
  const ex = THROW_X + Math.sin(s.angle) * len
  const ey = THROW_Y + Math.cos(s.angle) * len
  ctx.save()
  ctx.setLineDash([16, 14])
  ctx.lineWidth = 5
  ctx.strokeStyle = withAlpha(STONE_COLORS[0], 0.55 + s.power * 0.4)
  ctx.beginPath()
  ctx.moveTo(THROW_X, THROW_Y)
  ctx.lineTo(ex, ey)
  ctx.stroke()
  ctx.restore()
  ring(ctx, THROW_X, THROW_Y, STONE_R, withAlpha(STONE_COLORS[0], s.charging ? 0.85 : 0.35), 'rgba(255,255,255,0.6)', 2)
  ring(ctx, ex, ey, 9, withAlpha('#ffffff', 0.75))
}

/** 蓄力条：颜色随力量由绿转红，并标出最小有效出壶线 */
function drawPowerBar(ctx: CanvasRenderingContext2D, s: State): void {
  const live = s.phase === 'aim' && s.turn === 0
  const p = live ? s.power : 0
  fillRoundRect(ctx, BAR.x, BAR.y, BAR.w, BAR.h, 14, 'rgba(255,255,255,0.10)')
  const color = p < 0.5 ? COLORS.green : p < 0.8 ? COLORS.yellow : COLORS.red
  if (p > 0) fillRoundRect(ctx, BAR.x, BAR.y, Math.max(8, BAR.w * p), BAR.h, 14, withAlpha(color, 0.85))
  // 最小有效出壶线
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(BAR.x + BAR.w * MIN_POWER, BAR.y - 6)
  ctx.lineTo(BAR.x + BAR.w * MIN_POWER, BAR.y + BAR.h + 6)
  ctx.stroke()
  ctx.restore()
  text(ctx, live ? `力量 ${Math.round(p * 100)}%` : '力量', VW / 2, BAR.y - 26, { size: 22, color: COLORS.textDim })
}

/** 局面状态条：把 rules 已经算好的阶段与比分直接说清楚 */
function drawStatus(ctx: CanvasRenderingContext2D, s: State): void {
  let msg: string
  let color: string = COLORS.textDim
  if (s.phase === 'settle') {
    msg = `第 ${s.round} 局结算 · 本局 玩家 ${s.roundScore[0]} : AI ${s.roundScore[1]}`
    color = COLORS.accent
  } else if (s.phase === 'sliding') {
    msg = '冰壶滑行中…'
  } else if (s.turn === 1) {
    msg = 'AI 正在瞄准…'
  } else {
    msg = s.charging ? '蓄力中 —— 松手出壶' : '按住蓄力 · 左右调向 · 松手出壶'
  }
  text(ctx, msg, VW / 2, VH - 148, { size: 26, color })
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, '#1b3550', '#0b1622')
  topBar(ctx, VW, '玩具冰壶', `${s.total[0]} : ${s.total[1]}`, 92)
  drawSheet(ctx)
  drawHouse(ctx)
  drawGuide(ctx, s)
  drawStones(ctx, s)
  drawPowerBar(ctx, s)
  drawStatus(ctx, s)
  text(ctx, `第 ${s.round} / ${ROUNDS} 局 · 本局第 ${s.throws + 1} / ${THROWS_PER_END} 投`, VW / 2, 138, {
    size: 24,
    color: COLORS.textDim,
  })

  if (s.over) {
    const w = winnerOf(s)
    banner(
      ctx,
      VW,
      VH,
      w === 0 ? '你赢了！' : w === 1 ? 'AI 获胜' : '平局',
      `玩家 ${s.total[0]} : AI ${s.total[1]}`,
      w === 0 ? COLORS.accent : w === 1 ? COLORS.blue : COLORS.text,
    )
  }
  // 方向范围只作为背景提示（画布上的说明文字，不是可点控件）
  shadowText(ctx, `方向上限 ±${MAX_ANGLE.toFixed(2)} 弧度`, VW / 2, VH - 26, { size: 18, color: COLORS.textDim, weight: 'normal' })
}

// ---------------- 输入 ----------------

/** 画布手势：按住任意处蓄力，横向拖动调向，松手出壶（纯函数，不记任何外部量） */
function input(s: State, p: PointerInput): Action | null {
  if (s.over || s.phase !== 'aim' || s.turn !== 0) return null
  if (p.kind === 'down') return { type: 'charge' }
  if (p.kind === 'move' && p.pressed) {
    const dx = p.x - THROW_X
    const dir: -1 | 0 | 1 = dx < -AIM_DEAD ? -1 : dx > AIM_DEAD ? 1 : 0
    return { type: 'aim', dir, hold: true }
  }
  if (p.kind === 'up') return s.charging ? { type: 'release' } : { type: 'aim', dir: 0, hold: true }
  return null
}

/** 键盘便利操作：空格蓄力 / 出壶，方向键调向，回车跳过结算 */
function key(s: State, k: string): Action | null {
  if (s.over) return null
  if (k === 'Enter' && s.phase === 'settle') return { type: 'next' }
  if (k === ' ' && s.phase === 'aim' && s.turn === 0) return { type: 'charge' }
  if (k === 'ArrowLeft') return { type: 'aim', dir: -1, hold: true }
  if (k === 'ArrowRight') return { type: 'aim', dir: 1, hold: true }
  return null
}

// ---------------- 提示 / 控件 / 结算 / 副作用 ----------------

function hint(s: State): string {
  if (s.over) {
    const w = winnerOf(s)
    const tail = w === 0 ? '，你赢了' : w === 1 ? '，AI 获胜' : '，平局'
    return `三局结束：玩家 ${s.total[0]} 分，AI ${s.total[1]} 分${tail}`
  }
  if (s.phase === 'settle') return `第 ${s.round} 局结算：玩家 ${s.roundScore[0]} 分、AI ${s.roundScore[1]} 分，点「下一局」继续`
  if (s.phase === 'sliding') return '冰壶滑行中，全部停下后自动结算本局'
  if (s.turn === 1) return 'AI 正在枚举候选力度与方向，稍等片刻'
  return `第 ${s.round}/${ROUNDS} 局 · 本局第 ${s.throws + 1}/${THROWS_PER_END} 投 · 当前力量 ${Math.round(s.power * 100)}%，按住蓄力、左右调向，松手出壶`
}

/** 蓄力与调向交给壳渲染成真正的 DOM 按钮（画布上不再重复画一遍） */
function controls(s: State): Control<Action>[] {
  if (s.over) return []
  if (s.phase === 'settle') return [{ label: '下一局', action: { type: 'next' }, primary: true }]
  if (s.phase !== 'aim' || s.turn !== 0) return []
  return [
    { label: '蓄力', action: { type: 'charge' }, primary: !s.charging },
    { label: '出壶', action: { type: 'release' }, disabled: !s.charging },
    { label: '向左', action: { type: 'aim', dir: -1, hold: true } },
    { label: '向右', action: { type: 'aim', dir: 1, hold: true } },
  ]
}

function outcome(s: State): Outcome | null {
  if (!s.over) return null
  return { score: s.total[0] - s.total[1], better: 'higher', unit: ' 分', win: winnerOf(s) === 0 }
}

function effects(prev: State, next: State): Effect[] {
  if (next === prev) return []
  const out: Effect[] = []

  if (!prev.over && next.over) {
    out.push({ kind: 'sound', name: next.winner === 0 ? 'win' : next.winner === 1 ? 'lose' : 'score' })
    out.push({ kind: 'flash', color: 'rgba(255,255,255,0.18)' })
    return out
  }
  if (next.hits > prev.hits) {
    out.push({ kind: 'sound', name: 'hit' })
    out.push({ kind: 'shake', power: 6 })
  }
  const scored = next.phase === 'settle' && prev.phase !== 'settle' && (next.lastEnd[0] > 0 || next.lastEnd[1] > 0)
  if (scored) {
    const team: Owner = next.lastEnd[0] > 0 ? 0 : 1
    out.push({ kind: 'sound', name: 'score' })
    out.push({ kind: 'burst', x: BUTTON.x, y: BUTTON.y, color: STONE_COLORS[team], count: 16 })
  } else if (prev.phase === 'aim' && next.phase === 'sliding') {
    out.push({ kind: 'sound', name: 'place' })
  }
  return out
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
  aiAction,
  // 实时游戏：AI 落子前只等一小会儿，很快就会自己算完
  aiDelay: 320,
}

export default game
