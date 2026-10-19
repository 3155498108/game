/**
 * 黑白棋渲染 + 输入映射。规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 * 动画一律走 render/anim.ts 旁路（progressSince / elapsedSince），不进入 state。
 */
import type { Effect, GameModule, PointerInput } from '../../core/types'
import { COLORS, banner, background, disc, ease, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { elapsedSince, keepAlive, pulse } from '../../render/anim'
import { clamp, gridHit, type Rect } from '../../core/geom'
import meta from './meta'
import { SIZE, aiAction, colOf, create, idx, legalActions, opponent, reduce, rowOf, type Action, type Player, type State } from './rules'

const VW = 720
const VH = 1280
const CELL = 78
const BOARD_W = SIZE * CELL // 624
const BOARD_X = (VW - BOARD_W) / 2 // 48
const BOARD_Y = 252
/** 棋盘矩形（含外边距），输入命中与渲染共用，保证坐标永远一致 */
const BOARD_RECT: Rect = { x: BOARD_X - 16, y: BOARD_Y - 16, w: BOARD_W + 32, h: BOARD_W + 32 }

const cellCenter = (col: number, row: number): [number, number] => [BOARD_X + col * CELL + CELL / 2, BOARD_Y + row * CELL + CELL / 2]
const pieceColor = (p: Player): string => (p === 1 ? COLORS.black : COLORS.white)

function statusText(s: State): [string, string] {
  if (s.over) {
    if (s.winner === 1) return ['你赢了！', `黑子 ${s.black} : 白子 ${s.white}`]
    if (s.winner === 2) return ['电脑获胜', `黑子 ${s.black} : 白子 ${s.white}`]
    return ['平局', `黑子 ${s.black} : 白子 ${s.white}`]
  }
  if (s.passes > 0) return [s.turn === 1 ? '轮到你落子' : '电脑思考中', '上一步双方都无处可下，已自动跳过']
  if (s.turn === 1) return ['轮到你落子', '点半透明的提示子，必须夹住对方棋子']
  return ['电脑思考中', '它会优先抢角和控制中心']
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  keepAlive()
  background(ctx, VW, VH, '#173a2a', '#0c1c15')

  const [main, sub] = statusText(state)
  topBar(ctx, VW, main, `第 ${state.moves} 手`, 96)
  shadowText(ctx, sub, VW / 2, 148, { size: 26, color: COLORS.textDim, weight: 'normal' })

  // 当前执子提示（黑白小圆 + 文字）
  drawTurn(ctx, 206, state)

  // 棋盘底板
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, BOARD_RECT.x, BOARD_RECT.y, BOARD_RECT.w, BOARD_RECT.h, 26, withAlpha('#07140e', 0.92))
  ctx.restore()
  fillRoundRect(ctx, BOARD_RECT.x, BOARD_RECT.y, BOARD_RECT.w, BOARD_RECT.h, 26, 'rgba(255,255,255,0.07)', COLORS.line, 2)

  // 格子底色
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const dark = (c + r) % 2 === 0
      fillRoundRect(ctx, BOARD_X + c * CELL + 2, BOARD_Y + r * CELL + 2, CELL - 4, CELL - 4, 10, dark ? '#1e6b46' : '#19603e')
    }
  }
  // 棋盘坐标提示（黑白两色的角标）
  for (let c = 0; c < SIZE; c++) {
    const [x] = cellCenter(c, 0)
    text(ctx, String.fromCharCode(65 + c), x, BOARD_Y - 8, { size: 20, color: COLORS.textDim })
  }
  for (let r = 0; r < SIZE; r++) {
    const [, y] = cellCenter(0, r)
    text(ctx, String(r + 1), BOARD_X - 10, y, { size: 20, color: COLORS.textDim })
  }

  // 合法落点：半透明提示子（黑白棋必备的可玩性设计）
  const legal = state.over ? [] : legalActions(state.board, state.turn)
  const breathe = 0.3 + 0.1 * pulse(1400)
  const hoverOk = state.hover >= 0 && !state.over && legal.indexOf(state.hover) >= 0 ? state.hover : -1
  for (const i of legal) {
    const [x, y] = cellCenter(colOf(i), rowOf(i))
    disc(ctx, x, y, CELL * 0.31, pieceColor(state.turn), { alpha: i === hoverOk ? breathe + 0.25 : breathe })
  }

  // 棋子：最后一手带落子弹跳，被翻的棋子做横向翻转动画
  const moveSig = String(state.moves)
  const flipE = elapsedSince('rv-flip', moveSig, 760)
  const placeE = elapsedSince('rv-place', moveSig, 320)
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = state.board[i]
    if (v === 0) continue
    const [x, y] = cellCenter(colOf(i), rowOf(i))
    let shown: Player = v
    let sx = 1
    let scale = 1
    const rank = state.flipped.indexOf(i)
    if (rank >= 0 && flipE < 760) {
      // 错峰：按被翻顺序依次翻开，中点换色
      const p = clamp((flipE - rank * 22) / 240, 0, 1)
      const e = ease.inOutCubic(p)
      sx = Math.max(0.02, Math.abs(Math.cos((e * Math.PI) / 2)))
      shown = p < 0.5 ? opponent(v) : v
    } else if (i === state.lastMove && placeE < 320) {
      scale = 1 + (1 - placeE / 320) * 0.18
    }
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(sx, 1)
    disc(ctx, 0, 0, CELL * 0.37 * scale, pieceColor(shown))
    ctx.restore()
    // 白子描边，避免在浅色格上糊成一片
    if (shown === 2) {
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(sx, 1)
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(0, 0, CELL * 0.37 * scale, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  // 落子点位高亮
  if (state.lastMove >= 0 && !state.over) {
    const [x, y] = cellCenter(colOf(state.lastMove), rowOf(state.lastMove))
    ctx.save()
    ctx.strokeStyle = COLORS.accent
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(x, y, CELL * 0.46, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  // 比分
  drawScore(ctx, 912, state)

  // 底部提示
  const tip = state.over ? '点「新的一局」再来一次' : state.turn === 1 ? '轮到你落子' : '电脑正在落子…'
  fillRoundRect(ctx, 60, VH - 216, VW - 120, 116, 24, 'rgba(255,255,255,0.08)')
  text(ctx, tip, VW / 2, VH - 158, { size: 30, weight: 'bold' })

  if (state.over) banner(ctx, VW, VH, state.winner === 1 ? '胜利' : state.winner === 2 ? '失败' : '平局', main)
}

function drawTurn(ctx: CanvasRenderingContext2D, y: number, s: State): void {
  const who = s.over ? 0 : s.turn
  if (who === 0) {
    shadowText(ctx, '本局结束', VW / 2, y, { size: 28, color: COLORS.accent })
    return
  }
  const label = who === 1 ? '你执黑先行' : '电脑执白'
  const w = 300
  fillRoundRect(ctx, (VW - w) / 2, y - 30, w, 60, 18, 'rgba(255,255,255,0.08)')
  disc(ctx, (VW - w) / 2 + 46, y, 19, pieceColor(who))
  shadowText(ctx, label, (VW - w) / 2 + 190, y + 1, { size: 25, weight: 'bold' })
}

function drawScore(ctx: CanvasRenderingContext2D, y: number, s: State): void {
  const pill = (x: number, p: Player, n: number, lead: boolean): void => {
    const w = 264
    fillRoundRect(ctx, x, y, w, 108, 22, lead ? 'rgba(255,204,51,0.14)' : 'rgba(255,255,255,0.07)')
    disc(ctx, x + 52, y + 54, 26, pieceColor(p))
    shadowText(ctx, String(n), x + 150, y + 54, { size: 42, color: lead ? COLORS.accent : COLORS.text })
  }
  pill(80, 1, s.black, !s.over && s.turn === 1)
  pill(376, 2, s.white, !s.over && s.turn === 2)
}

function effects(prev: State, next: State): Effect[] {
  if (next.moves !== prev.moves) {
    const [x, y] = cellCenter(colOf(next.lastMove), rowOf(next.lastMove))
    const out: Effect[] = [{ kind: 'sound', name: next.flipped.length > 0 ? 'flip' : 'place' }]
    out.push({ kind: 'burst', x, y, color: COLORS.accent, count: 10 + next.flipped.length * 3 })
    return out
  }
  if (next.over && !prev.over) {
    const out: Effect[] = [{ kind: 'sound', name: next.winner === 1 ? 'win' : next.winner === 2 ? 'lose' : 'click' }]
    if (next.winner !== 0) out.push({ kind: 'flash', color: 'rgba(255,204,51,0.3)' })
    return out
  }
  if (next.passes > prev.passes) return [{ kind: 'sound', name: 'tick' }]
  return []
}

function outcome(state: State) {
  if (!state.over) return null
  return { score: state.winner === 1 ? 1 : 0, better: 'higher' as const, unit: ' 胜', win: state.winner === 1 }
}

function input(state: State, p: PointerInput): Action | null {
  if (state.over) return null
  const hit = gridHit({ x: p.x, y: p.y }, BOARD_X, BOARD_Y, CELL, CELL, SIZE, SIZE)
  if (!hit) return p.kind === 'move' && state.hover !== -1 ? { type: 'leave' } : null
  const [c, r] = hit
  const i = idx(c, r)
  // 非法落点也照样派发给 reduce，由 reduce 拒绝（保持「唯一规则来源」）
  if (p.kind === 'move' && !p.pressed) return { type: 'hover', index: i }
  if (p.kind === 'down' || (p.kind === 'up' && p.pressed)) return { type: 'place', index: i }
  return null
}

function key(state: State, k: string): Action | null {
  if (state.over) return null
  const steps: Record<string, readonly [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }
  const step = steps[k]
  if (step) {
    const base = state.hover >= 0 ? state.hover : idx(3, 3)
    const c = clamp(colOf(base) + step[0], 0, SIZE - 1)
    const r = clamp(rowOf(base) + step[1], 0, SIZE - 1)
    return { type: 'hover', index: idx(c, r) }
  }
  if ((k === ' ' || k === 'Enter') && state.hover >= 0) return { type: 'place', index: state.hover }
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
      ? `本局结束：黑子 ${s.black} : 白子 ${s.white}，点「新的一局」再来一次`
      : s.turn === 1
        ? '轮到你：点棋盘上的半透明提示子落子，必须夹住对方的一串棋子'
        : '电脑思考中…',
  aiDelay: 380,
}

export default game