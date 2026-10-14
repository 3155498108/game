/**
 * 连环新接龙渲染 + 输入映射。
 * 规则在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas。
 * 玩家手牌**按花色分组**（♠♥♣♦王）竖排，组内按点数从小到大；
 * playerHandLayout() 的坐标由渲染与输入共用，保证命中永远一致。
 * 动画走 render/anim 旁路，不进 reduce。
 */
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { SUIT_SYMBOL, cardLabel, isJoker, type Card } from '../../core/cards'
import type { Rect } from '../../core/geom'
import { inRect } from '../../core/geom'
import { COLORS, background, banner, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { drawCard } from '../../render/cards'
import { keepAlive, progressSince, pulse, tweenTo } from '../../render/anim'
import meta from './meta'
import { AI, PLAYER, aiAction, create, isLegal, playableCards, reduce, roundSuit, stock, type Action, type State } from './rules'

const VW = 720
const VH = 1280

/** 桌面面板与桌面牌（接龙基准） */
const PANEL: Rect = { x: 128, y: 258, w: 464, h: 242 }
const TABLE_X = 280
const TABLE_Y = 268
const TABLE_W = 160
const TABLE_H = 224
/** 面板两侧的小挂件：本轮花色 / 悔牌次数 */
const CHIP_W = 112
const CHIP_H = 96
const CHIP_L = { x: 142, y: 296 }
const CHIP_R = { x: 466, y: 296 }
/** 牌数统计行，以及它下面的「可接什么」提示行 */
const STATS_Y = 533
const CAPTION_Y = 580

/** 电脑手牌（背面） */
const AI_W = 50
const AI_H = 68
const AI_Y = 158

/** 玩家手牌：按花色分组竖排，组内从小到大 */
const HAND_TOP = 600
const GROUP_H = 124
const GROUP_LABEL = 20
const CARD_W = 72
const CARD_H = 96
const MARGIN = 20

interface Placed {
  card: Card
  rect: Rect
}

/** 组内扇形排布：牌多时自动压缩重叠间距 */
function fanRow(n: number, y: number): Rect[] {
  if (n === 0) return []
  const avail = VW - MARGIN * 2
  const step = n === 1 ? 0 : Math.min(CARD_W + 10, (avail - CARD_W) / (n - 1))
  const total = step * (n - 1) + CARD_W
  const x0 = (VW - total) / 2
  return Array.from({ length: n }, (_, i) => ({
    x: x0 + i * step,
    y,
    w: i === n - 1 ? CARD_W : Math.max(step, 1),
    h: CARD_H,
  }))
}

/**
 * 玩家手牌坐标（渲染与输入共用）：手牌本身已由 sortCards 按花色、点数排好，
 * 这里只把同花色的牌放进同一行，空组直接跳过不留空档。
 */
function playerHandLayout(hand: readonly Card[]): Placed[] {
  const out: Placed[] = []
  let row = 0
  let i = 0
  while (i < hand.length) {
    const suit = hand[i].suit
    let j = i
    while (j < hand.length && hand[j].suit === suit) j++
    const rects = fanRow(j - i, HAND_TOP + row * GROUP_H + GROUP_LABEL)
    for (let k = i; k < j; k++) out.push({ card: hand[k], rect: rects[k - i] })
    row++
    i = j
  }
  return out
}

/** 某一组手牌所在的槽位序号（画组标签用） */
function groupSlotOf(hand: readonly Card[], index: number): number {
  let row = 0
  for (let i = 0; i < index; i++) if (hand[i].suit !== hand[index].suit) row++
  return row
}

/**
 * 把可接牌清单压成一行能放下的宽度。
 * 起手时同花色最多 13 张全可出，直接 join 会横向溢出画布被切掉首尾，
 * 所以超过 CAP_MAX 张就截断并补「等 N 张」。
 */
const CAP_MAX = 5
function cardList(labels: string[]): string {
  if (labels.length <= CAP_MAX) return labels.join(' / ')
  return `${labels.slice(0, CAP_MAX).join(' / ')} … 等 ${labels.length} 张`
}

// ---------------- 绘制 ----------------

function render(ctx: CanvasRenderingContext2D, s: State): void {
  keepAlive()
  background(ctx, VW, VH, '#14477f', '#0a1d3a')

  const mine = s.hands[0].length
  const theirs = s.hands[1].length
  topBar(ctx, VW, `你 ${mine} 张`, `电脑 ${theirs} 张`, 92)
  drawLeadInfo(ctx, s)
  drawAiHand(ctx, s)
  drawTable(ctx, s)
  drawPlayerHand(ctx, s)
  drawTip(ctx, s)

  if (s.over) {
    banner(
      ctx,
      VW,
      VH,
      s.winner === PLAYER ? '你赢了' : s.winner === AI ? '电脑赢了' : '平局',
      `你剩 ${mine} 张 · 电脑剩 ${theirs} 张 · 第 ${s.rounds + 1} 轮`,
      s.winner === PLAYER ? COLORS.green : s.winner === AI ? COLORS.red : COLORS.accent,
    )
  }
}

/** 顶部：下一轮的指定起手花色（整局最重要的一条规则提示） */
function drawLeadInfo(ctx: CanvasRenderingContext2D, s: State): void {
  const label =
    s.leadSuit === null
      ? s.tableTop === null
        ? '本轮：任意花色起手'
        : '本轮接龙中'
      : `下一轮须以 ${SUIT_SYMBOL[s.leadSuit]} 起手`
  fillRoundRect(ctx, 60, 100, VW - 120, 48, 16, s.leadSuit === null ? 'rgba(0,0,0,0.26)' : withAlpha(COLORS.accent, 0.22))
  shadowText(ctx, label, VW / 2, 124, { size: 26, color: s.leadSuit === null ? COLORS.textDim : COLORS.accent })
}

/** 电脑手牌：只看张数与万能牌数量 */
function drawAiHand(ctx: CanvasRenderingContext2D, s: State): void {
  const n = s.hands[1].length
  if (n === 0) {
    text(ctx, '电脑已出完', VW / 2, AI_Y + AI_H / 2, { size: 26, color: COLORS.textDim })
    return
  }
  const avail = VW - MARGIN * 2
  const step = n === 1 ? 0 : Math.min(AI_W + 8, (avail - AI_W) / (n - 1))
  const total = step * (n - 1) + AI_W
  for (let i = 0; i < n; i++) {
    const w = i === n - 1 ? AI_W : Math.max(step, 1)
    drawCard(ctx, null, (VW - total) / 2 + i * step, AI_Y, w, AI_H)
  }
  const jokers = s.hands[1].filter((c) => isJoker(c)).length
  text(ctx, `电脑 ${n} 张${jokers > 0 ? ` · 万能 ${jokers} 张` : ''}`, VW / 2, 244, { size: 24, color: COLORS.textDim })
}

/** 桌面：本轮末牌 + 本轮花色 + 悔牌次数 + 牌数统计 */
function drawTable(ctx: CanvasRenderingContext2D, s: State): void {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 28, 'rgba(4,16,36,0.62)')
  ctx.restore()
  fillRoundRect(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 28, 'rgba(255,255,255,0.05)', COLORS.line, 2)

  const flip = s.moves === 0 ? 1 : progressSince('gops-chain-play', String(s.moves), 320)
  const glow = s.over ? 0 : tweenTo('gops-chain-glow', 1, 240)
  ctx.save()
  ctx.globalAlpha = 0.12 + 0.14 * pulse(1100) * glow
  fillRoundRect(ctx, TABLE_X - 10, TABLE_Y - 10, TABLE_W + 20, TABLE_H + 20, 28, COLORS.accent)
  ctx.restore()

  if (s.tableTop) {
    drawCard(ctx, s.tableTop, TABLE_X, TABLE_Y, TABLE_W, TABLE_H, { flip, highlight: !s.over })
  } else {
    fillRoundRect(ctx, TABLE_X, TABLE_Y, TABLE_W, TABLE_H, 18, 'rgba(255,255,255,0.06)', COLORS.line, 2)
    shadowText(ctx, '桌面为空', VW / 2, TABLE_Y + TABLE_H / 2 - 20, { size: 28, color: COLORS.textDim })
    shadowText(ctx, s.leadSuit === null ? '任选花色起手' : `须出 ${SUIT_SYMBOL[s.leadSuit]}`, VW / 2, TABLE_Y + TABLE_H / 2 + 24, {
      size: 26,
      color: COLORS.accent,
    })
  }

  // 左挂件：本轮花色与已接长度
  fillRoundRect(ctx, CHIP_L.x, CHIP_L.y, CHIP_W, CHIP_H, 18, 'rgba(255,255,255,0.07)')
  const suit = roundSuit(s)
  shadowText(ctx, suit === null ? '—' : SUIT_SYMBOL[suit], CHIP_L.x + CHIP_W / 2, CHIP_L.y + 32, {
    size: 40,
    color: suit === null ? COLORS.textDim : suit === 'H' || suit === 'D' ? COLORS.red : COLORS.text,
  })
  text(ctx, `本轮 ${s.chainPlays} 张`, CHIP_L.x + CHIP_W / 2, CHIP_L.y + 68, { size: 19, color: COLORS.textDim })

  // 右挂件：悔牌次数
  fillRoundRect(ctx, CHIP_R.x, CHIP_R.y, CHIP_W, CHIP_H, 18, s.undoLeft > 0 ? 'rgba(255,204,51,0.16)' : 'rgba(255,255,255,0.07)')
  shadowText(ctx, `${s.undoLeft}`, CHIP_R.x + CHIP_W / 2, CHIP_R.y + 32, {
    size: 40,
    color: s.undoLeft > 0 ? COLORS.accent : COLORS.textDim,
  })
  text(ctx, '悔牌次数', CHIP_R.x + CHIP_W / 2, CHIP_R.y + 68, { size: 19, color: COLORS.textDim })

  const jokerNote = s.lastPlayed !== null && isJoker(s.lastPlayed)
  fillRoundRect(ctx, 60, STATS_Y - 22, VW - 120, 44, 16, 'rgba(0,0,0,0.28)')
  const stats = `牌堆 ${stock(s)} · 弃牌 ${s.pile.length} · 第 ${s.rounds + 1} 轮${jokerNote ? ' · 万能牌不接龙' : ''}`
  text(ctx, stats, VW / 2, STATS_Y, { size: 23, weight: 'bold', color: jokerNote ? COLORS.accent : COLORS.text })

  if (!s.over && s.turn === PLAYER) {
    const cards = playableCards(s, PLAYER)
    const cap =
      s.tableTop === null
        ? cards.length > 0
          ? `起手牌：${cardList(cards.map(cardLabel))}`
          : '你没有能起手的牌'
        : cards.length > 0
          ? `你可接：${cardList(cards.map(cardLabel))}`
          : '你接不上了，请点「过」'
    shadowText(ctx, cap, VW / 2, CAPTION_Y, { size: 23, color: cards.length > 0 ? COLORS.text : COLORS.textDim })
  }
}

/** 玩家手牌：按花色分组，组内从小到大；可接的打亮，提示牌抬起并呼吸 */
function drawPlayerHand(ctx: CanvasRenderingContext2D, s: State): void {
  const hand = s.hands[0]
  if (hand.length === 0) return
  const placed = playerHandLayout(hand)
  const ok = new Set(playableCards(s, PLAYER).map((c) => c.id))
  const myTurn = !s.over && s.turn === PLAYER
  const glow = pulse(900)

  for (let i = 0; i < placed.length; i++) {
    const p = placed[i]
    const hinted = p.card.id === s.hintCardId
    drawCard(ctx, p.card, p.rect.x, p.rect.y, p.rect.w, p.rect.h, {
      highlight: myTurn && ok.has(p.card.id),
      dim: myTurn && !ok.has(p.card.id) && !hinted,
      selected: hinted,
    })
    if (hinted) {
      ctx.save()
      ctx.globalAlpha = 0.45 + 0.4 * glow
      fillRoundRect(ctx, p.rect.x + p.rect.w / 2 - 24, p.rect.y + p.rect.h - 18, 48, 18, 9, COLORS.accent2)
      ctx.restore()
      text(ctx, '提示', p.rect.x + p.rect.w / 2, p.rect.y + p.rect.h - 9, { size: 15, color: '#0c1b2a', weight: 'bold' })
    }
    // 组标签：每一行的花色与张数
    if (i === 0 || hand[i - 1].suit !== p.card.suit) {
      const slot = groupSlotOf(hand, i)
      const count = placed.filter((_, k) => groupSlotOf(hand, k) === slot).length
      const label = p.card.suit === 'J' ? `万能 ×${count}` : `${SUIT_SYMBOL[p.card.suit]} ×${count}`
      const color = p.card.suit === 'J' ? COLORS.accent2 : p.card.suit === 'H' || p.card.suit === 'D' ? COLORS.red : COLORS.textDim
      text(ctx, label, 26, HAND_TOP + slot * GROUP_H + 11, { size: 21, align: 'left', color, weight: 'bold' })
    }
  }
}

/** 底部一行操作提示 */
function drawTip(ctx: CanvasRenderingContext2D, s: State): void {
  let tip: string
  if (s.over) tip = '点「新的一局」再来一次'
  else if (s.turn !== PLAYER) tip = '电脑正在接龙…'
  else if (s.hintCardId !== null) tip = '已高亮提示牌：点它即可打出，或再想想别的打法'
  else if (playableCards(s, PLAYER).length === 0) tip = '没有能接上的牌，点下方「过」把回合交给电脑'
  else tip = '点亮的手牌可以打出 · 必须接完才能过牌'
  fillRoundRect(ctx, 40, 1232, VW - 80, 44, 14, 'rgba(0,0,0,0.3)')
  text(ctx, tip, VW / 2, 1254, { size: 22, color: COLORS.textDim })
}

// ---------------- 模块导出 ----------------

const TABLE_CX = TABLE_X + TABLE_W / 2
const TABLE_CY = TABLE_Y + TABLE_H / 2

function effects(prev: State, next: State): Effect[] {
  if (!prev.over && next.over) {
    if (next.winner === PLAYER) {
      return [
        { kind: 'sound', name: 'win' },
        { kind: 'flash', color: 'rgba(102,187,106,0.3)' },
        { kind: 'burst', x: TABLE_CX, y: TABLE_CY, color: COLORS.green, count: 24 },
      ]
    }
    if (next.winner === AI) {
      return [
        { kind: 'sound', name: 'lose' },
        { kind: 'shake', power: 8 },
        { kind: 'burst', x: TABLE_CX, y: TABLE_CY, color: COLORS.red, count: 18 },
      ]
    }
    return [
      { kind: 'sound', name: 'error' },
      { kind: 'shake', power: 5 },
    ]
  }
  if (next.undoLeft < prev.undoLeft) return [{ kind: 'sound', name: 'flip' }]
  if (next.hintCardId !== prev.hintCardId && next.hintCardId !== null) {
    const c = next.hands[0].find((x) => x.id === next.hintCardId)
    return c
      ? [{ kind: 'sound', name: 'click' }, { kind: 'burst', x: TABLE_CX, y: CAPTION_Y, color: COLORS.accent2, count: 10 }]
      : []
  }
  if (next.recycles > prev.recycles) {
    return [
      { kind: 'sound', name: 'score' },
      { kind: 'flash', color: 'rgba(255,204,51,0.25)' },
    ]
  }
  if (next.moves > prev.moves) {
    const out: Effect[] = [
      { kind: 'sound', name: 'place' },
      { kind: 'burst', x: TABLE_CX, y: TABLE_CY, color: COLORS.accent, count: 14 },
    ]
    const played = next.lastPlayed
    if (played !== null && isJoker(played)) out.unshift({ kind: 'sound', name: 'flip' })
    return out
  }
  if (next.passes > prev.passes) return [{ kind: 'sound', name: 'tick' }]
  return []
}

function outcome(state: State): Outcome | null {
  if (!state.over) return null
  // 电脑手里剩的牌越多，你这局赢得越漂亮
  return { score: state.hands[1].length, better: 'higher', unit: ' 分', win: state.winner === PLAYER }
}

/** 画面点击：只认 up，避免一次点击同时触发 down/up 而打出两张牌 */
function input(state: State, p: PointerInput): Action | null {
  if (state.over || state.turn !== PLAYER || p.kind !== 'up') return null
  const placed = playerHandLayout(state.hands[0])
  for (let i = placed.length - 1; i >= 0; i--) {
    if (!inRect(p, placed[i].rect)) continue
    const action: Action = { type: 'play', cardId: placed[i].card.id }
    return isLegal(state, action) ? action : null
  }
  return null
}

/** 桌面端便利：数字键 = 屏幕上的前 N 张牌，空格 / 回车 = 过牌 */
function key(state: State, k: string): Action | null {
  if (state.over || state.turn !== PLAYER) return null
  const placed = playerHandLayout(state.hands[0])
  if (k.length === 1) {
    const n = Number(k)
    if (n >= 1 && n <= 9 && placed[n - 1]) {
      const action: Action = { type: 'play', cardId: placed[n - 1].card.id }
      return isLegal(state, action) ? action : null
    }
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
  input,
  key,
  aiAction,
  effects,
  outcome,
  aiDelay: 520,
  controls: (s) => {
    if (s.over || s.turn !== PLAYER) return []
    return [
      { label: '提示', action: { type: 'hint' }, disabled: s.hintCardId !== null, primary: true },
      { label: `悔牌（剩 ${s.undoLeft}）`, action: { type: 'undo' }, disabled: s.undoLeft <= 0 },
    ]
  },
  hint: (s) => {
    if (s.over) {
      return s.winner === PLAYER
        ? '你赢了！点「新的一局」再来一次'
        : s.winner === AI
          ? '电脑赢了，点「新的一局」再来一次'
          : '双方都接不上，本局平局'
    }
    if (s.turn !== PLAYER) return '电脑思考中…'
    if (s.hintCardId !== null) {
      const c = s.hands[0].find((x) => x.id === s.hintCardId)
      if (c) return `提示：先出 ${cardLabel(c)}（能接就得接，接完才轮得到过牌）`
    }
    const cards = playableCards(s, PLAYER)
    if (cards.length === 0) return '没有能接上的牌，点「过」把回合交给电脑'
    const list = cards.slice(0, 5).map(cardLabel).join(' / ')
    return `轮到你（${cards.length} 张可接）：${list}${cards.length > 5 ? ' …' : ''}`
  },
}

export default game