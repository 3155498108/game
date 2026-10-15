/**
 * 英国十字戏渲染 + 输入映射。
 *
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas，
 * 以及把逻辑坐标的指针事件翻译成 action。
 *
 * 格子位置由 rules 的 CELLS 唯一定义，渲染与命中共用同一份坐标数组（cellAt → cellRect），
 * 因此不存在「画在这里、点在那里」的错位可能。
 *
 * 动画不进 state：滑行与推动的插值全部由 render/anim 的旁路缓存按 moves 签名驱动，
 * 落点结果早已由 state 定好，所以「动画期间不可点击」不需要做成任何状态。
 */
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import type { Rect } from '../../core/geom'
import { inRect, lerp } from '../../core/geom'
import {
  COLORS,
  background,
  banner,
  disc,
  fillRoundRect,
  roundRectPath,
  shadowText,
  text,
  topBar,
  withAlpha,
} from '../../render/draw'
import { progressSince } from '../../render/anim'
import meta from './meta'
import {
  ARM,
  ARM_ENDS,
  CELL_COUNT,
  SPAN,
  aiAction,
  cellAt,
  create,
  movesFrom,
  other,
  reduce,
  type Action,
  type Player,
  type State,
} from './rules'

// ---------------- 布局常量（渲染与输入共用） ----------------

const VW = 720
const VH = 1280
/**
 * 单格边长。十字形棋盘的包围盒恒为 7×7 格，720 逻辑像素宽下 CELL 的上限约 100，
 * 取 96（左右各留 24 边距）。热区 96×96 逻辑像素，远大于 44 的触控下限。
 */
const CELL = 96
const BOARD_LEFT = Math.round((VW - SPAN * CELL) / 2)
const BOARD_TOP = 290
/** 命中区在格子中心外扩的半径（逻辑像素），方便手指点边缘 */
const HIT_PAD = CELL * 0.55
/** 滑行动画时长（动画走旁路缓存，不进 state） */
const SLIDE_MS = 220

const playerColor = (p: Player): string => (p === 1 ? COLORS.yellow : COLORS.blue)

function cellRect(i: number): Rect {
  const at = cellAt(i)
  return { x: BOARD_LEFT + ((at ? at.x : 0) + ARM) * CELL, y: BOARD_TOP + ((at ? at.y : 0) + ARM) * CELL, w: CELL, h: CELL }
}

function cellCenter(i: number): [number, number] {
  const r = cellRect(i)
  return [r.x + r.w / 2, r.y + r.h / 2]
}

/** 命中判定：先按格子矩形精确命中，再退化为「离最近的格子中心不超过 HIT_PAD」 */
function hitCell(x: number, y: number): number {
  const p = { x, y }
  for (let i = 0; i < CELL_COUNT; i++) if (inRect(p, cellRect(i))) return i
  let best = -1
  let bestD = HIT_PAD
  for (let i = 0; i < CELL_COUNT; i++) {
    const [cx, cy] = cellCenter(i)
    const d = Math.hypot(x - cx, y - cy)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

// ---------------- 文案 ----------------

function statusLine(s: State): [string, string] {
  if (s.over) {
    if (s.winner === 1) return ['你赢了！', `第 ${s.moves} 手把电脑的棋子全部挤出棋盘`]
    if (s.winner === 2) return ['电脑获胜', `第 ${s.moves} 手你的棋子被全部挤出`]
    return ['平局', `走了 ${s.moves} 步，谁也没占优`]
  }
  if (s.turn === 1) return ['轮到你', '把电脑的棋子全部挤出棋盘']
  return ['电脑思考中', '它正想办法把你的棋子推出去']
}

function tipText(s: State): string {
  if (s.over) return '点「新的一局」再来一次'
  if (s.turn === 2) return '电脑正在挤…'
  if (s.sel >= 0) return '点一个高亮格把棋子移过去'
  return '先点一枚自己的棋子，再点高亮格'
}

// ---------------- 绘制 ----------------

/** 十字形底板：先画外圈（露出来的部分就是描边），再画内圈 */
function drawCrossPlate(ctx: CanvasRenderingContext2D): void {
  const cross = (inset: number, color: string): void => {
    const x = BOARD_LEFT
    const y = BOARD_TOP
    const s = SPAN * CELL
    const r = Math.max(6, 26 - inset)
    fillRoundRect(ctx, x + ARM * CELL + inset, y + inset, CELL - inset * 2, s - inset * 2, r, color)
    fillRoundRect(ctx, x + inset, y + ARM * CELL + inset, s - inset * 2, CELL - inset * 2, r, color)
  }
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  cross(0, '#09182b')
  ctx.restore()
  cross(4, '#15304f')
}

/**
 * 四个臂端格 = 底线：虚线框。
 * 新规则下底线**不属任何一方**（谁被挤出去都一样丢子），所以四个都用中性色标注，
 * 不再按「你的底线 / 电脑底线」着色 —— 那套着色属于已废除的旧规则。
 */
function drawGoalMarks(ctx: CanvasRenderingContext2D, s: State): void {
  const col = 'rgba(255,214,102,0.9)'
  for (const idx of ARM_ENDS) {
    const r = cellRect(idx)
    const at = cellAt(idx)
    // 四个尖格的标签要避让棋盘外侧：横臂端标在上下、竖臂端标在左右
    const horizontal = at !== null && at.y === 0
    ctx.save()
    ctx.setLineDash([12, 10])
    ctx.strokeStyle = col
    ctx.lineWidth = 5
    roundRectPath(ctx, r.x + 8, r.y + 8, r.w - 16, r.h - 16, 16)
    ctx.stroke()
    ctx.restore()
    text(
      ctx,
      '底线',
      r.x + r.w / 2,
      horizontal ? r.y - 26 : r.y + r.h + 34,
      { size: 24, weight: 'bold', color: col },
    )
  }
  void s
}

function drawBoard(ctx: CanvasRenderingContext2D, s: State): void {
  drawCrossPlate(ctx)
  drawGoalMarks(ctx, s)

  const selMoves = s.sel >= 0 ? movesFrom(s.pieces, s.sel) : []
  const targets = new Set(selMoves.map((m) => m.to))

  for (let i = 0; i < CELL_COUNT; i++) {
    const r = cellRect(i)
    const occupied = s.pieces[i] !== 0
    const isTarget = targets.has(i)
    const isHover = !s.over && s.turn === 1 && s.hover === i
    fillRoundRect(
      ctx,
      r.x + 7,
      r.y + 7,
      r.w - 14,
      r.h - 14,
      16,
      isTarget ? 'rgba(255,204,51,0.20)' : occupied ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.06)',
      isHover ? withAlpha(COLORS.accent, 0.9) : 'rgba(255,255,255,0.10)',
      isHover ? 4 : 2,
    )
  }

  // 选中棋子：外圈高亮 + 每个合法落点画一个小靶心
  if (s.sel >= 0 && !s.over) {
    const [cx, cy] = cellCenter(s.sel)
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, CELL * 0.44, 0, Math.PI * 2)
    ctx.strokeStyle = COLORS.accent
    ctx.lineWidth = 5
    ctx.stroke()
    ctx.restore()
    for (const m of selMoves) {
      const [tx, ty] = cellCenter(m.to)
      disc(ctx, tx, ty, 11, COLORS.accent, { alpha: 0.9 })
      ctx.save()
      ctx.beginPath()
      ctx.arc(tx, ty, 20, 0, Math.PI * 2)
      ctx.strokeStyle = withAlpha(COLORS.accent, 0.55)
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.restore()
    }
  }
}

/** 棋子：最后一手按旁路动画进度在「起点格 → 终点格」之间插值 */
function drawPieces(ctx: CanvasRenderingContext2D, s: State): void {
  const t = s.last ? progressSince('xi-slide', String(s.moves), SLIDE_MS) : 1
  const anim = new Map<number, [number, number]>()
  if (s.last && t < 1) {
    const lerpTo = (a: number, b: number): void => {
      const [ax, ay] = cellCenter(a)
      const [bx, by] = cellCenter(b)
      anim.set(b, [lerp(ax, bx, t), lerp(ay, by, t)])
    }
    lerpTo(s.last.from, s.last.to)
    for (const p of s.last.pushed) lerpTo(p.from, p.to)
  }

  for (let i = 0; i < CELL_COUNT; i++) {
    const v = s.pieces[i]
    if (v === 0) continue
    const c = anim.get(i) ?? cellCenter(i)
    disc(ctx, c[0], c[1], CELL * 0.36, playerColor(v as Player), { ring: 'rgba(255,255,255,0.55)' })
  }
}

function drawFooter(ctx: CanvasRenderingContext2D, s: State): void {
  fillRoundRect(ctx, 48, 1000, VW - 96, 110, 24, 'rgba(255,255,255,0.07)')
  text(ctx, tipText(s), VW / 2, 1055, { size: 30, weight: 'bold' })

  const y = 1152
  disc(ctx, VW / 2 - 156, y, 16, playerColor(1))
  text(ctx, '你', VW / 2 - 128, y + 1, { size: 28, align: 'left', weight: 'bold' })
  disc(ctx, VW / 2 + 52, y, 16, playerColor(2))
  text(ctx, '电脑', VW / 2 + 80, y + 1, { size: 28, align: 'left', weight: 'bold' })
  shadowText(ctx, '沿直线滑动 · 遇子就推 · 不吃子', VW / 2, 1214, {
    size: 24,
    color: COLORS.textDim,
    weight: 'normal',
  })
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, '#123a63', '#071426')

  const [main, sub] = statusLine(s)
  topBar(ctx, VW, main, `第 ${s.moves} 手`, 96)
  shadowText(ctx, sub, VW / 2, 152, { size: 26, color: COLORS.textDim, weight: 'normal' })

  drawBoard(ctx, s)
  drawPieces(ctx, s)
  drawFooter(ctx, s)

  if (s.over) {
    banner(ctx, VW, VH, s.winner === 1 ? '胜利' : s.winner === 2 ? '失败' : '平局', main)
  }
}

// ---------------- 副作用与成绩 ----------------

function effects(prev: State, next: State): Effect[] {
  if (next.moves === prev.moves) return []
  const out: Effect[] = []
  const pushed = next.last ? next.last.pushed.length : 0
  if (next.over) {
    out.push({ kind: 'sound', name: next.winner === 1 ? 'win' : next.winner === 2 ? 'lose' : 'click' })
    if (next.winner !== 0) {
      // 胜负不再绑定某条底线，庆祝特效定位到胜方棋子的实际位置；
      // 位置决胜（撞上限）时把棋子聚在一起，取其中一格即可。
      let cx = 0
      let cy = 0
      let n = 0
      for (let i = 0; i < CELL_COUNT; i++) {
        if (next.pieces[i] !== next.winner) continue
        const [x, y] = cellCenter(i)
        cx += x
        cy += y
        n++
      }
      if (n === 0) {
        const [x, y] = cellCenter(ARM_ENDS[0])
        cx = x
        cy = y
      } else {
        cx /= n
        cy /= n
      }
      out.push({ kind: 'burst', x: cx, y: cy, color: playerColor(next.winner), count: 26 })
      out.push({ kind: 'flash', color: 'rgba(255,255,255,0.35)' })
    }
    return out
  }
  out.push({ kind: 'sound', name: pushed > 0 ? 'hit' : 'place' })
  if (pushed > 0) {
    out.push({ kind: 'shake', power: 5 + Math.min(6, pushed * 2) })
    const by = next.last ? next.last.by : 1
    for (const p of next.last ? next.last.pushed : []) {
      const [x, y] = cellCenter(p.to)
      out.push({ kind: 'burst', x, y, color: playerColor(other(by)), count: 6 })
    }
  }
  return out
}

function outcome(state: State): Outcome | null {
  if (!state.over) return null
  return { score: state.winner === 1 ? 1 : 0, better: 'higher', unit: ' 胜', win: state.winner === 1 }
}

// ---------------- 输入 ----------------

function input(state: State, p: PointerInput): Action | null {
  if (state.over) return null
  const i = hitCell(p.x, p.y)

  if (p.kind === 'down') {
    // 点空白处：取消选中
    if (i < 0) return { type: 'leave' }
    // 电脑回合不接受输入，避免抢走它的回合
    if (state.turn !== 1) return null
    if (state.sel >= 0) {
      if (movesFrom(state.pieces, state.sel).some((m) => m.to === i)) return { type: 'move', from: state.sel, to: i }
      if (state.pieces[i] === 1) return { type: 'pick', cell: i }
      return { type: 'leave' }
    }
    return state.pieces[i] === 1 ? { type: 'pick', cell: i } : { type: 'hover', cell: i }
  }

  if (p.kind === 'move' && !p.pressed) return state.hover === i ? null : { type: 'hover', cell: i }
  return null
}

/** 键盘：方向键在可交互的格子间移动，回车/空格选中或落子 */
function key(state: State, k: string): Action | null {
  if (state.over || state.turn !== 1) return null

  const reachable = (i: number): boolean =>
    state.pieces[i] === 1 || (state.sel >= 0 && movesFrom(state.pieces, state.sel).some((m) => m.to === i))

  const step = (d: number): Action | null => {
    const from = state.hover === -1 ? (d > 0 ? -1 : CELL_COUNT) : state.hover
    for (let n = 0; n < CELL_COUNT; n++) {
      const i = (from + d + CELL_COUNT) % CELL_COUNT
      if (reachable(i)) return { type: 'hover', cell: i }
    }
    return null
  }

  if (k === 'ArrowRight' || k === 'ArrowDown') return step(1)
  if (k === 'ArrowLeft' || k === 'ArrowUp') return step(-1)
  if (k === ' ' || k === 'Enter') {
    if (state.hover < 0) return null
    if (state.sel >= 0 && movesFrom(state.pieces, state.sel).some((m) => m.to === state.hover)) {
      return { type: 'move', from: state.sel, to: state.hover }
    }
    return state.pieces[state.hover] === 1 ? { type: 'pick', cell: state.hover } : null
  }
  if (k === 'Escape') return state.sel === -1 && state.hover === -1 ? null : { type: 'leave' }
  return null
}

// ---------------- 游戏模块 ----------------

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
  hint: (s) => tipText(s),
  aiDelay: 300,
}

export default game
