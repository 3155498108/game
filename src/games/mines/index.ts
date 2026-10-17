/**
 * 扫雷赌局 mines —— 渲染与输入层。
 *
 * 本文件只负责「画」和「把输入翻译成 action」：
 * 雷位、翻牌、收益全部由 rules.ts 以纯函数推进，这里不持有任何规则状态。
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { gridHit } from '../../core/geom'
import { progressSince, tweenTo } from '../../render/anim'
import { COLORS, background, banner, fillRoundRect, shadowText, text, topBar } from '../../render/draw'
import { meta } from './meta'
import {
  CELL_GAP,
  CELL_H,
  CELL_SIZE,
  CELL_W,
  COLS,
  GRID_X,
  GRID_Y,
  MINE_OPTIONS,
  ROWS,
  cellCol,
  cellRow,
  create,
  formatMultiple,
  liveMultiple,
  netMultiple,
  reduce,
  safeCount,
} from './rules'
import type { Action, State } from './rules'

const VW = 720
const VH = 1280
/** 雷区整体宽高（5 格步进减去最后一格的间隙） */
const BOARD_W = COLS * CELL_W - CELL_GAP
const BOARD_H = ROWS * CELL_H - CELL_GAP

function cellRect(index: number): { x: number; y: number; w: number; h: number } {
  return {
    x: GRID_X + cellCol(index) * CELL_W,
    y: GRID_Y + cellRow(index) * CELL_H,
    w: CELL_SIZE,
    h: CELL_SIZE,
  }
}

function cellCenter(index: number): [number, number] {
  const r = cellRect(index)
  return [r.x + r.w / 2, r.y + r.h / 2]
}

/** 单个格子：未翻开是问号牌面，安全格显示「安」，终局才亮出雷 */
function drawCell(ctx: CanvasRenderingContext2D, s: State, index: number): void {
  const r = cellRect(index)
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const opened = s.opened.includes(index)
  const isMine = s.mines.includes(index)
  const hit = s.hit === index
  // 该格自己的签名：只有本局由未翻开变翻开时才重放弹出动画
  const p = progressSince(`mines-cell-${index}`, `${s.rounds}:${opened}`, 260)
  const k = opened ? 0.72 + 0.28 * p : 1 + 0.04 * (1 - p)

  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(k, k)
  ctx.translate(-cx, -cy)

  const showMine = s.phase === 'done' && isMine
  if (showMine) {
    fillRoundRect(ctx, r.x, r.y, r.w, r.h, 18, hit ? '#c62828' : '#5c2020', hit ? COLORS.accent : '#8a2b2b', hit ? 6 : 2)
    text(ctx, hit ? '✹' : '✖', cx, cy - 4, { size: 52, weight: 'bold', color: hit ? COLORS.accent : '#b34a4a' })
    text(ctx, '雷', cx, cy + 32, { size: 22, color: hit ? COLORS.accent : '#b34a4a' })
  } else if (opened) {
    fillRoundRect(ctx, r.x, r.y, r.w, r.h, 18, COLORS.felt, COLORS.accent2, 3)
    text(ctx, '安', cx, cy, { size: 44, weight: 'bold', color: COLORS.accent2 })
  } else {
    const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h)
    g.addColorStop(0, COLORS.panelLight)
    g.addColorStop(1, COLORS.panel)
    ctx.shadowColor = 'rgba(0,0,0,0.4)'
    ctx.shadowBlur = 6
    ctx.shadowOffsetY = 3
    fillRoundRect(ctx, r.x, r.y, r.w, r.h, 18, g)
    ctx.shadowColor = 'transparent'
    text(ctx, '?', cx, cy + 2, { size: 46, weight: 'bold', color: COLORS.textDim })
  }
  ctx.restore()
}

function drawBoard(ctx: CanvasRenderingContext2D, s: State): void {
  fillRoundRect(ctx, GRID_X - 18, GRID_Y - 18, BOARD_W + 36, BOARD_H + 36, 26, 'rgba(8,16,30,0.55)', COLORS.line, 2)
  for (let i = 0; i < COLS * ROWS; i++) drawCell(ctx, s, i)
}

/** 底部 HUD：当前收益倍数最大字号，方便一眼判断要不要继续翻 */
function drawHud(ctx: CanvasRenderingContext2D, s: State): void {
  const x = 48
  const y = 966
  const w = VW - 96
  const h = 258
  fillRoundRect(ctx, x, y, w, h, 24, 'rgba(10,20,36,0.72)', COLORS.line, 2)

  const mult = tweenTo('mines-mult', liveMultiple(s), 320)
  const live = s.phase === 'playing'
  shadowText(ctx, live || s.phase === 'done' ? `×${formatMultiple(mult)}` : '×0.00', VW / 2, y + 66, {
    size: 74,
    color: mult < 0 ? COLORS.red : COLORS.accent,
  })
  text(ctx, live ? '当前累积收益倍数' : s.phase === 'done' ? (s.cleared ? '通关收益' : '本局归零') : '开局前的预估', VW / 2, y + 118, {
    size: 24,
    color: COLORS.textDim,
  })

  const left = `已翻 ${s.opened.length} / ${safeCount(s.mineCount)}`
  const right = `雷数 ${s.mineCount}`
  text(ctx, left, x + 28, y + 172, { size: 28, align: 'left', weight: 'bold' })
  text(ctx, right, x + w - 28, y + 172, { size: 28, align: 'right', weight: 'bold', color: COLORS.accent2 })

  const note =
    s.phase === 'setup'
      ? '选择雷数后点「开始」，雷位即定死在盘面上'
      : s.phase === 'done'
        ? s.cleared
          ? '安全格全部翻完，点「再来一局」继续'
          : '踩到雷了，点「再来一局」换个雷数'
        : '每翻开一格，累积倍数都会变高'
  text(ctx, note, VW / 2, y + 216, { size: 24, color: COLORS.textDim })
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, COLORS.bg2, COLORS.bg)
  topBar(ctx, VW, `第 ${s.rounds + 1} 局`, s.best > 0 ? `最高 ×${formatMultiple(s.best)}` : '')
  shadowText(ctx, '扫雷赌局', VW / 2, 140, { size: 40, color: COLORS.text })
  text(ctx, `雷区 5×5 · 每格雷概率 ${((s.mineCount / (COLS * ROWS)) * 100).toFixed(0)}%`, VW / 2, 196, {
    size: 24,
    color: COLORS.textDim,
  })
  drawBoard(ctx, s)
  drawHud(ctx, s)

  if (s.phase === 'done') {
    const net = netMultiple(s)
    banner(
      ctx,
      VW,
      VH,
      s.cleared ? `通关 +${formatMultiple(net)}` : '踩雷，全输',
      s.cleared ? `翻了 ${s.opened.length} 格安全牌` : `第 ${cellRow(s.hit) * COLS + cellCol(s.hit) + 1} 格有雷`,
      s.cleared ? COLORS.accent : COLORS.red,
    )
  } else if (s.phase === 'setup') {
    // 雷数选择与「开始」都由 controls 提供，画布不再重复画按钮
    text(ctx, `当前雷数 ${s.mineCount} 颗`, VW / 2, 930, { size: 28, weight: 'bold', color: COLORS.accent })
  }
}

function input(state: State, p: PointerInput): Action | null {
  if (state.phase !== 'playing' || p.kind !== 'down') return null
  const hit = gridHit({ x: p.x, y: p.y }, GRID_X, GRID_Y, CELL_W, CELL_H, COLS, ROWS)
  if (!hit) return null
  return { type: 'reveal', col: hit[0], row: hit[1] }
}

function controls(state: State): Control<Action>[] {
  const setup = state.phase === 'setup'
  const list: Control<Action>[] = MINE_OPTIONS.map((n) => ({
    label: `${n} 雷`,
    action: { type: 'setMineCount', count: n },
    disabled: !setup,
    primary: state.mineCount === n,
  }))
  list.push({
    label: state.phase === 'done' ? '再来一局' : '开始',
    action: { type: 'start' },
    disabled: state.phase === 'playing',
    primary: true,
  })
  return list
}

function hint(s: State): string {
  if (s.phase === 'setup') return `已选 ${s.mineCount} 雷 · 每格雷概率 ${((s.mineCount / (COLS * ROWS)) * 100).toFixed(0)}%｜点「开始」埋雷`
  if (s.phase === 'done') {
    return s.cleared
      ? `通关！收益 = 注额 × ${formatMultiple(netMultiple(s))}`
      : `踩雷，本局收益归零（共翻了 ${s.opened.length} 格）`
  }
  return `已翻 ${s.opened.length} / ${safeCount(s.mineCount)} 格 · 当前 ×${formatMultiple(liveMultiple(s))}｜点格子翻开`
}

function outcome(s: State): Outcome | null {
  if (s.phase !== 'done') return null
  return { score: netMultiple(s), better: 'higher', unit: '金币', win: s.cleared }
}

/** 金币结算：一律按注额倍数换算，不写死面值 */
function coins(s: State, _outcome: Outcome, bet: number): number {
  return Math.round(bet * netMultiple(s))
}

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  const revealed = next.opened.length - prev.opened.length
  if (revealed > 0) {
    const last = next.opened[next.opened.length - 1]
    const [x, y] = cellCenter(last)
    out.push({ kind: 'sound', name: 'flip' })
    out.push({ kind: 'burst', x, y, color: COLORS.accent2, count: 8 })
  }
  if (next.hit >= 0 && prev.hit < 0) {
    const [x, y] = cellCenter(next.hit)
    out.push({ kind: 'sound', name: 'lose' })
    out.push({ kind: 'burst', x, y, color: COLORS.red, count: 22 })
    out.push({ kind: 'shake', power: 14 })
  }
  if (next.phase === 'done' && prev.phase !== 'done') {
    if (next.cleared) {
      out.push({ kind: 'sound', name: 'win' })
      out.push({ kind: 'burst', x: VW / 2, y: 600, color: COLORS.accent, count: 40 })
    }
  }
  return out
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  input,
  hint,
  controls,
  outcome,
  effects,
  coins,
}

export default game
export { meta }
export type { Action, State }
