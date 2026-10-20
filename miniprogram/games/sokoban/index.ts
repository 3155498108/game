/**
 * 推箱子 · 渲染与游戏模块装配（唯一允许接触 Canvas 的地方）
 *
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 *
 * ## 布局
 * 关卡尺寸不固定（7×5 到 11×7 都有），所以格子大小按关卡现算：
 * 取「能放下的最大正方形格子」并整体居中。render 与 input 共用 `gridLayout()`，
 * 坐标永远不会不一致。
 *
 * ## 提示的求解结果不进 state
 * 「这一关最短几步」是纯函数 `levelBestMoves()` 的结果，渲染时现算即可；
 * 真正需要存进 state 的只有玩家按下「提示」时算出的**下一步方向**。
 */
import type { Control, Effect, GameModule, PointerInput } from '../../core/types'
import { COLORS, background, banner, disc, fillRoundRect, shadowText, topBar, withAlpha } from '../../render/draw'
import { pulse } from '../../render/anim'
import type { Rect } from '../../core/geom'
import meta from './meta'
import {
  DIR_GLYPH,
  DIR_VECTORS,
  LEVELS,
  type Action,
  type Dir,
  type Parsed,
  type State,
  clearedCount,
  create,
  levelBestMoves,
  reduce,
  remainingBoxes,
} from './rules'

const VW = meta.viewport.width
const VH = meta.viewport.height

/** 棋盘可用区域（逻辑坐标） */
const AREA_X = 30
const AREA_Y = 215
const AREA_W = VW - AREA_X * 2
const AREA_H = 880

/** 网格布局：格子边长 + 网格左上角 */
export interface GridLayout {
  cell: number
  x: number
  y: number
}

export function gridLayout(p: Parsed): GridLayout {
  const cell = Math.floor(Math.min(AREA_W / p.w, AREA_H / p.h))
  const gw = cell * p.w
  const gh = cell * p.h
  return {
    cell,
    x: Math.round((VW - gw) / 2),
    y: Math.round(AREA_Y + (AREA_H - gh) / 2),
  }
}

/** 某个格子的矩形 */
export function cellRect(p: Parsed, index: number): Rect {
  const l = gridLayout(p)
  const x = index % p.w
  const y = Math.floor(index / p.w)
  return { x: l.x + x * l.cell, y: l.y + y * l.cell, w: l.cell, h: l.cell }
}

/** 逻辑坐标 → 格子下标；不在棋盘上返回 -1 */
export function cellAt(p: Parsed, px: number, py: number): number {
  const l = gridLayout(p)
  const cx = Math.floor((px - l.x) / l.cell)
  const cy = Math.floor((py - l.y) / l.cell)
  if (cx < 0 || cy < 0 || cx >= p.w || cy >= p.h) return -1
  return cy * p.w + cx
}

/** 每一关的最短步数（纯函数结果，缓存一下免得每帧重算） */
const BEST_CACHE = new Map<number, number | null>()

function bestMoves(levelId: number): number | null {
  if (!BEST_CACHE.has(levelId)) BEST_CACHE.set(levelId, levelBestMoves(LEVELS[levelId]))
  return BEST_CACHE.get(levelId) ?? null
}

// ==================================================================
// 绘制
// ==================================================================

function drawBoard(ctx: CanvasRenderingContext2D, s: State): void {
  const p = s.level
  const l = gridLayout(p)
  const targetSet = new Set(p.targets)

  // 地板
  ctx.fillStyle = '#0d1a2b'
  ctx.fillRect(l.x - 8, l.y - 8, p.w * l.cell + 16, p.h * l.cell + 16)

  for (let i = 0; i < p.w * p.h; i++) {
    const r = cellRect(p, i)
    const inset = Math.max(1, Math.round(l.cell * 0.06))
    const box = { x: r.x + inset, y: r.y + inset, w: r.w - inset * 2, h: r.h - inset * 2 }
    if (p.walls[i]) {
      fillRoundRect(ctx, box.x, box.y, box.w, box.h, Math.max(3, l.cell * 0.12), COLORS.panelLight, COLORS.line, 2)
      continue
    }
    // 地板格子：淡淡的棋盘格纹理
    const gx = i % p.w
    const gy = Math.floor(i / p.w)
    ctx.fillStyle = (gx + gy) % 2 === 0 ? '#13233a' : '#101d31'
    ctx.fillRect(r.x, r.y, r.w, r.h)
    if (targetSet.has(i)) {
      // 目标点：一个圈
      const cx = r.x + r.w / 2
      const cy = r.y + r.h / 2
      const rad = l.cell * 0.26
      ctx.beginPath()
      ctx.arc(cx, cy, rad, 0, Math.PI * 2)
      ctx.strokeStyle = withAlpha(COLORS.accent, 0.75)
      ctx.lineWidth = Math.max(2, l.cell * 0.07)
      ctx.stroke()
      ctx.fillStyle = withAlpha(COLORS.accent, 0.16)
      ctx.fill()
    }
  }

  // 箱子
  for (const b of s.boxes) {
    const r = cellRect(p, b)
    const inset = Math.max(2, Math.round(l.cell * 0.12))
    const box = { x: r.x + inset, y: r.y + inset, w: r.w - inset * 2, h: r.h - inset * 2 }
    const on = targetSet.has(b)
    fillRoundRect(ctx, box.x, box.y, box.w, box.h, Math.max(3, l.cell * 0.14), on ? COLORS.accent2 : COLORS.wood, COLORS.woodDark, 3)
    // 箱子上的十字纹
    ctx.save()
    ctx.strokeStyle = on ? withAlpha('#0b1220', 0.5) : withAlpha(COLORS.woodDark, 0.9)
    ctx.lineWidth = Math.max(2, l.cell * 0.08)
    const m = box.w * 0.26
    ctx.beginPath()
    ctx.moveTo(box.x + m, box.y + m)
    ctx.lineTo(box.x + box.w - m, box.y + box.h - m)
    ctx.moveTo(box.x + box.w - m, box.y + m)
    ctx.lineTo(box.x + m, box.y + box.h - m)
    ctx.stroke()
    ctx.restore()
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, s: State): void {
  const r = cellRect(s.level, s.player)
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const rad = r.w * 0.31
  // 提示态：玩家外圈呼吸
  if (s.hint) {
    const k = pulse(900)
    ctx.save()
    ctx.globalAlpha = 0.25 + 0.35 * k
    ctx.beginPath()
    ctx.arc(cx, cy, rad * (1.25 + 0.25 * k), 0, Math.PI * 2)
    ctx.strokeStyle = COLORS.accent
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.restore()
  }
  disc(ctx, cx, cy, rad, COLORS.accent)
  // 眼睛
  const eye = rad * 0.16
  const ey = cy - rad * 0.12
  ctx.fillStyle = '#2a1f00'
  ctx.beginPath()
  ctx.arc(cx - rad * 0.3, ey, eye, 0, Math.PI * 2)
  ctx.arc(cx + rad * 0.3, ey, eye, 0, Math.PI * 2)
  ctx.fill()
}

function drawHintArrow(ctx: CanvasRenderingContext2D, s: State): void {
  if (!s.hint) return
  const [dx, dy] = DIR_VECTORS[s.hint]
  const p = s.level
  const nx = (s.player % p.w) + dx
  const ny = Math.floor(s.player / p.w) + dy
  if (nx < 0 || nx >= p.w || ny < 0 || ny >= p.h) return
  const r = cellRect(p, ny * p.w + nx)
  const k = pulse(700)
  ctx.save()
  ctx.globalAlpha = 0.55 + 0.45 * k
  shadowText(ctx, DIR_GLYPH[s.hint], r.x + r.w / 2, r.y + r.h / 2, {
    size: r.w * 0.62,
    color: COLORS.accent2,
    shadow: 'rgba(0,0,0,0.7)',
  })
  ctx.restore()
}

function drawFooter(ctx: CanvasRenderingContext2D, s: State): void {
  const best = bestMoves(s.levelId)
  const left = `第 ${s.levelIndex + 1} / ${s.order.length} 关 · ${LEVELS[s.levelId].name}`
  const right = `步 ${s.moves} · 推 ${s.pushes}`
  topBar(ctx, VW, left, right, 92)
  const rest = remainingBoxes(s)
  const sub =
    s.phase === 'won'
      ? `本关用 ${s.moves} 步完成，最短 ${best ?? '?'} 步 · 点「下一关」继续`
      : s.phase === 'allclear'
        ? '全部关卡都推完了'
        : `还有 ${rest} 个箱子没归位 · 最短 ${best ?? '?'} 步`
  shadowText(ctx, sub, VW / 2, 142, { size: 25, color: COLORS.textDim, weight: 'normal' })
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, '#10203a', '#070e1a')
  drawFooter(ctx, s)
  drawBoard(ctx, s)
  drawHintArrow(ctx, s)
  drawPlayer(ctx, s)

  if (s.phase === 'allclear') {
    banner(ctx, VW, VH, '全部通关！', `12 关都推完了，共 ${s.moves} 步`)
  }
}

// ==================================================================
// 输入
// ==================================================================

/** 点相邻格 → 走一步（手机上最顺手的操作方式） */
function input(s: State, p: PointerInput): Action | null {
  if (p.kind !== 'down') return null
  if (s.phase !== 'play') return null
  const idx = cellAt(s.level, p.x, p.y)
  if (idx < 0 || idx === s.player) return null
  const px = s.player % s.level.w
  const py = Math.floor(s.player / s.level.w)
  const cx = idx % s.level.w
  const cy = Math.floor(idx / s.level.w)
  const dx = cx - px
  const dy = cy - py
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null
  const dir: Dir = dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up'
  return { type: 'move', dir }
}

function key(s: State, k: string): Action | null {
  const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' }
  const dir = map[k]
  if (!dir) return null
  if (s.phase !== 'play') return null
  return { type: 'move', dir }
}

// ==================================================================
// 副作用与展示
// ==================================================================

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (next.phase === 'won' && prev.phase !== 'won') {
    out.push({ kind: 'sound', name: 'win' })
    out.push({ kind: 'flash', color: 'rgba(255,204,51,0.28)' })
    for (const b of next.boxes) {
      const r = cellRect(next.level, b)
      out.push({ kind: 'burst', x: r.x + r.w / 2, y: r.y + r.h / 2, color: COLORS.accent2, count: 12 })
    }
    return out
  }
  if (next.phase === 'allclear' && prev.phase !== 'allclear') {
    out.push({ kind: 'sound', name: 'win' })
    return out
  }
  // 箱子被推到目标点上：清脆一声
  const prevBoxes = new Set(prev.boxes)
  const targetSet = new Set(next.level.targets)
  for (const b of next.boxes) {
    if (!prevBoxes.has(b) && targetSet.has(b)) out.push({ kind: 'sound', name: 'place' })
  }
  if (out.length === 0 && next.moves > prev.moves) out.push({ kind: 'sound', name: 'click' })
  return out
}

function outcome(s: State) {
  if (s.phase === 'play') return null
  return { score: clearedCount(s), better: 'higher' as const, unit: ' 关', win: true }
}

function hint(s: State): string {
  if (s.phase === 'allclear') return '全部关卡都推完了，厉害'
  if (s.phase === 'won') return `过关！本关 ${s.moves} 步（最短 ${bestMoves(s.levelId) ?? '?'} 步）`
  return `${LEVELS[s.levelId].name} · 已走 ${s.moves} 步 · 还剩 ${remainingBoxes(s)} 个箱子`
}

function controls(s: State): Control<Action>[] {
  if (s.phase === 'won') {
    return [
      { label: '下一关', action: { type: 'next' }, primary: true },
      { label: '重打本关', action: { type: 'reset' } },
    ]
  }
  if (s.phase !== 'play') return []
  return [
    { label: '↑', action: { type: 'move', dir: 'up' } },
    { label: '↓', action: { type: 'move', dir: 'down' } },
    { label: '←', action: { type: 'move', dir: 'left' } },
    { label: '→', action: { type: 'move', dir: 'right' } },
    { label: '撤销', action: { type: 'undo' }, disabled: s.history.length === 0 },
    { label: '提示', action: { type: 'hint' } },
    { label: '重开', action: { type: 'reset' } },
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
