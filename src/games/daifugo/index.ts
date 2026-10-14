/**
 * 大富豪 · 渲染 + 输入映射。
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 * 手牌按花色分成 4 行铺开（52 张单排根本点不中），布局常量由 render 与 input 共用，
 * 点击命中与画面永远一致。
 */
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { SUITS, SUIT_SYMBOL, cardLabel, type Card, type Suit } from '../../core/cards'
import { inRect } from '../../core/geom'
import { COLORS, background, banner, fillRoundRect, shadowText, text, topBar } from '../../render/draw'
import { drawCard, handLayout } from '../../render/cards'
import { elapsedSince, pulse, tweenTo } from '../../render/anim'
import meta from './meta'
import {
  MAX_CHAIN,
  aiAction,
  canLeadSuit,
  create,
  legalActions,
  playableCards,
  reduce,
  type Action,
  type State,
} from './rules'

const VW = 720
const VH = 1280

/** 本轮末牌（大字） */
const BIG_W = 168
const BIG_H = 236
const BIG_X = (VW - BIG_W) / 2
const BIG_Y = 214

/** 弃牌堆预览（最近 6 张） */
const PILE_W = 62
const PILE_H = 87
const PILE_Y = 520

/** 电脑手牌：只画几张背面示意 */
const BACK_N = 9
const BACK_W = 46
const BACK_H = 64
const BACK_Y = 648

/** 玩家手牌：按花色分 4 行，render 与 input 共用同一套布局 */
const HAND_W = 76
const HAND_H = 106
const HAND_TOP = 736
const ROW_PITCH = 124
const HAND_MARGIN = 24

/** handLayout 返回的矩形 */
type HandRect = ReturnType<typeof handLayout>[number]

/** 一张手牌 + 它在屏幕上的位置 */
interface Slot extends HandRect {
  card: Card
}

/** 手牌槽位：按花色分 4 行，行内按点数升序（filter 返回新数组，sort 不会改动 state） */
function handSlots(state: State): Slot[] {
  const out: Slot[] = []
  SUITS.forEach((suit, row) => {
    const cards = state.hands[0].filter((c) => c.suit === suit).sort((a, b) => a.rank - b.rank || a.id - b.id)
    if (cards.length === 0) return
    const rects = handLayout(cards.length, VW, HAND_TOP + row * ROW_PITCH, HAND_W, HAND_H, HAND_MARGIN)
    cards.forEach((card, i) => out.push({ ...rects[i], card }))
  })
  return out
}

const SUIT_COLOR: Record<Suit, string> = { S: '#cfd8e3', H: '#ff8a80', D: '#ffab91', C: '#a5d6a7' }

/** 本轮「要接什么」的中文说明：A 打出后无人能接，不再显示「接 0」 */
function needText(s: State): string {
  if (s.turnRank === 0) return ''
  if (s.turnRank === 1) return `已经接到 A（${SUIT_SYMBOL[s.leadSuit as Suit]}A），谁也接不上`
  return `要接 ${SUIT_SYMBOL[s.leadSuit as Suit]}${s.turnRank - 1}`
}

function statusText(s: State): [string, string] {
  if (s.over) {
    if (s.winner === 'player') return ['你赢了！', `它手上还剩 ${s.hands[1].length} 张`]
    if (s.winner === 'ai') return ['电脑获胜', `你手上还剩 ${s.hands[0].length} 张，再来一局`]
    return ['平局', '谁也没能先走完']
  }
  if (s.phase === 'chooseSuit') {
    if (s.turn === 'player') return ['选一个花色开局', '本轮结束 —— 由你先点一个花色，然后打出该花色的牌']
    return ['电脑选花色中', '本轮结束，它在挑开局的花色']
  }
  if (s.turnRank === 0) return ['本轮开始', s.leadSuit ? `锁定 ${SUIT_SYMBOL[s.leadSuit]}，只能出这个花色` : '任意花色都可以开首牌']
  const left = playableCards(s).length
  if (s.turnRank === 1) return ['本轮到头', s.turn === 'player' ? 'A 已经是最后一档，你只能过牌' : 'A 已经是最后一档，它只能过牌']
  if (s.turn === 'player') return ['轮到你', `${needText(s)}（或甩一张 2），你有 ${left} 张能出`]
  return ['电脑思考中', `${needText(s)}，它手上有 ${left} 张能出`]
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  background(ctx, VW, VH, '#17603f', '#0b3324')

  const [main, sub] = statusText(state)
  topBar(ctx, VW, `你剩 ${state.hands[0].length} 张`, `电脑剩 ${state.hands[1].length} 张`, 96)
  shadowText(ctx, main, VW / 2, 140, { size: 36, color: COLORS.accent })
  shadowText(ctx, sub, VW / 2, 178, { size: 23, color: COLORS.textDim, weight: 'normal' })

  // 本轮末牌
  const big = state.turnCard
  if (big) {
    const glow = !state.over ? tweenTo('df-glow', 1, 260) : 0
    ctx.save()
    ctx.globalAlpha = 0.12 + 0.16 * pulse(1100) * glow
    fillRoundRect(ctx, BIG_X - 14, BIG_Y - 14, BIG_W + 28, BIG_H + 28, 30, COLORS.accent)
    ctx.restore()
    drawCard(ctx, big, BIG_X, BIG_Y, BIG_W, BIG_H, { highlight: !state.over })
    // 万能牌打出后提示它的真实身份
    if (big.rank === 2) {
      text(ctx, `万能牌：算 ${SUIT_SYMBOL[state.leadSuit as Suit]}${state.turnRank}`, VW / 2, BIG_Y - 26, {
        size: 26,
        color: COLORS.accent2,
        weight: 'bold',
      })
    }
  } else {
    drawCard(ctx, null, BIG_X, BIG_Y, BIG_W, BIG_H)
    text(ctx, state.phase === 'chooseSuit' ? '等待选花色' : '还没有人出牌', VW / 2, BIG_Y + BIG_H / 2, {
      size: 25,
      color: COLORS.textDim,
    })
  }

  // 锁定花色 / 本轮进度 / 轮数
  const suitLabel = state.leadSuit ? SUIT_SYMBOL[state.leadSuit] : '自由'
  fillRoundRect(ctx, 60, 474, VW - 120, 40, 14, 'rgba(0,0,0,0.26)')
  // 左侧小色块标出本轮锁定花色
  fillRoundRect(ctx, 92, 484, 34, 20, 6, state.leadSuit ? SUIT_COLOR[state.leadSuit] : 'rgba(255,255,255,0.3)')
  text(
    ctx,
    `本轮花色 ${suitLabel} · 第 ${Math.min(state.chainCount, MAX_CHAIN)}/${MAX_CHAIN} 张 · 第 ${state.rounds + 1} 轮`,
    VW / 2,
    494,
    { size: 23, weight: 'bold' },
  )

  // 弃牌堆预览
  text(ctx, `弃牌堆 ${state.pile.length} 张`, VW / 2, 528, { size: 22, color: COLORS.textDim })
  const recent = state.pile.slice(-6)
  const pileRects = handLayout(recent.length, VW, PILE_Y, PILE_W, PILE_H, 30)
  recent.forEach((c, i) => {
    const r = pileRects[i]
    drawCard(ctx, c, r.x, r.y, PILE_W, PILE_H, { highlight: i === recent.length - 1 })
  })

  // 电脑手牌（背面示意 + 张数）
  text(ctx, `电脑手牌 ${state.hands[1].length} 张`, VW / 2, 636, { size: 22, color: COLORS.textDim })
  const shown = Math.min(BACK_N, state.hands[1].length)
  const backRects = handLayout(shown, VW, BACK_Y, BACK_W, BACK_H, 20)
  for (const r of backRects) drawCard(ctx, state.hands[1][0] ?? null, r.x, r.y, BACK_W, BACK_H, { faceUp: false })

  // 玩家手牌：可出的描边高亮，不可出的压暗
  const legal = legalActions(state)
  const playIds = new Set(legal.filter((a) => a.type === 'play').map((a) => (a as { cardId: number }).cardId))
  const myTurn = state.turn === 'player' && !state.over && state.phase === 'play'
  const slots = handSlots(state)
  for (const r of slots) {
    const ok = myTurn && playIds.has(r.card.id)
    if (ok) {
      ctx.save()
      ctx.globalAlpha = 0.18 + 0.16 * pulse(900)
      fillRoundRect(ctx, r.x - 5, r.y - 9, r.w + 10, r.h + 18, 12, COLORS.accent)
      ctx.restore()
    }
    drawCard(ctx, r.card, r.x, r.y, r.w, r.h, { highlight: ok, dim: myTurn && !ok })
  }

  // 底部说明
  const tip = state.over
    ? '点「新的一局」再来一次'
    : state.phase === 'chooseSuit'
      ? state.turn === 'player'
        ? '用下方 4 个按钮选一个花色开局'
        : '电脑正在挑花色…'
      : myTurn
        ? playIds.size > 0
          ? '发光的牌可以打出 · 点它出牌'
          : '没有牌能接，只能过牌'
        : '电脑正在出牌…'
  fillRoundRect(ctx, 60, 1212, VW - 120, 52, 18, 'rgba(0,0,0,0.28)')
  text(ctx, tip, VW / 2, 1238, { size: 24, color: COLORS.textDim })

  if (state.over) {
    banner(
      ctx,
      VW,
      VH,
      state.winner === 'player' ? '胜利' : state.winner === 'ai' ? '失败' : '平局',
      main,
      state.winner === 'player' ? COLORS.accent : COLORS.red,
    )
  }
}

function effects(prev: State, next: State): Effect[] {
  const cx = VW / 2
  const cy = BIG_Y + BIG_H / 2
  if (next.over && !prev.over) {
    const win = next.winner === 'player'
    const out: Effect[] = [
      { kind: 'sound', name: win ? 'win' : 'lose' },
      { kind: 'burst', x: cx, y: cy, color: win ? COLORS.accent : COLORS.red, count: 24 },
    ]
    if (win) out.push({ kind: 'flash', color: 'rgba(255,204,51,0.35)' })
    return out
  }
  if (next.plays > prev.plays) {
    const sig = `${next.plays}:${next.lastPlay ? next.lastPlay.card.id : 0}`
    const e = elapsedSince('df-play', sig, 420)
    const wild = next.lastPlay !== null && next.lastPlay.card.rank === 2
    return [
      { kind: 'sound', name: 'place' },
      { kind: 'burst', x: cx, y: cy, color: wild ? COLORS.accent2 : COLORS.yellow, count: Math.max(4, 14 - Math.floor(e / 60)) },
    ]
  }
  if (next.phase === 'chooseSuit' && prev.phase !== 'chooseSuit') {
    return [{ kind: 'sound', name: 'hit' }, { kind: 'shake', power: 6 }]
  }
  if (next.passes > prev.passes) return [{ kind: 'sound', name: 'tick' }]
  if (next.reshuffles > prev.reshuffles) return [{ kind: 'sound', name: 'flip' }]
  return []
}

function outcome(state: State): Outcome | null {
  if (!state.over) return null
  const win = state.winner === 'player'
  // 赢牌 200 分 + 对手每剩 1 张 3 分；输了按自己剩牌倒扣
  const score = (win ? 200 : 0) + state.hands[1].length * 3 - state.hands[0].length * 3
  return { score, better: 'higher', unit: ' 分', win }
}

/** 画面点击：只认 up，避免一次点击同时触发 down/up 而出两张牌 */
function input(state: State, p: PointerInput): Action | null {
  if (state.over || state.turn !== 'player' || state.phase !== 'play') return null
  if (p.kind !== 'up') return null
  const slots = handSlots(state)
  // 后面的牌盖在前面上面，倒着命中才能点到最上层那张
  for (let i = slots.length - 1; i >= 0; i--) {
    const s = slots[i]
    if (inRect(p, s)) return { type: 'play', cardId: s.card.id }
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
  controls: (s) => {
    if (s.over || s.turn !== 'player') return []
    if (s.phase === 'chooseSuit') {
      return SUITS.map((suit) => ({
        label: `${SUIT_SYMBOL[suit]} 开局`,
        action: { type: 'lead', suit } as Action,
        disabled: !canLeadSuit(s, suit),
        primary: canLeadSuit(s, suit),
      }))
    }
    return legalActions(s).some((a) => a.type === 'pass')
      ? [{ label: '过牌（本轮结束）', action: { type: 'pass' }, primary: true }]
      : []
  },
  hint: (s) => {
    if (s.over) return s.winner === 'player' ? '你赢了！点「新的一局」再来一次' : '这局输了，点「新的一局」再来一次'
    if (s.phase === 'chooseSuit') {
      return s.turn === 'player' ? '本轮结束：选一个花色开局，然后打出该花色的牌（或一张 2）' : '本轮结束，电脑正在挑开局的花色…'
    }
    if (s.turn !== 'player') {
      const top = s.turnCard
      return `电脑思考中… 场上是 ${top ? cardLabel(top) : '（空）'}，${needText(s) || '本轮可以任意花色开首'}`
    }
    if (s.turnRank === 0) {
      return s.leadSuit ? `锁定 ${SUIT_SYMBOL[s.leadSuit]}：出这个花色的牌，或用一张 2 当它的 K` : '开局：任意花色的牌都可以出，也可以用一张 2 开首'
    }
    const n = playableCards(s).length
    if (s.turnRank === 1) return '本轮已经接到 A，谁都接不上，用「过牌」结束本轮'
    if (n === 0) return `${needText(s)}：没有能接的牌，用「过牌」把回合交给电脑`
    return `${needText(s)}：${n} 张牌可以打出（万能牌 2 随时可用）`
  },
}

export default game
