/**
 * 钓鱼 · 渲染层与 GameModule 组装。
 *
 * 规则全在 rules.ts（纯逻辑）。本文件只负责：
 * - 把逻辑状态画成 720×1280 的竖屏画面
 * - 用 performance.now() 算收杆抛物线等表现层动画（旁路缓存，绝不写回 state）
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import {
  COLORS,
  background,
  banner,
  fillRoundRect,
  shadowText,
  text,
  topBar,
  withAlpha,
} from '../../render/draw'
import { meta } from './meta'
import {
  BOB_X,
  BOB_Y,
  BITE_HALF,
  CAST_CD_TICKS,
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  SPECIES,
  VH,
  VW,
  WATER_TOP,
  create,
  hasBite,
  reduce,
  secondsLeft,
  tick,
  type Action,
  type CastInfo,
  type Fish,
  type State,
} from './rules'

export { meta }
export * from './rules'

// ---------------- 表现层旁路缓存（不入 state） ----------------
const CAST_MS = 460
let animSeq = -1
let animStart = -1
let anim: CastInfo | null = null

/** 鱼在屏幕上的纵向起伏（纯派生，可由 tick 复现） */
function bobY(f: Fish, tickN: number): number {
  return f.y + Math.sin((tickN + f.id * 37) / 14) * 5
}

/** 咬钩时浮漂下沉的深度 */
function dipDepth(s: State): number {
  if (!hasBite(s)) return 0
  return 16 + Math.abs(Math.sin(s.tick / 3)) * 12
}

// ---------------- 绘制片段 ----------------

function drawWater(ctx: CanvasRenderingContext2D, s: State): void {
  // 天空
  const sky = ctx.createLinearGradient(0, 0, 0, WATER_TOP)
  sky.addColorStop(0, '#8ec9e8')
  sky.addColorStop(1, '#cfe9f5')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, VW, WATER_TOP)
  // 远山
  ctx.fillStyle = '#7fa8bd'
  ctx.beginPath()
  ctx.moveTo(0, WATER_TOP)
  ctx.lineTo(90, WATER_TOP - 120)
  ctx.lineTo(190, WATER_TOP - 40)
  ctx.lineTo(300, WATER_TOP - 150)
  ctx.lineTo(430, WATER_TOP - 30)
  ctx.lineTo(VW, WATER_TOP - 110)
  ctx.lineTo(VW, WATER_TOP)
  ctx.closePath()
  ctx.fill()

  // 水体
  const g = ctx.createLinearGradient(0, WATER_TOP, 0, VH)
  g.addColorStop(0, '#2f7fa8')
  g.addColorStop(0.45, '#175e86')
  g.addColorStop(1, '#0b3350')
  ctx.fillStyle = g
  ctx.fillRect(0, WATER_TOP, VW, VH - WATER_TOP)

  // 水面波纹
  ctx.strokeStyle = withAlpha('#bfe8ff', 0.55)
  ctx.lineWidth = 3
  for (let i = 0; i < 3; i++) {
    const base = WATER_TOP + 8 + i * 9
    ctx.beginPath()
    for (let x = 0; x <= VW; x += 12) {
      const y = base + Math.sin((x + s.tick * 1.7) / 26 + i) * 4
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  // 上升气泡（由 tick 派生，画面稳定可复现）
  ctx.fillStyle = withAlpha('#dff3ff', 0.35)
  const span = FIELD_BOTTOM - FIELD_TOP
  for (let i = 0; i < 16; i++) {
    const bx = FIELD_LEFT + ((i * 83) % (FIELD_RIGHT - FIELD_LEFT))
    const by = FIELD_BOTTOM - (((s.tick + i * 37) * 1.6) % span)
    const br = 3 + (i % 4)
    ctx.beginPath()
    ctx.arc(bx, by, br, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawFish(ctx: CanvasRenderingContext2D, f: Fish, tickN: number): void {
  const g = SPECIES[f.sp]
  const x = f.x
  const y = bobY(f, tickN)
  const w = g.size
  const h = g.size * 0.58
  const dir = f.dir

  ctx.save()
  ctx.globalAlpha = f.hold > 0 ? 0.95 : 0.82
  ctx.fillStyle = g.color
  // 尾鳍
  ctx.beginPath()
  ctx.moveTo(x - dir * w * 0.5, y)
  ctx.lineTo(x - dir * w * 0.95, y - h * 0.75)
  ctx.lineTo(x - dir * w * 0.95, y + h * 0.75)
  ctx.closePath()
  ctx.fill()
  // 背鳍
  ctx.beginPath()
  ctx.moveTo(x - dir * w * 0.08, y - h * 0.42)
  ctx.lineTo(x + dir * w * 0.12, y - h * 1.02)
  ctx.lineTo(x + dir * w * 0.3, y - h * 0.35)
  ctx.closePath()
  ctx.fill()
  // 身体
  ctx.beginPath()
  ctx.ellipse(x, y, w * 0.5, h * 0.5, 0, 0, Math.PI * 2)
  ctx.fill()
  // 腹部高光
  ctx.fillStyle = withAlpha('#ffffff', 0.28)
  ctx.beginPath()
  ctx.ellipse(x + dir * w * 0.06, y + h * 0.16, w * 0.32, h * 0.18, 0, 0, Math.PI * 2)
  ctx.fill()
  // 眼睛
  ctx.fillStyle = '#10202c'
  ctx.beginPath()
  ctx.arc(x + dir * w * 0.3, y - h * 0.12, Math.max(2.2, w * 0.06), 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** 钓线 + 浮漂 */
function drawRig(ctx: CanvasRenderingContext2D, dip: number, bite: boolean, tickN: number): void {
  const by = BOB_Y + dip
  ctx.strokeStyle = withAlpha('#f3f8ff', 0.75)
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(BOB_X - 250, VH)
  ctx.lineTo(BOB_X, by)
  ctx.stroke()

  // 浮漂：上红下白
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 8
  ctx.fillStyle = COLORS.red
  ctx.beginPath()
  ctx.arc(BOB_X, by - 6, 13, Math.PI, 0)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#f6fbff'
  ctx.beginPath()
  ctx.arc(BOB_X, by - 6, 13, 0, Math.PI)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // 咬钩提示：浮漂周围扩散环
  if (bite) {
    const p = (tickN % 18) / 18
    ctx.strokeStyle = withAlpha(COLORS.accent, 0.85 * (1 - p))
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(BOB_X, by - 6, 16 + p * 46, 0, Math.PI * 2)
    ctx.stroke()
    shadowText(ctx, '收杆！', BOB_X, by - 74, { size: 40, color: COLORS.accent })
  }
}

/** 抛物线：把鱼从水下甩到岸上的鱼篓 */
function drawCast(ctx: CanvasRenderingContext2D, now: number, s: State): void {
  if (!anim) return
  const p = Math.min(1, (now - animStart) / CAST_MS)
  if (p >= 1) {
    anim = null
    return
  }
  const bx = BOB_X
  const by = BOB_Y + dipDepth(s)
  const tx = 86
  const ty = 168
  const arc = 230
  const x = bx + (tx - bx) * p
  const y = by + (ty - by) * p - arc * 4 * p * (1 - p)

  // 钓线
  ctx.strokeStyle = withAlpha('#ffffff', 0.8 * (1 - p * 0.5))
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(bx - 250, VH)
  ctx.lineTo(x, y)
  ctx.stroke()

  if (anim.kind === 'hit') {
    const g = SPECIES[anim.sp]
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate((1 - p) * 2.2)
    ctx.fillStyle = g.color
    ctx.beginPath()
    ctx.ellipse(0, 0, g.size * 0.5, g.size * 0.29, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(-g.size * 0.5, 0)
    ctx.lineTo(-g.size * 0.9, -g.size * 0.28)
    ctx.lineTo(-g.size * 0.9, g.size * 0.28)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    shadowText(ctx, `+${anim.w} 斤`, x, y - 44, { size: 34, color: COLORS.accent })
  } else {
    // 空杆：浮漂被猛地提起再落回
    const up = -70 * Math.sin(Math.PI * p)
    ctx.strokeStyle = withAlpha(COLORS.red, 1 - p)
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(BOB_X, BOB_Y + up, 18 + p * 26, 0, Math.PI * 2)
    ctx.stroke()
    shadowText(ctx, '空杆', BOB_X, BOB_Y + up - 52, { size: 34, color: COLORS.red })
  }
}

/** 岸上的鱼篓（累计重量的可视化） */
function drawBasket(ctx: CanvasRenderingContext2D, s: State): void {
  fillRoundRect(ctx, 30, 130, 118, 84, 12, withAlpha(COLORS.wood, 0.9), withAlpha('#6b4a26', 0.9), 3)
  ctx.strokeStyle = withAlpha('#6b4a26', 0.9)
  ctx.lineWidth = 4
  for (let i = 1; i < 3; i++) {
    ctx.beginPath()
    ctx.moveTo(30 + i * 39, 130)
    ctx.lineTo(30 + i * 39, 214)
    ctx.stroke()
  }
  const cap = Math.min(1, s.weight / 60)
  if (cap > 0) {
    ctx.fillStyle = withAlpha(COLORS.accent2, 0.85)
    ctx.fillRect(34, 210 - 74 * cap, 110, 74 * cap)
  }
}

function drawHud(ctx: CanvasRenderingContext2D, s: State): void {
  topBar(ctx, VW, `剩余 ${secondsLeft(s)} 秒`, `总重量 ${s.weight} 斤`)
  // 冷却指示
  if (s.castCd > 0) {
    const p = s.castCd / CAST_CD_TICKS
    ctx.fillStyle = withAlpha('#000000', 0.35)
    ctx.fillRect(0, 90, VW, 6)
    ctx.fillStyle = COLORS.accent
    ctx.fillRect(0, 90, VW * (1 - p), 6)
  }
  // 底部操作提示（不含重开按钮，重开由站点壳提供）
  const tip = s.over
    ? `钓上 ${s.caught} 尾 · 空杆 ${s.miss} 次`
    : hasBite(s)
      ? '浮漂下沉了！点一下收杆'
      : '等待咬钩…任意位置点击收杆'
  text(ctx, tip, VW / 2, VH - 74, { size: 32, color: hasBite(s) && !s.over ? COLORS.accent : COLORS.textDim })
  // 咬钩判定范围提示线
  ctx.strokeStyle = withAlpha('#ffffff', 0.1)
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(BOB_X - BITE_HALF, FIELD_TOP - 20)
  ctx.lineTo(BOB_X - BITE_HALF, FIELD_BOTTOM + 20)
  ctx.moveTo(BOB_X + BITE_HALF, FIELD_TOP - 20)
  ctx.lineTo(BOB_X + BITE_HALF, FIELD_BOTTOM + 20)
  ctx.stroke()
}

// ---------------- GameModule ----------------

function render(ctx: CanvasRenderingContext2D, s: State): void {
  const now = performance.now()
  // 收杆动画旁路：只在 seq 变化时重置起点
  if (s.seq !== animSeq) {
    animSeq = s.seq
    animStart = now
    anim = s.lastCast
  }

  background(ctx, VW, 240, '#0b1220', '#050a12')
  drawWater(ctx, s)

  for (const f of s.fishes) drawFish(ctx, f, s.tick)

  const dip = dipDepth(s)
  drawRig(ctx, dip, hasBite(s) && !s.over, s.tick)
  drawCast(ctx, now, s)
  drawBasket(ctx, s)
  drawHud(ctx, s)

  if (s.over) {
    banner(ctx, VW, VH, '时间到！', `总重量 ${s.weight} 斤 · ${s.caught} 尾`, COLORS.accent)
    text(ctx, `钓上 ${s.caught} 尾，空杆 ${s.miss} 次`, VW / 2, VH / 2 + 118, {
      size: 30,
      color: COLORS.textDim,
    })
  }
}

function input(_s: State, p: PointerInput): Action | null {
  return p.kind === 'down' ? { type: 'cast' } : null
}

function key(_s: State, k: string): Action | null {
  return k === ' ' || k === 'Enter' || k === 'Spacebar' ? { type: 'cast' } : null
}

function hint(s: State): string {
  if (s.over) return `时间到！总重量 ${s.weight} 斤，钓上 ${s.caught} 尾，空杆 ${s.miss} 次`
  if (hasBite(s)) return '浮漂下沉了！立刻收杆，越大的鱼停留时间越短'
  return `等浮漂下沉再收杆 · 剩余 ${secondsLeft(s)} 秒`
}

function controls(s: State): Control<Action>[] {
  return [{ label: '收杆', action: { type: 'cast' }, disabled: s.over || s.castCd > 0, primary: true }]
}

function outcome(s: State): Outcome | null {
  if (!s.over) return null
  return { score: s.weight, better: 'higher', unit: '斤' }
}

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (next.seq !== prev.seq && next.lastCast) {
    if (next.lastCast.kind === 'hit') {
      out.push({ kind: 'sound', name: 'score' })
      out.push({
        kind: 'burst',
        x: next.lastCast.x,
        y: next.lastCast.y,
        color: SPECIES[next.lastCast.sp]?.color,
      })
    } else {
      out.push({ kind: 'sound', name: 'error' })
      out.push({ kind: 'shake', power: 0.25 })
    }
  }
  if (next.biteId !== prev.biteId && hasBite(next)) out.push({ kind: 'sound', name: 'tick' })
  if (next.over && !prev.over) out.push({ kind: 'sound', name: 'win' })
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
}

export default game
