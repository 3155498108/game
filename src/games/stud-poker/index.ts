/**
 * 梭哈（五张牌比牌型）：渲染 + 输入映射。
 *
 * 规则全部在 `rules.ts`（纯逻辑），本文件只负责把状态画到 Canvas、把指针翻成 action。
 *
 * **所有牌都亮面**——这是与德州扑克的根本区别，也是当初不实现德州扑克的原因
 * （暗牌 + 底池推断需要联网或复杂 AI）。梭哈的乐趣在于换牌决策，不在于藏牌。
 *
 * 动画与计时不进 state：
 * - 发牌用 `anim.tweenTo` 按「第几张」做落位插值；
 * - 选中高亮用 `anim.pulse` 让画面持续重绘；
 * - 粒子 / 音效通过 `effects()` 交给站点壳执行。
 *
 * 画布上不画「新的一局」按钮，也不重复画 `controls()` 声明的控件，站点壳会自动追加。
 */
import type { Card } from '../../core/cards'
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { COLORS, background, banner, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { drawCard, handLayout } from '../../render/cards'
import { pulse, progressSince, tweenTo } from '../../render/anim'
import { meta } from './meta'
import {
  HAND_SIZE,
  MAX_DISCARD,
  MAX_REDRAWS,
  aiAction,
  create,
  handLabel,
  reduce,
  resultLabel,
  type Action,
  type HandValue,
  type State,
} from './rules'

const VW = 720
const VH = 1280

const CARD_W = 112
const CARD_H = 156

/** 手牌区顶边（handLayout 传的是顶边，不是中心） */
const AI_TOP = 250
const PLAYER_TOP = 640

/** 开牌横幅的纵向中心：放在玩家手牌**下方**，不压牌面 */
const BANNER_Y = 960

const RESULT_COLOR: Record<string, string> = {
  win: COLORS.green,
  lose: COLORS.red,
  push: COLORS.textDim,
}

// ---------------- 渲染 ----------------

function drawHand(ctx: CanvasRenderingContext2D, s: State, top: number, mine: boolean): void {
  const slots = handLayout(HAND_SIZE, VW, top, CARD_W, CARD_H, 24)
  for (let i = 0; i < HAND_SIZE; i++) {
    const box = slots[i]
    if (!box) continue
    const card: Card | null = (mine ? s.player : s.ai)[i] ?? null
    // 发牌落位：key 里带 round，本局一来就自动从上方落进来
    const key = `sp-${mine ? 'p' : 'a'}-${s.round}-${i}`
    const landed = top
    const y = tweenTo(key, landed, 240)
    const picked = mine && s.selected.includes(i)
    drawCard(ctx, card, box.x, y - 90 + (landed - (landed - 90)), box.w, box.h, {
      faceUp: true,
      selected: picked,
      highlight: picked,
      dim: mine && s.playerFolded,
    })
  }
}

function kindText(v: HandValue | null): string {
  return v ? handLabel(v) : '—'
}

function drawInfo(ctx: CanvasRenderingContext2D, s: State): void {
  text(ctx, '电脑', VW / 2, AI_TOP - 26, { size: 24, color: COLORS.textDim })
  text(ctx, '你', VW / 2, PLAYER_TOP - 26, { size: 24, color: COLORS.textDim })

  if (s.phase === 'done') {
    // 开牌后双方牌型同屏对照——这是这个游戏最该被看清的一屏信息
    text(ctx, `电脑：${kindText(s.aiHand)}`, VW / 2, AI_TOP + CARD_H + 30, { size: 25, color: COLORS.textDim })
    text(ctx, `你：${kindText(s.playerHand)}`, VW / 2, PLAYER_TOP + CARD_H + 34, { size: 27, color: COLORS.accent })
  } else if (s.phase === 'ai') {
    const t = progressSince('sp-ai', String(s.round), 900)
    text(ctx, t < 0.5 ? '电脑思考中…' : '电脑在换牌…', VW / 2, AI_TOP + CARD_H + 30, {
      size: 24,
      color: COLORS.accent,
    })
  } else {
    const n = s.selected.length
    const msg =
      n === 0
        ? '点手牌选中要换掉的牌（1~3 张）'
        : `已选 ${n} 张 · 还可换 ${MAX_REDRAWS - s.redrawsUsed} 次`
    text(ctx, msg, VW / 2, PLAYER_TOP + CARD_H + 34, { size: 22, color: COLORS.textDim })
  }
}

function drawResult(ctx: CanvasRenderingContext2D, s: State): void {
  if (s.phase !== 'done' || !s.result) return
  const color = RESULT_COLOR[s.result] ?? COLORS.text
  const mult = s.lastMult > 0 ? `+${s.lastMult}` : `${s.lastMult}`
  const t = progressSince('sp-banner', String(s.round), 260)
  fillRoundRect(ctx, 60, BANNER_Y - 60, VW - 120, 120, 24, withAlpha(COLORS.panel, 0.94), withAlpha(color, 0.85), 2)
  shadowText(ctx, resultLabel(s.result), VW / 2, BANNER_Y - 16, { size: 42, color })
  text(ctx, `${mult} 注 · 第 ${s.round} 局`, VW / 2, BANNER_Y + 30, { size: 22, color: COLORS.textDim })
  if (t < 1) pulse(1000)
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, '#123a2c', '#071c15')
  topBar(ctx, VW, '梭哈', `${s.score > 0 ? '+' : ''}${s.score} 注`, 92)
  pulse(1600)

  drawInfo(ctx, s)
  drawHand(ctx, s, AI_TOP, false)
  drawHand(ctx, s, PLAYER_TOP, true)
  drawResult(ctx, s)

  if (s.phase === 'player' && s.playerFolded) banner(ctx, VW, BANNER_Y, '你已弃牌', '点「下一局」继续', COLORS.textDim)

  const foot = '牌型：同花顺 > 四条 > 葫芦 > 同花 > 顺子 > 三条 > 两对 > 一对 · 数字键 1~5 选牌'
  text(ctx, foot, VW / 2, VH - 22, { size: 19, color: COLORS.textDim })
}

// ---------------- 输入 ----------------

/** 玩家手牌区命中测试：逻辑坐标 → 手牌下标 */
function hitIndex(p: PointerInput): number {
  const slots = handLayout(HAND_SIZE, VW, PLAYER_TOP, CARD_W, CARD_H, 24)
  for (let i = 0; i < slots.length; i++) {
    const b = slots[i]
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i
  }
  return -1
}

/** 画面点击：只认 up，避免一次点击同时触发 down/up 把同一张牌切换两次 */
function input(s: State, p: PointerInput): Action | null {
  if (s.phase !== 'player' || s.playerFolded) return null
  if (p.kind !== 'up') return null
  const i = hitIndex(p)
  return i >= 0 ? { type: 'toggle', index: i } : null
}

function key(s: State, k: string): Action | null {
  if (s.phase === 'done') return k === 'Enter' || k === ' ' ? { type: 'next' } : null
  if (s.phase !== 'player' || s.playerFolded) return null
  if (k === 'Enter') return { type: 'stay' }
  const n = Number(k)
  if (k.length === 1 && n >= 1 && n <= HAND_SIZE) return { type: 'toggle', index: n - 1 }
  return null
}

// ---------------- 提示 / 控件 / 结算 ----------------

function controls(s: State): Control<Action>[] {
  if (s.phase === 'done') return [{ label: '下一局', action: { type: 'next' }, primary: true }]
  if (s.phase !== 'player' || s.playerFolded) return []

  const n = s.selected.length
  const canRedraw = n > 0 && s.redrawsUsed < MAX_REDRAWS
  return [
    { label: n === 0 ? '换牌（先选牌）' : `换 ${n} 张`, action: { type: 'redraw' }, disabled: !canRedraw, primary: canRedraw },
    { label: '停牌比牌', action: { type: 'stay' } },
    { label: '弃牌', action: { type: 'fold' } },
  ]
}

function hint(s: State): string {
  if (s.phase === 'done') return `${resultLabel(s.result ?? 'push')} · 点「下一局」继续，第 ${s.round} 局结束`
  if (s.phase === 'ai') return '电脑正在决定换牌还是停牌…'
  const n = s.selected.length
  const left = MAX_REDRAWS - s.redrawsUsed
  const hand = s.playerHand ? kindText(s.playerHand) : '未开牌'
  const detail =
    n === 0
      ? `点手牌选中要换掉的牌，最多 ${MAX_DISCARD} 张`
      : s.redrawsUsed >= MAX_REDRAWS
        ? '换牌次数已用完，只能停牌或弃牌'
        : `已选 ${n} 张，可以换牌（还可换 ${left} 次）`
  return `你的手牌 ${hand} · ${detail}`
}

function outcome(s: State): Outcome | null {
  if (s.phase !== 'done') return null
  const win = s.result === 'win' ? true : s.result === 'lose' ? false : undefined
  return { score: s.score, better: 'higher', unit: '金币', win }
}

/**
 * 金币结算：`outcome.score` 以「注」为单位累计（赢 +1、四条以上 +2、输取负、平局 0），
 * 这里按注额等比换算。
 *
 * 注意**不能走默认规则**：默认规则只看 `win`，会给四条只发 1 倍注，
 * 而四条是梭哈里最强的牌型，必须给足 2 倍。
 */
function coins(_s: State, o: Outcome, bet: number): number {
  if (bet <= 0 || !Number.isFinite(o.score)) return 0
  return Math.trunc(o.score * bet)
}

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (next.round !== prev.round) return [{ kind: 'sound', name: 'flip' }]
  if (prev.phase !== 'done' && next.phase === 'done') {
    out.push({ kind: 'flash', color: RESULT_COLOR[next.result ?? 'push'] ?? COLORS.accent })
    out.push({ kind: 'sound', name: next.result === 'lose' ? 'lose' : next.result === 'win' ? 'win' : 'click' })
  }
  if (next.selected.length > prev.selected.length) out.push({ kind: 'sound', name: 'place' })
  return out
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  aiAction,
  input,
  key,
  hint,
  controls,
  outcome,
  effects,
  coins,
  aiDelay: 520,
}

export default game
export { meta, create, reduce, render, input, key, hint, controls, outcome, effects, coins }
