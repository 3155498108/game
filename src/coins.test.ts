/**
 * 金币系统测试（壳层）。
 *
 * 钱包是全站唯一一处「算错了也不会立刻报错」的地方：多结算一次、少扣一次、
 * 溢出一个 NaN，界面上都只是数字慢慢变得不对。所以这里的断言全部对着
 * **不变量**写，而不是对着实现的影子参数写——
 * 「余额恒 ≥ 0」「一局最多输掉本局注额」「重复领取不加分」「签名按本地日期跨天」
 */
import { describe, expect, it } from 'vitest'
import type { GameModule, Outcome } from './core/types'
import {
  BET_STEPS,
  MAX_PAYOUT,
  POOR_THRESHOLD,
  SIGNIN_STREAK,
  START_COINS,
  canSignIn,
  claimSignin,
  defaultDelta,
  effectiveBet,
  formatCoins,
  formatDelta,
  readWallet,
  settle,
  signinAmount,
  todayKey,
  writeWallet,
  type Wallet,
} from './shell/coins'

const WIN: Outcome = { score: 100, better: 'higher', unit: '分', win: true }
const LOSE: Outcome = { score: 0, better: 'higher', unit: '分', win: false }
const DRAW: Outcome = { score: 50, better: 'higher', unit: '分' }

/** 只提供 coins() 的最小 GameModule——金币结算只需要这一个方法 */
function modWith(coins?: GameModule['coins']): GameModule {
  return { coins } as GameModule
}

const wallet = (balance: number, signins = 0, lastSignIn = ''): Wallet => ({ balance, signins, lastSignIn })

describe('默认结算规则', () => {
  it('赢赢一注、输输一注、平局不动', () => {
    expect(defaultDelta(WIN, 100)).toBe(100)
    expect(defaultDelta(LOSE, 100)).toBe(-100)
    expect(defaultDelta(DRAW, 100)).toBe(0)
  })

  it('下注为 0 时恒为 0', () => {
    expect(defaultDelta(WIN, 0)).toBe(0)
    expect(defaultDelta(LOSE, 0)).toBe(0)
  })

  it('游戏没实现 coins() 时走默认规则', () => {
    const m = modWith(undefined)
    expect(settle(m, {}, WIN, wallet(1000), 100).delta).toBe(100)
    expect(settle(m, {}, LOSE, wallet(1000), 100).delta).toBe(-100)
  })
})

describe('下注额：永远不超过余额', () => {
  it('余额充足时按档位下注', () => {
    expect(effectiveBet(wallet(1000), 100)).toBe(100)
  })

  it('余额不够就按余额下注，而不是把玩家挡在门外', () => {
    expect(effectiveBet(wallet(7), 100)).toBe(7)
    expect(effectiveBet(wallet(0), 100)).toBe(0)
  })

  it('非法注额归零', () => {
    expect(effectiveBet(wallet(1000), -50)).toBe(0)
    expect(effectiveBet(wallet(1000), Number.NaN)).toBe(0)
    expect(effectiveBet(wallet(1000), Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('所有档位都能正常取用', () => {
    for (const b of BET_STEPS) expect(effectiveBet(wallet(100000), b)).toBe(b)
  })
})

describe('结算：钱不会越算越离谱', () => {
  it('余额恒 ≥ 0，绝不透支', () => {
    const r = settle(modWith(), {}, LOSE, wallet(30), 100)
    expect(r.delta).toBe(-30)
    expect(r.balance).toBe(0)
  })

  it('最多输掉本局注额：游戏想多扣也扣不动', () => {
    const evil = modWith(() => -99999)
    const r = settle(evil, {}, LOSE, wallet(1000), 100)
    expect(r.delta).toBe(-100)
    expect(r.balance).toBe(900)
  })

  it('赢钱有上限：公式写错也撑不爆钱包', () => {
    const buggy = modWith(() => Number.MAX_SAFE_INTEGER)
    const r = settle(buggy, {}, WIN, wallet(1000), 100)
    expect(r.delta).toBe(MAX_PAYOUT)
    expect(Number.isFinite(r.balance)).toBe(true)
  })

  it('返回 NaN / Infinity 一律当作不结算', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const m = modWith(() => bad)
      const r = settle(m, {}, WIN, wallet(1000), 100)
      expect(r.delta).toBe(0)
      expect(r.balance).toBe(1000)
    }
  })

  it('小数截断，余额永远是整数', () => {
    const m = modWith(() => 33.7)
    const r = settle(m, {}, WIN, wallet(1000), 100)
    expect(r.delta).toBe(33)
    expect(Number.isInteger(r.balance)).toBe(true)
  })

  it('结算结果 = 旧余额 + 净盈亏（不变式）', () => {
    const cases: Array<[Wallet, Outcome, number]> = [
      [wallet(1000), WIN, 100],
      [wallet(1000), LOSE, 100],
      [wallet(37), LOSE, 100],
      [wallet(0), WIN, 100],
      [wallet(5), DRAW, 500],
    ]
    for (const [w, o, bet] of cases) {
      const r = settle(modWith(), {}, o, w, bet)
      expect(r.balance).toBe(Math.max(0, w.balance + r.delta))
      expect(r.balance).toBeGreaterThanOrEqual(0)
    }
  })

  it('余额为 0 时什么都结算不了，但仍能玩', () => {
    const r = settle(modWith(), {}, WIN, wallet(0), 100)
    expect(r.delta).toBe(0)
    expect(r.balance).toBe(0)
  })

  it('自定义 coins() 按注额倍数换算（不是固定面值）', () => {
    const m = modWith((_s, _o, bet) => bet * 9)
    expect(settle(m, {}, WIN, wallet(10000), 100).delta).toBe(900)
    expect(settle(m, {}, WIN, wallet(10000), 500).delta).toBe(4500)
  })
})

describe('每日签到', () => {
  const d = (y: number, m: number, day: number) => new Date(y, m, day, 12, 0, 0)

  it('金额按 7 天一循环逐日递增', () => {
    const amounts = Array.from({ length: SIGNIN_STREAK }, (_, i) => signinAmount(wallet(0, i)))
    expect(amounts).toEqual([50, 75, 100, 125, 150, 175, 200])
    // 第 8 天回到第一档
    expect(signinAmount(wallet(0, SIGNIN_STREAK))).toBe(50)
  })

  it('同一天只能领一次', () => {
    const w = wallet(1000)
    const first = claimSignin(w, d(2026, 9, 16))
    expect(first.ok).toBe(true)
    expect(first.wallet.balance).toBe(1000 + 50)
    const second = claimSignin(first.wallet, d(2026, 9, 16))
    expect(second.ok).toBe(false)
    expect(second.wallet.balance).toBe(1000 + 50)
  })

  it('跨一天可以再领', () => {
    const a = claimSignin(wallet(0), d(2026, 9, 16))
    expect(canSignIn(a.wallet, d(2026, 9, 17))).toBe(true)
    const b = claimSignin(a.wallet, d(2026, 9, 17))
    expect(b.ok).toBe(true)
    expect(b.amount).toBe(75)
  })

  it('用本地日期而不是 UTC，跨月/跨年都算得对', () => {
    // 东八区凌晨 0 点半：UTC 已经是前一天了，用 toISOString 会少算一天
    expect(todayKey(new Date(2026, 11, 31, 0, 30))).toBe('2026-12-31')
    expect(todayKey(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
    // 月/日补零，否则 10-16 和 1-16 的字符串没法直接比
    expect(todayKey(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05')
    expect(todayKey(new Date(2026, 10, 16, 12, 0))).toBe('2026-11-16')
  })

  it('签到是破产玩家的最后一道救赎', () => {
    const broke = wallet(0, 0, '')
    expect(canSignIn(broke)).toBe(true)
    const r = claimSignin(broke)
    expect(r.wallet.balance).toBeGreaterThanOrEqual(POOR_THRESHOLD)
  })
})

describe('钱包存档', () => {
  it('坏存档一律夹回合法值', () => {
    writeWallet({ balance: Number.NaN, signins: -5, lastSignIn: 42 as unknown as string })
    const w = readWallet()
    expect(w.balance).toBe(START_COINS)
    expect(w.signins).toBe(0)
    expect(w.lastSignIn).toBe('')
  })

  it('余额不会因为存档被改成负无穷', () => {
    writeWallet({ balance: -Number.MAX_VALUE, signins: 0, lastSignIn: '' })
    const w = readWallet()
    expect(Number.isFinite(w.balance)).toBe(true)
    expect(w.balance).toBeGreaterThanOrEqual(-START_COINS * 5)
  })

  it('正常存档原样读回', () => {
    writeWallet({ balance: 4321, signins: 3, lastSignIn: '2026-10-16' })
    const w = readWallet()
    expect(w.balance).toBe(4321)
    expect(w.signins).toBe(3)
    expect(w.lastSignIn).toBe('2026-10-16')
  })
})

describe('展示格式', () => {
  it('盈亏带正负号', () => {
    expect(formatDelta(120)).toBe('+120')
    expect(formatDelta(-50)).toBe('-50')
    expect(formatDelta(0)).toBe('±0')
  })

  it('金币加千分位', () => {
    expect(formatCoins(0)).toBe('0')
    expect(formatCoins(999)).toBe('999')
    expect(formatCoins(1000)).toBe('1,000')
    expect(formatCoins(1234567)).toBe('1,234,567')
  })
})
