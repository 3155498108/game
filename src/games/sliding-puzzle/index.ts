/**
 * 数字华容道渲染 + 输入映射。
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 * 关键：格子布局常量由本文件统一导出，render 与 input 共用同一份，坐标永远一致。
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { COLORS, background, banner, button, fillRoundRect, lighten, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { elapsedSince, progressSince } from '../../render/anim'
import type { Rect } from '../../core/geom'
import { gridHit, inRect, rowLayout } from '../../core/geom'
import meta from './meta'
import {
  CELLS,
  GOAL,
  SIZE,
  blankIndex,
  colOf,
  create,
  idx,
  isAdjacent,
  reduce,
  rowOf,
  type Action,
  type State,
} from './rules'

// ---------------- 布局常量（render / input 共用） ----------------
const VW = 720
const VH = 1280
/** 单个方块边长 */
export const CELL = 150
/** 方块之间的缝隙 */
export const GAP = 12
/** 格子步距（方块 + 缝隙） */
export const PITCH = CELL + GAP
/** 棋盘网格左上角 */
export const BOARD_X = (VW - (SIZE * CELL + (SIZE - 1) * GAP)) / 2
export const BOARD_Y = 236
/** 棋盘底板（含内边距） */
export const BOARD_RECT: Rect = {
  x: BOARD_X - 20,
  y: BOARD_Y - 20,
  w: SIZE * CELL + (SIZE - 1) * GAP + 40,
  h: SIZE * CELL + (SIZE - 1) * GAP + 40,
}
/** 画面上自绘的两个按钮，与 controls() 一一对应 */
export const BTN_RECTS: Rect[] = rowLayout(2, 940, 280, 110, 24, VW)

const TILE_MISS = '#33507d'
const TILE_MISS_DARK = '#22385c'
const TILE_HIT = '#2f7d5c'
const TILE_HIT_DARK = '#1f5c43'

/** 格子下标 → 方块中心点 */
function cellCenter(index: number): [number, number] {
  return [BOARD_X + colOf(index) * PITCH + CELL / 2, BOARD_Y + rowOf(index) * PITCH + CELL / 2]
}

function tileGradient(ctx: CanvasRenderingContext2D, x: number, y: number, top: string, bottom: string): CanvasGradient {
  const g = ctx.createLinearGradient(x, y, x, y + CELL)
  g.addColorStop(0, top)
  g.addColorStop(1, bottom)
  return g
}

function subtitle(s: State): string {
  if (s.solved) return '全部归位，收工！'
  return '点与空格上下左右相邻的数字块即可移动'
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  background(ctx, VW, VH, '#26375f', '#111b2e')

  topBar(ctx, VW, '数字华容道', `${state.moves} 步`, 96)
  shadowText(ctx, subtitle(state), VW / 2, 150, { size: 26, color: COLORS.textDim, weight: 'normal' })

  // ---- 棋盘底板 ----
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, BOARD_RECT.x, BOARD_RECT.y, BOARD_RECT.w, BOARD_RECT.h, 26, withAlpha('#0a1626', 0.92))
  ctx.restore()
  fillRoundRect(ctx, BOARD_RECT.x, BOARD_RECT.y, BOARD_RECT.w, BOARD_RECT.h, 26, 'rgba(255,255,255,0.06)', COLORS.line, 2)

  // ---- 空格槽位 ----
  const blank = blankIndex(state.board)
  const [bx, by] = cellCenter(blank)
  fillRoundRect(ctx, bx - CELL / 2 + 6, by - CELL / 2 + 6, CELL - 12, CELL - 12, 18, 'rgba(0,0,0,0.34)')

  // ---- 悬停高亮 ----
  if (!state.solved && state.hover >= 0 && state.hover !== blank && isAdjacent(state.hover, blank)) {
    const [hx, hy] = cellCenter(state.hover)
    fillRoundRect(ctx, hx - CELL / 2 + 4, hy - CELL / 2 + 4, CELL - 8, CELL - 8, 18, 'rgba(255,255,255,0.12)')
  }

  // ---- 数字方块（刚滑动的那一块走位移动画） ----
  const last = state.lastMove
  const sig = `${state.seq}:${last ? `${last.from}>${last.to}` : 'none'}`
  const slideP = last ? progressSince('sp-slide', sig, 190) : 1
  const since = last ? elapsedSince('sp-slide', sig, 260) : 999
  for (let i = 0; i < CELLS; i++) {
    const v = state.board[i]
    if (v === 0 || i === blank) continue
    const [x0, y0] = cellCenter(i)
    let x = x0
    let y = y0
    if (last && i === last.from) {
      const [tx, ty] = cellCenter(last.to)
      x = x0 + (tx - x0) * slideP
      y = y0 + (ty - y0) * slideP
    }
    const placed = i === last?.from && slideP >= 1 && since < 260
    const scale = placed ? 1 + Math.max(0, 1 - since / 260) * 0.08 : 1
    const w = (CELL - 10) * scale
    const h = (CELL - 10) * scale
    const ok = v === GOAL[i]
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 14
    ctx.shadowOffsetY = 6
    fillRoundRect(
      ctx,
      x - w / 2,
      y - h / 2,
      w,
      h,
      18,
      tileGradient(ctx, x - h / 2, y - h / 2, ok ? lighten(TILE_HIT, 0.12) : lighten(TILE_MISS, 0.12), ok ? TILE_HIT_DARK : TILE_MISS_DARK),
    )
    ctx.restore()
    if (ok) fillRoundRect(ctx, x - w / 2 + 5, y - h / 2 + 5, w - 10, h - 10, 14, 'rgba(255,255,255,0.10)')
    shadowText(ctx, String(v), x, y + 2, { size: v >= 10 ? 54 : 60, color: COLORS.text })
  }

  // ---- 自绘按钮 ----
  button(ctx, BTN_RECTS[0], '打乱', { color: '#3c6ea5', size: 38 })
  button(ctx, BTN_RECTS[1], '重置', {
    color: '#4a5a76',
    disabled: state.moves === 0 && !state.solved,
    size: 38,
  })

  // ---- 底部提示 ----
  fillRoundRect(ctx, 60, 1100, VW - 120, 112, 22, 'rgba(255,255,255,0.08)')
  const tip = state.solved
    ? `用了 ${state.moves} 步，点「打乱」再来一盘`
    : `已走 ${state.moves} 步 · 数字越少越厉害`
  text(ctx, tip, VW / 2, 1156, { size: 30, weight: 'bold' })

  if (state.solved) banner(ctx, VW, VH, '完成！', `一共 ${state.moves} 步`, COLORS.accent)
}

function effects(prev: State, next: State): Effect[] {
  if (next.board === prev.board) return []
  if (next.solved && !prev.solved) {
    const out: Effect[] = [
      { kind: 'sound', name: 'win' },
      { kind: 'flash', color: 'rgba(255,204,51,0.3)' },
    ]
    for (const i of [3, 7, 11, 15]) {
      const [x, y] = cellCenter(i)
      out.push({ kind: 'burst', x, y, color: COLORS.accent, count: 20 })
    }
    return out
  }
  if (next.moves > prev.moves) return [{ kind: 'sound', name: 'place' }]
  return [{ kind: 'sound', name: 'click' }]
}

function outcome(state: State): Outcome | null {
  if (!state.solved) return null
  return { score: state.moves, better: 'lower', unit: ' 步', win: true }
}

function controls(state: State): Control<Action>[] {
  return [
    { label: '打乱', action: { type: 'shuffle' }, primary: true },
    { label: '重置', action: { type: 'reset' }, disabled: state.moves === 0 && !state.solved },
  ]
}

function input(_state: State, p: PointerInput): Action | null {
  if (p.kind === 'move' && !p.pressed) return { type: 'leave' }
  const pressed = p.kind === 'down' || (p.kind === 'up' && p.pressed)
  if (pressed) {
    if (inRect(p, BTN_RECTS[0])) return { type: 'shuffle' }
    if (inRect(p, BTN_RECTS[1])) return { type: 'reset' }
    const hit = gridHit(p, BOARD_X, BOARD_Y, PITCH, PITCH, SIZE, SIZE)
    return hit ? { type: 'move', index: idx(hit[0], hit[1]) } : null
  }
  if (p.kind === 'move') {
    const hit = gridHit(p, BOARD_X, BOARD_Y, PITCH, PITCH, SIZE, SIZE)
    return { type: 'hover', index: hit ? idx(hit[0], hit[1]) : -1 }
  }
  return null
}

function key(state: State, k: string): Action | null {
  if (k === 's' || k === 'S') return { type: 'shuffle' }
  if (k === 'r' || k === 'R') return { type: 'reset' }
  if (state.solved) return null
  const dir: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }
  const d = dir[k]
  if (!d) return null
  const b = blankIndex(state.board)
  if (b < 0) return null
  const c = colOf(b) + d[0]
  const r = rowOf(b) + d[1]
  if (c < 0 || c >= SIZE || r < 0 || r >= SIZE) return null
  return { type: 'move', index: idx(c, r) }
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  input,
  key,
  effects,
  outcome,
  controls,
  hint: (s) => (s.solved ? `完成！共 ${s.moves} 步，点「新的一局」挑战更少步数` : '点与空格相邻的数字块，把 1→15 排好、空格回到右下角'),
}

export default game
