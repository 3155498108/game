/**
 * 狐犬棋（Hare and Hounds）：渲染 + 输入映射。
 * 规则全在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas、把指针翻译成 action。
 *
 * 坐标与裁决（与 rules.ts 一一对应）：
 * - 棋盘 5 行 × 7 列：COLS=7 从左到右、ROWS=5 从上到下，idx(c,r) = r*COLS+c
 * - 只有 27 个点真实存在（ROW_MASK）：中间三行铺满 7 列，最上/最下两行只有中间 3 列，
 *   于是左右两端各收成一个尖角，而左端正好 3 点 —— 3 只猎犬一字排开就是一道无缝墙
 * - 走子 = 走到**相邻一个空棋点**（横/竖/斜），猎犬额外禁止后退（目标列不能更小）
 * - 胜负：围死兔子 → 猎犬胜；兔子越过犬阵最前缘 → 兔子胜；见 rules.ts 的 winnerOf
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
  EMPTY,
  HARE,
  HOUND,
  MOVE_LIMIT,
  ROWS,
  STALL_LIMIT,
  aiAction,
  canStep,
  colOf,
  create,
  idx,
  isPlayable,
  neighborsOf,
  rearmostHoundCol,
  reduce,
  rowOf,
  stepsFrom,
  type Action,
  type Piece,
  type State,
} from './rules'

const VW = 720
const VH = 1280
/** 单格边长（逻辑像素），远大于 44 的触控下限 */
const CELL = 96
const BOARD_W = COLS * CELL
const BOARD_H = ROWS * CELL
const BOARD_X = (VW - BOARD_W) / 2
const BOARD_Y = 300
/** 棋子半径 */
const PIECE_R = 34
/** 走一步的动画时长 */
const STEP_MS = 160

/**
 * 开局「选阵营」的两张卡。
 *
 * 选边放在画布上而不是壳层的 `controls()`：它是一次性的开局选择、不是常驻工具栏，
 * 而 `controls()` 的按钮会在整局里一直挂着，反而挡棋盘。
 */
const CARD_Y = 820
const CARD_H = 150
const CARD_W = 290
const CARD_GAP = 30
const CARD_TOP = CARD_Y - CARD_H / 2

function cardRect(i: number): [number, number, number, number] {
  const total = CARD_W * 2 + CARD_GAP
  const x = (VW - total) / 2 + i * (CARD_W + CARD_GAP)
  return [x, CARD_TOP, CARD_W, CARD_H]
}

const cellCenter = (cell: number): [number, number] => [
  BOARD_X + colOf(cell) * CELL + CELL / 2,
  BOARD_Y + rowOf(cell) * CELL + CELL / 2,
]

const PIECE_COLOR: Record<Piece, string> = {
  [EMPTY]: '#ffffff',
  [HOUND]: '#4aa3ff',
  [HARE]: '#f2f6fb',
}

const HOUND_COLOR = PIECE_COLOR[HOUND]
const HARE_COLOR = PIECE_COLOR[HARE]

function hitCell(x: number, y: number): number {
  const c = Math.floor((x - BOARD_X) / CELL)
  const r = Math.floor((y - BOARD_Y) / CELL)
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return -1
  return isPlayable(idx(c, r)) ? idx(c, r) : -1
}

/** 点到了哪张阵营卡（-1 / 0 / 1） */
function hitCard(x: number, y: number): number {
  for (let i = 0; i < 2; i++) {
    const [cx, cy, cw, ch] = cardRect(i)
    if (x >= cx && x <= cx + cw && y >= cy && y <= cy + ch) return i
  }
  return -1
}

// ---------------- 文案 ----------------

/** 玩家的胜利条件 = 玩家执子那一方获胜 */
function playerWon(s: State): boolean {
  return s.winner === s.playerSide
}

function statusText(s: State): [string, string] {
  if (s.playerSide === null) return ['先选你的棋子', '选完就开始，猎犬永远先走']
  const me = s.playerSide
  if (s.over) {
    if (s.winner === 'none') return ['平局', `${MOVE_LIMIT} 步内谁也没能成功`]
    if (s.winner === 'draw') return ['平局', `${MOVE_LIMIT} 步内谁也没能成功`]
    if (playerWon(s)) {
      return me === 'hounds'
        ? ['围住了！', `第 ${s.moves} 步把兔子逼得无路可走`]
        : ['你绕出去了！', `第 ${s.moves} 步绕到了犬阵左后方`]
    }
    return me === 'hounds'
      ? ['兔子绕出去了', `第 ${s.moves} 步它跑到了你犬阵的左后方`]
      : ['你被围住了', `第 ${s.moves} 步无路可走`]
  }
  if (s.turn === me) {
    return me === 'hounds'
      ? ['轮到你', '点一只犬，再点高亮的一格；别原地横移']
      : ['轮到你', '点兔子，再点高亮的一格；往绿区挤']
  }
  return me === 'hounds'
    ? ['电脑在绕', '兔子会想办法跑到你犬阵的左后方']
    : ['电脑在围', '三只犬会把你往墙角挤，注意别被围死']
}

function tipText(s: State): string {
  if (s.playerSide === null) return '点一张卡选边'
  if (s.over) return '点「新的一局」再来一次'
  const me = s.playerSide
  if (s.turn !== me) return '电脑正在算最佳的一步…'
  // 磨洋工的警告只对执犬的玩家有意义
  if (me === 'hounds' && s.sideStreak >= STALL_LIMIT - 3) {
    return `别再横移了！再磨 ${STALL_LIMIT - s.sideStreak} 步就算你输`
  }
  if (s.selected >= 0) return '点高亮格走一步，点空处取消'
  return me === 'hounds' ? '点一只猎犬，它能去的地方会亮出来' : '点兔子，它能去的地方会亮出来'
}

// ---------------- 绘制 ----------------

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, '#12312f', '#0a1a1c')

  const [main, sub] = statusText(s)
  topBar(ctx, VW, main, `第 ${s.moves} 步`, 96)
  shadowText(ctx, sub, VW / 2, 146, { size: 26, color: COLORS.textDim, weight: 'normal' })

  drawSidePills(ctx, s)
  drawBoard(ctx, s)
  drawSelection(ctx, s)
  drawPieces(ctx, s)
  if (s.playerSide === null) drawCards(ctx, s)
  else drawLegend(ctx, s)

  fillRoundRect(ctx, 60, VH - 196, VW - 120, 104, 22, 'rgba(255,255,255,0.08)')
  text(ctx, tipText(s), VW / 2, VH - 144, { size: 29, weight: 'bold' })

  if (s.over) {
    banner(ctx, VW, VH, playerWon(s) ? '胜利' : s.winner === 'draw' ? '平局' : '失败', main)
  }
}

/** 开局选阵营的两张卡 */
function drawCards(ctx: CanvasRenderingContext2D, s: State): void {
  const rows: Array<[string, string, string, string]> = [
    ['三只猎犬', '你执 3 子，把兔子逼到墙角', HOUND_COLOR, '较难'],
    ['一只兔子', '你执 1 子，绕到犬阵左后方', HARE_COLOR, '较易'],
  ]
  rows.forEach(([title, desc, color, tag], i) => {
    const [x, y, w, h] = cardRect(i)
    const hovered = s.hover === 100 + i
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 22
    ctx.shadowOffsetY = 8
    fillRoundRect(ctx, x, y, w, h, 24, hovered ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.07)')
    ctx.restore()
    fillRoundRect(ctx, x, y, w, h, 24, 'rgba(0,0,0,0)', hovered ? color : COLORS.line, hovered ? 3 : 2)
    disc(ctx, x + 44, y + 52, 18, color)
    text(ctx, title, x + 76, y + 58, { size: 30, align: 'left', weight: 'bold' })
    text(ctx, tag, x + w - 20, y + 34, { size: 22, align: 'right', color })
    text(ctx, desc, x + w / 2, y + 108, { size: 21, color: COLORS.textDim })
  })
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
  const you = s.playerSide
  pill(70, HOUND_COLOR, you === 'hounds' ? '你 · 三只犬' : '电脑 · 三只犬', you === 'hounds' && !s.over && s.turn === 'hounds')
  pill(390, HARE_COLOR, you === 'hare' ? '你 · 兔子' : '电脑 · 兔子', you === 'hare' && !s.over && s.turn === 'hare')
}

/** 底板 + 棋点连线 + 棋点圆点 + 动态逃脱区 */
function drawBoard(ctx: CanvasRenderingContext2D, s: State): void {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, BOARD_X - 14, BOARD_Y - 14, BOARD_W + 28, BOARD_H + 28, 22, '#0f2027')
  ctx.restore()
  fillRoundRect(ctx, BOARD_X - 14, BOARD_Y - 14, BOARD_W + 28, BOARD_H + 28, 22, 'rgba(255,255,255,0.04)', COLORS.line, 2)

  // 连线：相邻棋点之间画细线，这是「只能走到相邻一格」的直观表达（只有横竖，没有斜线）
  ctx.save()
  ctx.strokeStyle = withAlpha('#8fd6ff', 0.22)
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const from = idx(c, r)
      if (!isPlayable(from)) continue
      const [fx, fy] = cellCenter(from)
      for (const to of neighborsOf(from)) {
        // 只画右 / 下方向，避免斜边被画两遍
        if (colOf(to) < c || (colOf(to) === c && rowOf(to) < r)) continue
        const [tx, ty] = cellCenter(to)
        ctx.beginPath()
        ctx.moveTo(fx, fy)
        ctx.lineTo(tx, ty)
        ctx.stroke()
      }
    }
  }
  ctx.restore()

  // 逃脱区：所有位于「犬阵最后一只犬」左边的棋点。
  // 猎犬每向右推进一步，这块绿区就大一分 —— 规则不用文字讲，看图就懂。
  const rear = rearmostHoundCol(s.board)
  ctx.save()
  ctx.globalAlpha = 0.22
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c >= rear || !isPlayable(idx(c, r))) continue
      const [x, y] = cellCenter(idx(c, r))
      disc(ctx, x, y, 30, COLORS.green)
    }
  }
  ctx.restore()

  // 棋点圆点
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = idx(c, r)
      if (!isPlayable(cell)) continue
      const [x, y] = cellCenter(cell)
      disc(ctx, x, y, 6, withAlpha('#8fd6ff', 0.32))
    }
  }

  // 犬阵最后面那条线：兔子越过它就赢了
  if (rear > 0) {
    const x = BOARD_X + (rear - 0.5) * CELL
    ctx.save()
    ctx.strokeStyle = withAlpha(COLORS.green, 0.75)
    ctx.lineWidth = 3
    ctx.setLineDash([9, 9])
    ctx.beginPath()
    ctx.moveTo(x, BOARD_Y + 4)
    ctx.lineTo(x, BOARD_Y + BOARD_H - 4)
    ctx.stroke()
    ctx.restore()
  }

  // 上一手的起讫点
  if (s.moves > 0 && s.lastFrom >= 0 && s.lastTo >= 0) {
    ctx.save()
    ctx.strokeStyle = withAlpha('#ffffff', 0.4)
    ctx.lineWidth = 3
    for (const cell of [s.lastFrom, s.lastTo]) {
      const [x, y] = cellCenter(cell)
      ctx.beginPath()
      ctx.arc(x, y, PIECE_R + 8, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }
}

/** 选中棋子 + 合法落点 + 预览连线 */
function drawSelection(ctx: CanvasRenderingContext2D, s: State): void {
  if (s.over || s.turn !== 'hounds' || s.selected < 0) return
  const [sx, sy] = cellCenter(s.selected)
  ctx.save()
  ctx.strokeStyle = COLORS.accent
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(sx, sy, PIECE_R + 8, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  const targets = stepsFrom(s.board, s.selected, HOUND)
  for (const t of targets) {
    const [x, y] = cellCenter(t)
    disc(ctx, x, y, 17, COLORS.accent, { alpha: 0.5 })
    disc(ctx, x, y, 7, withAlpha('#ffffff', 0.85))
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

/** 棋子：上一手的那枚按进度从起点走到落点 */
function drawPieces(ctx: CanvasRenderingContext2D, s: State): void {
  const sig = `${s.lastFrom}-${s.lastTo}-${s.moves}`
  const t = s.moves > 0 ? progressSince('rah-step', sig, STEP_MS) : 1
  const moving = s.moves > 0 && s.lastPiece !== EMPTY && t < 1

  const [fx, fy] = moving ? cellCenter(s.lastFrom) : [0, 0]
  const [tx, ty] = moving ? cellCenter(s.lastTo) : [0, 0]
  const k = ease.outCubic(t)

  for (let i = 0; i < s.board.length; i++) {
    const p = s.board[i]
    if (p === EMPTY) continue
    if (moving && i === s.lastTo) continue
    const [x, y] = cellCenter(i)
    drawPiece(ctx, x, y, p, i === s.lastTo ? 1 - k * 0.4 : 1)
  }

  if (moving) drawPiece(ctx, fx + (tx - fx) * k, fy + (ty - fy) * k, s.lastPiece, 1)
}

function drawPiece(ctx: CanvasRenderingContext2D, x: number, y: number, p: Piece, alpha: number): void {
  ctx.save()
  ctx.globalAlpha = alpha
  disc(ctx, x, y, PIECE_R, PIECE_COLOR[p], { ring: p === HARE ? '#9fb3cf' : 'rgba(0,0,0,0.4)' })
  if (p === HARE) {
    // 兔子的两只耳朵
    ctx.fillStyle = '#d7e3f2'
    ctx.beginPath()
    ctx.ellipse(x - 12, y - PIECE_R - 7, 7, 15, -0.35, 0, Math.PI * 2)
    ctx.ellipse(x + 12, y - PIECE_R - 7, 7, 15, 0.35, 0, Math.PI * 2)
    ctx.fill()
  } else {
    text(ctx, '犬', x, y + 1, { size: 28, color: '#0c355f', weight: 'bold' })
  }
  ctx.restore()
}

function drawLegend(ctx: CanvasRenderingContext2D, s: State): void {
  const y = 828
  const me = s.playerSide
  fillRoundRect(ctx, 60, y, VW - 120, 190, 22, 'rgba(255,255,255,0.06)')
  const l1 = me === 'hare' ? '你执一只兔子：一次只走到相邻一格，往左挤' : '你执三只猎犬：一次只走到相邻一格，不能后退'
  const l2 = me === 'hare' ? '跑到绿区（犬阵左后方）= 你赢；被围死 = 你输' : '把兔子逼得无路可走 = 你赢；绿区是兔子想绕过去的地方'
  text(ctx, l1, VW / 2, y + 42, { size: 25, color: COLORS.textDim })
  text(ctx, l2, VW / 2, y + 86, { size: 25, color: COLORS.textDim })
  const stalled = s.sideStreak >= STALL_LIMIT - 3
  const line3 = stalled
    ? `⚠ 猎犬已经横移 ${s.sideStreak} 步，再磨 ${STALL_LIMIT - s.sideStreak} 步兔子就赢了`
    : '猎犬不能后退，兔子绕到左后方就再也追不上了'
  text(ctx, line3, VW / 2, y + 134, { size: 25, color: stalled ? COLORS.accent : COLORS.textDim })
}

// ---------------- 副作用 ----------------

function effects(prev: State, next: State): Effect[] {
  if (next.moves === prev.moves) return []
  const out: Effect[] = [{ kind: 'sound', name: 'place' }]
  const [x, y] = cellCenter(next.lastTo)
  out.push({ kind: 'burst', x, y, color: PIECE_COLOR[next.lastPiece], count: 10 })
  if (next.over) {
    const win = playerWon(next)
    out.push({
      kind: 'sound',
      name: next.winner === 'draw' ? 'click' : win ? 'win' : 'lose',
    })
    out.push({ kind: 'shake', power: 12 })
  }
  return out
}

function outcome(state: State): Outcome | null {
  if (!state.over) return null
  // 越快结束越好（围死 / 绕出去都算）
  return { score: state.moves, better: 'lower', unit: ' 步', win: playerWon(state) }
}

// ---------------- 输入 ----------------

/** hover 用的伪格号：100 / 101 代表两张卡（避开棋盘的 0~34） */
const CARD_HOVER_BASE = 100

function input(state: State, p: PointerInput): Action | null {
  // 开局选阵营：整块棋盘都不可点，只有两张卡有效
  if (state.playerSide === null) {
    const i = hitCard(p.x, p.y)
    if (p.kind === 'move' && !p.pressed) return { type: 'hover', cell: i >= 0 ? CARD_HOVER_BASE + i : -1 }
    if ((p.kind === 'down' || p.kind === 'up') && i >= 0) return { type: 'choose', side: i === 0 ? 'hounds' : 'hare' }
    return null
  }
  if (state.over || state.turn !== state.playerSide) return null
  const mine = state.playerSide === 'hounds' ? HOUND : HARE
  const cell = hitCell(p.x, p.y)

  if (p.kind === 'move' && !p.pressed) return { type: 'hover', cell }

  if (p.kind === 'down' || p.kind === 'up') {
    // 已选中且点的是合法落点 → 走一步（按下或松手都能完成，点两下或拖拽都行）
    if (cell >= 0 && state.selected >= 0 && canStep(state.board, state.selected, cell, mine)) {
      return { type: 'step', from: state.selected, to: cell }
    }
    if (p.kind === 'down') {
      if (cell < 0) return state.selected !== -1 ? { type: 'clear' } : null
      if (state.board[cell] === mine) {
        return stepsFrom(state.board, cell, mine).length > 0 ? { type: 'select', cell } : { type: 'clear' }
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
  hint: (s) => (s.playerSide === null ? '开局先选一边：三只犬较难，一只兔子较易' : s.over ? `本局结束：${s.moves} 步，点「新的一局」再来一次` : statusText(s)[1]),
  aiDelay: 420,
}

export default game
