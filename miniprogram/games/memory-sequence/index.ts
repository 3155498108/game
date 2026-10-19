/**
 * 猜颜色渲染 + 输入映射。
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 *
 * 亮灯播放的节奏完全走 render/anim.ts 的旁路缓存：
 * 每帧用 elapsedSince 算出「现在该亮哪一个、亮多少」，
 * 不把任何时间戳写进 state，因此 reduce 依旧可复盘。
 */
import type { Effect, GameModule, PointerInput } from '../../core/types'
import { COLORS, PALETTE, background, banner, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { elapsedSince, keepAlive, pulse } from '../../render/anim'
import type { Rect } from '../../core/geom'
import { gridHit, inRect } from '../../core/geom'
import meta from './meta'
import { COLOR_COUNT, MAX_ROUND, create, reduce, type Action, type State } from './rules'

// ---------------- 布局常量（render 与 input 共用同一份，坐标永远不会不一致） ----------------

/** 色块网格：2×2 */
export const GRID_COLS = 2
export const GRID_ROWS = 2
export const TILE = 258
export const TILE_GAP = 24
export const GRID_X = 90
export const GRID_Y = 320

/** 整个网格的外框，命中判定与底板共用 */
export const GRID_RECT: Rect = {
  x: GRID_X,
  y: GRID_Y,
  w: GRID_COLS * TILE + (GRID_COLS - 1) * TILE_GAP,
  h: GRID_ROWS * TILE + (GRID_ROWS - 1) * TILE_GAP,
}

/** 第 i 个色块（0 起）的矩形 */
export function tileRect(i: number): Rect {
  const c = i % GRID_COLS
  const r = Math.floor(i / GRID_COLS)
  return {
    x: GRID_X + c * (TILE + TILE_GAP),
    y: GRID_Y + r * (TILE + TILE_GAP),
    w: TILE,
    h: TILE,
  }
}

/** 第 i 个色块中心（特效粒子用） */
export function tileCenter(i: number): [number, number] {
  const r = tileRect(i)
  return [r.x + r.w / 2, r.y + r.h / 2]
}

// ---------------- 播放节奏（纯视觉常量，不进 state） ----------------

/** 每个色块的播放节拍 */
const STEP_MS = 620
/** 其中亮起的时长 */
const ON_MS = 360
/** 点击后的高亮余晖 */
const PICK_MS = 520

const tileColor = (i: number): string => PALETTE[i % PALETTE.length]

/** 展示阶段的动画签名：轮次（序列长度）变了就重新播一遍 */
const showSig = (s: State): string => `v${s.round}`
/** 点击高亮的动画签名 */
const pickSig = (s: State): string => `${s.round}/${s.step}/${s.lastPick}`

// ---------------- 文案 ----------------

function statusText(s: State): [string, string] {
  const len = s.sequence.length
  switch (s.phase) {
    case 'show':
      return ['记住顺序', `第 ${s.round} 轮：${len} 个色块，看完点「开始复现」`]
    case 'input':
      return ['轮到你', `按顺序点出 ${len} 个色块，已对 ${s.step} / ${len}`]
    case 'over':
      return ['答错了', `你在第 ${s.round} 轮复现失败，共 ${MAX_ROUND} 轮`]
    case 'won':
      return ['全部通关', `${MAX_ROUND} 轮全部答对，序列最长 ${MAX_ROUND} 个色块`]
  }
}

// ---------------- 绘制 ----------------

/** 此刻应当发光的色块与发光强度（0 表示不亮） */
function litTile(s: State): { index: number; amount: number } {
  if (s.phase === 'show') {
    const len = s.sequence.length
    const e = elapsedSince('ms-show', showSig(s), len * STEP_MS)
    const k = Math.min(len - 1, Math.floor(e / STEP_MS))
    const into = e % STEP_MS
    const attack = Math.min(1, into / 90)
    const release = Math.max(0, Math.min(1, (ON_MS - into) / 140))
    const amount = attack * release
    return { index: k, amount }
  }
  if (s.phase === 'input' && s.lastPick >= 0) {
    const e = elapsedSince('ms-pick', pickSig(s), PICK_MS)
    return { index: s.lastPick, amount: Math.max(0, 1 - e / PICK_MS) }
  }
  return { index: -1, amount: 0 }
}

function drawProgress(ctx: CanvasRenderingContext2D, s: State): void {
  const len = s.sequence.length
  const gap = 30
  const total = len * 18 + (len - 1) * gap
  const x0 = 360 - total / 2
  // 展示阶段点亮到「正在播的那一格」，输入阶段点亮到已答对的步数
  const lit = s.phase === 'show' ? litTile(s).index + 1 : s.phase === 'input' ? s.step : s.phase === 'won' ? len : s.step
  for (let i = 0; i < len; i++) {
    const x = x0 + 9 + i * (18 + gap)
    const on = i < lit
    ctx.beginPath()
    ctx.arc(x, 236, 9, 0, Math.PI * 2)
    ctx.fillStyle = on ? COLORS.accent : 'rgba(255,255,255,0.22)'
    ctx.fill()
  }
}

function drawTiles(ctx: CanvasRenderingContext2D, s: State): void {
  const lit = litTile(s)
  // 输入阶段让色块轻微呼吸，提示「可以点了」
  const breath = s.phase === 'input' ? 0.06 + 0.05 * pulse(1600) : 0.05
  for (let i = 0; i < COLOR_COUNT; i++) {
    const r = tileRect(i)
    const color = tileColor(i)
    const on = lit.index === i ? lit.amount : 0
    const wrong = s.lastWrong && s.lastPick === i && s.phase === 'over'

    ctx.save()
    if (on > 0) {
      ctx.shadowColor = wrong ? COLORS.red : color
      ctx.shadowBlur = 30 + 40 * on
    }
    const base = withAlpha(wrong ? COLORS.red : color, breath + on * (1 - breath))
    fillRoundRect(ctx, r.x, r.y, r.w, r.h, 34, base, withAlpha(wrong ? COLORS.red : color, 0.35 + 0.5 * on), 3)
    ctx.restore()

    // 中心放一个小圆，纯装饰，让色块不至于太空
    const [cx, cy] = tileCenter(i)
    ctx.save()
    ctx.globalAlpha = 0.25 + 0.55 * on
    ctx.beginPath()
    ctx.arc(cx, cy, 34 + 12 * on, 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(wrong ? COLORS.red : color, 0.85)
    ctx.fill()
    ctx.restore()

    text(ctx, String(i + 1), r.x + r.w / 2, r.y + r.h - 34, { size: 26, color: 'rgba(255,255,255,0.55)' })
  }
}

function drawTip(ctx: CanvasRenderingContext2D, s: State): void {
  const tip =
    s.phase === 'show'
      ? '点击色块或下方按钮开始复现'
      : s.phase === 'input'
        ? `按亮起的顺序点 · 已对 ${s.step} / ${s.sequence.length}`
        : s.phase === 'won'
          ? `记忆达人 · 点「新的一局」挑战更快的记忆`
          : `点「新的一局」重来一次`
  fillRoundRect(ctx, 60, 1280 - 230, 720 - 120, 118, 26, 'rgba(255,255,255,0.07)')
  text(ctx, tip, 360, 1280 - 171, { size: 29, weight: 'bold' })
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  keepAlive()
  background(ctx, 720, 1280, '#10203a', '#070e1a')

  const [main, sub] = statusText(s)
  topBar(ctx, 720, main, `第 ${s.round} / ${MAX_ROUND} 轮`, 96)
  shadowText(ctx, sub, 360, 154, { size: 26, color: COLORS.textDim, weight: 'normal' })

  drawProgress(ctx, s)
  drawTiles(ctx, s)
  drawTip(ctx, s)

  if (s.phase === 'won') banner(ctx, 720, 1280, '通关！', `你记住了全部 ${MAX_ROUND} 轮`)
  else if (s.phase === 'over') banner(ctx, 720, 1280, '结束', `到达第 ${s.round} 轮`, COLORS.red)
}

// ---------------- 输入 ----------------

function input(s: State, p: PointerInput): Action | null {
  if (p.kind !== 'down') return null
  if (!inRect(p, GRID_RECT)) return null
  // 展示阶段：点色块等于「我看完了」，直接交还给玩家
  if (s.phase === 'show') return { type: 'ready' }
  if (s.phase !== 'input') return null
  const hit = gridHit(p, GRID_X, GRID_Y, TILE + TILE_GAP, TILE + TILE_GAP, GRID_COLS, GRID_ROWS)
  if (!hit) return null
  return { type: 'pick', color: hit[1] * GRID_COLS + hit[0] }
}

function key(s: State, k: string): Action | null {
  if (k === ' ' || k === 'Enter') return s.phase === 'show' ? { type: 'ready' } : null
  if (s.phase !== 'input') return null
  const map: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3 }
  return k in map ? { type: 'pick', color: map[k] } : null
}

// ---------------- 副作用 ----------------

function effects(prev: State, next: State): Effect[] {
  if (next.phase === 'won' && prev.phase !== 'won') {
    const out: Effect[] = [
      { kind: 'sound', name: 'win' },
      { kind: 'flash', color: 'rgba(255,204,51,0.32)' },
    ]
    for (let i = 0; i < COLOR_COUNT; i++) {
      const [x, y] = tileCenter(i)
      out.push({ kind: 'burst', x, y, color: tileColor(i), count: 20 })
    }
    return out
  }
  if (next.phase === 'over' && prev.phase !== 'over') {
    const out: Effect[] = [{ kind: 'sound', name: 'error' }, { kind: 'shake', power: 12 }]
    if (next.lastPick >= 0) {
      const [x, y] = tileCenter(next.lastPick)
      out.push({ kind: 'burst', x, y, color: COLORS.red, count: 18 })
    }
    return out
  }
  if (next.phase === 'input' && prev.phase === 'show') return [{ kind: 'sound', name: 'flip' }]
  if (next.round > prev.round) return [{ kind: 'sound', name: 'score' }]
  if (next.step > prev.step) return [{ kind: 'sound', name: 'tick' }]
  return []
}

function outcome(s: State) {
  if (s.phase !== 'over' && s.phase !== 'won') return null
  return { score: s.round, better: 'higher' as const, unit: ' 轮', win: s.phase === 'won' }
}

function hint(s: State): string {
  if (s.phase === 'show') return `第 ${s.round} / ${MAX_ROUND} 轮：先记住 ${s.sequence.length} 个色块的顺序`
  if (s.phase === 'input') return `轮到你复现，已答对 ${s.step} / ${s.sequence.length}`
  if (s.phase === 'won') return `通关！你答对了全部 ${MAX_ROUND} 轮`
  return `第 ${s.round} 轮答错，本局结束`
}

function controls(s: State) {
  return s.phase === 'show' ? [{ label: '开始复现', action: { type: 'ready' } as Action, primary: true }] : []
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
