/**
 * 贪吃蛇渲染 + 输入映射。规则全在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas、
 * 把真实帧间隔折算成整数 tick、把指针 / 键盘翻译成 action。
 *
 * 三条分层约定（延续 rail-cart）：
 * 1. **墙上时钟只在本文件**：模块级 acc 累加真实 dt，按 TICK_MS 折算成整数 tick，
 *    再以 `{ type: 'tick', ticks }` 交给 rules.reduce。rules.ts 里没有任何时间源。
 * 2. **动画走旁路缓存**：蛇在两格之间的滑行用 tweenTo 平滑，动画状态不进 state。
 * 3. **控件不重复画**：方向键与重开都在 controls() 里声明（由壳渲染成真正的 DOM 按钮，
 *    天然满足 44px 触控目标），画布上不再自绘任何按钮。
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { COLORS, background, banner, disc, ease, fillRoundRect, text, topBar } from '../../render/draw'
import { keepAlive, pulse, tweenTo } from '../../render/anim'
import type { Rect } from '../../core/geom'
import { gridHit } from '../../core/geom'
import meta from './meta'
import {
  COLS,
  ROWS,
  TICK_MS,
  create,
  reduce,
  ticksPerCell,
  type Action,
  type Cell,
  type Dir,
  type State,
} from './rules'

// ---------------- 布局常量（render / input 共用同一份，坐标永远不会不一致） ----------------
const VW = 720
const VH = 1280
/** 格子边长：18 列 × 36 = 648，两侧各留 36 的边距 */
export const CELL = 36
/** 棋盘左上角 */
export const BOARD_X = 36
export const BOARD_Y = 300

/** 棋盘外框 */
export const BOARD_RECT: Rect = { x: BOARD_X, y: BOARD_Y, w: COLS * CELL, h: ROWS * CELL }

/** 第 (col,row) 格的矩形 */
export function cellRect(col: number, row: number): Rect {
  return { x: BOARD_X + col * CELL, y: BOARD_Y + row * CELL, w: CELL, h: CELL }
}

/** 第 (col,row) 格的中心（食物与粒子用） */
export function cellCenter(col: number, row: number): [number, number] {
  const r = cellRect(col, row)
  return [r.x + r.w / 2, r.y + r.h / 2]
}

// ---------------- 帧时间 → tick ----------------
/** 上一帧留下的不足一个 tick 的余量 */
let acc = 0
/** 上一次渲染的状态：换局时壳会给新对象，据此清零余量 */
let lastState: State | null = null
/** 上一次见过的对局序号：重开时序号会变，也据此清零余量 */
let lastSeq = -1

function syncClock(s: State): void {
  if (s !== lastState && s.seq !== lastSeq) {
    lastSeq = s.seq
    acc = 0
  }
  lastState = s
}

/** 站点壳每帧以 dt(ms) 调用：折算成整数 tick 派发给 reduce。dt 不足一个 tick 时返回 0 个 tick */
function tick(dt: number): Action {
  acc += Math.max(0, Math.min(50, dt))
  const n = Math.floor(acc / TICK_MS)
  acc -= n * TICK_MS
  return { type: 'tick', ticks: n }
}

// ---------------- 绘制 ----------------
function drawBoard(ctx: CanvasRenderingContext2D): void {
  fillRoundRect(ctx, BOARD_X - 12, BOARD_Y - 12, BOARD_RECT.w + 24, BOARD_RECT.h + 24, 22, 'rgba(255,255,255,0.05)')
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= COLS; i++) {
    const x = BOARD_X + i * CELL
    ctx.moveTo(x, BOARD_Y)
    ctx.lineTo(x, BOARD_Y + ROWS * CELL)
  }
  for (let i = 0; i <= ROWS; i++) {
    const y = BOARD_Y + i * CELL
    ctx.moveTo(BOARD_X, y)
    ctx.lineTo(BOARD_X + COLS * CELL, y)
  }
  ctx.stroke()
  ctx.restore()
}

function drawFood(ctx: CanvasRenderingContext2D, s: State): void {
  if (s.food.col < 0) return
  const [cx, cy] = cellCenter(s.food.col, s.food.row)
  // 食物轻轻呼吸，玩家一眼就能看到下一个目标在哪
  const r = CELL * 0.3 * (0.92 + 0.12 * pulse(900))
  disc(ctx, cx, cy, r, COLORS.red, { ring: '#8e2020' })
}

/** 蛇头的两只眼睛：眼白 + 朝前方的瞳孔 */
function drawEyes(ctx: CanvasRenderingContext2D, cx: number, cy: number, dir: Dir): void {
  const off: Record<Dir, [number, number][]> = {
    up: [[-6, -7], [6, -7]],
    down: [[-6, 7], [6, 7]],
    left: [[-7, -6], [-7, 6]],
    right: [[7, -6], [7, 6]],
  }
  for (const [dx, dy] of off[dir]) {
    ctx.beginPath()
    ctx.arc(cx + dx, cy + dy, 5, 0, Math.PI * 2)
    ctx.fillStyle = COLORS.white
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx + dx * 0.55, cy + dy * 0.55, 2.4, 0, Math.PI * 2)
    ctx.fillStyle = COLORS.black
    ctx.fill()
  }
}

function drawSnake(ctx: CanvasRenderingContext2D, s: State): void {
  // 补间时长 = 走完一格的时间，滑行速度正好和实际步进一致
  const dur = Math.max(60, ticksPerCell(s.body.length) * TICK_MS)
  const inset = 3
  // 从尾巴往头画，蛇头压在最上面
  for (let i = s.body.length - 1; i >= 0; i--) {
    const seg: Cell = s.body[i]
    const r = cellRect(seg.col, seg.row)
    // 平滑滑行：动画状态只存在旁路缓存里，不进 state
    const x = tweenTo(`snake:${s.seed}:${s.seq}:${i}:x`, r.x, dur, ease.linear)
    const y = tweenTo(`snake:${s.seed}:${s.seq}:${i}:y`, r.y, dur, ease.linear)
    const head = i === 0
    fillRoundRect(
      ctx,
      x + inset,
      y + inset,
      CELL - inset * 2,
      CELL - inset * 2,
      9,
      head ? '#8fe06a' : '#3f9e4d',
      head ? '#c2f5a8' : 'rgba(255,255,255,0.12)',
      2,
    )
    if (head) drawEyes(ctx, x + CELL / 2, y + CELL / 2, s.dir)
  }
}

function drawHud(ctx: CanvasRenderingContext2D, s: State): void {
  topBar(ctx, VW, '贪吃蛇', `${s.score} 分`, 96)
  const per = ticksPerCell(s.body.length)
  text(ctx, `长度 ${s.body.length} · 速度 ${(1000 / (per * TICK_MS)).toFixed(1)} 格/秒`, VW / 2, 140, {
    size: 26,
    color: COLORS.textDim,
  })
}

function drawTip(ctx: CanvasRenderingContext2D, s: State): void {
  const tip = s.alive
    ? '点方向按钮或按方向键转向 · 吃红色食物变长'
    : s.won
      ? '整块棋盘都被你填满了，满分通关'
      : '撞墙或咬到自己了 · 点「重开本局」再来一次'
  fillRoundRect(ctx, 60, VH - 230, VW - 120, 118, 26, 'rgba(255,255,255,0.07)')
  text(ctx, tip, VW / 2, VH - 171, { size: 27, weight: 'bold' })
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  syncClock(s)
  // 蛇一直在滑行，需要每帧重绘
  if (s.alive) keepAlive()

  background(ctx, VW, VH, '#10203a', '#070e1a')
  drawBoard(ctx)
  drawFood(ctx, s)
  drawSnake(ctx, s)
  drawHud(ctx, s)
  drawTip(ctx, s)

  if (!s.alive) {
    if (s.won) banner(ctx, VW, VH, '通关！', `整块棋盘都填满了 · ${s.score} 分`, COLORS.accent)
    else banner(ctx, VW, VH, '结束', `得分 ${s.score} · 长度 ${s.body.length}`, COLORS.red)
  }
}

// ---------------- 输入 ----------------
/**
 * 画布点按：点在蛇头所在的格子之外，就朝那个方向转。
 * 方向按钮在 controls() 里（壳渲染成真正的 DOM 按钮），这里只是桌面端的额外入口。
 */
function input(s: State, p: PointerInput): Action | null {
  if (p.kind !== 'down') return null
  if (!s.alive) return null
  const hit = gridHit(p, BOARD_X, BOARD_Y, CELL, CELL, COLS, ROWS)
  if (!hit) return null
  const col = hit[0]
  const row = hit[1]
  const head = s.body[0]
  const dx = col - head.col
  const dy = row - head.row
  if (dx === 0 && dy === 0) return null
  const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
  return { type: 'turn', dir }
}

/** 键盘：方向键 / WASD 转向，R 重开 */
const DIR_KEYS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
}

function key(_s: State, k: string): Action | null {
  const dir = DIR_KEYS[k]
  if (dir) return { type: 'turn', dir }
  if (k === 'r' || k === 'R') return { type: 'restart' }
  return null
}

// ---------------- 副作用 ----------------
function effects(prev: State, next: State): Effect[] {
  // 死亡优先于吃食物：同一段位移里不可能同时发生，但顺序上先判死更稳
  if (!next.alive && prev.alive) {
    return [
      { kind: 'sound', name: 'hit' },
      { kind: 'shake', power: 14 },
      { kind: 'flash', color: 'rgba(239,83,80,0.35)' },
    ]
  }
  if (next.score > prev.score) {
    // 粒子落在刚被吃掉的那颗食物上
    const [x, y] = cellCenter(prev.food.col, prev.food.row)
    return [
      { kind: 'sound', name: 'score' },
      { kind: 'burst', x, y, color: COLORS.red, count: 14 },
    ]
  }
  if (next.queue.length > prev.queue.length) return [{ kind: 'sound', name: 'click' }]
  return []
}

// ---------------- 壳接口 ----------------
function outcome(s: State): Outcome | null {
  if (s.alive) return null
  return { score: s.score, better: 'higher', unit: ' 分', win: s.won }
}

function hint(s: State): string {
  if (!s.alive) {
    return s.won ? `通关！整块棋盘都填满了，得分 ${s.score}` : `结束，得分 ${s.score}，点「重开本局」再来一次`
  }
  return `得分 ${s.score} · 长度 ${s.body.length} · 点方向按钮或按方向键转向`
}

/** 方向键与重开都交给壳渲染成 DOM 按钮（自动满足 44px 触控目标） */
function controls(s: State): Control<Action>[] {
  const dead = !s.alive
  return [
    { label: '↑', action: { type: 'turn', dir: 'up' }, disabled: dead },
    { label: '↓', action: { type: 'turn', dir: 'down' }, disabled: dead },
    { label: '←', action: { type: 'turn', dir: 'left' }, disabled: dead },
    { label: '→', action: { type: 'turn', dir: 'right' }, disabled: dead },
    { label: '重开本局', action: { type: 'restart' }, primary: dead },
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
  tick,
}

export default game
