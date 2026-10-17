/**
 * 欧式轮盘 roulette —— 规则层测试。
 * 覆盖：盘面、每种注码的输赢、赔率与返还、注额倍数换算、
 * 随机源、终局性、纯函数性、非法动作、以及 1:1 下注的统计期望。
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng'
import { meta } from './meta'
import { coins, outcome } from './index'
import {
  BET_DEFS,
  BET_ORDER,
  CHIP,
  MAX_CHIPS,
  ROUNDS,
  SPIN_TICKS,
  SETTLE_TICKS,
  WHEEL,
  chipOf,
  create,
  isBlack,
  isRed,
  isZero,
  payout,
  payoutOf,
  reduce,
  roll,
  settleDelta,
  totalStake,
  winningKinds,
} from './rules'
import type { Action, BetKind, Chip, State } from './rules'

// ---------------- 测试脚手架 ----------------

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v)
  }
  return o
}

/** 押一枚后开一盘，把状态推到下一盘的下注阶段 */
function playOne(s: State, kind: BetKind = 'red'): State {
  let cur = reduce(s, { type: 'bet', kind })
  cur = reduce(cur, { type: 'spin' })
  for (let i = 0; i < 200 && cur.phase === 'spin'; i++) cur = reduce(cur, { type: 'step', n: 8 })
  for (let i = 0; i < 200 && cur.phase === 'settle'; i++) cur = reduce(cur, { type: 'step', n: 8 })
  return cur
}

/** 从开局一路自动打到终局，返回终态与步数 */
function autoPlay(seed: number, maxSteps = 4000): { s: State; steps: number } {
  let s = create(seed)
  let steps = 0
  while (s.phase !== 'over' && steps < maxSteps) {
    if (s.phase === 'bet') {
      s = reduce(s, { type: 'bet', kind: BET_ORDER[steps % BET_ORDER.length] })
      s = reduce(s, { type: 'spin' })
    }
    s = reduce(s, { type: 'step', n: 3 })
    steps++
  }
  return { s, steps }
}

const chipsOf = (pairs: [BetKind, number][]): Chip[] => pairs.map(([kind, count]) => ({ kind, count }))

// ---------------- 盘面 ----------------

describe('盘面', () => {
  it('共 37 格，0 唯一且只有 0 是绿色', () => {
    expect(WHEEL.length).toBe(37)
    expect(WHEEL.filter(isZero).length).toBe(1)
    expect(WHEEL.filter((n) => n === 0).length).toBe(1)
    // 绿格数（0 的定义面）= 1
    expect(WHEEL.filter((n) => !isRed(n) && !isBlack(n) && !isZero(n)).length).toBe(0)
  })

  it('轮盘顺序恰好是 0~36 的一个排列', () => {
    const sorted = [...WHEEL].sort((a, b) => a - b)
    expect(sorted).toEqual(Array.from({ length: 37 }, (_, i) => i))
    expect(new Set(WHEEL).size).toBe(37)
  })

  it('红黑各 18 个且互补，0 既不算红也不算黑', () => {
    const reds = WHEEL.filter(isRed)
    const blacks = WHEEL.filter(isBlack)
    expect(reds.length).toBe(18)
    expect(blacks.length).toBe(18)
    expect(reds.some(isBlack)).toBe(false)
    expect(blacks.some(isRed)).toBe(false)
    expect(isRed(0)).toBe(false)
    expect(isBlack(0)).toBe(false)
  })

  it('每种注码声明的覆盖号码数与盘面一致', () => {
    for (const kind of BET_ORDER) {
      const def = BET_DEFS[kind]
      const hit = WHEEL.filter(def.wins).length
      expect(hit).toBe(def.cover)
    }
  })
})

// ---------------- 各注码输赢 ----------------

describe('注码判定', () => {
  it('红注：中红不中黑不中零', () => {
    expect(BET_DEFS.red.wins(1)).toBe(true)
    expect(BET_DEFS.red.wins(36)).toBe(true)
    expect(BET_DEFS.red.wins(2)).toBe(false)
    expect(BET_DEFS.red.wins(0)).toBe(false)
  })

  it('黑注：中黑不中红不中零', () => {
    expect(BET_DEFS.black.wins(2)).toBe(true)
    expect(BET_DEFS.black.wins(35)).toBe(true)
    expect(BET_DEFS.black.wins(1)).toBe(false)
    expect(BET_DEFS.black.wins(0)).toBe(false)
  })

  it('单注：1 中、2 不中、0 不中', () => {
    expect(BET_DEFS.odd.wins(1)).toBe(true)
    expect(BET_DEFS.odd.wins(35)).toBe(true)
    expect(BET_DEFS.odd.wins(2)).toBe(false)
    expect(BET_DEFS.odd.wins(0)).toBe(false)
  })

  it('双注：2 中、1 不中、0 不中', () => {
    expect(BET_DEFS.even.wins(2)).toBe(true)
    expect(BET_DEFS.even.wins(36)).toBe(true)
    expect(BET_DEFS.even.wins(1)).toBe(false)
    expect(BET_DEFS.even.wins(0)).toBe(false)
  })

  it('小注 1-18：18 中、19 不中、0 不中', () => {
    expect(BET_DEFS.small.wins(1)).toBe(true)
    expect(BET_DEFS.small.wins(18)).toBe(true)
    expect(BET_DEFS.small.wins(19)).toBe(false)
    expect(BET_DEFS.small.wins(0)).toBe(false)
  })

  it('大注 19-36：36 中、18 不中、0 不中', () => {
    expect(BET_DEFS.big.wins(36)).toBe(true)
    expect(BET_DEFS.big.wins(19)).toBe(true)
    expect(BET_DEFS.big.wins(18)).toBe(false)
    expect(BET_DEFS.big.wins(0)).toBe(false)
  })

  it('零注只中 0', () => {
    expect(BET_DEFS.zero.wins(0)).toBe(true)
    for (const n of [1, 17, 18, 36]) expect(BET_DEFS.zero.wins(n)).toBe(false)
  })

  it('三连 0/1/2：覆盖 3 个号码', () => {
    expect([0, 1, 2].every(BET_DEFS.trio.wins)).toBe(true)
    expect(BET_DEFS.trio.wins(3)).toBe(false)
    expect(BET_DEFS.trio.cover).toBe(3)
  })

  it('三档二连各覆盖 12 个号码且互不重叠', () => {
    const a = WHEEL.filter(BET_DEFS.dozen1.wins)
    const b = WHEEL.filter(BET_DEFS.dozen2.wins)
    const c = WHEEL.filter(BET_DEFS.dozen3.wins)
    expect([a.length, b.length, c.length]).toEqual([12, 12, 12])
    expect(a.includes(1)).toBe(true)
    expect(a.includes(0)).toBe(false)
    expect(b.includes(13)).toBe(true)
    expect(c.includes(36)).toBe(true)
    expect(a.some((n) => b.includes(n))).toBe(false)
    expect(b.some((n) => c.includes(n))).toBe(false)
  })
})

// ---------------- 赔率与结算 ----------------

describe('赔率与结算', () => {
  it('赔率表：红黑单双大小 1:1，零 35:1，三连 11:1，二连 2:1', () => {
    expect(BET_DEFS.red.odds).toBe(1)
    expect(BET_DEFS.black.odds).toBe(1)
    expect(BET_DEFS.odd.odds).toBe(1)
    expect(BET_DEFS.even.odds).toBe(1)
    expect(BET_DEFS.small.odds).toBe(1)
    expect(BET_DEFS.big.odds).toBe(1)
    expect(BET_DEFS.zero.odds).toBe(35)
    expect(BET_DEFS.trio.odds).toBe(11)
    expect(BET_DEFS.dozen1.odds).toBe(2)
    expect(BET_DEFS.dozen2.odds).toBe(2)
    expect(BET_DEFS.dozen3.odds).toBe(2)
  })

  it('中奖返还 bet × 赔率 + 本金，不中返还 0', () => {
    expect(payout('red', 1)).toBe(CHIP * 1 + CHIP)
    expect(payout('red', 2)).toBe(0)
    expect(payout('zero', 0)).toBe(CHIP * 35 + CHIP)
    expect(payout('trio', 2)).toBe(CHIP * 11 + CHIP)
    expect(payout('dozen3', 30)).toBe(CHIP * 2 + CHIP)
  })

  it('净盈亏 = 返还额 − 总注额', () => {
    expect(settleDelta(chipsOf([['red', 1]]), 1)).toBe(1)
    expect(settleDelta(chipsOf([['red', 1]]), 2)).toBe(-1)
    expect(settleDelta(chipsOf([['zero', 1]]), 0)).toBe(35)
    expect(settleDelta(chipsOf([['zero', 1]]), 1)).toBe(-1)
  })

  it('多注组合按每注独立结算，注额统计正确', () => {
    const chips = chipsOf([
      ['red', 2],
      ['zero', 1],
    ])
    expect(totalStake(chips)).toBe(3)
    // 落 0：红不中（0 非红），零注 35:1 中 → 返还 36
    expect(payoutOf(chips, 0)).toBe(36)
    expect(winningKinds(chips, 0)).toEqual(['zero'])
    expect(settleDelta(chips, 0)).toBe(33)
    expect(winningKinds(chips, 5)).toEqual(['red'])
    expect(payoutOf(chips, 5)).toBe(4)
    expect(settleDelta(chips, 2)).toBe(-3)
  })
})

// ---------------- 状态机 ----------------

describe('状态机', () => {
  it('同种子 create 完全一致（同参同出）', () => {
    expect(create(2024)).toEqual(create(2024))
    expect(create(2024)).not.toBe(create(2024))
  })

  it('下注：叠筹码、封顶、清空', () => {
    let s = create(7)
    s = reduce(s, { type: 'bet', kind: 'red' })
    s = reduce(s, { type: 'bet', kind: 'red' })
    s = reduce(s, { type: 'bet', kind: 'big' })
    expect(chipOf(s.chips, 'red')).toBe(2)
    expect(chipOf(s.chips, 'big')).toBe(1)
    for (let i = 0; i < MAX_CHIPS; i++) s = reduce(s, { type: 'bet', kind: 'zero' })
    expect(chipOf(s.chips, 'zero')).toBe(MAX_CHIPS)
    s = reduce(s, { type: 'clear' })
    expect(s.chips).toEqual([])
  })

  it('未下注不能转，转起来不能再下注', () => {
    const s = create(7)
    expect(reduce(s, { type: 'spin' })).toBe(s)
    const spinning = reduce(reduce(s, { type: 'bet', kind: 'red' }), { type: 'spin' })
    expect(spinning.phase).toBe('spin')
    expect(reduce(spinning, { type: 'bet', kind: 'black' })).toBe(spinning)
    expect(reduce(spinning, { type: 'clear' })).toBe(spinning)
  })

  it('下注 → 旋转 → 结算 → 自动下一盘', () => {
    let s = create(99)
    s = reduce(s, { type: 'bet', kind: 'red' })
    s = reduce(s, { type: 'spin' })
    expect(s.phase).toBe('spin')
    expect(s.result).not.toBeNull()
    for (let i = 0; i < 200 && s.phase === 'spin'; i++) s = reduce(s, { type: 'step', n: 8 })
    expect(s.phase).toBe('settle')
    expect(s.round).toBe(1)
    expect(s.bankroll).toBe(s.lastDelta)
    expect(s.history.length).toBe(1)
    for (let i = 0; i < 200 && s.phase === 'settle'; i++) s = reduce(s, { type: 'step', n: 8 })
    expect(s.phase).toBe('bet')
    expect(s.chips).toEqual([])
    expect(s.round).toBe(1)
  })

  it('旋转时长固定为 SPIN_TICKS，展示时长固定为 SETTLE_TICKS', () => {
    let s = reduce(create(3), { type: 'bet', kind: 'red' })
    s = reduce(s, { type: 'spin' })
    const total = SPIN_TICKS + SETTLE_TICKS
    let steps = 0
    while (s.phase === 'spin' || s.phase === 'settle') {
      s = reduce(s, { type: 'step', n: 1 })
      steps++
      if (steps > total + 5) break
    }
    expect(steps).toBe(total)
  })

  it('十盘之后必须进入终局，不会卡死', () => {
    const { s, steps } = autoPlay(20240607)
    expect(s.phase).toBe('over')
    expect(s.round).toBe(ROUNDS)
    expect(steps).toBeGreaterThan(0)
    expect(steps).toBeLessThan(4000)
    // 终局后不再推进
    expect(reduce(s, { type: 'step', n: 3 })).toBe(s)
    expect(reduce(s, { type: 'bet', kind: 'red' })).toBe(s)
    expect(reduce(s, { type: 'spin' })).toBe(s)
  })

  it('终局可以重新开局，且随机流继续前进而不是回退', () => {
    const { s } = autoPlay(11)
    const fresh = reduce(s, { type: 'restart' })
    expect(fresh.phase).toBe('bet')
    expect(fresh.round).toBe(0)
    expect(fresh.bankroll).toBe(0)
    expect(fresh.chips).toEqual([])
    expect(fresh.rng).toBe(s.rng)
  })

  it('非法动作返回同一状态，不改任何字段', () => {
    const s = create(5)
    const bad: Action[] = [
      { type: 'spin' },
      { type: 'clear' },
      { type: 'next' },
      { type: 'restart' },
      { type: 'step', n: 0 },
      { type: 'step', n: -5 },
    ]
    for (const a of bad) expect(reduce(s, a)).toBe(s)
  })

  it('reduce 不修改入参（深冻结后仍可迁移）', () => {
    const frozen = deepFreeze(create(31337))
    const before = JSON.stringify(frozen)
    const bet = reduce(frozen, { type: 'bet', kind: 'trio' })
    expect(JSON.stringify(frozen)).toBe(before)
    expect(frozen.chips).toEqual([])
    expect(chipOf(bet.chips, 'trio')).toBe(1)
    const spun = reduce(bet, { type: 'spin' })
    const after = JSON.stringify(bet)
    expect(JSON.stringify(frozen)).toBe(before)
    expect(after).toBe(JSON.stringify(bet))
    expect(spun.phase).toBe('spin')
  })
})

// ---------------- 随机源 ----------------

describe('随机源', () => {
  it('落点序列与 Rng 的 int(37) 流完全一致（唯一随机来源）', () => {
    const seed = 0xbeef
    const r = new Rng(seed)
    // 一场正好 ROUNDS 盘，每盘只消耗一次随机数
    const expected = Array.from({ length: ROUNDS }, () => r.int(37))
    let s = create(seed)
    const got: number[] = []
    for (let i = 0; i < ROUNDS; i++) {
      s = playOne(s, 'odd')
      got.push(s.result as number)
    }
    expect(got).toEqual(expected)
  })

  it('同种子同动作序列，结果完全可复现', () => {
    const a = autoPlay(555).s
    const b = autoPlay(555).s
    expect(a).toEqual(b)
    expect(a.history).toEqual(b.history)
    expect(a.bankroll).toBe(b.bankroll)
  })

  it('roll 只消耗一次随机数，圈数由新游标推出', () => {
    const seed = 123
    const r = new Rng(seed)
    const [n1, s1, turns] = roll(seed)
    expect(n1).toBe(r.int(37))
    expect(s1).toBe(r.s)
    expect(turns).toBeGreaterThanOrEqual(3)
    expect(turns).toBeLessThanOrEqual(6)
  })
})

// ---------------- 成绩与金币 ----------------

describe('成绩与金币', () => {
  it('未结束不产出成绩，结束时 score 是整场净盈亏', () => {
    const mid = playOne(create(4242))
    expect(mid.phase).toBe('bet')
    expect(outcome(mid)).toBeNull()

    const { s } = autoPlay(4242)
    expect(s.phase).toBe('over')
    const o = outcome(s)
    expect(o).not.toBeNull()
    expect(o?.score).toBe(s.bankroll)
    expect(o?.better).toBe('higher')
    expect(o?.unit).toBe('金币')
    // 单盘最多净赢 35 注（零注），十盘封顶
    expect(o?.score).toBeLessThanOrEqual(35 * ROUNDS)
  })

  it('coins 按注额倍数换算，不写死面值', () => {
    const s = create(1)
    const one: Action = { type: 'bet', kind: 'red' }
    expect(one.type).toBe('bet')
    const betState = reduce(s, one)
    const outcome = { score: -3, better: 'higher' as const, unit: '金币' }
    expect(coins(betState, outcome, 1)).toBe(-3)
    expect(coins(betState, outcome, 5)).toBe(-15)
    expect(coins(betState, outcome, 100)).toBe(-300)
    expect(coins(betState, { ...outcome, score: 35 }, 2)).toBe(70)
    expect(coins(betState, outcome, 0)).toBe(0)
  })
})

// ---------------- 统计 ----------------

describe('统计（1:1 下注长期期望）', () => {
  it('一万盘红注：胜率不超过 60%，且期望不明显为正', () => {
    const r = new Rng(0x5eed)
    const n = 10000
    let wins = 0
    let profit = 0
    for (let i = 0; i < n; i++) {
      const hit = r.int(37)
      profit += settleDelta(chipsOf([['red', 1]]), hit)
      if (payout('red', hit) > 0) wins++
    }
    expect(wins / n).toBeLessThan(0.6)
    expect(wins / n).toBeGreaterThan(0.35)
    expect(profit / n).toBeLessThan(0.05)
  })

  it('所有注码的精确期望都是 -1/37（单零轮的庄家优势恒定）', () => {
    // 穷举 37 个口袋算精确期望，不受抽样噪声影响
    const exactEv = (kind: BetKind): number => {
      let sum = 0
      for (let n = 0; n < 37; n++) sum += settleDelta(chipsOf([[kind, 1]]), n)
      return sum / 37
    }
    for (const kind of BET_ORDER) {
      expect(exactEv(kind)).toBeCloseTo(-1 / 37, 10)
      expect(exactEv(kind)).toBeLessThan(0)
    }
    // 手算核验：红 18/37 赢 1、19/37 输 1；零 1/37 赢 35、36/37 输 1
    expect(exactEv('red')).toBeCloseTo((18 - 19) / 37, 10)
    expect(exactEv('zero')).toBeCloseTo((35 - 36) / 37, 10)
    expect(exactEv('dozen1')).toBeCloseTo((12 * 2 - 25) / 37, 10)
    expect(exactEv('trio')).toBeCloseTo((3 * 11 - 34) / 37, 10)
  })

  it('二连若多算 0 号会变成正期望（设计护栏）', () => {
    // 2:1 摊到 13 个号（0-12）会让玩家期望翻正，所以 0 必须排除
    let sum = 0
    for (let n = 0; n < 37; n++) {
      const win = n >= 0 && n <= 12 ? 2 : -1
      sum += win
    }
    expect(sum / 37).toBeGreaterThan(0)
    expect(BET_DEFS.dozen1.wins(0)).toBe(false)
  })
})

describe('元信息', () => {
  it('id 与目录一致，视口固定 720×1280', () => {
    expect(meta.id).toBe('roulette')
    expect(meta.viewport).toEqual({ width: 720, height: 1280 })
  })
})
