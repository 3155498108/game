/**
 * 百家乐 baccarat —— 渲染与输入层。
 *
 * 本文件只负责「画」：发牌顺序、要牌、结算全部由 rules.ts 的纯状态机推进，
 * 这里通过 tick(dt) 把真实时间喂进去，让发牌有节奏感。
 */
import type { Control, Effect, GameModule, Outcome } from '../../core/types'
import { progressSince, tweenTo } from '../../render/anim'
import { COLORS, background, banner, fillRoundRect, shadowText, text, topBar } from '../../render/draw'
import { drawCard, handLayout } from '../../render/cards'
import { meta } from './meta'
import {
  SIDE_LABEL,
  STEP_MS,
  create,
  handTotal,
  payoutNet,
  reduce,
} from './rules'
import type { Action, Result, Stage, State } from './rules'

const VW = 720
const VH = 1280

const CARD_W = 104
const CARD_H = 152
const BANKER_LABEL_Y = 130
const BANKER_Y = 165
const PLAYER_LABEL_Y = 880
const PLAYER_Y = 915

/** 阶段提示文案 */
const STAGE_LABEL: Record<Stage, string> = {
  bet: '等待下注',
  dealP0: '发牌 · 闲家',
  dealB0: '发牌 · 庄家',
  dealP1: '发牌 · 闲家',
  dealB1: '发牌 · 庄家',
  playerCheck: '闲家要牌判定',
  bankerCheck: '庄家要牌判定',
  bankerDraw: '庄家已补牌',
  settle: '比点结算',
  done: '本局结束',
}

const RESULT_LABEL: Record<Result, string> = { banker: '庄家胜', player: '闲家胜', tie: '和局' }

function netText(net: number): string {
  if (net > 0) return `赢 ${net} 倍注`
  if (net === 0) return '退还本金'
  return `输 ${Math.abs(net)} 倍注`
}

/** 某一方的手牌：新发的牌做一次翻入动画 */
function drawHand(ctx: CanvasRenderingContext2D, s: State, side: 'player' | 'banker', y: number): void {
  const cards = side === 'player' ? s.player : s.banker
  const rects = handLayout(cards.length, VW, y, CARD_W, CARD_H, 40)
  cards.forEach((c, i) => {
    const r = rects[i]
    // 签名只在该位置由「无牌」变「有牌」时变化，所以每张牌只播一次
    const p = progressSince(`baccarat-card-${side}-${i}`, `${s.rounds}:${i < cards.length}`, STEP_MS)
    ctx.save()
    if (p < 1) ctx.translate(0, -(1 - p) * 36)
    drawCard(ctx, c, r.x, r.y, r.w, r.h, { flip: p })
    ctx.restore()
  })
}

/** 总点数徽章（数字用补间平滑变化） */
function drawTotal(ctx: CanvasRenderingContext2D, label: string, total: number, key: string, y: number): void {
  const w = 200
  const h = 74
  const shown = Math.round(tweenTo(key, total, 260)) % 10
  fillRoundRect(ctx, (VW - w) / 2, y, w, h, h / 2, 'rgba(0,0,0,0.35)', COLORS.accent, 3)
  shadowText(ctx, `${label} ${shown}`, VW / 2, y + h / 2, { size: 38, color: COLORS.accent })
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, COLORS.felt, COLORS.feltDark)

  topBar(ctx, VW, `第 ${s.rounds + 1} 局`, s.rounds === 0 ? '累计 —' : `累计 ×${s.profit}`)

  // 庄家（上）
  text(ctx, '庄', VW / 2, BANKER_LABEL_Y, { size: 30, weight: 'bold', color: COLORS.textDim })
  drawHand(ctx, s, 'banker', BANKER_Y)
  drawTotal(ctx, '庄', handTotal(s.banker), 'baccarat-total-banker', 360)

  // 中段：下注与阶段（结算时由横幅覆盖）
  text(ctx, `本局押注：${SIDE_LABEL[s.bet]} ${s.bet === 'tie' ? '8:1' : '1:1'}`, VW / 2, 640, {
    size: 30,
    weight: 'bold',
    color: COLORS.text,
  })
  text(ctx, STAGE_LABEL[s.stage], VW / 2, 700, { size: 26, color: COLORS.textDim })

  // 闲家（下）
  text(ctx, '闲', VW / 2, PLAYER_LABEL_Y, { size: 30, weight: 'bold', color: COLORS.textDim })
  drawHand(ctx, s, 'player', PLAYER_Y)
  drawTotal(ctx, '闲', handTotal(s.player), 'baccarat-total-player', 1110)

  // 底部：累计收益与要牌表
  shadowText(ctx, `累计收益 ×${s.profit}`, VW / 2, 1196, { size: 30, color: COLORS.accent })
  text(ctx, '要牌表：闲 0~5 要 · 庄 0~5 / 7 / 9 要', VW / 2, 1240, { size: 22, color: COLORS.textDim })

  if (s.phase === 'done' && s.result) {
    const won = s.lastNet > 0
    banner(
      ctx,
      VW,
      VH,
      RESULT_LABEL[s.result],
      `你押${SIDE_LABEL[s.bet]} · ${netText(s.lastNet)}`,
      won ? COLORS.accent : s.lastNet === 0 ? COLORS.text : COLORS.red,
    )
  }
}

function controls(s: State): Control<Action>[] {
  const idle = s.phase !== 'playing'
  return [
    { label: '下注·庄 1:1', action: { type: 'placeBet', side: 'banker' }, disabled: !idle, primary: s.bet === 'banker' },
    { label: '下注·闲 1:1', action: { type: 'placeBet', side: 'player' }, disabled: !idle, primary: s.bet === 'player' },
    { label: '下注·和 8:1', action: { type: 'placeBet', side: 'tie' }, disabled: !idle, primary: s.bet === 'tie' },
  ]
}

function hint(s: State): string {
  if (s.phase === 'done') {
    const label = s.result ? RESULT_LABEL[s.result] : '本局结束'
    return `闲 ${handTotal(s.player)} · 庄 ${handTotal(s.banker)} → ${label}｜你押${SIDE_LABEL[s.bet]}，${netText(s.lastNet)}`
  }
  if (s.phase === 'playing') return `${STAGE_LABEL[s.stage]}…`
  return `选择下注：庄 1:1 / 闲 1:1 / 和 8:1｜当前选中 ${SIDE_LABEL[s.bet]}`
}

function outcome(s: State): Outcome | null {
  if (s.phase !== 'done') return null
  return { score: s.profit, better: 'higher', unit: '金币', win: s.lastNet > 0 }
}

/** 金币结算：按注额倍数换算，和局押中返 8 倍 + 本金，押庄闲遇和退还本金 */
function coins(s: State, _outcome: Outcome, bet: number): number {
  if (s.phase !== 'done' || !s.result) return 0
  return Math.round(bet * payoutNet(s.bet, s.result))
}

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  const dealt = next.player.length + next.banker.length - (prev.player.length + prev.banker.length)
  if (dealt > 0) out.push({ kind: 'sound', name: 'flip' })
  if (next.phase === 'done' && prev.phase !== 'done') {
    if (next.lastNet > 0) {
      out.push({ kind: 'sound', name: 'win' })
      out.push({ kind: 'burst', x: VW / 2, y: 640, color: COLORS.accent, count: 36 })
    } else if (next.lastNet === 0) {
      out.push({ kind: 'sound', name: 'score' })
    } else {
      out.push({ kind: 'sound', name: 'lose' })
      out.push({ kind: 'shake', power: 8 })
    }
  }
  return out
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  /** 站点壳每帧调用：dt(ms) 累加够了就自动走一步发牌 / 要牌 / 结算 */
  tick: (dt: number) => ({ type: 'step', dt }),
  hint,
  controls,
  outcome,
  effects,
  coins,
}

export default game
export { meta }
export type { Action, State }
