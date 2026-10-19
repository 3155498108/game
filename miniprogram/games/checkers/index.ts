/**
 * 西洋跳棋渲染 + 输入映射。
 * 规则全在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas、把指针翻译成 action。
 *
 * 动画说明：棋子移动动画走 render/anim.ts 旁路（elapsedSince），
 * 落点结果已经由 state 定好，不存在「动画中不可点击」的状态。
 */
import type { Effect, GameModule, PointerInput } from '../../core/types'
import type { Rect } from '../../core/geom'
import { COLORS, background, banner, disc, ease, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { elapsedSince, keepAlive, pulse } from '../../render/anim'
import meta from './meta'
import {
  CELL_COUNT,
  SIZE,
  aiSearch,
  bestMoveFrom,
  colOf,
  create,
  idx,
  isDark,
  isKing,
  legalMoves,
  moveToAction,
  ownerOf,
  reduce,
  rowOf,
  type Action,
  type Cell,
  type LastMove,
  type Player,
  type State,
} from './rules'

const VW = 720
const VH = 1280
const CELL = 78
const BOARD_W = SIZE * CELL
const BOARD_X = (VW - BOARD_W) / 2
const BOARD_Y = 288
/** 棋盘外框，命中判定与渲染共用，保证坐标永远一致 */
const BOARD_RECT: Rect = { x: BOARD_X - 16, y: BOARD_Y - 16, w: BOARD_W + 32, h: BOARD_W + 32 }
/** 每一跳的动画时长 */
const STEP_MS = 130
const SIDE_COLOR: Record<Player, string> = { 1: '#20202a', 2: '#d63b32' }
const SIDE_RING: Record<Player, string> = { 1: '#f0e0b8', 2: '#ffd9a0' }

const cellCenter = (square: number): [number, number] => [
  BOARD_X + colOf(square) * CELL + CELL / 2,
  BOARD_Y + rowOf(square) * CELL + CELL / 2,
]

function pieceColor(c: Cell): string {
  const o = ownerOf(c)
  return SIDE_COLOR[o === 0 ? 1 : o]
}

function hitSquare(x: number, y: number): number {
  const c = Math.floor((x - BOARD_X) / CELL)
  const r = Math.floor((y - BOARD_Y) / CELL)
  if (c < 0 || c >= SIZE || r < 0 || r >= SIZE) return -1
  return isDark(c, r) ? idx(c, r) : -1
}

// ---------------- 文案 ----------------

function statusText(s: State): [string, string] {
  if (s.over) {
    if (s.winner === 1) return ['你赢了！', `你吃掉了对方 ${s.takenBy1} 颗棋子`]
    return ['电脑获胜', `它吃掉了你 ${s.takenBy2} 颗棋子`]
  }
  if (s.turn === 1) {
    const moves = legalMoves(s)
    if (moves.length > 0 && moves[0].captures.length > 0) return ['轮到你 · 必须吃子', '先点那颗能吃的棋子，再点落点']
    return ['轮到你', '点棋子选中，再点高亮落点走一步']
  }
  return ['电脑思考中', '它会优先吃子、抢升变']
}

// ---------------- 动画（旁路缓存，不进 state） ----------------

interface MoveAnim {
  last: LastMove
  /** 0~1 线性进度 */
  raw: number
  steps: number
  /** 当前所在段（0 起） */
  seg: number
  /** 段内 0~1 进度（带缓动） */
  t: number
}

function moveAnim(s: State): MoveAnim | null {
  const last = s.last
  if (last === null) return null
  const steps = Math.max(1, last.path.length - 1)
  const dur = steps * STEP_MS
  const raw = Math.min(1, elapsedSince('ck-move', String(s.moves), dur) / dur)
  const stepF = raw * steps
  const seg = Math.min(steps - 1, Math.floor(stepF))
  return { last, raw, steps, seg, t: ease.inOutQuad(Math.min(1, stepF - seg)) }
}

/** 在任意坐标画一枚棋子（王 = 内环 + 冠点） */
function drawPieceAt(ctx: CanvasRenderingContext2D, x: number, y: number, c: Cell, r: number, alpha = 1): void {
  disc(ctx, x, y, r, pieceColor(c), { alpha })
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = SIDE_RING[ownerOf(c) as Player]
  ctx.lineWidth = Math.max(2, r * 0.09)
  ctx.beginPath()
  ctx.arc(x, y, r * 0.93, 0, Math.PI * 2)
  ctx.stroke()
  if (isKing(c)) {
    ctx.strokeStyle = '#ffcc33'
    ctx.lineWidth = Math.max(3, r * 0.16)
    ctx.beginPath()
    ctx.arc(x, y, r * 0.5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#ffcc33'
    ctx.beginPath()
    ctx.arc(x, y, r * 0.16, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawPiece(ctx: CanvasRenderingContext2D, square: number, c: Cell, r: number, alpha = 1): void {
  const [x, y] = cellCenter(square)
  drawPieceAt(ctx, x, y, c, r, alpha)
}

// ---------------- 渲染 ----------------

function render(ctx: CanvasRenderingContext2D, state: State): void {
  keepAlive()
  background(ctx, VW, VH, '#2c3f52', '#131c26')

  const [main, sub] = statusText(state)
  topBar(ctx, VW, main, `第 ${state.moves} 步`, 92)
  shadowText(ctx, sub, VW / 2, 142, { size: 25, color: COLORS.textDim, weight: 'normal' })
  drawSides(ctx, state)

  // 棋盘底板
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, BOARD_RECT.x, BOARD_RECT.y, BOARD_RECT.w, BOARD_RECT.h, 22, withAlpha('#0a1620', 0.95))
  ctx.restore()
  fillRoundRect(ctx, BOARD_RECT.x, BOARD_RECT.y, BOARD_RECT.w, BOARD_RECT.h, 22, 'rgba(255,255,255,0.07)', COLORS.line, 2)

  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const hot = idx(col, row) === state.selected
      ctx.fillStyle = hot ? withAlpha('#ffcc33', 0.34) : isDark(col, row) ? '#9c6b43' : '#efdcc0'
      ctx.fillRect(BOARD_X + col * CELL, BOARD_Y + row * CELL, CELL, CELL)
    }
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = 1
  for (let k = 1; k < SIZE; k++) {
    ctx.beginPath()
    ctx.moveTo(BOARD_X + k * CELL, BOARD_Y)
    ctx.lineTo(BOARD_X + k * CELL, BOARD_Y + BOARD_W)
    ctx.moveTo(BOARD_X, BOARD_Y + k * CELL)
    ctx.lineTo(BOARD_X + BOARD_W, BOARD_Y + k * CELL)
    ctx.stroke()
  }

  const moves = legalMoves(state)
  const anim = moveAnim(state)

  // 可落点提示（选中某子后只提示那一颗的落点）
  if (!state.over && state.turn === 1) {
    const shown = state.selected >= 0 ? moves.filter((m) => m.from === state.selected) : moves
    for (const m of shown) {
      const to = m.path[m.path.length - 1]
      if (to === m.from) continue
      const jump = m.path.length > 1
      const [x, y] = cellCenter(to)
      disc(ctx, x, y, CELL * (jump ? 0.24 : 0.15), COLORS.accent, { alpha: jump ? 0.4 : 0.2 })
    }
  }

  // 上一步路径
  if (anim !== null && anim.raw < 1) {
    for (let k = 1; k < anim.last.path.length; k++) {
      const [x, y] = cellCenter(anim.last.path[k])
      ctx.save()
      ctx.globalAlpha = 0.5
      ctx.strokeStyle = COLORS.accent
      ctx.lineWidth = 3
      ctx.setLineDash([6, 6])
      ctx.beginPath()
      ctx.arc(x, y, CELL * 0.3, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  // 被吃掉的棋子：逐跳消散
  if (anim !== null) {
    const stepF = anim.raw * anim.steps
    for (let k = 0; k < anim.last.captures.length; k++) {
      const local = stepF - k
      if (local <= 0 || local >= 1) continue
      const a = 1 - Math.min(1, local / 0.45)
      if (a <= 0) continue
      drawPiece(ctx, anim.last.captures[k], anim.last.victims[k], CELL * 0.37 * (0.55 + 0.45 * a), a * 0.9)
    }
  }

  // 盘面棋子（正在飞行的落点格交给动画棋子接管）
  const skip = anim !== null && anim.raw < 1 ? anim.last.path[anim.last.path.length - 1] : -1
  const beat = 0.5 + 0.5 * pulse(1400)
  for (let i = 0; i < CELL_COUNT; i++) {
    const c = state.board[i]
    if (c === 0 || i === skip) continue
    drawPiece(ctx, i, c, CELL * 0.37)
    if (i === state.selected) {
      const [x, y] = cellCenter(i)
      ctx.save()
      ctx.globalAlpha = 0.35 + 0.35 * beat
      ctx.strokeStyle = COLORS.accent
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.arc(x, y, CELL * 0.44, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  // 飞行中的棋子：落点已由 state 定好，这里只补一段逐格位移
  if (anim !== null && anim.raw < 1 && state.board[skip] !== 0) {
    const [ax, ay] = cellCenter(anim.last.path[anim.seg])
    const [bx, by] = cellCenter(anim.last.path[anim.seg + 1])
    drawPieceAt(ctx, ax + (bx - ax) * anim.t, ay + (by - ay) * anim.t, state.board[skip], CELL * 0.37)
  }

  drawFooter(ctx, state)

  if (state.over) {
    banner(ctx, VW, VH, state.winner === 1 ? '胜利' : '失败', main, state.winner === 1 ? COLORS.accent : COLORS.red)
  }
}

function drawSides(ctx: CanvasRenderingContext2D, s: State): void {
  const pill = (x: number, player: Player, label: string, active: boolean): void => {
    fillRoundRect(ctx, x, 176, 300, 62, 18, active ? 'rgba(255,204,51,0.18)' : 'rgba(255,255,255,0.07)')
    disc(ctx, x + 38, 207, 17, SIDE_COLOR[player])
    text(ctx, label, x + 168, 208, { size: 24, weight: 'bold', color: active ? COLORS.accent : COLORS.text })
  }
  pill(60, 1, `你 · 吃 ${s.takenBy1}`, !s.over && s.turn === 1)
  pill(360, 2, `电脑 · 吃 ${s.takenBy2}`, !s.over && s.turn === 2)
}

function drawFooter(ctx: CanvasRenderingContext2D, s: State): void {
  const y = BOARD_RECT.y + BOARD_RECT.h + 30
  const tip = s.over
    ? '点「新的一局」再来一次'
    : s.turn === 1
      ? '规则：有子可吃必须吃，连吃停在底线升变'
      : '电脑正在算最佳一步…'
  fillRoundRect(ctx, 60, y, VW - 120, 110, 22, 'rgba(255,255,255,0.08)')
  text(ctx, tip, VW / 2, y + 55, { size: 27, weight: 'bold' })
}

// ---------------- 输入 ----------------

function input(state: State, p: PointerInput): Action | null {
  if (state.over || state.turn !== 1) return null
  if (p.kind !== 'down') return null
  const sq = hitSquare(p.x, p.y)
  if (sq < 0) return state.selected !== -1 ? { type: 'clear' } : null
  if (state.selected >= 0) {
    const mv = bestMoveFrom(state, state.selected, sq)
    if (mv !== null) return moveToAction(mv)
  }
  if (ownerOf(state.board[sq]) === 1) {
    return legalMoves(state).some((m) => m.from === sq) ? { type: 'select', square: sq } : null
  }
  return state.selected !== -1 ? { type: 'clear' } : null
}

// ---------------- 副作用与成绩 ----------------

function effects(prev: State, next: State): Effect[] {
  if (next.moves === prev.moves) {
    return prev.selected !== next.selected ? [{ kind: 'sound', name: 'click' }] : []
  }
  const last = next.last
  const cap = last === null ? 0 : last.captures.length
  const landing = last === null ? -1 : last.path[last.path.length - 1]

  if (next.over) {
    const out: Effect[] =
      next.winner === 1
        ? [
            { kind: 'sound', name: 'win' },
            { kind: 'flash', color: 'rgba(255,204,51,0.3)' },
          ]
        : [
            { kind: 'sound', name: 'lose' },
            { kind: 'shake', power: 9 },
          ]
    if (last !== null) {
      for (const sq of last.captures) {
        const [x, y] = cellCenter(sq)
        out.push({ kind: 'burst', x, y, color: COLORS.accent, count: 18 })
      }
    }
    return out
  }

  if (cap > 0) {
    const out: Effect[] = [{ kind: 'sound', name: cap >= 3 ? 'score' : 'hit' }]
    if (landing >= 0) {
      const [x, y] = cellCenter(landing)
      out.push({ kind: 'burst', x, y, color: COLORS.accent, count: 10 + cap * 6 })
      if (cap >= 3) out.push({ kind: 'shake', power: 6 })
    }
    return out
  }

  if (last !== null && last.promoted && landing >= 0) {
    const [x, y] = cellCenter(landing)
    return [
      { kind: 'sound', name: 'flip' },
      { kind: 'burst', x, y, color: COLORS.accent, count: 24 },
    ]
  }

  return [{ kind: 'sound', name: 'place' }]
}

function outcome(state: State) {
  if (!state.over) return null
  return {
    score: state.winner === 1 ? 1 : 0,
    better: 'higher' as const,
    unit: ' 胜',
    win: state.winner === 1,
  }
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  aiAction: (s) => {
    const info = aiSearch(s)
    return info === null ? null : info.action
  },
  input,
  effects,
  outcome,
  hint: (s) => {
    if (s.over) return s.winner === 1 ? '你赢了，点「新的一局」再来一盘' : '这局输了，点「新的一局」再来一盘'
    if (s.turn === 2) return '电脑思考中…'
    const moves = legalMoves(s)
    if (moves.length > 0 && moves[0].captures.length > 0) return '你必须吃子：先点那颗能吃的棋子，再点落点'
    return '轮到你：点棋子选中，再点高亮落点'
  },
  controls: (s) => (s.over || s.turn !== 1 ? [] : [{ label: '提示', action: { type: 'hint' }, primary: true }]),
  aiDelay: 300,
}

export default game
