/**
 * 四子棋渲染 + 输入映射。
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 */
import type { Effect, GameModule, PointerInput } from '../../core/types'
import { COLORS, banner, background, disc, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { elapsedSince, keepAlive, progressSince, tweenTo } from '../../render/anim'
import type { Rect } from '../../core/geom'
import { inRect } from '../../core/geom'
import meta from './meta'
import { COLS, ROWS, aiAction, colOf, create, dropRow, legalColumns, reduce, rowOf, type Action, type State } from './rules'

const CELL = 96
const BOARD_W = COLS * CELL
const BOARD_X = (720 - BOARD_W) / 2
const BOARD_Y = 336

/** 棋盘矩形（含外边距），输入命中与渲染共用，保证坐标永远一致 */
const BOARD_RECT: Rect = { x: BOARD_X - 18, y: BOARD_Y - 18, w: BOARD_W + 36, h: ROWS * CELL + 36 }

const cellCenter = (col: number, row: number): [number, number] => [BOARD_X + col * CELL + CELL / 2, BOARD_Y + row * CELL + CELL / 2]

const pieceColor = (p: 1 | 2): string => (p === 1 ? '#ffd54f' : '#ef5350')

function statusText(s: State): [string, string] {
  if (s.over) {
    if (s.winner === 1) return ['你赢了！', `你用了 ${s.moves} 步连成四子`]
    if (s.winner === 2) return ['电脑获胜', '再来一局，这次堵住它']
    return ['平局', '棋盘填满了，谁也没能连成四子']
  }
  if (s.turn === 1) return ['轮到你', '点一列把棋子放到底部空位']
  return ['电脑思考中', '它会优先堵住你的三连']
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  const vw = 720
  const vh = 1280
  keepAlive()
  background(ctx, vw, vh, '#1b3b6f', '#0d1b30')

  const [main, sub] = statusText(state)
  topBar(ctx, vw, main, `第 ${state.moves + (state.over ? 0 : 1)} 手`, 96)
  shadowText(ctx, sub, vw / 2, 150, { size: 26, color: COLORS.textDim, weight: 'normal' })

  // 玩家 / 电脑 图例
  drawLegend(ctx, 196)

  // 棋盘底板
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, BOARD_RECT.x, BOARD_RECT.y, BOARD_RECT.w, BOARD_RECT.h, 26, withAlpha('#0a1626', 0.92))
  ctx.restore()
  fillRoundRect(ctx, BOARD_RECT.x, BOARD_RECT.y, BOARD_RECT.w, BOARD_RECT.h, 26, 'rgba(255,255,255,0.06)', COLORS.line, 2)

  const legal = legalColumns(state.board)
  const hoverCol = state.hover >= 0 && !state.over && legal.indexOf(state.hover) >= 0 ? state.hover : -1
  if (hoverCol >= 0) {
    const r = dropRow(state.board, hoverCol)
    fillRoundRect(ctx, BOARD_X + hoverCol * CELL + 4, BOARD_Y + 4, CELL - 8, ROWS * CELL - 8, 18, 'rgba(255,255,255,0.1)')
    const [hx, hy] = cellCenter(hoverCol, r)
    disc(ctx, hx, hy, CELL * 0.34, COLORS.accent, { alpha: 0.35 })
  }

  // 空洞
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const [x, y] = cellCenter(c, r)
      ctx.beginPath()
      ctx.arc(x, y, CELL * 0.38, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fill()
    }
  }

  // 棋子（最后一手带落下动画）
  const dropSig = String(state.lastMove) + ':' + state.moves
  const fallP = progressSince('c4-drop', dropSig, 260)
  const recent = elapsedSince('c4-drop', dropSig, 600)
  for (let i = 0; i < state.board.length; i++) {
    const v = state.board[i]
    if (v === 0) continue
    const [x, y0] = cellCenter(colOf(i), rowOf(i))
    let y = y0
    let scale = 1
    if (i === state.lastMove) {
      if (fallP < 1) {
        // 从棋盘上方落入落点
        const from = BOARD_Y + ROWS * CELL + CELL / 2 - 120
        y = from + (y0 - from) * fallP
        scale = 0.55 + 0.45 * fallP
      } else {
        // 落定后短暂的高亮回弹
        scale = 1 + Math.max(0, 1 - recent / 600) * 0.12
      }
    }
    const win = state.winCells.indexOf(i) >= 0
    disc(ctx, x, y, CELL * 0.37 * scale, pieceColor(v), { ring: win ? COLORS.accent : undefined })
    if (win) {
      const glow = tweenTo(`c4-win-${i}`, 1, 300)
      ctx.save()
      ctx.globalAlpha = 0.35 + 0.25 * glow
      ctx.strokeStyle = COLORS.accent
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.arc(x, y, CELL * 0.46, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  // 底部提示
  const tip = state.over ? '点「新的一局」再来一次' : state.turn === 1 ? '轮到你落子' : '电脑正在落子…'
  fillRoundRect(ctx, 60, vh - 200, vw - 120, 110, 22, 'rgba(255,255,255,0.08)')
  text(ctx, tip, vw / 2, vh - 145, { size: 30, weight: 'bold' })

  if (state.over) banner(ctx, vw, vh, state.winner === 1 ? '胜利' : state.winner === 2 ? '失败' : '平局', main)
}

function drawLegend(ctx: CanvasRenderingContext2D, y: number): void {
  const pill = (x: number, color: string, label: string): void => {
    fillRoundRect(ctx, x, y - 30, 200, 60, 18, 'rgba(255,255,255,0.08)')
    disc(ctx, x + 38, y, 17, color)
    text(ctx, label, x + 122, y + 1, { size: 23, weight: 'bold' })
  }
  pill(120, pieceColor(1), '你 · 先手')
  pill(400, pieceColor(2), '电脑')
}

function effects(prev: State, next: State): Effect[] {
  if (next.moves === prev.moves) return []
  if (next.over) {
    if (next.winner === 1) {
      const out: Effect[] = [{ kind: 'sound', name: 'win' }, { kind: 'flash', color: 'rgba(255,204,51,0.35)' }]
      for (const i of next.winCells) {
        const [x, y] = cellCenter(colOf(i), rowOf(i))
        out.push({ kind: 'burst', x, y, color: COLORS.accent, count: 22 })
      }
      return out
    }
    return [{ kind: 'sound', name: next.winner === 2 ? 'lose' : 'click' }]
  }
  return [{ kind: 'sound', name: 'place' }]
}

function outcome(state: State) {
  if (!state.over) return null
  return { score: state.winner === 1 ? 1 : 0, better: 'higher' as const, unit: ' 胜', win: state.winner === 1 }
}

function input(state: State, p: PointerInput): Action | null {
  if (!inRect(p, BOARD_RECT)) return p.kind === 'move' && state.hover !== -1 ? { type: 'leave' } : null
  const col = Math.floor((p.x - BOARD_X) / CELL)
  if (col < 0 || col >= COLS) return null
  if (p.kind === 'move' && !p.pressed) return { type: 'hover', col }
  if (p.kind === 'down' || (p.kind === 'up' && p.pressed)) return { type: 'drop', col }
  return null
}

function key(state: State, k: string): Action | null {
  const map: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6 }
  if (k in map) return { type: 'drop', col: map[k] }
  if (k === 'ArrowLeft') return { type: 'hover', col: Math.max(0, state.hover - 1) }
  if (k === 'ArrowRight') return { type: 'hover', col: Math.min(COLS - 1, state.hover + 1) }
  if ((k === ' ' || k === 'Enter') && state.hover >= 0) return { type: 'drop', col: state.hover }
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
  hint: (s) => (s.over ? '本局结束，点「新的一局」再来一次' : s.turn === 1 ? '轮到你：点任意列落子，连成四子即胜' : '电脑思考中…'),
  aiDelay: 420,
}

export default game