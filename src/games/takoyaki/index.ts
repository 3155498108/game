/**
 * 章鱼烧 takoyaki —— 渲染 + 输入映射。规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 *
 * 两条动画都走 render/anim.ts 的旁路缓存，state 里没有任何时间戳：
 *   1. 下落：用 progressSince 以「落子序号」为签名，从生成区插值到 rules 已经定好的落点行；
 *   2. 消行后的下移：每格用 tweenTo 过渡到自己的目标 y，键在格子下标上，天然跟随消行。
 * 落点由 reduce 一次算完，动画只是把过程补出来，绝不影响逻辑判定。
 */
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import {
  COLORS,
  background,
  banner,
  disc,
  ease,
  fillRoundRect,
  shadowText,
  text,
  topBar,
  withAlpha,
} from '../../render/draw'
import { progressSince, tweenTo } from '../../render/anim'
import type { Rect } from '../../core/geom'
import { inRect } from '../../core/geom'
import meta from './meta'
import {
  COLS,
  COLOR_COUNT,
  ROWS,
  canDrop,
  create,
  idx,
  landingRow,
  reduce,
  type Action,
  type State,
} from './rules'

// ---------------- 布局常量（render / input 共用，坐标永远不会不一致） ----------------
export const VW = 720
export const VH = 1280

/** 单格边长（规格建议 76~80，取 76 才能让 12 行连同底部提示一起放进 1280 逻辑像素） */
export const CELL = 76
/** 格间缝隙 */
export const GAP = 4
/** 格子步距 */
export const PITCH = CELL + GAP
/** 棋盘宽度 */
export const BOARD_W = COLS * CELL + (COLS - 1) * GAP
/** 棋盘左上角 */
export const BOARD_X = (VW - BOARD_W) / 2
export const BOARD_Y = 262
/** 顶部生成区（球从这里落下） */
export const SPAWN: Rect = { x: BOARD_X, y: 186, w: BOARD_W, h: 66 }
/** 统计面板 */
export const STATS: Rect = { x: 24, y: 100, w: VW - 48, h: 76 }

/** 下落动画时长（毫秒） */
const DROP_MS = 230
/** 消行后格子下移的过渡时长 */
const SETTLE_MS = 170
/** 消行闪光时长 */
const CLEAR_MS = 320

/** 球色表（章鱼烧的暖色系），长度严格等于 rules 里的 COLOR_COUNT */
const BASE_COLORS: readonly string[] = [COLORS.orange, COLORS.pink, COLORS.yellow, COLORS.green, COLORS.blue, COLORS.purple]
const BALL_COLORS: readonly string[] = Array.from({ length: COLOR_COUNT }, (_, i) => BASE_COLORS[i % BASE_COLORS.length])
/** 球半径 */
const BALL_R = CELL / 2 - 5

/** 格子中心点 */
export function cellCenter(col: number, row: number): [number, number] {
  return [BOARD_X + col * PITCH + CELL / 2, BOARD_Y + row * PITCH + CELL / 2]
}

/** 整列的落子热区：宽度 CELL = 76 逻辑像素，远大于 44px 的最小触控目标 */
export function columnZone(col: number): Rect {
  return { x: BOARD_X + col * PITCH, y: SPAWN.y, w: CELL, h: BOARD_Y + ROWS * PITCH - SPAWN.y }
}

/** 命中某一列的落子热区；未命中返回 -1 */
export function hitColumn(p: { x: number; y: number }): number {
  for (let c = 0; c < COLS; c++) if (inRect(p, columnZone(c))) return c
  return -1
}

// ---------------- 绘制 ----------------

/** 画一颗球（章鱼烧的圆面 + 高光 + 顶上的木鱼花） */
function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, color: number, r = BALL_R, alpha = 1): void {
  const fill = BALL_COLORS[(color - 1) % BALL_COLORS.length]
  disc(ctx, x, y, r, fill, { alpha, ring: withAlpha('#000000', 0.25) })
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.beginPath()
  ctx.arc(x - r * 0.34, y - r * 0.36, r * 0.2, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x, y, r * 0.2, 0, Math.PI * 2)
  ctx.fillStyle = withAlpha('#5a2b16', 0.55)
  ctx.fill()
  ctx.restore()
}

function drawStats(ctx: CanvasRenderingContext2D, s: State): void {
  fillRoundRect(ctx, STATS.x, STATS.y, STATS.w, STATS.h, 20, 'rgba(255,255,255,0.07)')
  const cells: [string, string, string][] = [
    ['得分', String(s.score), '总分'],
    ['单次最多', String(s.bestClear), `球/次`],
    ['累计消除', String(s.cleared), '球'],
    ['已落', String(s.drops), '球'],
  ]
  cells.forEach(([label, value, note], i) => {
    const cx = STATS.x + ((i + 0.5) * STATS.w) / cells.length
    text(ctx, label, cx, STATS.y + 22, { size: 21, color: COLORS.textDim })
    shadowText(ctx, value, cx, STATS.y + 46, { size: 30, color: i === 0 ? COLORS.accent : COLORS.text })
    text(ctx, note, cx, STATS.y + 67, { size: 17, color: COLORS.textDim })
  })
}

function drawSpawn(ctx: CanvasRenderingContext2D, s: State): void {
  fillRoundRect(ctx, SPAWN.x, SPAWN.y, SPAWN.w, SPAWN.h, 18, 'rgba(255,255,255,0.06)', withAlpha(COLORS.accent, 0.35), 2)
  text(ctx, '下一个', SPAWN.x + 46, SPAWN.y + SPAWN.h / 2, { size: 24, color: COLORS.textDim })
  drawBall(ctx, SPAWN.x + SPAWN.w / 2, SPAWN.y + SPAWN.h / 2, s.nextColor, BALL_R * 0.82)
}

function drawSlots(ctx: CanvasRenderingContext2D, s: State): void {
  const danger = s.grid.some((v, i) => v !== 0 && i < COLS)
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = BOARD_X + c * PITCH
      const y = BOARD_Y + r * PITCH
      const warn = danger && r === 0
      fillRoundRect(
        ctx,
        x,
        y,
        CELL,
        CELL,
        18,
        warn ? 'rgba(239,83,80,0.22)' : 'rgba(255,255,255,0.05)',
        warn ? withAlpha(COLORS.red, 0.5) : 'rgba(255,255,255,0.07)',
        warn ? 2 : 1,
      )
    }
  }
}

/** 悬停列的落点预览：让玩家在落下之前就知道球会停在哪 */
function drawGhost(ctx: CanvasRenderingContext2D, s: State): void {
  if (s.over || s.hover < 0 || !canDrop(s.grid, s.hover)) return
  const row = landingRow(s.grid, s.hover)
  if (row < 0) return
  const [x, y] = cellCenter(s.hover, row)
  ctx.save()
  ctx.setLineDash([10, 8])
  ctx.lineWidth = 4
  ctx.strokeStyle = withAlpha(COLORS.accent, 0.75)
  ctx.beginPath()
  ctx.arc(x, y, BALL_R, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function drawBalls(ctx: CanvasRenderingContext2D, s: State): void {
  const sig = String(s.seq)
  const clearing = s.lastClear !== null
  const falling = s.lastDrop !== null && !clearing
  const dropP = falling ? progressSince('tk-drop', sig, DROP_MS, ease.inQuad) : 1

  // 本次落子的那一格不在常规循环里画，由下落动画单独负责
  const flying = falling && dropP < 1 ? idx(s.lastDrop?.col ?? 0, s.lastDrop?.row ?? 0) : -1

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(c, r)
      const v = s.grid[i]
      if (v === 0 || i === flying) continue
      const [x, y0] = cellCenter(c, r)
      // 消行后上方整体下移一格：交给 tweenTo 平滑过去，键只跟格子下标有关
      const y = tweenTo(`tk-y${i}`, y0, SETTLE_MS)
      drawBall(ctx, x, y, v)
    }
  }

  if (flying && s.lastDrop) {
    const [x, y1] = cellCenter(s.lastDrop.col, s.lastDrop.row)
    const y0 = SPAWN.y + SPAWN.h / 2
    const y = y0 + (y1 - y0) * dropP
    // 落子期间把旁路缓存钉在动画当前位置，避免落定后又补一段多余的滑动
    tweenTo(`tk-y${flying}`, y, 0)
    drawBall(ctx, x, y, s.grid[flying], BALL_R * (1 + dropP * 0.06))
  }
}

/** 消除闪光：被消掉的行位置会闪一条亮带，随时间淡出 */
function drawClearBands(ctx: CanvasRenderingContext2D, s: State): void {
  if (!s.lastClear || s.lastClear.rows.length === 0) return
  const p = progressSince('tk-clear', String(s.seq), CLEAR_MS)
  if (p <= 0 || p >= 1) return
  const a = 1 - p
  for (const r of s.lastClear.rows) {
    const cy = BOARD_Y + r * PITCH + CELL / 2
    const h = CELL * (0.35 + a * 0.65)
    fillRoundRect(ctx, BOARD_X, cy - h / 2, BOARD_W, h, 12, withAlpha(COLORS.accent, 0.5 * a))
  }
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, '#2c1d13', '#120b07')
  topBar(ctx, VW, '章鱼烧', `${s.score} 分`, 92)
  drawStats(ctx, s)
  drawSpawn(ctx, s)
  drawSlots(ctx, s)
  drawGhost(ctx, s)
  drawBalls(ctx, s)
  drawClearBands(ctx, s)

  const bottom = s.over
    ? `堆到顶部，本局结束 · 单次最多消除 ${s.bestClear} 球`
    : '点任意一列落球 · 填满一整行即消除 · 数字键 1~8 也可落球'
  text(ctx, bottom, VW / 2, 1252, { size: 23, color: COLORS.textDim })

  if (s.over) {
    banner(ctx, VW, VH, '堆到顶了', `得分 ${s.score} · 单次最多消除 ${s.bestClear} 球`, COLORS.accent)
  }
}

// ---------------- 输入 ----------------

function input(s: State, p: PointerInput): Action | null {
  if (p.kind === 'move') {
    const col = p.pressed ? -1 : hitColumn(p)
    return col === -1 ? { type: 'leave' } : { type: 'hover', col }
  }
  if (p.kind !== 'down' || s.over) return null
  const col = hitColumn(p)
  return col >= 0 ? { type: 'drop', col } : null
}

function key(s: State, k: string): Action | null {
  if (s.over) return null
  const c = Number(k)
  return k.length === 1 && k >= '1' && k <= String(COLS) ? { type: 'drop', col: c - 1 } : null
}

// ---------------- 提示 / 结算 / 副作用 ----------------

function hint(s: State): string {
  if (s.over) return `堆到顶部，本局结束：得分 ${s.score}，单次最多消除 ${s.bestClear} 球，共落 ${s.drops} 球`
  const full = Array.from({ length: COLS }, (_, c) => c).filter((c) => !canDrop(s.grid, c)).length
  const tail = full > 0 ? `，已有 ${full} 列堆满` : ''
  return `点一列落下一颗球，填满一整行就会消除${tail} · 当前 ${s.drops} 球 / ${s.score} 分`
}

function outcome(s: State): Outcome | null {
  if (!s.over) return null
  return { score: s.score, better: 'higher', unit: ' 分', win: s.bestClear >= COLS * 2 }
}

function effects(prev: State, next: State): Effect[] {
  if (next === prev) return []
  if (next.over && !prev.over) return [{ kind: 'sound', name: 'lose' }, { kind: 'flash', color: 'rgba(255,204,51,0.22)' }]
  if (next.seq === prev.seq) return [{ kind: 'sound', name: 'error' }]

  const rows = next.lastClear?.rows ?? []
  if (rows.length === 0) return [{ kind: 'sound', name: 'place' }]

  const out: Effect[] = [{ kind: 'sound', name: 'score' }]
  for (const r of rows) out.push({ kind: 'burst', x: VW / 2, y: BOARD_Y + r * PITCH + CELL / 2, color: COLORS.accent, count: 14 })
  if (rows.length >= 2) out.push({ kind: 'shake', power: 8 })
  return out
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  input,
  key,
  hint,
  outcome,
  effects,
}

export default game