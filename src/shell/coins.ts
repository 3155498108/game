/**
 * 金币系统（壳层专属）。
 *
 * **为什么整个文件都在壳层、不进 `core/`**：本项目有一条硬约束——`rules.ts` 必须是
 * 纯逻辑，不碰 DOM、不碰全局存储、不读时间。把钱包放进 `core/` 等于给游戏开了
 * 一条够得着 localStorage 的路，约束就废了。所以金币与 `rules.ts` 完全解耦：
 * 游戏只在 `index.ts` 里提供一个**纯函数** `coins(state, outcome, bet)`，
 * 由壳层在结算时调用。游戏不知道钱包存在，钱包也不认识任何具体游戏。
 *
 * 金币是**纯本地虚拟积分**：不充值、不可兑换、不可交易、不可提现，删掉浏览器数据即清零。
 */
import type { GameModule, Outcome } from '../core/types'
import { readJSON, writeJSON } from './storage'

// ---------------------------------------------------------------- 存档

const WALLET_KEY = 'gs:wallet'
const BET_KEY = 'gs:wallet:bet'

/** 首次进入的启动资金，够摸清规则但不至于一局输光 */
export const START_COINS = 1000
/** 注额档位；「最小注」同时也是余额不足时的兜底上限 */
export const BET_STEPS = [10, 50, 100, 500] as const
/** 余额低于这个数时提示玩家去签到，别让人以为卡住了 */
export const POOR_THRESHOLD = BET_STEPS[0]
/** 每日签到连续 7 天为一轮，逐日递增，之后回到第一档 */
export const SIGNIN_STREAK = 7
export const SIGNIN_BASE = 50
export const SIGNIN_STEP = 25

export interface Wallet {
  balance: number
  /** 累计签到次数，用来推「连续第几天」 */
  signins: number
  /** 上一次签到的本地日期串 `YYYY-MM-DD`；空串表示从未签到 */
  lastSignIn: string
}

/** 新玩家的钱包：启动资金够摸清规则，又不至于一局输光 */
export function freshWallet(): Wallet {
  return { balance: START_COINS, signins: 0, lastSignIn: '' }
}

export function readWallet(): Wallet {
  const v = readJSON<Partial<Wallet>>(WALLET_KEY, {})
  const fresh = freshWallet()
  const balance = typeof v.balance === 'number' && Number.isFinite(v.balance) ? Math.floor(v.balance) : fresh.balance
  return {
    // 存档可能被手改坏（NaN / 小数 / 天文数字 / 负到没边），这里一律夹回合法区间
    balance: Math.min(Number.MAX_SAFE_INTEGER, Math.max(-fresh.balance * 5, balance)),
    signins: typeof v.signins === 'number' && Number.isFinite(v.signins) ? Math.max(0, Math.floor(v.signins)) : fresh.signins,
    lastSignIn: typeof v.lastSignIn === 'string' ? v.lastSignIn : fresh.lastSignIn,
  }
}

export function writeWallet(w: Wallet): void {
  writeJSON(WALLET_KEY, w)
}

// ---------------------------------------------------------------- 注额

export function readBet(): number {
  const v = readJSON<number>(BET_KEY, BET_STEPS[0])
  return typeof v === 'number' && BET_STEPS.includes(v as (typeof BET_STEPS)[number]) ? v : BET_STEPS[0]
}

export function writeBet(b: number): void {
  if (BET_STEPS.includes(b as (typeof BET_STEPS)[number])) writeJSON(BET_KEY, b)
}

/**
 * 实际下注额：**永远不超过当前余额**。
 *
 * 余额可以不足一档（比如只剩 7 金币），这时按 7 下注而不是把玩家挡在门外。
 * 余额为 0 时下注 0——那一局照常能玩，只是不结算金币，不会出现负数的无穷递归。
 */
export function effectiveBet(wallet: Wallet, bet: number): number {
  if (!Number.isFinite(bet) || bet <= 0) return 0
  return Math.max(0, Math.min(Math.floor(bet), wallet.balance))
}

// ---------------------------------------------------------------- 结算

/**
 * 默认结算：`win === true` 赢一注、`false` 输一注、`undefined` 不结算。
 * 游戏没实现 `coins()` 时走这里——覆盖 38 款既有游戏里的 31 款。
 */
export function defaultDelta(outcome: Outcome, bet: number): number {
  if (bet <= 0) return 0
  if (outcome.win === true) return bet
  if (outcome.win === false) return -bet
  return 0
}

/**
 * 结算一局，算出实际入账金币与结算后余额。**本函数不落盘**，由调用方写钱包
 * ——这样它可以在测试里纯调用，也方便壳层决定「先更新 UI 还是先写盘」。
 *
 * 四道防线，保证钱包永远不会被算坏：
 * 1. `coins()` 返回非有限数 → 当作不结算，绝不让 NaN 进钱包；
 * 2. 赢钱设上限（`MAX_PAYOUT`），某个游戏公式写错也不会把余额撑爆；
 * 3. 输钱设下限 `-stake`——最多输光本局下注额，**不透支**，
 *    余额永远不会因为一次操作掉到 0 以下；
 * 4. 结果余额再夹一次到 ≥0。
 */
export const MAX_PAYOUT = BET_STEPS[BET_STEPS.length - 1] * 100

export interface SettleResult {
  delta: number
  balance: number
}

export function settle(mod: GameModule, state: unknown, outcome: Outcome, wallet: Wallet, bet: number): SettleResult {
  const stake = effectiveBet(wallet, bet)
  let delta = mod.coins ? mod.coins(state as never, outcome, stake) : defaultDelta(outcome, stake)
  if (!Number.isFinite(delta)) delta = 0
  delta = Math.trunc(delta)
  if (delta > MAX_PAYOUT) delta = MAX_PAYOUT
  if (delta < -stake) delta = -stake
  const balance = Math.max(0, wallet.balance + delta)
  return { delta, balance }
}

// ---------------------------------------------------------------- 每日签到

/** 本地日期串 `YYYY-MM-DD`；不用 `toISOString`，那会把东八区的人算成前一天 */
export function todayKey(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** 距离明天还有多少毫秒——用来安排「明天再来」的提醒 */
export function msUntilTomorrow(now: Date = new Date()): number {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  return Math.max(0, t - now.getTime())
}

export function canSignIn(wallet: Wallet, now: Date = new Date()): boolean {
  return wallet.lastSignIn !== todayKey(now)
}

/** 今天能领多少：按 7 天一循环逐日递增（50/75/…/200） */
export function signinAmount(wallet: Wallet): number {
  const day = wallet.signins % SIGNIN_STREAK
  return SIGNIN_BASE + day * SIGNIN_STEP
}

/** 领了就写盘；同一天重复调用直接返回 false，不会刷币 */
export function claimSignin(wallet: Wallet, now: Date = new Date()): { ok: boolean; amount: number; wallet: Wallet } {
  if (!canSignIn(wallet, now)) return { ok: false, amount: 0, wallet }
  const amount = signinAmount(wallet)
  const next: Wallet = {
    balance: Math.min(Number.MAX_SAFE_INTEGER, wallet.balance + amount),
    signins: wallet.signins + 1,
    lastSignIn: todayKey(now),
  }
  writeWallet(next)
  return { ok: true, amount, wallet: next }
}

// ---------------------------------------------------------------- 展示

/** 把带符号的盈亏格式化成「+120」/「-50」/「±0」 */
export function formatDelta(n: number): string {
  if (n > 0) return `+${n}`
  if (n < 0) return String(n)
  return '±0'
}

export function formatCoins(n: number): string {
  // 金币数量可能很大，四个一组加千分位，免得手机上糊成一片
  const s = String(Math.trunc(n))
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
