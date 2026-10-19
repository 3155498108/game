/**
 * 弹戏 pachinko —— 渲染与输入适配层。
 *
 * 分工：
 *   - rules.ts 持有全部纯逻辑（定步推进、碰撞、分值），禁 DOM / 禁时间来源；
 *   - 本文件负责画布绘制、指针映射，以及用 performance.now() 的真实 dt
 *     折算成整数 tick 后发 `step` action（性能.now 只出现在这里）。
 *
 * 注意：不在画布上自绘「重开」按钮 —— 站点壳会自动追加「新的一局」，
 * 自绘会造成重复控件。controls() 里只声明站点壳负责渲染的 DOM 按钮。
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
import meta from './meta'
import {
  BALL_R,
  CHUTE_TOP,
  DT,
  FLIPPER_R,
  FLIPPER_STEP,
  FLIPPER_Y,
  FLIPPER_ZONE_TOP,
  LAUNCH_MAX_X,
  LAUNCH_MIN_X,
  LAUNCH_Y,
  LEFT_PIVOT_X,
  RIGHT_PIVOT_X,
  SLOT_COUNT,
  SLOT_H,
  SLOT_TOP,
  SLOT_W,
  VW,
  VH,
  create,
  flipperAngleFromPointer,
  flipperTip,
  reduce,
  slotCenterX,
  type Action,
  type Side,
  type State,
} from './rules'

/** 分值区配色：越靠中间越亮（对应更高的基础分） */
function slotColor(i: number): string {
  const mid = (SLOT_COUNT - 1) / 2
  const t = 1 - Math.abs(i - mid) / mid // 0(边缘) ~ 1(中央)
  return `hsl(${38 + (1 - t) * 8}, ${45 + t * 45}%, ${34 + t * 24}%)`
}

function drawSlots(ctx: CanvasRenderingContext2D, s: State): void {
  // 分值区背板
  ctx.fillStyle = withAlpha('#000000', 0.25)
  ctx.fillRect(0, SLOT_TOP - 14, VW, SLOT_H + 14)

  const hot = s.lastScore ? s.lastScore.index : -1
  for (let i = 0; i < SLOT_COUNT; i++) {
    const x = i * SLOT_W
    const active = i === hot
    fillRoundRect(
      ctx,
      x + 4,
      SLOT_TOP,
      SLOT_W - 8,
      SLOT_H,
      10,
      active ? COLORS.accent : slotColor(i),
      active ? COLORS.white : withAlpha('#ffffff', 0.18),
      active ? 5 : 2,
    )
    // 分隔竖线
    if (i > 0) {
      ctx.fillStyle = withAlpha('#000000', 0.35)
      ctx.fillRect(x - 2, SLOT_TOP + 6, 4, SLOT_H - 12)
    }
    shadowText(ctx, String(s.slotValues[i]), x + SLOT_W / 2, SLOT_TOP + SLOT_H * 0.42, {
      size: 40,
      color: active ? COLORS.black : COLORS.text,
    })
    if (active) {
      shadowText(ctx, `+${s.lastScore?.value ?? 0}`, x + SLOT_W / 2, SLOT_TOP + SLOT_H * 0.76, {
        size: 30,
        color: COLORS.black,
      })
    } else {
      text(ctx, '分', x + SLOT_W / 2, SLOT_TOP + SLOT_H * 0.78, {
        size: 22,
        color: withAlpha('#ffffff', 0.55),
      })
    }
  }
}

function drawPegField(ctx: CanvasRenderingContext2D, s: State): void {
  for (let i = 0; i < s.pegs.length; i++) {
    const p = s.pegs[i]
    disc(ctx, p.x, p.y, p.r, COLORS.panelLight, { ring: COLORS.line })
  }
}

function drawFlipper(ctx: CanvasRenderingContext2D, s: State, side: Side): void {
  const angle = side === 'left' ? s.leftAngle : s.rightAngle
  const px = side === 'left' ? LEFT_PIVOT_X : RIGHT_PIVOT_X
  const tip = flipperTip(side, angle)
  const hot = side === 'left' ? s.leftActive : s.rightActive
  ctx.save()
  ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 4
  ctx.lineWidth = FLIPPER_R * 2
  ctx.strokeStyle = hot ? COLORS.accent : side === 'left' ? COLORS.blue : COLORS.red
  ctx.beginPath()
  ctx.moveTo(px, FLIPPER_Y)
  ctx.lineTo(tip.x, tip.y)
  ctx.stroke()
  ctx.restore()
  // 枢轴
  disc(ctx, px, FLIPPER_Y, FLIPPER_R + 5, COLORS.panel, { ring: COLORS.line })
}

function drawBalls(ctx: CanvasRenderingContext2D, s: State): void {
  for (let i = 0; i < s.balls.length; i++) {
    const b = s.balls[i]
    if (b.scored) {
      disc(ctx, b.x, SLOT_TOP + SLOT_H * 0.86, BALL_R * 0.86, COLORS.pink, { ring: withAlpha('#ffffff', 0.5) })
    } else {
      disc(ctx, b.x, b.y, BALL_R, COLORS.accent2, { ring: COLORS.white })
    }
  }
}

function drawChute(ctx: CanvasRenderingContext2D, s: State): void {
  fillRoundRect(ctx, LAUNCH_MIN_X - 12, CHUTE_TOP, LAUNCH_MAX_X - LAUNCH_MIN_X + 24, LAUNCH_Y - CHUTE_TOP + 22, 12, withAlpha('#ffffff', 0.08), withAlpha('#ffffff', 0.22), 2)
  // 投放口滑块
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 8
  fillRoundRect(ctx, s.launchX - 26, CHUTE_TOP - 10, 52, 22, 8, COLORS.accent2, COLORS.white, 3)
  ctx.restore()
  text(ctx, '投放口', s.launchX, CHUTE_TOP - 32, { size: 22, color: COLORS.textDim })
  // 落点竖向参考线
  ctx.save()
  ctx.strokeStyle = withAlpha('#ffffff', 0.12)
  ctx.lineWidth = 2
  ctx.setLineDash([6, 10])
  ctx.beginPath()
  ctx.moveTo(s.launchX, LAUNCH_Y + 22)
  ctx.lineTo(s.launchX, SLOT_TOP)
  ctx.stroke()
  ctx.restore()
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, '#13253e', '#070f1b')

  // 场地侧边框
  ctx.fillStyle = withAlpha('#ffffff', 0.06)
  ctx.fillRect(0, CHUTE_TOP - 60, 6, SLOT_TOP - CHUTE_TOP + 40)
  ctx.fillRect(VW - 6, CHUTE_TOP - 60, 6, SLOT_TOP - CHUTE_TOP + 40)

  drawSlots(ctx, s)
  drawPegField(ctx, s)
  drawFlipper(ctx, s, 'left')
  drawFlipper(ctx, s, 'right')
  drawBalls(ctx, s)
  drawChute(ctx, s)

  topBar(ctx, VW, '弹戏', `总分 ${s.score} · 剩余 ${s.ballsLeft}`)

  if (s.over) {
    banner(ctx, VW, VH, `总分 ${s.score}`, `弹珠用尽 · 最高区 ${Math.max(...s.slotValues)} 分`, COLORS.accent)
  } else if (s.ballsLeft > 0 && s.balls.length === 0) {
    shadowText(ctx, '点画面上方投放弹珠', VW / 2, CHUTE_TOP + 52, { size: 30, color: COLORS.textDim })
  }
}

/** 指针 → action：上半屏投放，下半屏拖动左右挡板。挡板角度由指针本身决定，无需读状态。 */
function input(_s: State, p: PointerInput): Action | null {
  if (p.kind === 'up') return null
  if (p.y >= FLIPPER_ZONE_TOP) {
    const side: Side = Math.abs(p.x - LEFT_PIVOT_X) <= Math.abs(p.x - RIGHT_PIVOT_X) ? 'left' : 'right'
    const angle = flipperAngleFromPointer(side, p.x, p.y)
    return side === 'left' ? { type: 'setLeft', angle } : { type: 'setRight', angle }
  }
  if (p.kind === 'down') return { type: 'launch', x: p.x }
  return null
}

/** 键盘微调（桌面便利）：←/→ 抬板，↓/↑ 落板，空格投放 */
function key(s: State, k: string): Action | null {
  switch (k) {
    case 'ArrowLeft':
      return { type: 'flipLeft', delta: FLIPPER_STEP }
    case 'ArrowRight':
      return { type: 'flipRight', delta: FLIPPER_STEP }
    case 'ArrowDown':
      return { type: 'flipLeft', delta: -FLIPPER_STEP }
    case 'ArrowUp':
      return { type: 'flipRight', delta: -FLIPPER_STEP }
    case ' ':
    case 'Space':
      return { type: 'launch', x: s.launchX }
    default:
      return null
  }
}

/**
 * 实时推进：把真实 dt(ms) 折算成整数 tick 数。
 * 夹在 1..5 帧，避免切后台回来后一次补上千个 tick。
 */
function tick(dt: number): Action {
  const frames = Math.round(dt / 1000 / DT)
  return { type: 'step', n: Math.max(1, Math.min(5, Number.isFinite(frames) ? frames : 1)) }
}

function hint(s: State): string {
  if (s.over) return `本局结束 · 总分 ${s.score} · 调整挡板角度可以拿中间高分区`
  return `剩余弹珠 ${s.ballsLeft} 颗 · 点画面上方投放 · 拖动下方左右挡板（←/→ 抬板，↓/↑ 落板，空格投放）`
}

function controls(s: State): Control<Action>[] {
  return [
    {
      label: '投放弹珠',
      action: { type: 'launch', x: VW / 2 },
      disabled: s.over || s.ballsLeft <= 0,
      primary: true,
    },
  ]
}

function outcome(s: State): Outcome | null {
  if (!s.over) return null
  return { score: s.score, better: 'higher', unit: '分', win: s.score > 0 }
}

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (next.lastScore !== prev.lastScore && next.lastScore) {
    out.push({
      kind: 'burst',
      x: slotCenterX(next.lastScore.index),
      y: SLOT_TOP + 40,
      color: COLORS.accent,
      count: 16,
    })
    out.push({ kind: 'sound', name: 'score' })
  }
  if (!prev.over && next.over) {
    out.push({ kind: 'sound', name: 'win' })
    out.push({ kind: 'flash', color: COLORS.accent })
  }
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
  aiDelay: 0,
}

export default game
