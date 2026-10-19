/**
 * 点格棋渲染 + 输入映射。
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas，
 * 以及把逻辑坐标的指针事件翻译成 action。
 *
 * 命中判定与渲染共用同一套边几何（EDGE_GEO，由 rules 的 edgeAt 生成），
 * 点到边 = 到该边线段距离最小且 ≤ EDGE_HIT。
 */
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { COLORS, banner, background, disc, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { elapsedSince, progressSince } from '../../render/anim'
import meta from './meta'
import {
  BOXES,
  BOX_COUNT,
  DOTS,
  EDGE_COUNT,
  aiAction,
  create,
  edgeAt,
  reduce,
  type Action,
  type Player,
  type State,
} from './rules'

// ---------------- 布局常量（渲染与输入共用） ----------------

/** 点间距（逻辑像素） */
const DOT = 130
/** 左上角第 0 个点 */
const GRID_X = 100
const GRID_Y = 320
/** 边线点击热区半径（逻辑像素）→ 直径 88，远大于 44 的触控下限 */
const EDGE_HIT = 44
const VW = 720
const VH = 1280
/** 画出的边线宽 */
const EDGE_W = 14

const dotPos = (r: number, c: number): [number, number] => [GRID_X + c * DOT, GRID_Y + r * DOT]
const boxCenter = (b: number): [number, number] => [
  GRID_X + ((b % BOXES) + 0.5) * DOT,
  GRID_Y + (Math.floor(b / BOXES) + 0.5) * DOT,
]

interface EdgeGeo {
  i: number
  x1: number
  y1: number
  x2: number
  y2: number
}

/** 40 条边的线段几何：索引 → 两端点（渲染与命中共用） */
const EDGE_GEO: EdgeGeo[] = (() => {
  const out: EdgeGeo[] = []
  for (let i = 0; i < EDGE_COUNT; i++) {
    const at = edgeAt(i)
    if (!at) continue
    const [x1, y1] = dotPos(at.r, at.c)
    const [x2, y2] = at.dir === 'h' ? dotPos(at.r, at.c + 1) : dotPos(at.r + 1, at.c)
    out.push({ i, x1, y1, x2, y2 })
  }
  return out
})()

/** 点到线段的距离 */
function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t))
}

/** 命中判定：返回最近的边索引，没碰到任何边返回 -1 */
function hitEdge(x: number, y: number): number {
  let best = -1
  let bestD = EDGE_HIT
  for (const e of EDGE_GEO) {
    const d = distToSeg(x, y, e.x1, e.y1, e.x2, e.y2)
    if (d < bestD) {
      bestD = d
      best = e.i
    }
  }
  return best
}

const playerColor = (p: Player): string => (p === 1 ? COLORS.yellow : COLORS.blue)

// ---------------- 文案 ----------------

function statusText(s: State): [string, string] {
  if (s.over) {
    const diff = s.scores[0] - s.scores[1]
    if (diff > 0) return ['你赢了！', `你多拿了 ${diff} 个盒子`]
    if (diff < 0) return ['电脑获胜', `电脑多拿了 ${-diff} 个盒子`]
    return ['平局', `${s.scores[0]} : ${s.scores[1]}，各拿一半格子`]
  }
  if (s.turn === 1) return ['轮到你', '围成一个盒子就能连走下一步']
  return ['电脑思考中', '它会优先吃掉只剩一条边的盒子']
}

function tipText(s: State): string {
  if (s.over) return '点「新的一局」再来一次'
  if (s.turn === 2) return '电脑正在画边…'
  return '点两点之间的线占边，收尾阶段别停手'
}

// ---------------- 绘制 ----------------

function strokeSeg(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number, color: string): void {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.lineWidth = w
  ctx.lineCap = 'round'
  ctx.strokeStyle = color
  ctx.stroke()
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  background(ctx, VW, VH, '#14304f', '#0a1728')

  const [main, sub] = statusText(state)
  topBar(ctx, VW, main, `第 ${state.moves + (state.over ? 0 : 1)} 手`, 96)
  shadowText(ctx, sub, VW / 2, 146, { size: 26, color: COLORS.textDim, weight: 'normal' })

  drawScores(ctx, state)

  // 盘面底板
  const bx = GRID_X - 64
  const by = GRID_Y - 64
  const bs = (DOTS - 1) * DOT + 128
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, bx, by, bs, bs, 28, withAlpha('#081426', 0.92))
  ctx.restore()
  fillRoundRect(ctx, bx, by, bs, bs, 28, 'rgba(255,255,255,0.05)', COLORS.line, 2)

  // 已完成的盒子：填色 + 描边
  for (let b = 0; b < BOX_COUNT; b++) {
    const owner = state.owners[b]
    if (owner === 0) continue
    const [cx, cy] = boxCenter(b)
    const s = DOT - 30
    const pop = state.lastBoxes.indexOf(b) >= 0 ? progressSince('dab-box', String(state.moves), 380) : 1
    const k = pop < 1 ? 1 + 0.35 * (1 - pop) : 1
    ctx.save()
    ctx.globalAlpha = pop < 1 ? 0.35 + 0.65 * pop : 1
    fillRoundRect(ctx, cx - (s * k) / 2, cy - (s * k) / 2, s * k, s * k, 16, withAlpha(playerColor(owner as Player), 0.3))
    ctx.lineWidth = 3
    ctx.strokeStyle = withAlpha(playerColor(owner as Player), 0.85)
    ctx.strokeRect(cx - (s * k) / 2, cy - (s * k) / 2, s * k, s * k)
    ctx.restore()
  }

  // 悬停预览（只有轮到自己且该边未占时才画）
  if (!state.over && state.turn === 1 && state.hover >= 0 && state.edges[state.hover] === 0) {
    const e = EDGE_GEO[state.hover]
    strokeSeg(ctx, e.x1, e.y1, e.x2, e.y2, EDGE_W + 8, 'rgba(255,255,255,0.28)')
  }

  // 已占的边（最后一手带生长动画）
  const sig = `${state.lastEdge}:${state.moves}`
  const grow = progressSince('dab-edge', sig, 240)
  const recent = elapsedSince('dab-edge', sig, 520)
  for (const e of EDGE_GEO) {
    const v = state.edges[e.i]
    if (v === 0) continue
    if (e.i === state.lastEdge && grow < 1) {
      strokeSeg(ctx, e.x1, e.y1, e.x1 + (e.x2 - e.x1) * grow, e.y1 + (e.y2 - e.y1) * grow, EDGE_W, playerColor(v as Player))
      continue
    }
    strokeSeg(ctx, e.x1, e.y1, e.x2, e.y2, EDGE_W, playerColor(v as Player))
    if (e.i === state.lastEdge && recent < 520) {
      ctx.save()
      ctx.globalAlpha = 0.5 * (1 - recent / 520)
      strokeSeg(ctx, e.x1, e.y1, e.x2, e.y2, EDGE_W + 14, COLORS.white)
      ctx.restore()
    }
  }

  // 点阵
  for (let r = 0; r < DOTS; r++) {
    for (let c = 0; c < DOTS; c++) {
      const [x, y] = dotPos(r, c)
      disc(ctx, x, y, 9, '#5c7aa8')
    }
  }

  // 底部提示
  fillRoundRect(ctx, 60, VH - 196, VW - 120, 104, 22, 'rgba(255,255,255,0.08)')
  text(ctx, tipText(state), VW / 2, VH - 144, { size: 29, weight: 'bold' })

  if (state.over) banner(ctx, VW, VH, state.winner === 1 ? '胜利' : state.winner === 2 ? '失败' : '平局', main)
}

function drawScores(ctx: CanvasRenderingContext2D, s: State): void {
  const pill = (x: number, p: Player, n: number, label: string, active: boolean): void => {
    fillRoundRect(ctx, x, 176, 260, 66, 20, active ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)', active ? playerColor(p) : COLORS.line, active ? 4 : 2)
    disc(ctx, x + 44, 209, 15, playerColor(p))
    text(ctx, label, x + 96, 211, { size: 27, align: 'left', weight: 'bold' })
    text(ctx, String(n), x + 218, 209, { size: 34, align: 'right', weight: 'bold', color: playerColor(p) })
  }
  pill(70, 1, s.scores[0], '你', !s.over && s.turn === 1)
  pill(390, 2, s.scores[1], '电脑', !s.over && s.turn === 2)
}

// ---------------- 副作用 ----------------

function effects(prev: State, next: State): Effect[] {
  if (next.moves === prev.moves) return []
  const out: Effect[] = []
  const gained = next.scores[0] + next.scores[1] - (prev.scores[0] + prev.scores[1])
  if (gained > 0) {
    out.push({ kind: 'sound', name: 'score' })
    const color = playerColor(prev.turn)
    for (const b of next.lastBoxes) {
      const [x, y] = boxCenter(b)
      out.push({ kind: 'burst', x, y, color, count: 16 })
    }
  } else {
    out.push({ kind: 'sound', name: 'place' })
  }
  if (next.over) {
    out.push({ kind: 'sound', name: next.winner === 1 ? 'win' : next.winner === 2 ? 'lose' : 'click' })
  }
  return out
}

function outcome(state: State): Outcome | null {
  if (!state.over) return null
  return { score: state.scores[0], better: 'higher', unit: ' 盒', win: state.winner === 1 }
}

// ---------------- 输入 ----------------

function input(state: State, p: PointerInput): Action | null {
  if (state.over) return null
  const e = hitEdge(p.x, p.y)
  if (p.kind === 'down') {
    // 只在轮到自己时接受画边，避免在电脑思考窗口里抢走它的回合
    if (state.turn !== 1 || e < 0 || state.edges[e] !== 0) return null
    return { type: 'draw', edge: e }
  }
  if (p.kind === 'move' && !p.pressed) return state.hover === e ? null : { type: 'hover', edge: e }
  return null
}

function key(state: State, k: string): Action | null {
  if (state.over) return null
  const step = (d: number): Action | null => {
    const free = state.edges
    let i = state.hover === -1 ? (d > 0 ? -1 : 0) : state.hover
    for (let n = 0; n < EDGE_COUNT; n++) {
      i += d
      if (i < 0 || i >= EDGE_COUNT) return null
      if (free[i] === 0) return { type: 'hover', edge: i }
    }
    return null
  }
  if (k === 'ArrowRight' || k === 'ArrowDown') return step(1)
  if (k === 'ArrowLeft' || k === 'ArrowUp') return step(-1)
  if (k === ' ' || k === 'Enter') {
    if (state.turn !== 1 || state.hover < 0 || state.edges[state.hover] !== 0) return null
    return { type: 'draw', edge: state.hover }
  }
  return null
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  aiAction,
  input,
  key,
  effects,
  outcome,
  hint: (s) =>
    s.over
      ? `本局结束：${s.scores[0]} : ${s.scores[1]}，点「新的一局」再来一次`
      : s.turn === 1
        ? '轮到你：点两点之间的线占边，围成盒子可连走一步'
        : '电脑思考中…',
  aiDelay: 260,
}

export default game