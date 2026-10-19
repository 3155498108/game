/**
 * 接龙渲染 + 输入映射。
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 * 手牌按经典 gops 排成两行，handRects() 的坐标由渲染与输入共用，保证命中永远一致。
 */
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { cardLabel, isJoker } from '../../core/cards'
import type { Rect } from '../../core/geom'
import { inRect } from '../../core/geom'
import { COLORS, background, banner, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { drawCard, handLayout } from '../../render/cards'
import { keepAlive, progressSince, pulse, tweenTo } from '../../render/anim'
import meta from './meta'
import { aiAction, create, isLegal, playableCards, reduce, stock, type Action, type State } from './rules'

const VW = 720
const VH = 1280

/** 桌面（接龙基准）大牌 */
const TABLE_X = 262
const TABLE_Y = 470
const TABLE_W = 196
const TABLE_H = 274
/** 桌面底座（同时兜住万能牌小图） */
const PANEL: Rect = { x: 120, y: 440, w: 480, h: 320 }
/** 打出万能牌时，桌面不变，右下角单独展示这张「不接龙」的牌 */
const JOKER_X = TABLE_X + TABLE_W + 18
const JOKER_Y = TABLE_Y + 44
const JOKER_W = 100
const JOKER_H = 140

/** 电脑手牌（背面，只用来看张数） */
const AI_W = 74
const AI_H = 104
const AI_Y = 196
const AI_MARGIN = 24

/** 玩家手牌：经典 gops 的两行排布 */
const HAND_ROWS = 2
const HAND_W = 100
const HAND_H = 140
const ROW_Y = [890, 1036]
const HAND_MARGIN = 24

/** 手牌坐标：渲染与输入共用同一份 */
function handRects(n: number): Rect[] {
  const top = Math.ceil(n / HAND_ROWS)
  const counts = [top, n - top]
  const out: Rect[] = []
  for (let r = 0; r < HAND_ROWS; r++) {
    for (const rect of handLayout(counts[r], VW, ROW_Y[r], HAND_W, HAND_H, HAND_MARGIN)) out.push(rect)
  }
  return out
}

/** 当前回合可接的手牌 id 集合（渲染高亮用） */
function playableIds(state: State, who: 1 | 2): Set<number> {
  return new Set(playableCards(state, who).map((c) => c.id))
}

/**
 * 把可接牌清单压成一行能放下的宽度。
 * 开头桌面为空时 27 张牌全可出，直接 join 会横向溢出画布被切掉首尾，
 * 所以超过 CAP 张就截断并补「等 N 张」。
 */
const CAP_MAX = 5
function cardList(labels: string[]): string {
  if (labels.length <= CAP_MAX) return labels.join(' / ')
  return `${labels.slice(0, CAP_MAX).join(' / ')} … 等 ${labels.length} 张`
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  keepAlive()
  background(ctx, VW, VH, '#17603f', '#0c3725')

  const mine = state.hands[0].length
  const theirs = state.hands[1].length
  topBar(ctx, VW, `你 ${mine} 张`, `电脑 ${theirs} 张`, 96)
  const sub = state.over ? '本局结束' : state.turn === 1 ? '轮到你出牌' : '电脑思考中…'
  shadowText(ctx, sub, VW / 2, 140, { size: 26, color: COLORS.textDim, weight: 'normal' })
  text(ctx, '同花色点数相邻才能接 · 大小王是万能牌', VW / 2, 172, { size: 24, color: COLORS.textDim })

  drawAiHand(ctx, state)
  drawTable(ctx, state)
  drawPlayerHand(ctx, state)

  const tip = state.over
    ? '点「新的一局」再来一次'
    : state.turn === 1
      ? playableIds(state, 1).size > 0
        ? '点亮的牌可以打出 · 发暗的牌接不上'
        : '没有能接上的牌，请点下方「过」'
      : '电脑正在接龙…'
  fillRoundRect(ctx, 60, 1196, VW - 120, 56, 18, 'rgba(0,0,0,0.26)')
  text(ctx, tip, VW / 2, 1224, { size: 25, color: COLORS.textDim })

  if (state.over) {
    banner(
      ctx,
      VW,
      VH,
      state.winner === 1 ? '你赢了' : state.winner === 2 ? '电脑赢了' : '平局',
      `你剩 ${mine} 张 · 电脑剩 ${theirs} 张`,
      state.winner === 1 ? COLORS.green : COLORS.red,
    )
  }
}

/** 电脑手牌：背面 + 张数与万能牌数量 */
function drawAiHand(ctx: CanvasRenderingContext2D, state: State): void {
  const n = state.hands[1].length
  for (const r of handLayout(n, VW, AI_Y, AI_W, AI_H, AI_MARGIN)) {
    drawCard(ctx, null, r.x, r.y, r.w, r.h)
  }
  const jokers = state.hands[1].filter((c) => isJoker(c)).length
  text(ctx, `电脑 ${n} 张${jokers > 0 ? ` · 万能 ${jokers} 张` : ''}`, VW / 2, 324, { size: 25, color: COLORS.textDim })
}

/** 桌面：接龙基准 + 万能牌单独展示 + 可接提示 */
function drawTable(ctx: CanvasRenderingContext2D, state: State): void {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 28, withAlpha('#08301f', 0.6))
  ctx.restore()
  fillRoundRect(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 28, 'rgba(255,255,255,0.05)', COLORS.line, 2)

  const flip = state.moves === 0 ? 1 : progressSince('gops-play', String(state.moves), 320)
  const glow = state.over ? 0 : tweenTo('gops-glow', 1, 240)
  ctx.save()
  ctx.globalAlpha = 0.14 + 0.14 * pulse(1100) * glow
  fillRoundRect(ctx, TABLE_X - 12, TABLE_Y - 12, TABLE_W + 24, TABLE_H + 24, 30, COLORS.accent)
  ctx.restore()

  if (state.tableTop) {
    drawCard(ctx, state.tableTop, TABLE_X, TABLE_Y, TABLE_W, TABLE_H, { flip, highlight: !state.over })
  } else {
    fillRoundRect(ctx, TABLE_X, TABLE_Y, TABLE_W, TABLE_H, 20, 'rgba(255,255,255,0.06)', COLORS.line, 2)
    shadowText(ctx, '桌面为空', VW / 2, TABLE_Y + TABLE_H / 2 - 22, { size: 30, color: COLORS.textDim })
    shadowText(ctx, '首出可任选', VW / 2, TABLE_Y + TABLE_H / 2 + 24, { size: 27, color: COLORS.accent })
  }

  // 万能牌打出后不改变接龙基准：右下角单独摆出来，并写明桌面仍是哪张
  const last = state.lastPlayed
  if (last && isJoker(last) && state.tableTop) {
    drawCard(ctx, last, JOKER_X, JOKER_Y, JOKER_W, JOKER_H, { highlight: true })
    fillRoundRect(ctx, JOKER_X, JOKER_Y + JOKER_H + 8, 62, 24, 8, COLORS.accent)
    text(ctx, '万能', JOKER_X + 31, JOKER_Y + JOKER_H + 20, { size: 17, color: '#1b1b1f' })
  }

  // 牌堆 / 弃牌堆 / 跳过次数
  fillRoundRect(ctx, 60, 352, VW - 120, 48, 16, 'rgba(0,0,0,0.28)')
  text(ctx, `弃牌 ${state.pile.length} 张 · 牌堆 ${stock(state)} 张 · 跳过 ${state.passes} 次`, VW / 2, 376, { size: 24, weight: 'bold' })

  // 可接提示
  if (state.over) {
    shadowText(ctx, state.winner === 1 ? '你出完了，获胜！' : state.winner === 2 ? '电脑出完了' : '双方卡死，平局', VW / 2, 840, {
      size: 32,
      color: state.winner === 1 ? COLORS.green : COLORS.red,
    })
    return
  }
  if (state.tableTop && last && isJoker(last)) {
    text(ctx, `万能牌不接龙，桌面仍是 ${cardLabel(state.tableTop)}`, VW / 2, 800, { size: 24, color: COLORS.accent })
  }
  const who = state.turn
  const cards = playableCards(state, who)
  const cap =
    cards.length > 0
      ? `${who === 1 ? '你可接' : '电脑可接'}：${cardList(cards.map(cardLabel))}`
      : `${who === 1 ? '你' : '电脑'}没有能接的牌`
  shadowText(ctx, cap, VW / 2, 840, { size: 26, color: cards.length > 0 ? COLORS.text : COLORS.textDim })
}

/** 玩家手牌：两行，能接的打亮、大小王标「万能」 */
function drawPlayerHand(ctx: CanvasRenderingContext2D, state: State): void {
  const hand = state.hands[0]
  const rects = handRects(hand.length)
  const ok = playableIds(state, 1)
  const myTurn = !state.over && state.turn === 1
  for (let i = 0; i < hand.length; i++) {
    const c = hand[i]
    const r = rects[i]
    drawCard(ctx, c, r.x, r.y, r.w, r.h, { highlight: myTurn && ok.has(c.id), dim: myTurn && !ok.has(c.id) })
    if (isJoker(c)) {
      fillRoundRect(ctx, r.x - 2, r.y - 26, 62, 24, 8, COLORS.accent)
      text(ctx, '万能', r.x + 29, r.y - 14, { size: 17, color: '#1b1b1f' })
    }
  }
}

function effects(prev: State, next: State): Effect[] {
  const cx = TABLE_X + TABLE_W / 2
  const cy = TABLE_Y + TABLE_H / 2
  if (!prev.over && next.over) {
    if (next.winner === 1) {
      return [
        { kind: 'sound', name: 'win' },
        { kind: 'flash', color: 'rgba(102,187,106,0.3)' },
        { kind: 'burst', x: cx, y: cy, color: COLORS.green, count: 24 },
      ]
    }
    if (next.winner === 2) {
      return [
        { kind: 'sound', name: 'lose' },
        { kind: 'shake', power: 8 },
        { kind: 'burst', x: cx, y: cy, color: COLORS.red, count: 18 },
      ]
    }
    return [{ kind: 'sound', name: 'error' }, { kind: 'shake', power: 5 }]
  }
  if (next.recycles > prev.recycles) {
    return [{ kind: 'sound', name: 'score' }, { kind: 'flash', color: 'rgba(255,204,51,0.25)' }]
  }
  if (next.moves > prev.moves) {
    const played = next.lastPlayed
    const out: Effect[] = [
      { kind: 'sound', name: 'place' },
      { kind: 'burst', x: cx, y: cy, color: COLORS.accent, count: 14 },
    ]
    // 万能牌的反馈与普通牌区分开
    if (played && isJoker(played)) out.unshift({ kind: 'sound', name: 'flip' })
    return out
  }
  if (next.passes > prev.passes) return [{ kind: 'sound', name: 'tick' }]
  return []
}

function outcome(state: State): Outcome | null {
  if (!state.over) return null
  // 电脑手里剩下的牌越多，你这局赢得越漂亮
  return { score: state.hands[1].length, better: 'higher', unit: ' 分', win: state.winner === 1 }
}

/** 画面点击：只认 up，避免一次点击同时触发 down/up 而出两张牌 */
function input(state: State, p: PointerInput): Action | null {
  if (state.over || state.turn !== 1 || p.kind !== 'up') return null
  const hand = state.hands[0]
  const rects = handRects(hand.length)
  for (let i = rects.length - 1; i >= 0; i--) {
    if (!inRect(p, rects[i])) continue
    const action: Action = { type: 'play', cardId: hand[i].id }
    return isLegal(state, action) ? action : null
  }
  return null
}

function key(state: State, k: string): Action | null {
  if (state.over || state.turn !== 1) return null
  const hand = state.hands[0]
  const n = Number(k)
  if (k.length === 1 && n >= 1 && n <= 9 && hand[n - 1]) {
    const action: Action = { type: 'play', cardId: hand[n - 1].id }
    return isLegal(state, action) ? action : null
  }
  if (k === ' ' || k === 'Enter') {
    const action: Action = { type: 'pass' }
    return isLegal(state, action) ? action : null
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
  key,
  effects,
  outcome,
  // 无牌可出时才给「过」按钮，正常回合直接点手牌
  controls: (s) => {
    if (s.over || s.turn !== 1) return []
    return playableIds(s, 1).size > 0 ? [] : [{ label: '过（没有能接的牌）', action: { type: 'pass' }, primary: true }]
  },
  hint: (s) => {
    if (s.over) {
      return s.winner === 1 ? '你赢了！点「新的一局」再来一次' : s.winner === 2 ? '电脑赢了，点「新的一局」再来一次' : '双方都接不上，本局平局'
    }
    if (s.turn === 2) return '电脑思考中…'
    const cards = playableCards(s, 1)
    if (cards.length === 0) return '没有能接上的牌，点「过」把回合交给电脑'
    return `轮到你：可接 ${cards.map(cardLabel).join(' / ')}`
  },
  aiDelay: 500,
}

export default game
