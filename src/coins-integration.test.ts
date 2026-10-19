/**
 * 金币结算集成测试：**真实游戏**的 `coins()` 灌进壳层的 `settle()` 安全网。
 *
 * 为什么单独一个文件、而不是把 `coins.test.ts` 写大一点：
 *
 * `coins.test.ts` 全程用桩模块（`modWith(() => 任意数)`），它能守住钱包的不变量
 * ——余额恒 ≥ 0、赢钱封顶、小数截断、重复签到不加钱。但桩返回的是**测试自己给的数**，
 * 所以它证不了真实游戏那条链：
 *
 * ```
 * games/<id>/index.ts 的 coins(state, outcome, bet) → shell/coins.ts 的 settle()
 * ```
 *
 * 某个游戏把公式写成 `bet / 3`、忘了乘 `bet`、或者从 state 里读了个不存在的字段，
 * 桩测试一律全绿。真机点一遍本来能兜住，但内置浏览器标签页的
 * `requestAnimationFrame` 是停摆的（同一页两次截图字节完全相同，按钮点下去没有
 * 任何状态变化），**这条链只能在这儿钉死**。
 *
 * 本文件不追求「把游戏推到终局」——那套驱动已经在 `smoke.test.ts` 里，
 * 复制一份只会变成两份都要维护的重复逻辑。这里换一条更狠也更稳的路：
 * **把每个真实 `coins()` 直接扔进 `settle()` 的四道数值防线里，看它能不能活着出来。**
 * 这既覆盖了正常返回值，也覆盖了「state 是垃圾」时会不会吐出 NaN 把钱包写坏。
 */
import { describe, expect, it } from 'vitest'
import type { GameModule, Outcome } from './core/types'
import { settle, START_COINS, MAX_PAYOUT, type Wallet } from './shell/coins'

/**
 * 全站全部游戏，含 index.ts（coins() 只挂在 GameModule 上，meta.ts 里没有）。
 *
 * `eager: true` 是必须的：不加的话 glob 返回的是**异步加载函数**而不是模块本身，
 * 拿到的 `g.create` 会是 undefined——而且这个坑在 TypeScript 上完全看不出来。
 */
const gameModules = import.meta.glob<GameModule>('./games/*/index.ts', {
  eager: true,
  import: 'default',
})

const wallet = (balance: number): Wallet => ({ balance, signins: 0, lastSignIn: '' })

const ALL: Array<[string, GameModule]> = Object.entries(gameModules)
  .map(([path, mod]) => [/\/games\/([^/]+)\//.exec(path)?.[1] ?? path, mod] as [string, GameModule])
  .sort((a, b) => a[0].localeCompare(b[0]))

/** 实现了 coins() 的游戏（其余走默认胜负规则） */
const CUSTOM: Array<[string, GameModule]> = ALL.filter(([, g]) => typeof g.coins === 'function')

/** 各种形态的 outcome：有 win、有不带 win 的、分数带小数、带天文数字、带垃圾值 */
const OUTCOMES: Outcome[] = [
  { score: 1, better: 'higher', unit: '分', win: true },
  { score: -1, better: 'lower', unit: '分', win: false },
  { score: 150, better: 'higher', unit: '分', win: true },
  { score: 150.7, better: 'higher', unit: '分' },
  { score: -33.7, better: 'lower', unit: '分' },
  { score: 0, better: 'higher', unit: '分' },
  { score: Number.MAX_SAFE_INTEGER, better: 'higher', unit: '分', win: true },
  { score: Number.NaN, better: 'higher', unit: '分', win: true },
  { score: Number.POSITIVE_INFINITY, better: 'higher', unit: '分' },
  { score: Number.NEGATIVE_INFINITY, better: 'higher', unit: '分', win: true },
]

const BETS = [1, 10, 50, 100, 500]

/** 一局结算必须同时成立的五条——都是玩家看得见的后果，不是实现细节 */
function expectSane(id: string, bet: number, outcome: Outcome, g: GameModule, state: unknown): void {
  const label = `${id} bet=${bet} score=${outcome.score}`
  const start = wallet(START_COINS)
  const r = settle(g, state, outcome, start, bet)

  expect(Number.isInteger(r.balance), `${label}：余额必须是整数`).toBe(true)
  expect(Number.isFinite(r.balance), `${label}：余额必须有限`).toBe(true)
  expect(r.balance, `${label}：余额不能为负`).toBeGreaterThanOrEqual(0)
  expect(r.balance, `${label}：新余额必须等于旧余额 + 净盈亏`).toBe(start.balance + r.delta)
  expect(Math.abs(r.delta), `${label}：单局净盈亏必须封顶`).toBeLessThanOrEqual(MAX_PAYOUT)

  // 余额只剩一点时也不许透支
  const poor = settle(g, state, outcome, wallet(7), bet)
  expect(poor.balance, `${label}：破产玩家也不能被扣成负数`).toBeGreaterThanOrEqual(0)
}

describe('金币结算集成：44 款真实游戏的 coins() 都要活着穿过 settle()', () => {
  it('注册表能收齐全部游戏，且其中有实现 coins() 的定制款', () => {
    expect(ALL.length).toBe(44)
    // 5 款门票制 + 5 款博彩
    expect(CUSTOM.length).toBeGreaterThanOrEqual(10)
  })

  for (const [id, g] of ALL) {
    it(`${id}：全部 outcome × 全部注额都不写坏钱包`, () => {
      // 两种 state：真实开局，和一块「什么都没有」的垃圾——后者专门用来打
      // 「coins() 从 state 读不存在的字段」这类只会在实战里炸的路径
      const states: unknown[] = [g.create(12345), {}]
      for (const bet of BETS) {
        for (const outcome of OUTCOMES) {
          for (const state of states) expectSane(id, bet, outcome, g, state)
        }
      }
    })
  }
})

describe('coins() 必须按注额倍数换算，不能写死面值', () => {
  /**
   * 最容易犯也最难发现的错：`coins()` 里 `return 100`。
   * 玩家把注额调到 500，游戏还是只赔 100——数值全是合法的，
   * 钱包不变量一条都不破，只有「换注额结果跟着变」才能抓住。
   *
   * 判据用**比例**而不是绝对值：同一 state、同一 outcome，只改注额，
   * 净盈亏必须同比缩放。净盈亏为 0（空奖、退还本金）时无话可说，跳过。
   */
  for (const [id, g] of CUSTOM) {
    it(`${id}：注额 ×50，净盈亏也 ×50`, () => {
      const state = g.create(4242)
      for (const outcome of OUTCOMES) {
        const small = settle(g, state, outcome, wallet(START_COINS), 10).delta
        if (!Number.isFinite(small) || small === 0) continue
        const big = settle(g, state, outcome, wallet(START_COINS), 500).delta
        if (!Number.isFinite(big) || big === 0) continue
        // 撞上封顶的不算：MAX_PAYOUT 本来就是「赔到上限为止」，
        // 天文数字分数下两个注额都会顶格，这时比比例是在测封顶常数、不是在测比例
        if (Math.abs(small) >= MAX_PAYOUT || Math.abs(big) >= MAX_PAYOUT) continue
        expect(big, `${id}：score=${outcome.score} 的净盈亏 ${small} 没随注额同比缩放`).toBe(small * 50)
      }
    })
  }
})

describe('同一局重复结算必须给同样结果', () => {
  it('结算过程里不能藏随机数或时间', () => {
    for (const [id, g] of ALL) {
      const state = g.create(777)
      const outcome: Outcome = { score: 42.5, better: 'higher', unit: '分', win: true }
      const a = settle(g, state, outcome, wallet(START_COINS), 100)
      const b = settle(g, state, outcome, wallet(START_COINS), 100)
      expect(b.delta, `${id}：两次结算结果不一致`).toBe(a.delta)
      expect(b.balance, `${id}：两次结算余额不一致`).toBe(a.balance)
    }
  })
})

describe('没实现 coins() 的游戏走默认规则', () => {
  it('默认款不会被本文件误算成定制款', () => {
    const plain = ALL.filter(([, g]) => typeof g.coins !== 'function')
    expect(plain.length).toBeGreaterThan(30)
    for (const [id, g] of plain) {
      const state = g.create(1)
      const win = settle(g, state, { score: 1, better: 'higher', unit: '分', win: true }, wallet(1000), 100)
      const lose = settle(g, state, { score: 1, better: 'higher', unit: '分', win: false }, wallet(1000), 100)
      expect(win.delta, `${id}：默认规则该赢一注`).toBe(100)
      expect(lose.delta, `${id}：默认规则该输一注`).toBe(-100)
    }
  })
})
