/**
 * 快艇骰子：渲染 + 输入映射。规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 *
 * 掷骰的滚动动画是纯渲染：点数在 roll action 里一次性确定，动画签名用
 * 「轮次 / 累计投掷次数」，走 render/anim.ts 的旁路缓存，因此 reduce 里没有任何时间戳。
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { COLORS, background, banner, button, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { elapsedSince, progressSince } from '../../render/anim'
import type { Rect } from '../../core/geom'
import { inRect } from '../../core/geom'
import meta from './meta'
import {
  DIE_COUNT,
  MAX_SCORE,
  ROLLS_PER_ROUND,
  SLOT_COUNT,
  SLOTS,
  UPPER_BONUS,
  UPPER_BONUS_TARGET,
  UPPER_SLOT_COUNT,
  bestSlot,
  create,
  lowerTotal,
  reduce,
  scoreFor,
  totalScore,
  upperTotal,
  worstSlot,
  yahtzeeBonus,
  type Action,
  type State,
} from './rules'

/** 达到这个分数算「高手局」，仅用于结算展示 */
export const GOOD_SCORE = 250

// ---------------- 布局：render 与 input 共用同一份常量，坐标永远不会不一致 ----------------

export const VW = 720
export const VH = 1280

/** 顶部总分面板 */
export const SCORE_PANEL: Rect = { x: 24, y: 112, w: VW - 48, h: 92 }
/** 骰子 */
export const DIE_SIZE = 104
export const DIE_GAP = 18
export const DIE_X = (VW - (DIE_COUNT * DIE_SIZE + (DIE_COUNT - 1) * DIE_GAP)) / 2
export const DIE_Y = 236
/** 投掷按钮 */
export const ROLL_BTN: Rect = { x: 190, y: 390, w: 340, h: 92 }
/** 上段计分格：3 列 × 2 行 */
export const UPPER_LAYOUT = { x: 28, y: 524, w: 208, h: 92, cols: 3, rows: 2, gapX: 20, gapY: 20 }
/** 下段计分格：4 列 × 2 行 */
export const LOWER_LAYOUT = { x: 25, y: 752, w: 154, h: 92, cols: 4, rows: 2, gapX: 18, gapY: 18 }
/** 上段 63 分进度条 */
export const PROGRESS_BAR: Rect = { x: 24, y: 988, w: VW - 48, h: 64 }

type Grid = typeof UPPER_LAYOUT

/** 第 i 颗骰子的矩形 */
export function dieRect(i: number): Rect {
  return { x: DIE_X + i * (DIE_SIZE + DIE_GAP), y: DIE_Y, w: DIE_SIZE, h: DIE_SIZE }
}

/** 第 i 颗骰子的中心（粒子用） */
export function dieCenter(i: number): [number, number] {
  const r = dieRect(i)
  return [r.x + r.w / 2, r.y + r.h / 2]
}

/** 第 slot 个计分格的矩形 */
export function slotRect(slot: number): Rect {
  const g: Grid = slot < UPPER_SLOT_COUNT ? UPPER_LAYOUT : LOWER_LAYOUT
  const local = slot < UPPER_SLOT_COUNT ? slot : slot - UPPER_SLOT_COUNT
  const col = local % g.cols
  const row = Math.floor(local / g.cols)
  return { x: g.x + col * (g.w + g.gapX), y: g.y + row * (g.h + g.gapY), w: g.w, h: g.h }
}

/** 第 slot 个计分格的中心（粒子用） */
export function slotCenter(slot: number): [number, number] {
  const r = slotRect(slot)
  return [r.x + r.w / 2, r.y + r.h / 2]
}

/** 命中某个计分格；没命中返回 -1 */
export function hitSlot(p: { x: number; y: number }): number {
  for (let slot = 0; slot < SLOT_COUNT; slot++) if (inRect(p, slotRect(slot))) return slot
  return -1
}

/** 命中某颗骰子；没命中返回 -1。热区比骰面略大一圈，缩放到手机后仍 ≥44px */
export function hitDie(p: { x: number; y: number }): number {
  for (let i = 0; i < DIE_COUNT; i++) {
    const r = dieRect(i)
    if (inRect(p, { x: r.x - 12, y: r.y - 16, w: r.w + 24, h: r.h + 32 })) return i
  }
  return -1
}

// ---------------- 骰面（纯程序绘制，无图片资源） ----------------

/** 各点数在 3×3 网格里的点位 */
const PIPS: readonly (readonly (readonly [number, number])[])[] = [
  [],
  [[1, 1]],
  [[0, 0], [2, 2]],
  [[0, 0], [1, 1], [2, 2]],
  [[0, 0], [2, 0], [0, 2], [2, 2]],
  [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
]

function drawDie(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, face: number, kept: boolean, dim: boolean): void {
  const lift = kept ? 10 : 0
  const bx = x
  const by = y - lift
  ctx.save()
  if (kept) {
    ctx.shadowColor = withAlpha(COLORS.accent, 0.55)
    ctx.shadowBlur = 18
  }
  fillRoundRect(ctx, bx, by, size, size, 20, dim ? '#cdd6e4' : COLORS.white, kept ? COLORS.accent : '#c8d3e2', kept ? 5 : 2)
  ctx.restore()

  const pip = PIPS[face] ?? []
  const cell = size / 3
  const r = size * 0.088
  ctx.save()
  ctx.fillStyle = '#1b1b1f'
  for (const p of pip) {
    ctx.beginPath()
    ctx.arc(bx + (p[0] + 0.5) * cell, by + (p[1] + 0.5) * cell, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

// ---------------- 绘制 ----------------

/** 掷骰动画签名：轮次或累计投掷次数变了就重播 */
const rollSig = (s: State): string => `${s.round}/${s.throws}`
const ROLL_MS = 460

function drawScorePanel(ctx: CanvasRenderingContext2D, s: State): void {
  fillRoundRect(ctx, SCORE_PANEL.x, SCORE_PANEL.y, SCORE_PANEL.w, SCORE_PANEL.h, 20, 'rgba(255,255,255,0.07)')
  const up = upperTotal(s)
  const lo = lowerTotal(s)
  const cells: [string, string, string][] = [
    ['上段', `${up} / ${UPPER_BONUS_TARGET}`, up >= UPPER_BONUS_TARGET ? `+${UPPER_BONUS}` : `差 ${UPPER_BONUS_TARGET - up}`],
    ['下段', `${lo}`, yahtzeeBonus(s) > 0 ? `快艇 +${yahtzeeBonus(s)}` : '下段 7 格'],
    ['总计', `${totalScore(s)}`, `满分 ${MAX_SCORE}`],
  ]
  cells.forEach(([label, value, note], i) => {
    const cx = SCORE_PANEL.x + ((i + 0.5) * SCORE_PANEL.w) / 3
    text(ctx, label, cx, SCORE_PANEL.y + 26, { size: 22, color: COLORS.textDim })
    shadowText(ctx, value, cx, SCORE_PANEL.y + 58, { size: 32, color: i === 2 ? COLORS.accent : COLORS.text })
    text(ctx, note, cx, SCORE_PANEL.y + 84, { size: 18, color: up >= UPPER_BONUS_TARGET && i === 0 ? COLORS.green : COLORS.textDim })
  })
}

function drawDice(ctx: CanvasRenderingContext2D, s: State): void {
  const ready = s.dice.length === DIE_COUNT
  const e = ready ? elapsedSince('yz-roll', rollSig(s), ROLL_MS) : ROLL_MS
  const rolling = ready && e < ROLL_MS && s.throws > 0
  const settle = ready ? progressSince('yz-roll', rollSig(s), 280) : 1
  const bounce = rolling ? 0 : Math.sin(settle * Math.PI) * 12

  for (let i = 0; i < DIE_COUNT; i++) {
    const r = dieRect(i)
    const kept = ready && s.keep[i]
    // 滚动中的点数只是纯视觉轮播，真实点数已经在 roll action 里定好
    const face = rolling && !kept ? ((Math.floor(e / 55) + i * 3 + s.throws) % 6) + 1 : ready ? s.dice[i] : 1
    if (ready) drawDie(ctx, r.x, r.y - bounce, r.w, face, kept, false)
    else drawDie(ctx, r.x, r.y, r.w, 1, false, true)
  }

  const tip = !ready ? '点「投掷」掷出 5 颗骰子' : s.rollsLeft > 0 ? '点骰子勾选保留（最多 3 次投掷）' : '投掷次数已用完，点计分格收下本轮'
  text(ctx, tip, VW / 2, DIE_Y + DIE_SIZE + 30, { size: 22, color: COLORS.textDim })
}

function drawSlot(ctx: CanvasRenderingContext2D, s: State, slot: number, best: number): void {
  const def = SLOTS[slot]
  const r = slotRect(slot)
  const v = s.slots[slot]
  const filled = v !== null
  const isBest = !filled && best === slot && s.dice.length === DIE_COUNT
  const bg = filled ? withAlpha(COLORS.accent, 0.16) : isBest ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.05)'
  const border = filled ? withAlpha(COLORS.accent, 0.5) : isBest ? COLORS.accent : 'rgba(255,255,255,0.12)'
  fillRoundRect(ctx, r.x, r.y, r.w, r.h, 16, bg, border, isBest ? 4 : 2)

  text(ctx, def.label, r.x + r.w / 2, r.y + 24, { size: 24, color: filled ? COLORS.text : COLORS.textDim, weight: 'bold' })
  if (filled) {
    shadowText(ctx, String(v), r.x + r.w / 2, r.y + 62, { size: 34, color: v > 0 ? COLORS.accent : COLORS.textDim })
  } else {
    const gain = s.dice.length === DIE_COUNT ? scoreFor(slot, s.dice) : -1
    text(ctx, gain < 0 ? '—' : `${gain}`, r.x + r.w / 2, r.y + 62, {
      size: 30,
      color: gain > 0 ? (isBest ? COLORS.accent : COLORS.text) : 'rgba(159,179,207,0.5)',
    })
  }
}

function drawSlots(ctx: CanvasRenderingContext2D, s: State): void {
  const best = bestSlot(s)
  text(ctx, '上段（合计 ≥63 额外 +35）', UPPER_LAYOUT.x, UPPER_LAYOUT.y - 20, { size: 24, color: COLORS.textDim, align: 'left', weight: 'bold' })
  for (let slot = 0; slot < UPPER_SLOT_COUNT; slot++) drawSlot(ctx, s, slot, best)
  text(ctx, '下段', LOWER_LAYOUT.x, LOWER_LAYOUT.y - 20, { size: 24, color: COLORS.textDim, align: 'left', weight: 'bold' })
  for (let slot = UPPER_SLOT_COUNT; slot < SLOT_COUNT; slot++) drawSlot(ctx, s, slot, best)
}

function drawProgress(ctx: CanvasRenderingContext2D, s: State): void {
  const up = upperTotal(s)
  const got = up >= UPPER_BONUS_TARGET
  fillRoundRect(ctx, PROGRESS_BAR.x, PROGRESS_BAR.y, PROGRESS_BAR.w, PROGRESS_BAR.h, 18, 'rgba(255,255,255,0.07)')
  const barX = PROGRESS_BAR.x + 20
  const barW = PROGRESS_BAR.w - 40
  const ratio = Math.max(0, Math.min(1, up / UPPER_BONUS_TARGET))
  fillRoundRect(ctx, barX, PROGRESS_BAR.y + 40, barW, 12, 6, 'rgba(255,255,255,0.12)')
  if (ratio > 0) fillRoundRect(ctx, barX, PROGRESS_BAR.y + 40, barW * ratio, 12, 6, got ? COLORS.green : COLORS.accent)
  text(ctx, got ? `上段 ${up} · 已拿到 +${UPPER_BONUS}` : `上段 ${up} / ${UPPER_BONUS_TARGET}，还差 ${UPPER_BONUS_TARGET - up}`, barX, PROGRESS_BAR.y + 22, {
    size: 22,
    color: got ? COLORS.green : COLORS.textDim,
    align: 'left',
  })
  text(ctx, `第 ${s.round} / ${SLOT_COUNT} 轮`, PROGRESS_BAR.x + PROGRESS_BAR.w - 20, PROGRESS_BAR.y + 22, {
    size: 22,
    color: COLORS.textDim,
    align: 'right',
  })
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, '#15304d', '#080f1b')
  topBar(ctx, VW, '快艇骰子', `${s.throws} 掷`, 96)
  drawScorePanel(ctx, s)
  drawDice(ctx, s)
  button(ctx, ROLL_BTN, s.rollsLeft > 0 ? `投掷（剩 ${s.rollsLeft} 次）` : '投掷次数已用完', {
    disabled: s.rollsLeft <= 0 || s.over,
    color: COLORS.accent,
    textColor: '#20303f',
    size: 30,
  })
  drawSlots(ctx, s)
  drawProgress(ctx, s)
  text(ctx, '空格=投掷 · 1~5=勾选保留 · A=AI 自动选格', VW / 2, 1120, { size: 22, color: COLORS.textDim })
  if (s.over) {
    const total = totalScore(s)
    banner(ctx, VW, VH, `${total} 分`, `上段 ${upperTotal(s)} · 下段 ${lowerTotal(s)} · 满分 ${MAX_SCORE}`, total >= GOOD_SCORE ? COLORS.accent : COLORS.text)
  }
}

// ---------------- 输入 ----------------

function input(s: State, p: PointerInput): Action | null {
  if (p.kind !== 'down' || s.over) return null
  if (s.dice.length === DIE_COUNT && s.rollsLeft > 0) {
    const die = hitDie(p)
    if (die >= 0) return { type: 'toggle', die }
  }
  if (s.dice.length === DIE_COUNT) {
    const slot = hitSlot(p)
    if (slot >= 0 && s.slots[slot] === null) return { type: 'fill', slot }
  }
  if (inRect(p, ROLL_BTN)) return { type: 'roll' }
  return null
}

function key(s: State, k: string): Action | null {
  if (s.over) return null
  if (k === ' ' || k === 'Enter') return s.rollsLeft > 0 ? { type: 'roll' } : null
  if (k === 'a' || k === 'A') return s.dice.length === DIE_COUNT ? { type: 'auto' } : null
  const map: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4 }
  return k in map ? { type: 'toggle', die: map[k] } : null
}

// ---------------- 提示 / 按钮 / 结算 / 副作用 ----------------

function hint(s: State): string {
  if (s.over) {
    const total = totalScore(s)
    return `本局结束：总分 ${total} / ${MAX_SCORE}，上段 ${upperTotal(s)}，下段 ${lowerTotal(s)}`
  }
  if (s.dice.length !== DIE_COUNT) return `第 ${s.round} / ${SLOT_COUNT} 轮：点「投掷」掷出 5 颗骰子，共 ${ROLLS_PER_ROUND} 次机会`
  const best = bestSlot(s)
  const gain = best >= 0 ? scoreFor(best, s.dice) : 0
  const tail = best >= 0 ? `AI 建议填「${SLOTS[best].label}」（${gain} 分）` : '计分格已填满'
  if (s.rollsLeft <= 0) return `投掷次数已用完，本轮必须计分 · ${tail}`
  return `本轮还剩 ${s.rollsLeft} 次投掷，可勾选骰子保留 · ${tail}`
}

function controls(s: State): Control<Action>[] {
  if (s.over) return []
  const out: Control<Action>[] = []
  if (s.dice.length === DIE_COUNT) {
    out.push({ label: 'AI 自动选格', action: { type: 'auto' }, primary: true })
    const worst = worstSlot(s)
    if (worst >= 0) out.push({ label: `放弃「${SLOTS[worst].label}」（0 分）`, action: { type: 'fill', slot: worst, abandon: true } })
  }
  if (s.rollsLeft > 0) out.push({ label: `重投（剩 ${s.rollsLeft} 次）`, action: { type: 'roll' } })
  return out
}

function outcome(s: State): Outcome | null {
  if (!s.over) return null
  const score = totalScore(s)
  return { score, better: 'higher', unit: ' 分', win: score >= GOOD_SCORE }
}

function effects(prev: State, next: State): Effect[] {
  if (next.over && !prev.over) return [{ kind: 'sound', name: 'win' }, { kind: 'flash', color: 'rgba(255,204,51,0.28)' }]
  if (next.lastSlot !== prev.lastSlot && next.lastSlot >= 0) {
    const [x, y] = slotCenter(next.lastSlot)
    const v = next.slots[next.lastSlot] ?? 0
    const out: Effect[] = [{ kind: 'sound', name: v > 0 ? 'score' : 'click' }]
    if (v > 0) out.push({ kind: 'burst', x, y, color: v >= SLOTS[next.lastSlot].max ? COLORS.green : COLORS.accent, count: 16 })
    return out
  }
  if (next.throws > prev.throws) return [{ kind: 'sound', name: 'hit' }]
  for (let i = 0; i < DIE_COUNT; i++) if (next.keep[i] !== prev.keep[i]) return [{ kind: 'sound', name: 'click' }]
  return []
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  input,
  key,
  hint,
  controls,
  outcome,
  effects,
}

export default game
