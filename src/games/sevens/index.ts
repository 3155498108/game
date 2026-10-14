/**
 * 排七渲染 + 输入映射。
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 */
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { cardLabel, sortCards, type Card } from '../../core/cards'
import type { Rect } from '../../core/geom'
import { inRect } from '../../core/geom'
import { COLORS, background, banner, ease, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { drawCard, handLayout } from '../../render/cards'
import { progressSince, pulse, tweenTo } from '../../render/anim'
import meta from './meta'
import {
  AI,
  DECK_SIZE,
  MAX_RANK,
  MIN_RANK,
  PLAYER,
  SEVEN,
  actionForCard,
  aiAction,
  create,
  legalActions,
  reduce,
  type Action,
  type Side,
  type State,
} from './rules'

const VW = 720
const VH = 1280

/** 电脑手牌（背面小牌）布局 */
const AI_Y = 120
const AI_CARD_W = 66
const AI_CARD_H = 92

/** 桌面面板 */
const PANEL: Rect = { x: 36, y: 262, w: 648, h: 430 }
/** 最近打出的牌 */
const LAST_W = 128
const LAST_H = 180
const LAST_X = (VW - LAST_W) / 2
const LAST_Y = PANEL.y + 22
/** 连续串 */
const CHAIN_LABEL_Y = PANEL.y + 224
const CHAIN_Y = PANEL.y + 250
const CHAIN_W = 54
const CHAIN_H = 76
const CHAIN_STEP = 46
/** 点数灯带 */
const CHIP_W = 42
const CHIP_H = 58
const CHIP_GAP = 5
const CHIP_Y = PANEL.y + 354

/** 玩家手牌布局：render 与 input 共用同一份常量，保证命中永远对齐 */
const HAND_Y = 966
const HAND_CARD_W = 132
const HAND_CARD_H = 186
const HAND_MARGIN = 20

/** 提示按钮最多列出几张 */
const HINT_MAX = 4

const SIDE_COLOR: Record<Side, string> = { 0: COLORS.accent, 1: COLORS.blue }

/** 玩家手牌按花色点数排序展示；render 与 input 用同一个数组，索引天然对齐 */
function viewHand(state: State): Card[] {
  return sortCards(state.hands[PLAYER])
}

function playerHandRects(state: State): Rect[] {
  return handLayout(viewHand(state).length, VW, HAND_Y, HAND_CARD_W, HAND_CARD_H, HAND_MARGIN)
}

/** 当前局面里玩家可打的牌 id 集合 */
function playableIds(state: State): Set<number> {
  const out = new Set<number>()
  if (state.over || state.turn !== PLAYER) return out
  for (const a of legalActions(state)) if (a.type === 'play') out.add(a.cardId)
  return out
}

function statusLine(state: State): string {
  // 电脑张数并进这一行：AI 卡片底(212)到桌面面板顶(262)只有 50px，
  // 塞两行文字必然叠字，所以合并成一行居中显示。
  const left = `电脑：还剩 ${state.hands[AI].length} 张`
  if (state.over) return `${left} · ${state.winner === PLAYER ? '你打完了全部手牌，赢了！' : '电脑先打完手牌，再来一局'}`
  if (state.turn === PLAYER) {
    const n = playableIds(state).size
    return n > 0 ? `${left} · 轮到你出牌 · 有 ${n} 张可出` : `${left} · 你没有可出的牌：点一张手牌丢掉并补一张`
  }
  return `${left} · 电脑思考中…`
}

// ---------------- 绘制 ----------------

function render(ctx: CanvasRenderingContext2D, state: State): void {
  background(ctx, VW, VH, COLORS.felt, COLORS.feltDark)
  topBar(ctx, VW, `你 ${state.scores[PLAYER]} 分`, `电脑 ${state.scores[AI]} 分`, 96)

  drawAiHand(ctx, state)
  shadowText(ctx, statusLine(state), VW / 2, 237, { size: 24, color: COLORS.textDim, weight: 'normal' })

  drawTable(ctx, state)
  drawDeckPile(ctx, state)
  drawPlayerHand(ctx, state)

  fillRoundRect(ctx, 60, VH - 90, VW - 120, 56, 18, 'rgba(0,0,0,0.26)')
  const tip = state.over
    ? '点「新的一局」再来一次'
    : state.turn === PLAYER
      ? '点一张发光的牌打出 · 没有可出的牌时点一张丢弃并补牌'
      : '电脑正在出牌…'
  text(ctx, tip, VW / 2, VH - 62, { size: 24, color: COLORS.textDim })

  if (state.over) {
    const win = state.winner === PLAYER
    banner(ctx, VW, VH, win ? '胜利' : '失败', `你 ${state.scores[PLAYER]} 分 · 电脑 ${state.scores[AI]} 分`, win ? COLORS.accent : COLORS.red)
  }
}

/** 电脑手牌：背面小牌（张数并入状态行，避免与状态行叠字） */
function drawAiHand(ctx: CanvasRenderingContext2D, state: State): void {
  const n = state.hands[AI].length
  const shown = Math.min(n, 10)
  const rects = handLayout(shown, VW, AI_Y, AI_CARD_W, AI_CARD_H, 16)
  for (const r of rects) drawCard(ctx, null, r.x, r.y, r.w, r.h, { faceUp: false })
}

/** 桌面：最近打出的牌 + 当前连续串 + 点数灯带 */
function drawTable(ctx: CanvasRenderingContext2D, state: State): void {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 20
  ctx.shadowOffsetY = 8
  fillRoundRect(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 26, withAlpha('#07301d', 0.72))
  ctx.restore()
  fillRoundRect(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 26, 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.16)', 2)

  const last = state.lastPlayed
  if (last) {
    const sig = `${state.moves}:${last.id}`
    const flip = progressSince('sv-play', sig, 320, ease.inOutCubic)
    const glow = tweenTo('sv-last', state.chain.length, 260)
    ctx.save()
    ctx.globalAlpha = 0.12 + 0.12 * pulse(1200) * glow
    fillRoundRect(ctx, LAST_X - 10, LAST_Y - 10, LAST_W + 20, LAST_H + 20, 18, COLORS.accent)
    ctx.restore()
    drawCard(ctx, last, LAST_X, LAST_Y, LAST_W, LAST_H, { flip, highlight: last.rank === SEVEN })
  } else {
    text(ctx, '等待出牌', VW / 2, LAST_Y + LAST_H / 2, { size: 26, color: COLORS.textDim })
  }

  // 连续串
  const chainLen = state.chain.length
  shadowText(
    ctx,
    chainLen > 1 ? `连续串 ${chainLen} 张（本局最长 ${state.bestChain}）` : '还没有接上串',
    VW / 2,
    CHAIN_LABEL_Y,
    { size: 26, color: chainLen > 1 ? COLORS.accent : COLORS.textDim, weight: chainLen > 1 ? 'bold' : 'normal' },
  )
  const show = state.chain.slice(-HINT_MAX)
  const total = CHAIN_STEP * (show.length - 1) + CHAIN_W
  const x0 = (VW - total) / 2
  for (let i = 0; i < show.length; i++) {
    drawCard(ctx, show[i], x0 + i * CHAIN_STEP, CHAIN_Y, CHAIN_W, CHAIN_H, { highlight: i === show.length - 1 })
  }

  // 点数灯带：已接龙的面值点亮
  const chips = MAX_RANK - MIN_RANK + 1
  const totalW = CHIP_W * chips + CHIP_GAP * (chips - 1)
  const cx0 = (VW - totalW) / 2
  for (let i = 0; i < chips; i++) {
    const rank = MIN_RANK + i
    const lit = state.discardRanks.indexOf(rank) >= 0
    const x = cx0 + i * (CHIP_W + CHIP_GAP)
    if (rank === SEVEN) {
      fillRoundRect(ctx, x - 3, CHIP_Y - 3, CHIP_W + 6, CHIP_H + 6, 14, withAlpha(COLORS.accent, 0.35))
    }
    fillRoundRect(
      ctx,
      x,
      CHIP_Y,
      CHIP_W,
      CHIP_H,
      11,
      lit ? withAlpha(SIDE_COLOR[state.turn], 0.55) : 'rgba(255,255,255,0.08)',
      lit ? COLORS.accent : 'rgba(255,255,255,0.18)',
      lit ? 2 : 1,
    )
    text(ctx, String(rank), x + CHIP_W / 2, CHIP_Y + CHIP_H / 2, {
      size: 26,
      weight: 'bold',
      color: lit ? COLORS.text : COLORS.textDim,
    })
  }
}

/** 牌堆余量 */
function drawDeckPile(ctx: CanvasRenderingContext2D, state: State): void {
  const x = 64
  const y = 736
  for (let i = 2; i >= 0; i--) drawCard(ctx, null, x + i * 4, y - i * 3, 84, 118, { faceUp: false })
  const left = state.deck.length
  shadowText(ctx, `牌堆剩余 ${left} 张`, x + 190, y + 42, { size: 28, color: COLORS.text })
  shadowText(ctx, `已洗回 ${state.reshuffles} 次 · 总牌数 ${DECK_SIZE} 张`, x + 190, y + 84, {
    size: 23,
    color: COLORS.textDim,
    weight: 'normal',
  })
}

/** 玩家手牌：可出的牌高亮并带呼吸光 */
function drawPlayerHand(ctx: CanvasRenderingContext2D, state: State): void {
  const hand = viewHand(state)
  const rects = playerHandRects(state)
  const legal = playableIds(state)
  const breathe = 0.1 + 0.1 * pulse(1000)
  for (let i = 0; i < hand.length; i++) {
    const c = hand[i]
    const r = rects[i]
    const ok = legal.has(c.id)
    if (ok && !state.over) {
      ctx.save()
      ctx.globalAlpha = breathe
      fillRoundRect(ctx, r.x - 8, HAND_Y - 26, r.w + 16, HAND_CARD_H + 34, 16, COLORS.accent)
      ctx.restore()
    }
    drawCard(ctx, c, r.x, r.y, r.w, r.h, { highlight: ok, dim: !ok && !state.over })
  }
  if (hand.length === 0) {
    text(ctx, '手牌已打完', VW / 2, HAND_Y + HAND_CARD_H / 2, { size: 32, color: COLORS.accent, weight: 'bold' })
  }
}

// ---------------- 副作用与成绩 ----------------

function effects(prev: State, next: State): Effect[] {
  if (next.moves === prev.moves) return []
  const out: Effect[] = []
  const played = next.discard.length > prev.discard.length
  const gained = next.scores[PLAYER] + next.scores[AI] - (prev.scores[PLAYER] + prev.scores[AI])

  if (next.lastDrawn && next.lastPlayed === null) out.push({ kind: 'sound', name: 'flip' })
  if (played) out.push({ kind: 'sound', name: 'place' })
  if (gained > 0 && next.chain.length >= 3) {
    out.push({ kind: 'sound', name: 'score' })
    out.push({ kind: 'burst', x: VW / 2, y: CHAIN_Y + CHAIN_H / 2, color: COLORS.accent, count: 16 })
  }
  if (next.over) {
    const win = next.winner === PLAYER
    out.push({ kind: 'sound', name: win ? 'win' : 'lose' })
    out.push({ kind: 'burst', x: VW / 2, y: VH / 2, color: win ? COLORS.accent : COLORS.red, count: 24 })
  }
  return out
}

function outcome(state: State): Outcome | null {
  if (!state.over) return null
  const win = state.winner === PLAYER
  return { score: state.scores[PLAYER] + (win ? 100 : 0), better: 'higher', unit: ' 分', win }
}

// ---------------- 输入 ----------------

/** 画面点击：只认 up，避免一次点击同时触发 down/up 而出两张牌 */
function input(state: State, p: PointerInput): Action | null {
  if (state.over || state.turn !== PLAYER || p.kind !== 'up') return null
  const hand = viewHand(state)
  const rects = playerHandRects(state)
  // 从后往前命中：后一张画在上层
  for (let i = rects.length - 1; i >= 0; i--) {
    if (!inRect(p, rects[i])) continue
    return actionForCard(state, hand[i].id)
  }
  return null
}

function key(state: State, k: string): Action | null {
  if (state.over || state.turn !== PLAYER) return null
  const hand = viewHand(state)
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
  if (k in digits) {
    const i = digits.indexOf(k)
    if (i >= hand.length) return null
    return actionForCard(state, hand[i].id)
  }
  return null
}

// ---------------- 模块 ----------------

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  aiAction,
  input,
  key,
  effects,
  outcome,
  aiDelay: 500,
  hint: (s) => statusLine(s),
  controls: (s) => {
    if (s.over || s.turn !== PLAYER) return []
    const hand = viewHand(s)
    return legalActions(s)
      .slice(0, HINT_MAX)
      .map((a, i) => {
        const c = hand.find((x) => x.id === a.cardId)
        const label = c ? `${cardLabel(c)} ${a.type === 'play' ? '可出' : '可弃'}` : '提示'
        return { label, action: a, primary: i === 0 }
      })
  },
}

export default game
