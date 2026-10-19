/**
 * 百家乐 baccarat —— 纯规则层。
 *
 * 约束：不 import DOM、不读 Date / performance、不使用 Math.random；
 * 牌堆由 core/cards 的 makeDeck 生成，洗牌走 Rng(seed)。
 * 规则只看点数，不看花色：A=1，2~9 原值，10/J/Q/K=10，总点数只留个位。
 */
import type { Card } from '../../core/cards'
import { makeDeck } from '../../core/cards'
import { Rng, hashSeed } from '../../core/rng'

/** 8 副牌 */
export const DECKS = 8
/** 一靴牌的张数 */
export const SHOE_SIZE = DECKS * 52
/** 一步（发一张 / 要一张 / 结算）之间的间隔 ms */
export const STEP_MS = 380
/** 每方最多几张牌：首两张 + 至多一张补牌 */
export const MAX_HAND = 3

export type Side = 'banker' | 'player' | 'tie'
/** 开牌结果：谁赢，或者和 */
export type Result = Side
export type Phase = 'bet' | 'playing' | 'done'
export type Stage =
  | 'bet'
  | 'dealP0'
  | 'dealB0'
  | 'dealP1'
  | 'dealB1'
  /** 闲家要牌判定 */
  | 'playerCheck'
  /** 庄家要牌判定 */
  | 'bankerCheck'
  /** 庄家已补牌，等着结算 */
  | 'bankerDraw'
  | 'settle'
  | 'done'

export interface State {
  phase: Phase
  /** 当前走到哪一步（发牌 / 要牌 / 结算） */
  stage: Stage
  /** 本局押哪一边 */
  bet: Side
  /** 牌堆（开局洗一次，耗尽再洗） */
  shoe: readonly Card[]
  /** 牌堆游标 */
  pos: number
  /** 累计洗牌次数（含开局那次） */
  shoes: number
  /** 闲家手牌 */
  player: readonly Card[]
  /** 庄家手牌 */
  banker: readonly Card[]
  /** 本局结果，未结算为 null */
  result: Result | null
  /** 上一局净收益倍数（相对注额）：赢为赔率、输 -1、和局退还 0 */
  lastNet: number
  /** 累计净收益倍数 */
  profit: number
  /** 距离下一步还差多少 ms，由 step(dt) 递减 */
  cooldown: number
  /** 随机游标 */
  rng: number
  /** 已结算局数 */
  rounds: number
}

export type Action =
  | { type: 'placeBet'; side: Side }
  /** 站点壳每帧推进：dt 累加到 STEP_MS 后自动走一步 */
  | { type: 'step'; dt: number }

// ---------------- 下注与赔率 ----------------

/** 赔率即净收益倍数：庄 1:1、闲 1:1、和 8:1 */
export const ODDS: Record<Side, number> = { banker: 1, player: 1, tie: 8 }

export const SIDE_LABEL: Record<Side, string> = { banker: '庄', player: '闲', tie: '和' }

export function isSide(v: unknown): v is Side {
  return v === 'banker' || v === 'player' || v === 'tie'
}

/**
 * 本局净收益倍数（相对注额）：
 * 押中 → 赔率倍数；没押中 → -1（输掉全部注额）；
 * 开和而押的不是「和」→ 0（退还本金，不输不赢）。
 */
export function payoutNet(bet: Side, result: Result): number {
  if (result === 'tie' && bet !== 'tie') return 0
  return result === bet ? ODDS[bet] : -1
}

// ---------------- 点数与要牌表 ----------------

/** 单张点数：A=1，2~9 原值，10/J/Q/K=10（大小王同样按 10 记） */
export function cardPoints(c: Card): number {
  if (c.rank >= 10) return 10
  return Math.max(1, c.rank)
}

/** 手牌总点数，只留个位 */
export function handTotal(cards: readonly Card[]): number {
  let sum = 0
  for (const c of cards) sum += cardPoints(c)
  return sum % 10
}

/** 闲家要牌表：对 0~5 要牌，对 6~9 停牌 */
export function playerDraws(total: number): boolean {
  return total <= 5
}

/** 庄家要牌表：对 0~5 要牌、7 要牌、9 要牌；对 6 停牌、8 停牌 */
export function bankerDraws(total: number): boolean {
  return total <= 5 || total === 7 || total === 9
}

/** 比点：相等为和，否则大者胜 */
export function settle(playerTotal: number, bankerTotal: number): Result {
  if (playerTotal === bankerTotal) return 'tie'
  return playerTotal > bankerTotal ? 'player' : 'banker'
}

// ---------------- 状态机 ----------------

export function create(seed: number): State {
  const r = new Rng(hashSeed(seed))
  return {
    phase: 'bet',
    stage: 'bet',
    bet: 'player',
    shoe: r.shuffle(makeDeck({ decks: DECKS })),
    pos: 0,
    shoes: 1,
    player: [],
    banker: [],
    result: null,
    lastNet: 0,
    profit: 0,
    cooldown: 0,
    rng: r.s,
    rounds: 0,
  }
}

/** 取一张牌；牌堆耗尽则整靴洗回 */
function takeCard(s: State): { card: Card; shoe: readonly Card[]; pos: number; shoes: number; rng: number } {
  if (s.pos < s.shoe.length) {
    return { card: s.shoe[s.pos], shoe: s.shoe, pos: s.pos + 1, shoes: s.shoes, rng: s.rng }
  }
  const r = new Rng(s.rng)
  const shoe = r.shuffle(makeDeck({ decks: DECKS }))
  return { card: shoe[0], shoe, pos: 1, shoes: s.shoes + 1, rng: r.s }
}

/** 发一张牌给某方，并推进到下一步 */
function giveCard(s: State, who: 'player' | 'banker', next: Stage): State {
  const { card, shoe, pos, shoes, rng } = takeCard(s)
  return {
    ...s,
    shoe,
    pos,
    shoes,
    rng,
    stage: next,
    player: who === 'player' ? [...s.player, card] : s.player,
    banker: who === 'banker' ? [...s.banker, card] : s.banker,
  }
}

function settleRound(s: State): State {
  const result = settle(handTotal(s.player), handTotal(s.banker))
  const net = payoutNet(s.bet, result)
  return {
    ...s,
    phase: 'done',
    stage: 'done',
    result,
    lastNet: net,
    profit: s.profit + net,
    cooldown: 0,
    rounds: s.rounds + 1,
  }
}

/** 走一步（不处理冷却，由 reduce 负责） */
function advance(s: State): State {
  switch (s.stage) {
    // 标准发牌顺序：闲、庄、闲、庄，每人两张
    case 'dealP0':
      return giveCard(s, 'player', 'dealB0')
    case 'dealB0':
      return giveCard(s, 'banker', 'dealP1')
    case 'dealP1':
      return giveCard(s, 'player', 'dealB1')
    case 'dealB1':
      return giveCard(s, 'banker', 'playerCheck')
    // 闲家先要牌：0~5 要、6~9 停
    case 'playerCheck':
      return playerDraws(handTotal(s.player)) ? giveCard(s, 'player', 'bankerCheck') : { ...s, stage: 'bankerCheck' }
    // 再看庄家：0~5 / 7 / 9 要，6 / 8 停
    case 'bankerCheck':
      return bankerDraws(handTotal(s.banker)) ? giveCard(s, 'banker', 'bankerDraw') : { ...s, stage: 'settle' }
    case 'bankerDraw':
    case 'settle':
      return settleRound(s)
    default:
      return s
  }
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'placeBet': {
      // 发牌中不能改注；终局后可以再开一局
      if (state.phase === 'playing') return state
      if (!isSide(action.side)) return state
      return {
        ...state,
        phase: 'playing',
        stage: 'dealP0',
        bet: action.side,
        player: [],
        banker: [],
        result: null,
        cooldown: 0,
      }
    }

    case 'step': {
      if (state.phase !== 'playing') return state
      const dt = action.dt
      if (state.cooldown > 0) {
        if (!(dt > 0)) return state
        const left = state.cooldown - dt
        if (left > 0) return { ...state, cooldown: left }
      }
      return { ...advance({ ...state, cooldown: 0 }), cooldown: STEP_MS }
    }

    default:
      return state
  }
}

/** 本局最终净收益倍数（未结算为 0） */
export function netMultiple(s: State): number {
  return s.phase === 'done' ? s.lastNet : 0
}
