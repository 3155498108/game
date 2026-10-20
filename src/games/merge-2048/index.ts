/**
 * 数字合成渲染 + 输入映射。
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 *
 * 两样东西**不进 state**：
 * - 滑动动效：补间状态存在 render/anim.ts 的旁路缓存里（tweenTo），
 *   渲染层自己记着上一帧棋盘，用它算出每个方块是从哪儿滑到哪儿的。
 * - 墙上时钟：只有本文件知道真实时间，dt 累加成整数 tick 后交给 rules.reduce。
 */
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import type { Rect } from '../../core/geom'
import { gridHit, inRect } from '../../core/geom'
import { COLORS, background, banner, fillRoundRect, shadowText, text, topBar } from '../../render/draw'
import { elapsedSince, tweenTo } from '../../render/anim'
import meta from './meta'
import {
  COLS,
  ROWS,
  SIZE,
  TARGET,
  create,
  reduce,
  slideBoard,
  type Action,
  type Dir,
  type State,
} from './rules'

// ---------------- 布局常量（render 与 input 共用同一份，坐标永远不会不一致） ----------------

export const VW = 720
export const VH = 1280
/** 格子边长 */
export const CELL = 150
/** 格子间距 */
export const GAP = 12
/** 棋盘左上角（整体宽 636，居中在 720 里） */
export const GRID_X = 42
export const GRID_Y = 300

/** 整个棋盘的外框：命中判定与底板共用 */
export const GRID_RECT: Rect = {
  x: GRID_X,
  y: GRID_Y,
  w: COLS * CELL + (COLS - 1) * GAP,
  h: ROWS * CELL + (ROWS - 1) * GAP,
}

/** 第 i 个格子（0 起，行优先）的矩形 */
export function cellRect(i: number): Rect {
  const c = i % COLS
  const r = Math.floor(i / COLS)
  return {
    x: GRID_X + c * (CELL + GAP),
    y: GRID_Y + r * (CELL + GAP),
    w: CELL,
    h: CELL,
  }
}

/** 第 i 个格子的中心（粒子特效用） */
export function cellCenter(i: number): [number, number] {
  const r = cellRect(i)
  return [r.x + r.w / 2, r.y + r.h / 2]
}

// ---------------- 配色 ----------------

/** 每个数字对应的底色 */
const TILE_COLOR: Record<number, string> = {
  2: '#cfd8dc', // 浅灰
  4: '#b0bec5', // 灰
  8: '#ffa726', // 橙
  16: '#ef5350', // 红
  32: '#f57c00', // 深橙
  64: '#ffd54f', // 黄
  128: '#66bb6a', // 绿
  256: '#2e7d32', // 深绿
  512: '#26c6da', // 青
  1024: '#42a5f5', // 蓝
  2048: '#ffcc33', // 金
}

/** 取方块底色：表里没有的值一律按 2048 的金色 */
function tileColor(v: number): string {
  return TILE_COLOR[v] ?? TILE_COLOR[TARGET]
}

/** 浅底用深字，其余用白字 */
function tileTextColor(v: number): string {
  if (v <= 4) return '#1b1b1f'
  if (v === TARGET) return '#4a3200'
  return '#ffffff'
}

/** 字号随位数缩小 */
function tileFontSize(v: number): number {
  const digits = String(v).length
  if (digits <= 1) return 64
  if (digits === 2) return 52
  if (digits === 3) return 42
  if (digits === 4) return 34
  return 26
}

// ---------------- 动效（渲染层运行时状态，不进 game state） ----------------

/** 滑动动效时长（毫秒） */
const SLIDE_MS = 160
/** 新方块弹出的时长 */
const POP_MS = 200

interface SlideAnim {
  /** 这是第几次滑动（用 moves 计数） */
  move: number
  /** 滑动方向 */
  dir: Dir
  /** 新位置 → 旧位置 */
  from: number[]
  /** 新方块落在哪一格（-1 表示这次没有新方块） */
  spawn: number
}

/** 上一帧的棋盘：靠它算出方块是从哪儿滑到哪儿的 */
let prevBoard: number[] = []
/** 上一帧的 moves */
let prevMoves = -1
/** 正在播放的滑动动效 */
let anim: SlideAnim | null = null

/** 补间的 key：每次滑动一组，动画状态存在 render/anim.ts 的旁路缓存里 */
const travelKey = (move: number, i: number): string => `m2048:travel:${move}:${i}`
const popKey = (move: number): string => `m2048:pop:${move}`

/** 两个格子之间隔了几格（按滑动方向所在的轴算） */
function travelCells(dir: Dir, from: number, to: number): number {
  if (dir === 'left' || dir === 'right') return Math.abs((from % COLS) - (to % COLS))
  return Math.abs(Math.floor(from / COLS) - Math.floor(to / COLS))
}

/** 发现棋盘变了就准备一次滑动动效（补间交给 render/anim.ts 的旁路缓存保管） */
function updateAnim(s: State): void {
  if (s.moves === prevMoves) return
  const dir = s.lastDir
  if (dir !== null && prevMoves >= 0 && s.moves === prevMoves + 1 && prevBoard.length === SIZE) {
    const sl = slideBoard(prevBoard, dir)
    // 滑动结果与当前棋盘不同的那一格，就是新冒出来的方块
    let spawn = -1
    for (let i = 0; i < SIZE; i++) {
      if (sl.board[i] !== s.board[i]) {
        spawn = i
        break
      }
    }
    anim = { move: s.moves, dir, from: sl.from, spawn }
    for (let i = 0; i < SIZE; i++) {
      const j = sl.from[i]
      if (j < 0 || j === i) continue
      const key = travelKey(s.moves, i)
      tweenTo(key, travelCells(dir, j, i), 0) // 先把起点摆到位
      tweenTo(key, 0, SLIDE_MS) // 再补间到终点
    }
    if (spawn >= 0) {
      const key = popKey(s.moves)
      tweenTo(key, 0, 0)
      tweenTo(key, 1, POP_MS)
    }
  } else {
    anim = null
  }
  prevMoves = s.moves
  prevBoard = s.board.slice()
}

/** 方块相对自己格子的位移（滑动动效用） */
function tileOffset(i: number): [number, number] {
  if (!anim) return [0, 0]
  const j = anim.from[i]
  if (j < 0 || j === i) return [0, 0]
  const remain = tweenTo(travelKey(anim.move, i), 0, SLIDE_MS)
  if (remain <= 0) return [0, 0]
  const step = (CELL + GAP) * remain
  if (anim.dir === 'left') return [step, 0]
  if (anim.dir === 'right') return [-step, 0]
  if (anim.dir === 'up') return [0, step]
  return [0, -step]
}

/** 新方块弹出的缩放（1 表示不再缩放） */
function tileScale(i: number): number {
  if (!anim || anim.spawn !== i) return 1
  return 0.7 + 0.3 * tweenTo(popKey(anim.move), 1, POP_MS)
}

// ---------------- 文案 ----------------

function subtitle(s: State): string {
  if (s.over) return '棋盘塞满又没法合并，本局结束'
  if (s.won) return '已通关，继续挑战更高分'
  return '滑动棋盘，把相同数字并成双倍'
}

/** 通关横幅只亮一小会儿，之后让玩家接着玩 */
function winBannerOn(s: State): boolean {
  if (!s.won || s.wonAt === null) return false
  return elapsedSince('m2048-win', String(s.wonAt), 2200) < 2200
}

// ---------------- 绘制 ----------------

function drawTile(
  ctx: CanvasRenderingContext2D,
  value: number,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
): void {
  ctx.save()
  if (scale !== 1) {
    const cx = x + w / 2
    const cy = y + h / 2
    ctx.translate(cx, cy)
    ctx.scale(scale, scale)
    ctx.translate(-cx, -cy)
  }
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 4
  fillRoundRect(ctx, x, y, w, h, 18, tileColor(value))
  ctx.restore()
  shadowText(ctx, String(value), x + w / 2, y + h / 2, {
    size: tileFontSize(value),
    color: tileTextColor(value),
  })
  ctx.restore()
}

function drawBoard(ctx: CanvasRenderingContext2D, s: State): void {
  // 底板 + 空格
  fillRoundRect(ctx, GRID_RECT.x - 16, GRID_RECT.y - 16, GRID_RECT.w + 32, GRID_RECT.h + 32, 26, 'rgba(255,255,255,0.07)')
  for (let i = 0; i < SIZE; i++) {
    const r = cellRect(i)
    fillRoundRect(ctx, r.x, r.y, r.w, r.h, 18, 'rgba(255,255,255,0.05)')
  }
  // 按住的那一格高亮一下，提示「从这儿开始滑」
  if (s.dragStart) {
    const hit = gridHit(s.dragStart, GRID_X, GRID_Y, CELL + GAP, CELL + GAP, COLS, ROWS)
    if (hit) {
      const r = cellRect(hit[1] * COLS + hit[0])
      fillRoundRect(ctx, r.x, r.y, r.w, r.h, 18, 'rgba(255,204,51,0.14)')
    }
  }
  // 方块
  for (let i = 0; i < SIZE; i++) {
    const v = s.board[i]
    if (v === 0) continue
    const r = cellRect(i)
    const [ox, oy] = tileOffset(i)
    drawTile(ctx, v, r.x + ox, r.y + oy, r.w, r.h, tileScale(i))
  }
}

function drawTip(ctx: CanvasRenderingContext2D, s: State): void {
  const tip = s.over ? '点「重开」再来一局' : '在棋盘上滑动手指，或用方向键'
  fillRoundRect(ctx, 60, GRID_Y + GRID_RECT.h + 44, VW - 120, 96, 24, 'rgba(255,255,255,0.07)')
  text(ctx, tip, VW / 2, GRID_Y + GRID_RECT.h + 92, { size: 28, weight: 'bold' })
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  updateAnim(s)
  background(ctx, VW, VH, '#1d2f4d', '#0a1220')
  topBar(ctx, VW, `分数 ${s.score}`, `目标 ${TARGET}`, 96)
  shadowText(ctx, subtitle(s), VW / 2, 142, { size: 26, color: COLORS.textDim, weight: 'normal' })

  drawBoard(ctx, s)
  drawTip(ctx, s)

  if (s.over) banner(ctx, VW, VH, '结束', `最终得分 ${s.score}`, COLORS.red)
  else if (winBannerOn(s)) banner(ctx, VW, VH, '通关！', '合成出 2048，接着挑战更高分', COLORS.accent)
}

// ---------------- 输入 ----------------

function input(s: State, p: PointerInput): Action | null {
  if (s.over) return null
  if (p.kind === 'down') {
    // 只有从棋盘上按下的手指才算滑动
    if (!inRect(p, GRID_RECT)) return null
    return { type: 'press', x: p.x, y: p.y }
  }
  if (p.kind === 'move') {
    if (!s.dragStart) return null
    return { type: 'drag', x: p.x, y: p.y }
  }
  if (p.kind === 'up') {
    if (!s.dragStart) return null
    return { type: 'release' }
  }
  return null
}

function key(_s: State, k: string): Action | null {
  if (k === 'ArrowUp' || k === 'w' || k === 'W') return { type: 'move', dir: 'up' }
  if (k === 'ArrowDown' || k === 's' || k === 'S') return { type: 'move', dir: 'down' }
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') return { type: 'move', dir: 'left' }
  if (k === 'ArrowRight' || k === 'd' || k === 'D') return { type: 'move', dir: 'right' }
  if (k === 'r' || k === 'R') return { type: 'restart' }
  return null
}

// ---------------- 时间（只有这一层知道真实时间） ----------------

/** 真实 dt 的累计量（渲染层运行时状态，不进 game state） */
let acc = 0
/** 一个 tick 对应的毫秒数 */
const TICK_MS = 16

/** 站点壳每帧调用：把真实 dt 折成整数 tick 交给规则层 */
function tick(dt: number): Action {
  const ms = Number.isFinite(dt) ? dt : TICK_MS
  acc += ms
  const ticks = Math.floor(acc / TICK_MS)
  acc -= ticks * TICK_MS
  return { type: 'tick', ticks: Math.max(0, ticks) }
}

// ---------------- 副作用与成绩 ----------------

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (next.moves > prev.moves) out.push({ kind: 'sound', name: 'place' })
  if (next.score > prev.score) out.push({ kind: 'sound', name: 'score' })
  if (next.won && !prev.won) {
    out.push({ kind: 'sound', name: 'win' })
    out.push({ kind: 'flash', color: 'rgba(255,204,51,0.28)' })
    const at = next.board.indexOf(TARGET)
    if (at >= 0) {
      const [x, y] = cellCenter(at)
      out.push({ kind: 'burst', x, y, color: COLORS.accent, count: 22 })
    }
  }
  if (next.over && !prev.over) {
    out.push({ kind: 'sound', name: 'lose' })
    out.push({ kind: 'shake', power: 10 })
  }
  return out
}

function outcome(s: State): Outcome | null {
  if (!s.over) return null
  return { score: s.score, better: 'higher', unit: '分', win: s.won }
}

function hint(s: State): string {
  if (s.over) return `本局结束，最终得分 ${s.score}`
  if (s.won) return `已合成 2048！当前得分 ${s.score}，继续挑战更高分`
  return `当前得分 ${s.score}，滑动棋盘把相同数字并起来`
}

function controls(s: State) {
  return [
    { label: '上', action: { type: 'move', dir: 'up' } as Action, disabled: s.over },
    { label: '下', action: { type: 'move', dir: 'down' } as Action, disabled: s.over },
    { label: '左', action: { type: 'move', dir: 'left' } as Action, disabled: s.over },
    { label: '右', action: { type: 'move', dir: 'right' } as Action, disabled: s.over },
    { label: '重开', action: { type: 'restart' } as Action },
  ]
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  input,
  key,
  tick,
  effects,
  outcome,
  hint,
  controls,
}

export default game
