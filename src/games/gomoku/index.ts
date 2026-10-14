/**
 * 五子棋渲染 + 输入映射。
 * 规则与 AI 全在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas 以及把指针翻译成 action。
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { COLORS, background, banner, darken, disc, ease, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { elapsedSince, progressSince, tweenTo } from '../../render/anim'
import type { Rect } from '../../core/geom'
import { clamp, inRect } from '../../core/geom'
import meta from './meta'
import { HUMAN, SIZE, advise, aiAction, colOf, create, idx, reduce, rowOf, type Action, type State } from './rules'

const VW = 720
const VH = 1280

/** 棋盘四周留白：15 条线摊在 720 - 2×36 = 648 的宽度里 */
const PAD = 36
/** 单格间距 ≈46.3 逻辑像素 ≥ 44，满足最小触控目标 */
const CELL = (VW - PAD * 2) / (SIZE - 1)
/** 第一行（row 0，最上面）格心的 y */
const BOARD_Y = 258

/** 棋盘底板（含外边距）：渲染与命中判定共用同一份坐标 */
const PANEL: Rect = { x: PAD - 24, y: BOARD_Y - 24, w: VW - (PAD - 24) * 2, h: (SIZE - 1) * CELL + 48 }

/** 星位（天元 + 四星） */
const STARS: readonly number[] = [idx(3, 3), idx(11, 3), idx(7, 7), idx(3, 11), idx(11, 11)]

const cellX = (cell: number): number => PAD + colOf(cell) * CELL
const cellY = (cell: number): number => BOARD_Y + rowOf(cell) * CELL

/** 提示按钮的建议落点缓存：同一局面只算一次，避免每次状态变化都重跑一遍搜索 */
let adviseMemo = { key: '', cell: -1 }

function adviseCell(s: State): number {
  const key = `${s.turn}:${s.moves}:${s.board.join('')}`
  if (adviseMemo.key !== key) adviseMemo = { key, cell: advise(s) }
  return adviseMemo.cell
}

/** 逻辑坐标 → 棋格索引；每格热区正好是 CELL（≈46px）见方 */
function cellAt(x: number, y: number): number {
  const col = Math.round((x - PAD) / CELL)
  const row = Math.round((y - BOARD_Y) / CELL)
  if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return -1
  return idx(col, row)
}

const stoneColor = (v: 1 | 2): string => (v === 1 ? COLORS.black : COLORS.white)

function statusText(s: State): [string, string] {
  if (s.over) {
    if (s.winner === 1) return ['你赢了！', `第 ${s.moves} 手连成五子，黑棋执胜`]
    if (s.winner === 2) return ['电脑获胜', '再来一局，这次记得提前堵住它的四']
    return ['平局', '棋盘下满了，谁也没能连成五子']
  }
  if (s.turn === HUMAN) return ['轮到你', '黑棋先行，点棋盘任意空点落子']
  return ['电脑思考中', '它会先取胜，再堵你的冲四与活三']
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  background(ctx, VW, VH, '#1e6b46', '#0c3524')

  const [main, sub] = statusText(state)
  topBar(ctx, VW, main, `第 ${state.moves} 手`, 96)
  shadowText(ctx, sub, VW / 2, 146, { size: 24, color: COLORS.textDim, weight: 'normal' })
  drawLegend(ctx, 196)

  drawBoard(ctx, state)

  // 底部状态卡
  fillRoundRect(ctx, 60, 962, VW - 120, 106, 22, 'rgba(0,0,0,0.22)')
  text(ctx, bottomTip(state), VW / 2, 1004, { size: 27, weight: 'bold' })
  text(ctx, '规则：横竖斜任意方向连成五子即胜 · 无禁手', VW / 2, 1044, { size: 20, color: COLORS.textDim })

  if (state.over) {
    const title = state.winner === 1 ? '胜利' : state.winner === 2 ? '失败' : '平局'
    banner(ctx, VW, VH, title, main, state.winner === 1 ? COLORS.accent : state.winner === 2 ? COLORS.red : COLORS.text)
  }
}

function bottomTip(s: State): string {
  if (s.over) return s.winner === 0 ? '棋盘已满，本局平手' : `本局共 ${s.moves} 手`
  if (s.turn === HUMAN) return `黑子已下 ${countStones(s, 1)} 颗，白子 ${countStones(s, 2)} 颗`
  return '电脑正在推演最优落点…'
}

function countStones(s: State, p: 1 | 2): number {
  let n = 0
  for (const v of s.board) if (v === p) n++
  return n
}

function drawLegend(ctx: CanvasRenderingContext2D, y: number): void {
  const pill = (x: number, color: string, label: string): void => {
    fillRoundRect(ctx, x, y - 31, 210, 62, 18, 'rgba(0,0,0,0.22)')
    disc(ctx, x + 42, y, 18, color)
    text(ctx, label, x + 130, y + 1, { size: 24, weight: 'bold' })
  }
  pill(100, COLORS.black, '你 · 黑先')
  pill(410, COLORS.white, '电脑 · 白后')
}

function drawBoard(ctx: CanvasRenderingContext2D, state: State): void {
  // 底板
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 20, COLORS.wood)
  ctx.restore()
  fillRoundRect(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 20, 'rgba(0,0,0,0)', withAlpha(COLORS.woodDark, 0.9), 3)

  // 棋盘线
  const span = (SIZE - 1) * CELL
  ctx.strokeStyle = withAlpha(darken(COLORS.woodDark, 0.35), 0.6)
  ctx.lineWidth = 1.4
  for (let i = 0; i < SIZE; i++) {
    ctx.beginPath()
    ctx.moveTo(PAD, BOARD_Y + i * CELL)
    ctx.lineTo(PAD + span, BOARD_Y + i * CELL)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(PAD + i * CELL, BOARD_Y)
    ctx.lineTo(PAD + i * CELL, BOARD_Y + span)
    ctx.stroke()
  }

  // 星位
  ctx.fillStyle = withAlpha(darken(COLORS.woodDark, 0.4), 0.85)
  for (const s of STARS) {
    ctx.beginPath()
    ctx.arc(cellX(s), cellY(s), 4.5, 0, Math.PI * 2)
    ctx.fill()
  }

  // 悬停预览
  const hover = state.hover
  const showHover = !state.over && state.turn === HUMAN && hover >= 0 && state.board[hover] === 0
  if (showHover) {
    const hx = cellX(hover)
    const hy = cellY(hover)
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(hx - CELL * 0.44, hy)
    ctx.lineTo(hx + CELL * 0.44, hy)
    ctx.moveTo(hx, hy - CELL * 0.44)
    ctx.lineTo(hx, hy + CELL * 0.44)
    ctx.stroke()
    disc(ctx, hx, hy, CELL * 0.4, COLORS.black, { alpha: 0.32 })
  }

  // 棋子：最后一手带弹出动画
  const sig = `${state.lastMove}:${state.moves}`
  const pop = progressSince('gm-place', sig, 220, ease.outBack)
  const markAge = elapsedSince('gm-place', sig, 420)
  for (let i = 0; i < state.board.length; i++) {
    const v = state.board[i]
    if (v === 0) continue
    const x = cellX(i)
    const y = cellY(i)
    const win = state.winCells.indexOf(i) >= 0
    const scale = i === state.lastMove ? 0.5 + 0.5 * pop : 1
    disc(ctx, x, y, CELL * 0.43 * scale, stoneColor(v), { ring: win ? COLORS.accent : undefined })
    // 最后一手在棋子上留一个黄点，方便回看
    if (i === state.lastMove && !win) {
      const a = markAge < 420 ? 1 - markAge / 420 : 0.65
      ctx.save()
      ctx.globalAlpha = a
      ctx.fillStyle = COLORS.accent
      ctx.beginPath()
      ctx.arc(x, y, CELL * 0.1, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  // 获胜连线高亮
  if (state.winCells.length >= 5) {
    const a = state.winCells[0]
    const b = state.winCells[state.winCells.length - 1]
    const glow = tweenTo('gm-win', 1, 320)
    ctx.save()
    ctx.globalAlpha = 0.55 + 0.35 * glow
    ctx.strokeStyle = COLORS.accent
    ctx.lineWidth = 7
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(cellX(a), cellY(a))
    ctx.lineTo(cellX(b), cellY(b))
    ctx.stroke()
    ctx.restore()
  }
}

function effects(prev: State, next: State): Effect[] {
  if (next.history.length < prev.history.length) return [{ kind: 'sound', name: 'click' }]
  if (next.history.length === prev.history.length) return []
  if (!next.over) return [{ kind: 'sound', name: 'place' }]
  if (next.winner === HUMAN) {
    const out: Effect[] = [
      { kind: 'sound', name: 'win' },
      { kind: 'flash', color: 'rgba(255,204,51,0.3)' },
    ]
    for (const i of next.winCells) out.push({ kind: 'burst', x: cellX(i), y: cellY(i), color: COLORS.accent, count: 20 })
    return out
  }
  return [{ kind: 'sound', name: next.winner === 0 ? 'click' : 'lose' }]
}

function outcome(state: State): Outcome | null {
  if (!state.over) return null
  return { score: state.winner === HUMAN ? 1 : 0, better: 'higher', unit: ' 胜', win: state.winner === HUMAN }
}

function input(state: State, p: PointerInput): Action | null {
  if (state.over) return null
  const inside = inRect(p, PANEL)
  const cell = inside ? cellAt(p.x, p.y) : -1
  if (cell < 0 || state.board[cell] !== 0) {
    return p.kind === 'move' && state.hover !== -1 ? { type: 'leave' } : null
  }
  if (p.kind === 'move' && !p.pressed) return { type: 'hover', cell }
  // 只有轮到自己时才会真正落子，避免在电脑思考的间隙抢落
  if (p.kind === 'down' || (p.kind === 'up' && p.pressed)) {
    return state.turn === HUMAN ? { type: 'place', cell } : { type: 'hover', cell }
  }
  return null
}

function key(state: State, k: string): Action | null {
  if (k === 'u' || k === 'z' || k === 'Z') return { type: 'undo' }
  if (state.over) return null
  let col = state.hover >= 0 ? colOf(state.hover) : (SIZE - 1) / 2
  let row = state.hover >= 0 ? rowOf(state.hover) : (SIZE - 1) / 2
  if (k === 'ArrowLeft') col -= 1
  else if (k === 'ArrowRight') col += 1
  else if (k === 'ArrowUp') row -= 1
  else if (k === 'ArrowDown') row += 1
  else if (k === ' ' || k === 'Enter') return state.hover >= 0 && state.turn === HUMAN ? { type: 'place', cell: state.hover } : null
  else return null
  col = clamp(Math.round(col), 0, SIZE - 1)
  row = clamp(Math.round(row), 0, SIZE - 1)
  return { type: 'hover', cell: idx(col, row) }
}

function controls(state: State): Control<Action>[] {
  const canUndo = !state.over && state.history.length > 0
  const tipCell = !state.over && state.turn === HUMAN ? adviseCell(state) : -1
  return [
    { label: '帮我走一步', action: { type: 'place', cell: tipCell < 0 ? 0 : tipCell }, disabled: tipCell < 0 },
    { label: '悔棋', action: { type: 'undo' }, disabled: !canUndo },
  ]
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
  controls,
  hint: (s) =>
    s.over
      ? '本局结束，点「新的一局」再来一次'
      : s.turn === HUMAN
        ? '轮到你：黑棋先行，点任意空点落子，五子连珠即胜'
        : '电脑思考中…',
  aiDelay: 400,
}

export default game