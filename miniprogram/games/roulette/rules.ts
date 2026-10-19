/**
 * 欧式轮盘 roulette —— 纯逻辑层。
 *
 * 约束：不 import DOM、不读 Date / performance、不用 Math.random。
 * 随机一律来自 src/core/rng 的 Rng，种子存在 State.rng 里。
 * 动画（球的公转）不进 State，由 render 层用 render/anim 的旁路插值。
 */
import { Rng } from '../../core/rng'

export const VW = 720
export const VH = 1280

/** 一场玩十盘 */
export const ROUNDS = 10
/** 定步：1 步 = 1/60 秒 */
export const TICK_MS = 1000 / 60
/** 旋转阶段步数（约 1.6 秒） */
export const SPIN_TICKS = 96
/** 结算展示步数（约 0.8 秒）后自动进入下一盘 */
export const SETTLE_TICKS = 48
/** 一次下注 = 一枚筹码，单位是「注」 */
export const CHIP = 1
/** 同一个注码最多叠几枚 */
export const MAX_CHIPS = 8
/** 盘面保留最近几期号码 */
export const HISTORY = 12

/** 欧式轮盘排列：0~36 共 37 格，顺时针 */
export const WHEEL: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18,
  29, 7, 28, 12, 35, 3, 26,
]

/** 每格的角度步长（弧度） */
export const SLOT_ANGLE = (Math.PI * 2) / 37

/** 红号 18 个（0 是绿，不算红也不算黑） */
const RED_SET = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])

export function isRed(n: number): boolean {
  return RED_SET.has(n)
}

export function isBlack(n: number): boolean {
  return n >= 1 && n <= 36 && !RED_SET.has(n)
}

export function isZero(n: number): boolean {
  return n === 0
}

/** 号码在盘上的格位 */
export function slotOf(n: number): number {
  const i = WHEEL.indexOf(n)
  return i < 0 ? 0 : i
}

const inRange = (n: number, lo: number, hi: number): boolean => n >= lo && n <= hi

export type BetKind =
  | 'red'
  | 'black'
  | 'odd'
  | 'even'
  | 'small'
  | 'big'
  | 'zero'
  | 'trio'
  | 'dozen1'
  | 'dozen2'
  | 'dozen3'

export interface BetDef {
  kind: BetKind
  /** 提示区按钮上的完整文案 */
  label: string
  /** 画布筹码上的短名 */
  short: string
  /** 净赔率：中奖额外赢多少倍注额 */
  odds: number
  /** 覆盖的号码个数 */
  cover: number
  /** 颜色标识 */
  color: string
  /** 是否命中落点 */
  wins: (n: number) => boolean
}

/**
 * 全部注码表：红黑单双大小 1:1，零 35:1，三连 11:1，二连 2:1。
 * 二连只覆盖 1-12 / 13-24 / 25-36 各 12 个号（0 归零注与三连），
 * 否则 2:1 摊到 13 个号上庄家优势会反转成玩家正期望。
 */
export const BET_DEFS: Record<BetKind, BetDef> = {
  red: { kind: 'red', label: '红', short: '红', odds: 1, cover: 18, color: '#e0393e', wins: isRed },
  black: { kind: 'black', label: '黑', short: '黑', odds: 1, cover: 18, color: '#22222a', wins: isBlack },
  odd: { kind: 'odd', label: '单', short: '单', odds: 1, cover: 18, color: '#42a5f5', wins: (n) => n >= 1 && n % 2 === 1 },
  even: { kind: 'even', label: '双', short: '双', odds: 1, cover: 18, color: '#7e57c2', wins: (n) => n >= 1 && n % 2 === 0 },
  small: { kind: 'small', label: '小(1-18)', short: '小', odds: 1, cover: 18, color: '#26a69a', wins: (n) => inRange(n, 1, 18) },
  big: { kind: 'big', label: '大(19-36)', short: '大', odds: 1, cover: 18, color: '#ff8f00', wins: (n) => inRange(n, 19, 36) },
  zero: { kind: 'zero', label: '零', short: '零', odds: 35, cover: 1, color: '#2e9e4f', wins: isZero },
  trio: { kind: 'trio', label: '三连(0/1/2)', short: '三连', odds: 11, cover: 3, color: '#c2185b', wins: (n) => inRange(n, 0, 2) },
  dozen1: { kind: 'dozen1', label: '二连(1-12)', short: '1-12', odds: 2, cover: 12, color: '#5d4037', wins: (n) => inRange(n, 1, 12) },
  dozen2: { kind: 'dozen2', label: '二连(13-24)', short: '13-24', odds: 2, cover: 12, color: '#00695c', wins: (n) => inRange(n, 13, 24) },
  dozen3: { kind: 'dozen3', label: '二连(25-36)', short: '25-36', odds: 2, cover: 12, color: '#33691e', wins: (n) => inRange(n, 25, 36) },
}

/** 注码顺序（提示区按钮、键盘 1..9 都按这个顺序） */
export const BET_ORDER: readonly BetKind[] = [
  'red',
  'black',
  'odd',
  'even',
  'small',
  'big',
  'zero',
  'trio',
  'dozen1',
  'dozen2',
  'dozen3',
]

// ---------------- 状态 ----------------

export type Phase = 'bet' | 'spin' | 'settle' | 'over'

export interface Chip {
  kind: BetKind
  count: number
}

export interface State {
  /** 随机源游标（mulberry32 的 32 位状态） */
  rng: number
  /** 已完成的盘数 0..ROUNDS */
  round: number
  phase: Phase
  /** 当前阶段已走的定步数 */
  timer: number
  /** 本盘已下的筹码 */
  chips: Chip[]
  /** 本盘落点号码（spin 开始时定下，不随动画变化） */
  result: number | null
  /** 每次旋转自增，作为动画旁路的签名（动画本身不进 State） */
  spinId: number
  /** 本盘净盈亏（注） */
  lastDelta: number
  /** 本盘中奖的注码种类 */
  lastWon: BetKind[]
  /** 整场累计净盈亏（注） */
  bankroll: number
  /** 本盘转几圈（由 rng 状态推出，只用不消耗） */
  turns: number
  /** 最近几期号码 */
  history: number[]
}

export type Action =
  | { type: 'bet'; kind: BetKind }
  | { type: 'clear' }
  | { type: 'spin' }
  | { type: 'next' }
  | { type: 'restart' }
  | { type: 'step'; n: number }

export function create(seed: number): State {
  return {
    rng: seed | 0,
    round: 0,
    phase: 'bet',
    timer: 0,
    chips: [],
    result: null,
    spinId: 0,
    lastDelta: 0,
    lastWon: [],
    bankroll: 0,
    turns: 0,
    history: [],
  }
}

// ---------------- 纯计算 ----------------

export function chipOf(chips: readonly Chip[], kind: BetKind): number {
  const c = chips.find((x) => x.kind === kind)
  return c ? c.count : 0
}

/** 本盘总注额（注） */
export function totalStake(chips: readonly Chip[]): number {
  let n = 0
  for (const c of chips) n += c.count * CHIP
  return n
}

/** 单个注码在落点 n 上的返还额（本金 + 盈利）：中 = bet × 赔率 + 本金，不中 = 0 */
export function payout(kind: BetKind, n: number): number {
  const def = BET_DEFS[kind]
  return def.wins(n) ? CHIP * def.odds + CHIP : 0
}

/** 一叠筹码的总返还额（注） */
export function payoutOf(chips: readonly Chip[], n: number): number {
  let total = 0
  for (const c of chips) total += payout(c.kind, n) * c.count
  return total
}

/** 本盘净盈亏 = 返还额 − 总注额（注） */
export function settleDelta(chips: readonly Chip[], n: number): number {
  return payoutOf(chips, n) - totalStake(chips)
}

export function winningKinds(chips: readonly Chip[], n: number): BetKind[] {
  return chips.filter((c) => BET_DEFS[c.kind].wins(n)).map((c) => c.kind)
}

/**
 * 推进一次随机：返回 [落点号码, 新的 rng 游标, 转圈数]。
 * 每盘只消耗一次 int(37)，圈数直接从新游标推导，不额外吃随机数。
 */
export function roll(rngState: number): [number, number, number] {
  const r = new Rng(rngState)
  const result = r.int(37)
  const turns = 3 + (Math.abs(r.s) % 4)
  return [result, r.s, turns]
}

// ---------------- 状态迁移 ----------------

function placeBet(s: State, kind: BetKind): State {
  if (s.phase !== 'bet') return s
  const def = BET_DEFS[kind]
  if (!def) return s
  const cur = chipOf(s.chips, kind)
  if (cur >= MAX_CHIPS) return s
  const chips =
    cur === 0
      ? [...s.chips, { kind, count: 1 }]
      : s.chips.map((c) => (c.kind === kind ? { kind, count: c.count + 1 } : c))
  return { ...s, chips }
}

function clearBets(s: State): State {
  if (s.phase !== 'bet' || s.chips.length === 0) return s
  return { ...s, chips: [] }
}

function startSpin(s: State): State {
  if (s.phase !== 'bet' || s.chips.length === 0) return s
  const [result, rng, turns] = roll(s.rng)
  return { ...s, phase: 'spin', timer: 0, result, rng, turns, spinId: s.spinId + 1, lastDelta: 0, lastWon: [] }
}

/** 旋转结束，落点已在 state 里，这里只做结算 */
function settleSpin(s: State): State {
  const n = s.result === null ? 0 : s.result
  const delta = settleDelta(s.chips, n)
  return {
    ...s,
    phase: 'settle',
    timer: 0,
    round: s.round + 1,
    lastDelta: delta,
    lastWon: winningKinds(s.chips, n),
    bankroll: s.bankroll + delta,
    history: [...s.history, n].slice(-HISTORY),
  }
}

/** 结算展示结束：满十盘进入终局，否则开下一盘 */
function nextRound(s: State): State {
  if (s.round >= ROUNDS) return { ...s, phase: 'over', timer: 0 }
  return { ...s, phase: 'bet', timer: 0, chips: [], lastWon: [] }
}

function stepN(s: State, n: number): State {
  const steps = Math.max(0, Math.min(8, Math.round(n)))
  if (steps === 0) return s
  if (s.phase === 'spin') {
    const timer = s.timer + steps
    if (timer < SPIN_TICKS) return { ...s, timer }
    return settleSpin({ ...s, timer: SPIN_TICKS })
  }
  if (s.phase === 'settle') {
    const timer = s.timer + steps
    if (timer < SETTLE_TICKS) return { ...s, timer }
    return nextRound({ ...s, timer: SETTLE_TICKS })
  }
  return s
}

export function reduce(s: State, a: Action): State {
  switch (a.type) {
    case 'bet':
      return placeBet(s, a.kind)
    case 'clear':
      return clearBets(s)
    case 'spin':
      return startSpin(s)
    case 'next':
      return s.phase === 'settle' ? nextRound(s) : s
    case 'restart':
      return s.phase === 'over' ? create(s.rng) : s
    case 'step':
      return stepN(s, a.n)
    default:
      return s
  }
}
