/**
 * 兔子和猎犬：渲染 + 输入映射。
 * 规则全在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas、把指针翻译成 action。
 *
 * 坐标与裁决（与 rules.ts 一一对应）：
 * - 棋盘 7 行 × 9 列：COLS=9 从左到右、ROWS=7 从上到下，idx(c,r) = r*COLS+c
 * - 狐狸起始格 = 第 3 行（中心行）第 4 列（中心列）
 * - 狐狸的胜利格 = 第 0 列或第 8 列上的任意格，且该格与「狗」不正交相邻
 * - 滑行 = 沿东西南北 + 两条 45° 对角线（共 8 条射线）落到该方向的第一个空格；
 *   路径上的棋子只阻挡落点、不阻挡穿过（规格「狗可跳棋子」的口径）
 * - 胜负：到底线（不挨着狗）→ 狐狸胜；任一方向都滑不出 → 兔子胜；满 MOVE_LIMIT 步 → 平局
 *
 * 动画说明：棋子移动动画走 render/anim.ts 旁路（progressSince），
 * 落点结果已经由 state 定好，不存在「动画中不可点击」的状态。
 */
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { COLORS, background, banner, disc, ease, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { progressSince } from '../../render/anim'
import meta from './meta'
import {
  COLS,
  DOG,
  EMPTY,
  FOX,
  MOVE_LIMIT,
  RABBIT,
  ROWS,
  aiAction,
  adjacentToHound,
  canSlide,
  colOf,
  create,
  idx,
  isExitCell,
  reduce,
  rowOf,
  slidesFrom,
  type Action,
  type Piece,
  type State,
} from './rules'

const VW = 720
const VH = 1280
/** 单格边长（逻辑像素），远大于 44 的触控下限 */
const CELL = 72
const BOARD_W = COLS * CELL
const BOARD_H = ROWS * CELL
const BOARD_X = (VW - BOARD_W) / 2
const BOARD_Y = 300
/** 棋子半径 */
const PIECE_R = 26
/** 一次滑行的动画时长 */
const SLIDE_MS = 190

const cellCenter = (cell: number): [number, number] => [
  BOARD_X + colOf(cell) * CELL + CELL / 2,
  BOARD_Y + rowOf(cell) * CELL + CELL / 2,
]

const PIECE_COLOR: Record<Piece, string> = {
  [EMPTY]: '#ffffff',
  [RABBIT]: '#f2f6fb',
  [FOX]: '#ff8a3d',
  [DOG]: '#4aa3ff',
}

function hitCell(x: number, y: number): number {
  const c = Math.floor((x - BOARD_X) / CELL)
  const r = Math.floor((y - BOARD_Y) / CELL)
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return -1
  return idx(c, r)
}

// ---------------- 文案 ----------------

function statusText(s: State): [string, string] {
  if (s.over) {
    if (s.winner === 'rabbit') return ['你赢了！', `狐狸在第 ${s.moves} 步被围死`]
    if (s.winner === 'fox') return ['狐狸逃走了', `电脑在第 ${s.moves} 步滑到底线`]
    return ['平局', `${MOVE_LIMIT} 步内谁也没能成功`]
  }
  if (s.turn === 'rabbit') return ['轮到你', '兔子先走，把狐狸的出口一个个堵上']
  return ['狐狸思考中', '它想抢到底线，而且不能挨着狗']
}

function tipText(s: State): string {
  if (s.over) return '点「新的一局」再来一次'
  if (s.turn !== 'rabbit') return '电脑正在算最佳的一步…'
  return s.selected >= 0 ? '点高亮格完成滑行，再点空处取消' : '点自己的兔子或狗，再点高亮落点'
}

// ---------------- 绘制 ----------------

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, '#12312f', '#0a1a1c')

  const [main, sub] = statusText(s)
  topBar(ctx, VW, main, `第 ${s.moves} 步`, 96)
  shadowText(ctx, sub, VW / 2, 146, { size: 26, color: COLORS.textDim, weight: 'normal' })

  drawSidePills(ctx, s)

  // 棋盘底板
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, BOARD_X - 14, BOARD_Y - 14, BOARD_W + 28, BOARD_H + 28, 22, '#0f2027')
  ctx.restore()
  fillRoundRect(ctx, BOARD_X - 14, BOARD_Y - 14, BOARD_W + 28, BOARD_H + 28, 22, 'rgba(255,255,255,0.04)', COLORS.line, 2)

  // 格子：棋盘格底色 + 两侧出口列高亮
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const exit = c === 0 || c === COLS - 1
      const base = (r + c) % 2 === 0 ? '#22414a' : '#1b353d'
      fillRoundRect(ctx, BOARD_X + c * CELL + 2, BOARD_Y + r * CELL + 2, CELL - 4, CELL - 4, 10, base)
      if (exit) {
        ctx.save()
        ctx.globalAlpha = 0.32
        fillRoundRect(ctx, BOARD_X + c * CELL + 2, BOARD_Y + r * CELL + 2, CELL - 4, CELL - 4, 10, COLORS.green)
        ctx.restore()
      }
      // 出口格的横线标记：暗示这是狐狸要抢的底线
      if (exit) {
        const [x, y] = cellCenter(idx(c, r))
        ctx.save()
        ctx.globalAlpha = s.board[idx(c, r)] === FOX ? 0.95 : 0.4
        text(ctx, '出口', x, y, { size: 17, color: '#c8f5d2' })
        ctx.restore()
      }
    }
  }

  drawMoveHighlight(ctx, s)
  drawSelection(ctx, s)
  drawPieces(ctx, s)

  drawLegend(ctx, s)

  fillRoundRect(ctx, 60, VH - 196, VW - 120, 104, 22, 'rgba(255,255,255,0.08)')
  text(ctx, tipText(s), VW / 2, VH - 144, { size: 29, weight: 'bold' })

  if (s.over) {
    banner(
      ctx,
      VW,
      VH,
      s.winner === 'rabbit' ? '胜利' : s.winner === 'fox' ? '失败' : '平局',
      main,
    )
  }
}

function drawSidePills(ctx: CanvasRenderingContext2D, s: State): void {
  const pill = (x: number, color: string, label: string, active: boolean): void => {
    fillRoundRect(
      ctx,
      x,
      178,
      260,
      66,
      20,
      active ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.07)',
      active ? color : COLORS.line,
      active ? 4 : 2,
    )
    disc(ctx, x + 44, 211, 15, color)
    text(ctx, label, x + 96, 213, { size: 27, align: 'left', weight: 'bold' })
  }
  pill(70, PIECE_COLOR[RABBIT], '你 · 兔子', !s.over && s.turn === 'rabbit')
  pill(390, PIECE_COLOR[FOX], '电脑 · 狐狸', !s.over && s.turn === 'fox')
}

/** 上一手的起点与落点 */
function drawMoveHighlight(ctx: CanvasRenderingContext2D, s: State): void {
  if (s.moves === 0 || s.lastFrom < 0 || s.lastTo < 0) return
  ctx.save()
  ctx.strokeStyle = withAlpha('#ffffff', 0.45)
  ctx.lineWidth = 3
  for (const cell of [s.lastFrom, s.lastTo]) {
    ctx.strokeRect(BOARD_X + colOf(cell) * CELL + 5, BOARD_Y + rowOf(cell) * CELL + 5, CELL - 10, CELL - 10)
  }
  ctx.restore()
}

/** 选中棋子 + 合法落点 + 滑行预览 */
function drawSelection(ctx: CanvasRenderingContext2D, s: State): void {
  if (s.over || s.turn !== 'rabbit' || s.selected < 0) return
  const [sx, sy] = cellCenter(s.selected)
  ctx.save()
  ctx.strokeStyle = COLORS.accent
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(sx, sy, PIECE_R + 7, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  const targets = slidesFrom(s.board, s.selected)
  for (const t of targets) {
    const [x, y] = cellCenter(t)
    disc(ctx, x, y, 13, COLORS.accent, { alpha: 0.55 })
  }

  if (s.hover >= 0 && targets.indexOf(s.hover) >= 0) {
    const [hx, hy] = cellCenter(s.hover)
    ctx.save()
    ctx.strokeStyle = withAlpha(COLORS.accent, 0.85)
    ctx.lineWidth = 5
    ctx.setLineDash([10, 10])
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(hx, hy)
    ctx.stroke()
    ctx.restore()
  }
}

/** 棋子：上一手的那枚按进度沿直线滑到落点 */
function drawPieces(ctx: CanvasRenderingContext2D, s: State): void {
  const sig = `${s.lastFrom}-${s.lastTo}-${s.moves}`
  const t = s.moves > 0 ? progressSince('rah-slide', sig, SLIDE_MS) : 1
  const sliding = s.moves > 0 && s.lastPiece !== EMPTY && t < 1

  const [fx, fy] = sliding ? cellCenter(s.lastFrom) : [0, 0]
  const [tx, ty] = sliding ? cellCenter(s.lastTo) : [0, 0]
  const k = ease.inOutCubic(t)

  for (let i = 0; i < s.board.length; i++) {
    const p = s.board[i]
    if (p === EMPTY) continue
    if (sliding && i === s.lastTo) continue
    const [x, y] = cellCenter(i)
    drawPiece(ctx, x, y, p, i === s.lastTo ? 1 - k * 0.35 : 1)
  }

  if (sliding) drawPiece(ctx, fx + (tx - fx) * k, fy + (ty - fy) * k, s.lastPiece, 1)
}

function drawPiece(ctx: CanvasRenderingContext2D, x: number, y: number, p: Piece, alpha: number): void {
  ctx.save()
  ctx.globalAlpha = alpha
  disc(ctx, x, y, PIECE_R, PIECE_COLOR[p], { ring: p === RABBIT ? '#9fb3cf' : 'rgba(0,0,0,0.4)' })
  if (p === RABBIT) {
    // 兔子的两只耳朵
    ctx.fillStyle = '#d7e3f2'
    ctx.beginPath()
    ctx.ellipse(x - 9, y - PIECE_R - 5, 5, 11, -0.35, 0, Math.PI * 2)
    ctx.ellipse(x + 9, y - PIECE_R - 5, 5, 11, 0.35, 0, Math.PI * 2)
    ctx.fill()
  } else if (p === FOX) {
    text(ctx, '狐', x, y + 1, { size: 22, color: '#5c2a05', weight: 'bold' })
  } else if (p === DOG) {
    text(ctx, '犬', x, y + 1, { size: 22, color: '#0c355f', weight: 'bold' })
  }
  ctx.restore()
}

function drawLegend(ctx: CanvasRenderingContext2D, s: State): void {
  const y = BOARD_Y + BOARD_H + 34
  fillRoundRect(ctx, 60, y, VW - 120, 132, 22, 'rgba(255,255,255,0.06)')
  const fox = s.board.indexOf(FOX)
  const guarded = fox >= 0 && isExitCell(fox) && adjacentToHound(s.board, fox)
  const line1 = '底线判胜：狐狸滑到左右两侧（绿格）即赢，但那一格不能挨着任何一只猎犬'
  const line2 = guarded
    ? '⚠ 狐狸已经站上底线，却正挨着猎犬——还不算赢'
    : '滑行只能落在该方向的第一个空格上：可以越过棋子，但不能压在棋子上'
  text(ctx, line1, VW / 2, y + 44, { size: 25, color: COLORS.textDim })
  text(ctx, line2, VW / 2, y + 88, {
    size: 25,
    color: guarded ? COLORS.accent : COLORS.textDim,
  })
}

// ---------------- 副作用 ----------------

function effects(prev: State, next: State): Effect[] {
  if (next.moves === prev.moves) return []
  const out: Effect[] = [{ kind: 'sound', name: 'place' }]
  const [x, y] = cellCenter(next.lastTo)
  out.push({ kind: 'burst', x, y, color: PIECE_COLOR[next.lastPiece], count: 10 })
  if (next.over) {
    out.push({ kind: 'sound', name: next.winner === 'rabbit' ? 'win' : next.winner === 'fox' ? 'lose' : 'click' })
    out.push({ kind: 'shake', power: 12 })
  }
  return out
}

function outcome(state: State): Outcome | null {
  if (!state.over) return null
  // 玩家越快围死狐狸越好
  return { score: state.moves, better: 'lower', unit: ' 步', win: state.winner === 'rabbit' }
}

// ---------------- 输入 ----------------

function input(state: State, p: PointerInput): Action | null {
  if (state.over || state.turn !== 'rabbit') return null
  const cell = hitCell(p.x, p.y)

  if (p.kind === 'move' && !p.pressed) return { type: 'hover', cell }

  if (p.kind === 'down' || p.kind === 'up') {
    // 已选中且点的是合法落点 → 滑行（先按下后松手也能完成拖拽式操作）
    if (cell >= 0 && state.selected >= 0 && canSlide(state.board, state.selected, cell)) {
      return { type: 'slide', from: state.selected, to: cell }
    }
    if (p.kind === 'down') {
      if (cell < 0) return state.selected !== -1 ? { type: 'clear' } : null
      if (state.board[cell] === RABBIT || state.board[cell] === DOG) {
        return slidesFrom(state.board, cell).length > 0 ? { type: 'select', cell } : { type: 'clear' }
      }
      return state.selected !== -1 ? { type: 'clear' } : null
    }
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
  effects,
  outcome,
  hint: (s) => (s.over ? `本局结束：${s.moves} 步，点「新的一局」再来一次` : statusText(s)[1]),
  aiDelay: 420,
}

export default game
