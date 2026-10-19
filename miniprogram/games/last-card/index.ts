/**
 * 最后一张牌 · 渲染 + 输入映射。
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 * 布局常量由 render 与 input 共用，点击命中与画面永远一致。
 */
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { cardLabel, type Card } from '../../core/cards'
import { inRect } from '../../core/geom'
import { COLORS, background, banner, fillRoundRect, shadowText, text, topBar } from '../../render/draw'
import { drawCard, handLayout } from '../../render/cards'
import { elapsedSince, pulse, tweenTo } from '../../render/anim'
import meta from './meta'
import { HAND_SIZE, aiAction, canPlay, create, legalActions, reduce, type Action, type State } from './rules'

const VW = 720
const VH = 1280

/** 场上最高牌（大字） */
const TOP_W = 210
const TOP_H = 294
const TOP_X = (VW - TOP_W) / 2
const TOP_Y = 200

/** 最近出牌（小字，最多 6 张） */
const MIN_W = 78
const MIN_H = 110
const MIN_Y = 592

/** 电脑手牌（背面小牌） */
const AI_W = 72
const AI_H = 100
const AI_Y = 752

/** 玩家手牌：render 与 input 共用同一套布局 */
const HAND_W = 112
const HAND_H = 158
const HAND_Y = 904
const HAND_MARGIN = 24

const handRects = (s: State): ReturnType<typeof handLayout> => handLayout(s.hands[0].length, VW, HAND_Y, HAND_W, HAND_H, HAND_MARGIN)

function statusText(s: State): [string, string] {
  // 「场上最高牌 X」并进副标题：顶栏(96)到大牌顶(200)只有 104px，
  // 单独再画一行标签必然和副标题叠字。
  const topLabel = `场上最高牌 ${s.tableTop ? cardLabel(s.tableTop) : '（空）'}`
  if (s.over) {
    if (s.winner === 'player') return ['你赢了！', `你打出了最后一张牌，还剩 ${s.hands[1].length} 张在它手上`]
    if (s.winner === 'ai') return ['电脑获胜', `你手上还剩 ${s.hands[0].length} 张，再来一局`]
    return ['平局', '牌都出完了，谁也没能先走完']
  }
  if (s.turn === 'player') return ['轮到你', `${topLabel} · 点亮的牌可打：比它小或同花色`]
  return ['电脑思考中', `${topLabel} · 它会优先出同花色的小牌`]
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  background(ctx, VW, VH, '#17603f', '#0c3725')

  const [main, sub] = statusText(state)
  topBar(ctx, VW, `你剩 ${state.hands[0].length} 张`, `电脑剩 ${state.hands[1].length} 张`, 96)
  shadowText(ctx, main, VW / 2, 140, { size: 38, color: COLORS.accent })
  shadowText(ctx, sub, VW / 2, 178, { size: 24, color: COLORS.textDim, weight: 'normal' })

  // 场上最高牌：开局时用暗色提示牌占位
  const top = state.tableTop
  const glow = top && !state.over ? tweenTo('lc-glow', 1, 260) : 0
  if (top) {
    ctx.save()
    ctx.globalAlpha = 0.12 + 0.16 * pulse(1100) * glow
    fillRoundRect(ctx, TOP_X - 14, TOP_Y - 14, TOP_W + 28, TOP_H + 28, 30, COLORS.accent)
    ctx.restore()
  }
  drawCard(ctx, top, TOP_X, TOP_Y, TOP_W, TOP_H, { highlight: top !== null && !state.over })
  if (!top) text(ctx, '还没有人出牌', VW / 2, TOP_Y + TOP_H / 2, { size: 26, color: COLORS.textDim })

  // 牌堆余量 + 补牌次数
  const left = Math.max(0, state.deck.length - state.cursor)
  fillRoundRect(ctx, 120, 508, VW - 240, 46, 16, 'rgba(0,0,0,0.28)')
  text(ctx, `牌堆剩余 ${left} 张 · 洗回 ${state.reshuffles} 次 · 跳过 ${state.skips} 次`, VW / 2, 531, { size: 23, weight: 'bold' })

  // 最近打出的牌
  text(ctx, '最近出牌', VW / 2, 578, { size: 24, color: COLORS.textDim })
  const recent = state.field.slice(-6)
  const recentRects = handLayout(recent.length, VW, MIN_Y, MIN_W, MIN_H, 30)
  recent.forEach((c, i) => {
    const r = recentRects[i]
    const isTop = top !== null && c.id === top.id
    drawCard(ctx, c, r.x, r.y, MIN_W, MIN_H, { highlight: isTop })
  })

  // 电脑手牌（背面）
  text(ctx, '电脑手牌', VW / 2, 736, { size: 24, color: COLORS.textDim })
  const aiRects = handLayout(state.hands[1].length, VW, AI_Y, AI_W, AI_H, 26)
  for (const r of aiRects) drawCard(ctx, state.hands[1][0] ?? null, r.x, r.y, AI_W, AI_H, { faceUp: false })

  // 玩家手牌：可出的描边高亮，不可出的压暗
  const playIds = new Set(legalActions(state).filter((a) => a.type === 'play').map((a) => (a as { cardId: number }).cardId))
  const myTurn = state.turn === 'player' && !state.over
  const rects = handRects(state)
  state.hands[0].forEach((c, i) => {
    const r = rects[i]
    const ok = myTurn && playIds.has(c.id)
    if (ok) {
      ctx.save()
      ctx.globalAlpha = 0.2 + 0.16 * pulse(900)
      fillRoundRect(ctx, r.x - 6, r.y - 10, r.w + 12, r.h + 20, 14, COLORS.accent)
      ctx.restore()
    }
    drawCard(ctx, c, r.x, r.y, r.w, r.h, { highlight: ok, dim: myTurn && !ok })
  })

  // 底部说明
  const tip = state.over
    ? '点「新的一局」再来一次'
    : myTurn
      ? playIds.size > 0
        ? '发光的牌可以打出 · 点它出牌'
        : '没有牌能接，用「跳过」把回合交给电脑'
      : '电脑正在出牌…'
  fillRoundRect(ctx, 60, 1096, VW - 120, 60, 20, 'rgba(0,0,0,0.28)')
  text(ctx, tip, VW / 2, 1126, { size: 25, color: COLORS.textDim })

  fillRoundRect(ctx, 60, 1184, VW - 120, 60, 20, 'rgba(0,0,0,0.2)')
  text(ctx, '打到最后一张牌的人赢', VW / 2, 1214, { size: 26, color: COLORS.accent, weight: 'bold' })

  if (state.over) banner(ctx, VW, VH, state.winner === 'player' ? '胜利' : state.winner === 'ai' ? '失败' : '平局', main, state.winner === 'player' ? COLORS.accent : COLORS.red)
}

function effects(prev: State, next: State): Effect[] {
  const cx = VW / 2
  const cy = TOP_Y + TOP_H / 2
  if (next.over && !prev.over) {
    const win = next.winner === 'player'
    const out: Effect[] = [{ kind: 'sound', name: win ? 'win' : 'lose' }, { kind: 'burst', x: cx, y: cy, color: win ? COLORS.accent : COLORS.red, count: 24 }]
    if (win) out.push({ kind: 'flash', color: 'rgba(255,204,51,0.35)' })
    return out
  }
  if (next.plays > prev.plays) {
    const sig = `${next.plays}:${next.lastPlay ? next.lastPlay.card.id : 0}`
    const e = elapsedSince('lc-play', sig, 420)
    return [
      { kind: 'sound', name: 'place' },
      { kind: 'burst', x: cx, y: cy, color: COLORS.accent2, count: Math.max(4, 14 - Math.floor(e / 60)) },
    ]
  }
  if (next.skips > prev.skips) return [{ kind: 'sound', name: 'tick' }]
  if (next.reshuffles > prev.reshuffles) return [{ kind: 'sound', name: 'flip' }]
  return []
}

function outcome(state: State): Outcome | null {
  if (!state.over) return null
  const mine = state.hands[0].length
  const theirs = state.hands[1].length
  const score = (mine === 0 ? 60 : 0) + (HAND_SIZE * 2 - mine - theirs) * 5
  return { score, better: 'higher', unit: ' 分', win: state.winner === 'player' }
}

/** 画面点击：只认 up，避免一次点击同时触发 down/up 而出两张牌 */
function input(state: State, p: PointerInput): Action | null {
  if (state.over || state.turn !== 'player' || p.kind !== 'up') return null
  const rects = handRects(state)
  for (let i = 0; i < rects.length; i++) {
    if (!inRect(p, rects[i])) continue
    const card = state.hands[0][i] as Card
    return { type: 'play', cardId: card.id }
  }
  return null
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  aiAction,
  input,
  effects,
  outcome,
  aiDelay: 500,
  controls: (s) =>
    s.over || s.turn !== 'player'
      ? []
      : canSkip(s)
        ? [{ label: '跳过本轮', action: { type: 'skip' }, primary: true }]
        : [],
  hint: (s) => {
    if (s.over) return s.winner === 'player' ? '你赢了！点「新的一局」再来一次' : '这局输了，点「新的一局」再来一次'
    const top: Card | null = s.tableTop
    const n = s.hands[0].filter((c) => canPlay(c, top)).length
    if (s.turn !== 'player') return `电脑思考中… 场上最高牌 ${top ? cardLabel(top) : '（空）'}`
    if (n === 0) return '没有能接的牌，用「跳过」把回合交给电脑'
    return `场上最高牌 ${top ? cardLabel(top) : '（空）'}：${n} 张牌可以打出（比它小或同花色）`
  },
}

/** 是否该显示「跳过」按钮：一张牌都打不出时才显示 */
function canSkip(s: State): boolean {
  return legalActions(s).some((a) => a.type === 'skip')
}

export default game
