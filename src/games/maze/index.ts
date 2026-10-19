/**
 * 随机迷宫渲染 + 输入映射。
 * 规则全在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas、把指针翻译成 action。
 *
 * 三条旁路都不进 state / reduce：
 *   1. 按下滑动缓存：模块级 touch 记录按下点，抬手时才决定是「滑一步」还是「点邻格」；
 *   2. 移动动画：progressSince 以 seq 为签名插值，只把过程补出来，不影响判定；
 *   3. 终点呼吸灯：pulse() 循环相位，纯粹是视觉。
 *
 * **墙一律取自 rules 的 cells 位掩码**，本文件绝不另算一份「哪里有墙」——
 * 渲染和判定一旦各算各的，就会出现「看着有路却走不了」这类没法自查的问题。
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { COLORS, background, banner, disc, fillRoundRect, lighten, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { progressSince, pulse, resetAnims } from '../../render/anim'
import type { Rect } from '../../core/geom'
import { inRect } from '../../core/geom'
import meta from './meta'
import {
  DIRS,
  SLACK_RATE,
  WALL_E,
  WALL_N,
  WALL_S,
  WALL_W,
  coinsFor,
  colOf,
  create,
  exitCell,
  movesOf,
  playerCell,
  reduce,
  rowOf,
  type Action,
  type State,
} from './rules'

// ---------------- 布局常量（render / input 共用，坐标永远一致） ----------------
export const VW = 720
export const VH = 1280
/** 迷宫正方形左上角与边长：656 = 720 - 2×32，留 32 的边距 */
const MAZE_X = 32
const MAZE_Y = 176
const MAZE_SIDE = 656
/** 迷宫底板：输入命中与渲染共用 */
export const MAZE_RECT: Rect = { x: MAZE_X, y: MAZE_Y, w: MAZE_SIDE, h: MAZE_SIDE }
/** 信息条 */
const INFO_RECT: Rect = { x: 32, y: 856, w: 656, h: 80 }
/** 提示条 */
const TIP_RECT: Rect = { x: 32, y: 956, w: 656, h: 88 }
/** 滑一步判定所需的最小位移（逻辑像素，约等于一格） */
const SWIPE_MIN = 40
/** 移动动画时长 */
const MOVE_MS = 150

/** 单格边长 */
function cellSize(cols: number): number {
  return MAZE_SIDE / cols
}

/** 格子中心的画布坐标 */
function cellCenter(state: State, cell: number): { x: number; y: number } {
  const s = cellSize(state.cols)
  return {
    x: MAZE_X + colOf(state.cols, cell) * s + s / 2,
    y: MAZE_Y + rowOf(state.cols, cell) * s + s / 2,
  }
}

/** 指针命中的格子下标，落在迷宫外返回 null */
function cellAtPoint(x: number, y: number, cols: number): number | null {
  if (!inRect({ x, y }, MAZE_RECT)) return null
  const s = cellSize(cols)
  const c = Math.floor((x - MAZE_X) / s)
  const r = Math.floor((y - MAZE_Y) / s)
  if (c < 0 || r < 0 || c >= cols || r >= cols) return null
  return r * cols + c
}

/** 反查方向索引：邻格 to 相对 from 的方向；不相邻返回 -1 */
function dirTowards(cols: number, from: number, to: number): number {
  const dc = colOf(cols, to) - colOf(cols, from)
  const dr = rowOf(cols, to) - rowOf(cols, from)
  for (let d = 0; d < DIRS.length; d++) if (DIRS[d].dc === dc && DIRS[d].dr === dr) return d
  return -1
}

// ---------------- 按下 / 滑动旁路缓存 ----------------
interface Touch {
  x: number
  y: number
  /** 按下时的 seq：中途发生过任何动作就作废这次手势 */
  seq: number
  fired: boolean
}

let touch: Touch | null = null
/** 当前动画缓存对应的关卡，用于换关时清场 */
let animLevel = -1

// ---------------- 绘制 ----------------

function drawPanel(ctx: CanvasRenderingContext2D): void {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, MAZE_RECT.x, MAZE_RECT.y, MAZE_RECT.w, MAZE_RECT.h, 22, withAlpha('#08131f', 0.94))
  ctx.restore()
  fillRoundRect(ctx, MAZE_RECT.x, MAZE_RECT.y, MAZE_RECT.w, MAZE_RECT.h, 22, 'rgba(255,255,255,0.06)', COLORS.line, 2)
}

/** 格子底色：走过的路线留一条淡淡的痕迹，走多远一眼有数 */
function drawCells(ctx: CanvasRenderingContext2D, state: State): void {
  const s = cellSize(state.cols)
  const walked = new Set(state.trail)
  const cur = playerCell(state)
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cell = r * state.cols + c
      const isCur = cell === cur
      const fill = isCur ? 'rgba(255,204,51,0.10)' : walked.has(cell) ? 'rgba(79,209,197,0.13)' : 'rgba(255,255,255,0.035)'
      ctx.fillStyle = fill
      ctx.fillRect(MAZE_X + c * s, MAZE_Y + r * s, s, s)
    }
  }
}

/** 墙：直接读 rules 的位掩码，每个格子四面都判一次，重复描边无副作用 */
function drawWalls(ctx: CanvasRenderingContext2D, state: State): void {
  const s = cellSize(state.cols)
  const w = Math.max(3, s * 0.11)
  ctx.save()
  ctx.strokeStyle = state.clearedThisLevel ? withAlpha(COLORS.green, 0.85) : lighten(COLORS.line, 0.28)
  ctx.lineWidth = w
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cell = r * state.cols + c
      const mask = state.cells[cell]
      const x = MAZE_X + c * s
      const y = MAZE_Y + r * s
      if ((mask & WALL_N) !== 0) {
        ctx.moveTo(x, y)
        ctx.lineTo(x + s, y)
      }
      if ((mask & WALL_W) !== 0) {
        ctx.moveTo(x, y)
        ctx.lineTo(x, y + s)
      }
      if ((mask & WALL_E) !== 0) {
        ctx.moveTo(x + s, y)
        ctx.lineTo(x + s, y + s)
      }
      if ((mask & WALL_S) !== 0) {
        ctx.moveTo(x, y + s)
        ctx.lineTo(x + s, y + s)
      }
    }
  }
  ctx.stroke()
  ctx.restore()
}

/** 终点：右下角一个呼吸的靶环 */
function drawExit(ctx: CanvasRenderingContext2D, state: State): void {
  const p = cellCenter(state, exitCell(state))
  const s = cellSize(state.cols)
  const phase = pulse(1100)
  const done = state.clearedThisLevel
  const color = done ? COLORS.green : COLORS.accent2
  ctx.save()
  ctx.strokeStyle = withAlpha(color, 0.35 + phase * 0.5)
  ctx.lineWidth = Math.max(2, s * 0.06)
  ctx.beginPath()
  ctx.arc(p.x, p.y, s * (0.20 + phase * 0.10), 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = withAlpha(color, 0.95)
  ctx.lineWidth = Math.max(2, s * 0.07)
  ctx.beginPath()
  ctx.arc(p.x, p.y, s * 0.17, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = withAlpha(color, 0.95)
  ctx.beginPath()
  ctx.arc(p.x, p.y, s * 0.07, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** 玩家圆点：位置在两格之间插值，只补过程不改判定 */
function drawPlayer(ctx: CanvasRenderingContext2D, state: State): void {
  const n = state.trail.length
  const cur = playerCell(state)
  const prev = n >= 2 ? state.trail[n - 2] : cur
  const t = n >= 2 ? progressSince('mz-move', String(state.seq), MOVE_MS) : 1
  const a = cellCenter(state, prev)
  const b = cellCenter(state, cur)
  const x = a.x + (b.x - a.x) * t
  const y = a.y + (b.y - a.y) * t
  const s = cellSize(state.cols)
  disc(ctx, x, y, s * 0.28, COLORS.accent, { ring: 'rgba(255,255,255,0.92)' })
}

/** 提示：在正确方向画一个箭头，落在邻格上 */
function drawHint(ctx: CanvasRenderingContext2D, state: State): void {
  if (state.hint < 0) return
  const from = cellCenter(state, playerCell(state))
  const s = cellSize(state.cols)
  const d = DIRS[state.hint]
  const tx = from.x + d.dc * s
  const ty = from.y + d.dr * s
  ctx.save()
  ctx.strokeStyle = COLORS.accent2
  ctx.fillStyle = COLORS.accent2
  ctx.lineWidth = Math.max(3, s * 0.09)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(from.x + d.dc * s * 0.42, from.y + d.dr * s * 0.42)
  ctx.lineTo(tx - d.dc * s * 0.18, ty - d.dr * s * 0.18)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(tx, ty)
  ctx.lineTo(tx - d.dc * s * 0.22 - d.dr * s * 0.16, ty - d.dr * s * 0.22 + d.dc * s * 0.16)
  ctx.lineTo(tx - d.dc * s * 0.22 + d.dr * s * 0.16, ty - d.dr * s * 0.22 - d.dc * s * 0.16)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawInfo(ctx: CanvasRenderingContext2D, state: State): void {
  const moves = movesOf(state)
  const left = state.limit - moves
  const tight = left <= Math.ceil(state.par * SLACK_RATE * 0.4)
  fillRoundRect(ctx, INFO_RECT.x, INFO_RECT.y, INFO_RECT.w, INFO_RECT.h, 20, 'rgba(255,255,255,0.07)')
  text(ctx, `步数 ${moves} / ${state.limit}`, 224, INFO_RECT.y + INFO_RECT.h / 2, { size: 30, weight: 'bold', color: tight ? COLORS.red : COLORS.text })
  text(ctx, `最短 ${state.par} 步`, 460, INFO_RECT.y + INFO_RECT.h / 2, { size: 26, color: COLORS.textDim })
}

function drawTip(ctx: CanvasRenderingContext2D, state: State): void {
  let tip: string
  if (state.over) tip = `步数用光了，本局通关 ${state.cleared} 关`
  else if (state.clearedThisLevel) tip = `过关！用了 ${movesOf(state)} 步（最短 ${state.par} 步）`
  else if (state.hint >= 0) tip = '青色箭头指向正确方向'
  else tip = '点相邻的格子或滑动屏幕走一步'
  fillRoundRect(ctx, TIP_RECT.x, TIP_RECT.y, TIP_RECT.w, TIP_RECT.h, 20, 'rgba(255,255,255,0.07)')
  text(ctx, tip, VW / 2, TIP_RECT.y + TIP_RECT.h / 2, { size: 27, weight: 'bold' })
  text(ctx, '方向键或 WASD 也可以走 · 每关提示限一次', VW / 2, 1096, { size: 22, color: COLORS.textDim })
}

function drawOverlays(ctx: CanvasRenderingContext2D, state: State): void {
  if (state.over) {
    banner(ctx, VW, VH, '本局结束', `通关 ${state.cleared} 关 · 成绩 ${state.cleared}`, COLORS.red)
    return
  }
  if (state.clearedThisLevel) {
    banner(ctx, VW, VH, '过关！', `${movesOf(state)} 步（最短 ${state.par} 步）`, COLORS.green)
  }
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  // 换关时清空动画与手势缓存，避免上一关的残影
  if (state.level !== animLevel) {
    animLevel = state.level
    touch = null
    resetAnims()
  }
  background(ctx, VW, VH, '#1b3350', '#0b1728')
  topBar(ctx, VW, '随机迷宫', `已过 ${state.cleared} 关`, 96)
  shadowText(ctx, `第 ${state.level} 关 · ${state.cols}×${state.rows}`, VW / 2, 138, { size: 30 })

  drawPanel(ctx)
  drawCells(ctx, state)
  drawWalls(ctx, state)
  drawExit(ctx, state)
  drawHint(ctx, state)
  drawPlayer(ctx, state)
  drawInfo(ctx, state)
  drawTip(ctx, state)
  drawOverlays(ctx, state)
}

// ---------------- 副作用 / 结算 ----------------

function effects(prev: State, next: State): Effect[] {
  if (next === prev) return []
  if (next.over && !prev.over) {
    return [
      { kind: 'sound', name: 'lose' },
      { kind: 'shake', power: 0.5 },
      { kind: 'flash', color: 'rgba(239,83,80,0.26)' },
    ]
  }
  if (next.clearedThisLevel && !prev.clearedThisLevel) {
    const p = cellCenter(next, exitCell(next))
    return [
      { kind: 'sound', name: 'win' },
      { kind: 'flash', color: 'rgba(102,187,106,0.24)' },
      { kind: 'burst', x: p.x, y: p.y, color: COLORS.green, count: 22 },
    ]
  }
  if (next.level !== prev.level) return [{ kind: 'sound', name: 'click' }]
  if (next.trail.length === prev.trail.length - 1) return [{ kind: 'sound', name: 'tick' }]
  if (next.trail.length !== prev.trail.length) {
    return [{ kind: 'sound', name: prev.trail.length === 1 ? 'place' : 'click' }]
  }
  if (next.hint !== prev.hint && next.hint >= 0) return [{ kind: 'sound', name: 'score' }]
  return [{ kind: 'sound', name: 'click' }]
}

function outcome(state: State): Outcome | null {
  if (!state.over) return null
  return { score: state.cleared, better: 'higher', unit: ' 关' }
}

function coins(_state: State, out: Outcome, bet: number): number {
  return coinsFor(out.score, bet)
}

function hint(state: State): string {
  if (state.over) return `本局结束：通关 ${state.cleared} 关，成绩 ${state.cleared} 关`
  if (state.clearedThisLevel) return `第 ${state.level} 关过关，用了 ${movesOf(state)} 步，点「下一关」继续`
  const left = state.limit - movesOf(state)
  return `第 ${state.level} 关 · 已走 ${movesOf(state)} 步，还剩 ${left} 步：点相邻的格子或滑动屏幕走一步`
}

function controls(state: State): Control<Action>[] {
  if (state.over) return []
  if (state.clearedThisLevel) {
    return [
      { label: '下一关', action: { type: 'next' }, primary: true },
      { label: '重开本关', action: { type: 'restart' }, disabled: true },
      { label: '撤销一步', action: { type: 'undo' }, disabled: true },
    ]
  }
  return [
    { label: '提示', action: { type: 'hint' }, disabled: state.hintUsed },
    {
      label: '重开本关',
      action: { type: 'restart' },
      disabled: state.trail.length === 1 && state.hint < 0,
    },
    { label: '撤销一步', action: { type: 'undo' }, disabled: state.trail.length <= 1 },
  ]
}

// ---------------- 输入 ----------------

/** 点在相邻格上就朝那格走一步（走不通自然被 reduce 挡掉） */
function tapAction(state: State, x: number, y: number): Action | null {
  const cell = cellAtPoint(x, y, state.cols)
  if (cell === null) return null
  const cur = playerCell(state)
  if (cell === cur) return null
  const dir = dirTowards(state.cols, cur, cell)
  if (dir < 0) return null
  return { type: 'move', dir }
}

/** 滑动：位移超过一格即发一次 move，横竖取绝对值大的那个方向 */
function swipeAction(dx: number, dy: number): Action | null {
  if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return null
  const dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0
  return { type: 'move', dir }
}

function input(state: State, p: PointerInput): Action | null {
  if (state.over || state.clearedThisLevel) return null

  if (p.kind === 'down') {
    touch = { x: p.x, y: p.y, seq: state.seq, fired: false }
    return null
  }

  if (p.kind === 'move') {
    if (touch === null || touch.fired || !p.pressed) return null
    const a = swipeAction(p.x - touch.x, p.y - touch.y)
    if (a !== null) touch.fired = true
    return a
  }

  // 抬手：滑过就认滑动，否则当点击
  const t = touch
  touch = null
  if (t === null || t.fired || t.seq !== state.seq) return null
  return tapAction(state, p.x, p.y)
}

const DIR_KEYS: Record<string, number> = {
  ArrowUp: 0,
  ArrowRight: 1,
  ArrowDown: 2,
  ArrowLeft: 3,
  w: 0,
  d: 1,
  s: 2,
  a: 3,
  W: 0,
  D: 1,
  S: 2,
  A: 3,
}

function key(state: State, k: string): Action | null {
  if (state.over) return null
  if (k === 'z' || k === 'Z') return { type: 'undo' }
  if (k === 'h' || k === 'H') return { type: 'hint' }
  if (k === 'r' || k === 'R') return { type: 'restart' }
  if (state.clearedThisLevel) return k === 'Enter' || k === ' ' ? { type: 'next' } : null
  const dir = DIR_KEYS[k]
  if (dir === undefined) return null
  return { type: 'move', dir }
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
  coins,
  hint,
  controls,
}

export default game
