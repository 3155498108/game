/**
 * 数独渲染 + 输入映射。
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas、把指针翻译成 action。
 *
 * 布局常量只有这一份：render 与 input 都调 cellRect / padRect，
 * 坐标不会各算各的（看着能点却点不到，是这类棋盘最容易出的 bug）。
 *
 * 动画走 render/anim.ts 的旁路缓存：选中格的呼吸边框用 pulse() 现算，
 * 任何时间戳都不进 state，reduce 因此依旧可复盘。
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { COLORS, background, banner, button, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { pulse } from '../../render/anim'
import type { Rect } from '../../core/geom'
import { gridHit, inRect } from '../../core/geom'
import meta from './meta'
import {
  CELLS,
  SIDE,
  blankCount,
  boxOf,
  colOf,
  create,
  difficultyOf,
  filledCount,
  isRed,
  reduce,
  rowOf,
  scoreOf,
  type Action,
  type State,
} from './rules'

// ---------------- 布局常量（render / input 共用同一份） ----------------

export const VW = 720
export const VH = 1280

/** 单格边长：9 格 = 594，两侧各留 63 */
export const CELL = 66
export const GRID_X = 63
export const GRID_Y = 260
export const GRID_SIZE = CELL * SIDE

/** 整个棋盘的矩形，命中判定与底板共用 */
export const GRID_RECT: Rect = { x: GRID_X, y: GRID_Y, w: GRID_SIZE, h: GRID_SIZE }

/** 第 i 格（0~80）的矩形 */
export function cellRect(i: number): Rect {
  const c = i % SIDE
  const r = Math.floor(i / SIDE)
  return { x: GRID_X + c * CELL, y: GRID_Y + r * CELL, w: CELL, h: CELL }
}

/** 第 i 格的中心（特效粒子用） */
export function cellCenter(i: number): [number, number] {
  const r = cellRect(i)
  return [r.x + r.w / 2, r.y + r.h / 2]
}

/** 数字面板：3 行 × 3 列，每个按钮 ≥110 逻辑像素高（最小缩放下仍是 44px 触控目标） */
export const PAD_COLS = 3
export const PAD_BTN_W = 180
export const PAD_BTN_H = 112
export const PAD_GAP = 16
export const PAD_X = 74
export const PAD_Y = 900

/** 数字 v（1~9）对应的按钮矩形 */
export function padRect(v: number): Rect {
  const k = v - 1
  const c = k % PAD_COLS
  const r = Math.floor(k / PAD_COLS)
  return {
    x: PAD_X + c * (PAD_BTN_W + PAD_GAP),
    y: PAD_Y + r * (PAD_BTN_H + PAD_GAP),
    w: PAD_BTN_W,
    h: PAD_BTN_H,
  }
}

/** 「擦除」按钮：放在数字面板上方一行，与副标题并排 */
export const ERASE_RECT: Rect = { x: 500, y: 108, w: 190, h: 110 }

// ---------------- 绘制 ----------------

/** 两格是否同行/同列/同宫（选中格的「伙伴格」用来做淡高亮） */
function isPeer(a: number, b: number): boolean {
  if (a === b) return false
  return rowOf(a) === rowOf(b) || colOf(a) === colOf(b) || boxOf(a) === boxOf(b)
}

/** 候选数字：画在格子里的 3×3 小格上 */
function drawNotes(ctx: CanvasRenderingContext2D, s: State, i: number, r: Rect): void {
  const list = s.notes[i]
  if (list.length === 0) return
  const m = 4
  const cw = (r.w - m * 2) / 3
  for (const d of list) {
    const k = d - 1
    const nr = Math.floor(k / 3)
    const nc = k % 3
    text(ctx, String(d), r.x + m + nc * cw + cw / 2, r.y + m + nr * cw + cw / 2, {
      size: 19,
      color: COLORS.textDim,
      weight: 'normal',
    })
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, s: State): void {
  // 底板
  fillRoundRect(ctx, GRID_X - 12, GRID_Y - 12, GRID_SIZE + 24, GRID_SIZE + 24, 18, 'rgba(4,10,20,0.55)')
  fillRoundRect(ctx, GRID_X - 12, GRID_Y - 12, GRID_SIZE + 24, GRID_SIZE + 24, 18, 'rgba(255,255,255,0.04)', COLORS.line, 2)

  for (let i = 0; i < CELLS; i++) {
    const r = cellRect(i)
    const given = s.given[i]
    const v = s.values[i]
    const red = isRed(s, i)
    const green = s.checked && !given && v !== 0 && v === s.solution[i]

    let bg = 'rgba(255,255,255,0.03)'
    if (red) bg = 'rgba(239,83,80,0.26)'
    else if (green) bg = 'rgba(102,187,106,0.16)'
    else if (i === s.selected) bg = 'rgba(255,204,51,0.20)'
    else if (s.selected >= 0 && isPeer(s.selected, i)) bg = 'rgba(255,255,255,0.07)'
    ctx.fillStyle = bg
    ctx.fillRect(r.x, r.y, r.w, r.h)

    if (v !== 0) {
      const color = red ? COLORS.red : green ? COLORS.green : given ? COLORS.text : COLORS.blue
      text(ctx, String(v), r.x + r.w / 2, r.y + r.h / 2, { size: 40, weight: 'bold', color })
    } else {
      drawNotes(ctx, s, i, r)
    }
  }

  drawGridLines(ctx)

  // 选中格：呼吸的黄色边框
  if (s.selected >= 0) {
    const r = cellRect(s.selected)
    const p = pulse(1500)
    ctx.save()
    ctx.strokeStyle = withAlpha(COLORS.accent, 0.55 + 0.45 * p)
    ctx.lineWidth = 3 + 2 * p
    ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4)
    ctx.restore()
  }
}

/** 细线分格、粗线分宫 */
function drawGridLines(ctx: CanvasRenderingContext2D): void {
  ctx.save()
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.beginPath()
  for (let i = 1; i < SIDE; i++) {
    const x = GRID_X + i * CELL
    const y = GRID_Y + i * CELL
    ctx.moveTo(x, GRID_Y)
    ctx.lineTo(x, GRID_Y + GRID_SIZE)
    ctx.moveTo(GRID_X, y)
    ctx.lineTo(GRID_X + GRID_SIZE, y)
  }
  ctx.stroke()

  ctx.lineWidth = 4
  ctx.strokeStyle = withAlpha(COLORS.text, 0.5)
  ctx.beginPath()
  for (let i = 0; i <= SIDE; i += 3) {
    const x = GRID_X + i * CELL
    const y = GRID_Y + i * CELL
    ctx.moveTo(x, GRID_Y)
    ctx.lineTo(x, GRID_Y + GRID_SIZE)
    ctx.moveTo(GRID_X, y)
    ctx.lineTo(GRID_X + GRID_SIZE, y)
  }
  ctx.stroke()
  ctx.restore()
}

/** 底部数字面板 */
function drawPad(ctx: CanvasRenderingContext2D, s: State): void {
  for (let v = 1; v <= 9; v++) {
    button(ctx, padRect(v), String(v), {
      color: s.noteMode ? COLORS.purple : COLORS.panelLight,
      size: 38,
      disabled: s.over,
    })
  }
  button(ctx, ERASE_RECT, '擦除', {
    color: COLORS.panel,
    size: 32,
    disabled: s.over || s.selected < 0,
  })
}

/** 棋盘下方的一行提示 */
function drawTip(ctx: CanvasRenderingContext2D, s: State): void {
  const tip = s.over
    ? '已通关，点「新题」再来一局'
    : s.noteMode
      ? '笔记模式：点数字记候选，再点一次取消'
      : '点格子选位，点下方数字填入'
  text(ctx, tip, VW / 2, 878, { size: 26, color: COLORS.textDim })
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, '#16263d', '#0b1524')
  topBar(ctx, VW, `数独 · ${difficultyOf(s.puzzle)}`, `提示 ${s.hints} 次`, 96)
  shadowText(ctx, `已填 ${filledCount(s)} 格`, 30, 152, {
    size: 26,
    color: COLORS.textDim,
    weight: 'normal',
    align: 'left',
    maxWidth: 430,
  })

  drawGrid(ctx, s)
  drawTip(ctx, s)
  drawPad(ctx, s)

  if (s.over) banner(ctx, VW, VH, '通关！', `用了 ${s.hints} 次提示 · 得分 ${scoreOf(s)}`, COLORS.green)
}

// ---------------- 输入 ----------------

function input(s: State, p: PointerInput): Action | null {
  if (p.kind !== 'down') return null
  if (s.over) return null

  // 数字面板优先（面板在棋盘下方，不会重叠）
  for (let v = 1; v <= 9; v++) {
    if (inRect(p, padRect(v))) {
      return s.noteMode ? { type: 'toggleNote', value: v } : { type: 'place', value: v }
    }
  }
  if (inRect(p, ERASE_RECT)) return { type: 'place', value: 0 }

  const hit = gridHit(p, GRID_X, GRID_Y, CELL, CELL, SIDE, SIDE)
  if (!hit) return null
  return { type: 'select', index: hit[1] * SIDE + hit[0] }
}

function key(s: State, k: string): Action | null {
  if (s.over) return null
  if (k >= '1' && k <= '9') {
    const v = Number(k)
    return s.noteMode ? { type: 'toggleNote', value: v } : { type: 'place', value: v }
  }
  if (k === 'Backspace' || k === 'Delete' || k === '0') return { type: 'place', value: 0 }
  if (k === 'n' || k === 'N') return { type: 'toggleNoteMode' }
  if (k === 'h' || k === 'H') return { type: 'hint' }
  if (k === 'c' || k === 'C') return { type: 'check' }
  return null
}

// ---------------- 副作用 / 结算 ----------------

function valuesDiffer(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < CELLS; i++) if (a[i] !== b[i]) return true
  return false
}

function effects(prev: State, next: State): Effect[] {
  if (next === prev) return []
  if (next.over && !prev.over) {
    return [
      { kind: 'sound', name: 'win' },
      { kind: 'flash', color: 'rgba(102,187,106,0.3)' },
      { kind: 'burst', x: VW / 2, y: GRID_Y + GRID_SIZE / 2, color: COLORS.green, count: 28 },
    ]
  }
  if (next.puzzle !== prev.puzzle) return [{ kind: 'sound', name: 'click' }]
  if (next.hints > prev.hints) return [{ kind: 'sound', name: 'score' }]
  if (next.checked && !prev.checked) return [{ kind: 'sound', name: 'tick' }]
  for (let i = 0; i < CELLS; i++) {
    if (next.conflict[i] && !prev.conflict[i]) return [{ kind: 'sound', name: 'error' }]
  }
  if (valuesDiffer(prev.values, next.values)) return [{ kind: 'sound', name: 'place' }]
  return [{ kind: 'sound', name: 'click' }]
}

function outcome(s: State): Outcome | null {
  if (!s.over) return null
  return { score: scoreOf(s), better: 'higher', unit: '分', win: true }
}

function hint(s: State): string {
  if (s.over) return `通关！用了 ${s.hints} 次提示，得分 ${scoreOf(s)}`
  return `已填 ${filledCount(s)} / ${blankCount(s.puzzle)} 格 · 提示 ${s.hints} 次 · 行、列、宫里都不能重复`
}

function controls(s: State): Control<Action>[] {
  return [
    { label: '提示', action: { type: 'hint' }, disabled: s.over },
    { label: '检查', action: { type: 'check' }, disabled: s.over },
    { label: s.noteMode ? '笔记：开' : '笔记：关', action: { type: 'toggleNoteMode' } },
    { label: '新题', action: { type: 'newGame' } },
  ]
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
  hint,
  controls,
}

export default game
