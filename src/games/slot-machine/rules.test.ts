/**
 * 三轴老虎机规则层测试。
 * 重点：赔付表一致性、注额等比缩放、期望回报率、纯函数性、终局不卡死。
 */
import { describe, it, expect } from 'vitest'
import { meta, meta as metaDefault } from './meta'
import game from './index'
import {
  SYMBOLS,
  SYMBOL_COUNT,
  TRIPLE_PAY,
  PAIR_PAY,
  OUTCOMES_TOTAL,
  TRIPLE_OUTCOMES,
  PAIR_OUTCOMES,
  THEORETIC_RTP,
  ROUNDS,
  COLS,
  SETTLE_TICK,
  VW,
  VH,
  symbolOf,
  evaluate,
  create,
  reduce,
} from './rules'
import type { State, Action } from './rules'

// ------------------------------------------------------------------ 工具

/** 深度冻结（只读测试用；rules 里任何写操作都会在严格模式下抛错） */
function deepFreeze(v: unknown): unknown {
  if (v !== null && typeof v === 'object') {
    const obj = v as Record<string, unknown>
    for (const k of Object.keys(obj)) deepFreeze(obj[k])
    Object.freeze(v)
  }
  return v
}

/** 打满一局：拉杆 → 停稳结算。处于终局时先重开一场，保证长跑测试不被终局打断。 */
function playOne(s: State): State {
  const base = s.phase === 'over' ? reduce(s, { type: 'restart' }) : s
  return reduce(reduce(base, { type: 'pull' }), { type: 'step', n: SETTLE_TICK })
}

/** 打完一场对局（ROUNDS 局），返回终局状态 */
function playSession(seed: number): State {
  let s = create(seed)
  while (s.phase !== 'over') s = playOne(s)
  return s
}

/**
 * 连打 n 局，逐局回调。回调拿到「本局开始时的计分基准 net」与「结算后的状态」，
 * 这样跨终局重开时也不会把重开误算成盈亏。
 */
function forEachSpin(start: State, n: number, fn: (base: number, after: State) => void): void {
  let s = start
  for (let i = 0; i < n; i++) {
    const before = s
    s = playOne(s)
    fn(before.phase === 'over' ? 0 : before.net, s)
  }
}

/** 穷举 6³ 种转轴组合 */
function allReels(): number[][] {
  const out: number[][] = []
  for (let a = 0; a < SYMBOL_COUNT; a++)
    for (let b = 0; b < SYMBOL_COUNT; b++)
      for (let c = 0; c < SYMBOL_COUNT; c++) out.push([a, b, c])
  return out
}

function coinsOf(done: State, bet: number): number {
  const o = game.outcome?.(done)
  expect(o).not.toBeNull()
  return game.coins!(done, o!, bet)
}

// ------------------------------------------------------------------ 元信息

describe('元信息', () => {
  it('同时提供具名导出与默认导出，且内容一致', () => {
    expect(metaDefault).toBe(meta)
    expect(meta.id).toBe('slot-machine')
  })

  it('视口固定 720×1280 竖屏、三列三行', () => {
    expect(meta.viewport).toEqual({ width: 720, height: 1280 })
    expect(VW).toBe(720)
    expect(VH).toBe(1280)
    expect(COLS).toBe(3)
  })
})

// ------------------------------------------------------------------ 开局与随机源

describe('开局与随机源', () => {
  it('初始状态为待拉杆、零盈亏', () => {
    const s = create(1)
    expect(s.phase).toBe('ready')
    expect(s.round).toBe(0)
    expect(s.net).toBe(0)
    expect(s.reels).toEqual([0, 0, 0])
    expect(s.combo.pay).toBe(0)
  })

  it('create 是纯函数：同种子同开局', () => {
    expect(create(42)).toEqual(create(42))
    expect(create(42).rng).toBe(create(42).rng)
  })

  it('不同种子给出不同的随机游标', () => {
    expect(create(1).rng).not.toBe(create(2).rng)
  })

  it('拉杆后进入滚动、立刻扣注、并推进随机游标', () => {
    const s = create(9)
    const after = reduce(s, { type: 'pull' })
    expect(after.phase).toBe('spinning')
    expect(after.net).toBe(-1)
    expect(after.spin).toBe(s.spin + 1)
    expect(after.rng).not.toBe(s.rng)
    expect(after.reels).toHaveLength(3)
    for (const r of after.reels) {
      expect(Number.isInteger(r)).toBe(true)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThan(SYMBOL_COUNT)
    }
  })

  it('同种子的完整对局完全可复现', () => {
    expect(playSession(2024)).toEqual(playSession(2024))
  })

  it('不同种子会摇出不同的转轴序列', () => {
    // 这里**不能**断言整场净盈亏不同：一场只有 ROUNDS 局，每局净盈亏取自
    // {-1, 0, 1, 3, 7, 15, 27, 45} 这 8 个值，和是一个很小的数，
    // 两个种子撞出同样的总数是必然的，不是 bug（踩过一次的坑）。
    // 真正的契约是「随机源被种子决定」——比对完整的转轴序列。
    const reelsOf = (seed: number): string => {
      let s = create(seed)
      const out: string[] = []
      for (let i = 0; i < 20; i++) {
        const base = s.phase === 'over' ? reduce(s, { type: 'restart' }) : s
        s = reduce(reduce(base, { type: 'pull' }), { type: 'step', n: SETTLE_TICK })
        out.push(s.reels.join(''))
      }
      return out.join('|')
    }
    expect(reelsOf(3)).not.toBe(reelsOf(4))
  })
})

// ------------------------------------------------------------------ 转轴分布

describe('转轴分布', () => {
  const N = 60_000
  const counts = [new Array(SYMBOL_COUNT).fill(0), new Array(SYMBOL_COUNT).fill(0), new Array(SYMBOL_COUNT).fill(0)]
  const pairHits = [0, 0, 0]

  let s = create(777)
  for (let i = 0; i < N; i++) {
    s = playOne(s)
    const r = s.reels
    for (let c = 0; c < 3; c++) counts[c][r[c]]++
    if (r[0] === r[1]) pairHits[0]++
    if (r[1] === r[2]) pairHits[1]++
    if (r[0] === r[2]) pairHits[2]++
  }

  it('每轴 6 种符号近似等概率（偏差 < 3%）', () => {
    for (let c = 0; c < 3; c++) {
      for (let k = 0; k < SYMBOL_COUNT; k++) {
        const mean = N / SYMBOL_COUNT
        expect(Math.abs(counts[c][k] - mean) / mean).toBeLessThan(0.03)
      }
    }
  })

  it('三轴互相独立：两两同符号的频率 ≈ 1/6', () => {
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(pairHits[c] / N - 1 / 6)).toBeLessThan(0.02)
    }
  })
})

// ------------------------------------------------------------------ 赔付判定

describe('赔付判定与赔付表', () => {
  it('三连逐项等于赔付表，且命中全部三列', () => {
    for (const sym of SYMBOLS) {
      const idx = SYMBOLS.indexOf(sym)
      const combo = evaluate([idx, idx, idx])
      expect(combo.kind).toBe('triple')
      expect(combo.symbol).toBe(sym)
      expect(combo.pay).toBe(TRIPLE_PAY[sym])
      expect(combo.cols).toEqual([0, 1, 2])
    }
  })

  it('任意两轴同图给小额赔付，三轴全不同为空奖', () => {
    expect(evaluate([0, 0, 1]).kind).toBe('pair')
    expect(evaluate([0, 1, 1]).kind).toBe('pair')
    expect(evaluate([0, 1, 0]).kind).toBe('pair')
    expect(evaluate([0, 0, 1]).pay).toBe(PAIR_PAY)
    expect(evaluate([0, 1, 1]).pay).toBe(PAIR_PAY)
    expect(evaluate([0, 1, 0]).pay).toBe(PAIR_PAY)
    const none = evaluate([0, 1, 2])
    expect(none.kind).toBe('none')
    expect(none.pay).toBe(0)
    expect(none.symbol).toBeNull()
  })

  it('顶级三连明显高于普通三连（至少 8 倍）且档位严格递增', () => {
    const pays = SYMBOLS.map((s) => TRIPLE_PAY[s])
    expect(Math.max(...pays) / Math.min(...pays)).toBeGreaterThanOrEqual(8)
    expect(TRIPLE_PAY.crown).toBeGreaterThan(TRIPLE_PAY.seven)
    expect(TRIPLE_PAY.seven).toBeGreaterThan(TRIPLE_PAY.diamond)
    expect(TRIPLE_PAY.diamond).toBeGreaterThan(TRIPLE_PAY.star)
    expect(TRIPLE_PAY.star).toBeGreaterThan(TRIPLE_PAY.bell)
    expect(TRIPLE_PAY.bell).toBeGreaterThan(TRIPLE_PAY.cherry)
  })

  it('穷举 6³ 种组合：分类互斥且计数与理论一致', () => {
    const all = allReels()
    expect(all).toHaveLength(OUTCOMES_TOTAL)
    let triple = 0
    let pair = 0
    let none = 0
    for (const reels of all) {
      const combo = evaluate(reels)
      if (combo.kind === 'triple') {
        triple++
        expect(combo.pay).toBe(TRIPLE_PAY[combo.symbol!])
      } else if (combo.kind === 'pair') {
        pair++
        expect(combo.pay).toBe(PAIR_PAY)
        expect(combo.cols).toHaveLength(2)
      } else {
        none++
        expect(combo.pay).toBe(0)
      }
    }
    expect(triple).toBe(TRIPLE_OUTCOMES)
    expect(pair).toBe(PAIR_OUTCOMES)
    expect(none).toBe(OUTCOMES_TOTAL - TRIPLE_OUTCOMES - PAIR_OUTCOMES)
  })

  it('赔付额恒为非负', () => {
    for (const reels of allReels()) expect(evaluate(reels).pay).toBeGreaterThanOrEqual(0)
    expect(PAIR_PAY).toBeGreaterThanOrEqual(0)
    for (const sym of SYMBOLS) expect(TRIPLE_PAY[sym]).toBeGreaterThanOrEqual(0)
  })

  it('理论期望回报率由赔付表推导得到，且落在 85%~95%', () => {
    const sum = SYMBOLS.reduce((n, sym) => n + TRIPLE_PAY[sym], 0)
    const manual = (sum + PAIR_OUTCOMES * PAIR_PAY) / OUTCOMES_TOTAL
    expect(THEORETIC_RTP).toBeCloseTo(manual, 12)
    expect(THEORETIC_RTP).toBeGreaterThanOrEqual(0.85)
    expect(THEORETIC_RTP).toBeLessThanOrEqual(0.95)
  })

  it('统计期望回报率：大量拉杆的平均赔付落在 85%~95%', () => {
    let paid = 0
    let rounds = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      forEachSpin(create(seed), 25_000, (_base, after) => {
        paid += after.combo.pay
        rounds++
      })
    }
    expect(rounds).toBe(150_000)
    const rtp = paid / rounds
    expect(rtp).toBeGreaterThanOrEqual(0.85)
    expect(rtp).toBeLessThanOrEqual(0.95)
    // 与理论值的偏差也在统计噪声量级内
    expect(Math.abs(rtp - THEORETIC_RTP)).toBeLessThan(0.05)
  })

  it('空奖不给钱：本局净盈亏恒为 -1 注', () => {
    let empty = 0
    forEachSpin(create(123), 20_000, (base, after) => {
      if (after.combo.kind !== 'none') return
      empty++
      expect(after.combo.pay).toBe(0)
      expect(after.net - base).toBe(-1)
    })
    expect(empty).toBeGreaterThan(1000)
  })

  it('中奖局的净盈亏 = 赔付倍数 - 1 注', () => {
    let wins = 0
    forEachSpin(create(555), 20_000, (base, after) => {
      if (after.combo.kind === 'none') return
      wins++
      // 赔付要按 kind 分开断言。原来写成 `TRIPLE_PAY[symbol] ?? PAIR_PAY`，
      // 但 TRIPLE_PAY 覆盖了全部 6 个符号，那个兜底**永远不触发**，
      // 于是 pair 局（赔 1）被拿去和三连的 28 比——测试自己写错了，不是实现错。
      expect(after.combo.pay).toBe(
        after.combo.kind === 'triple' ? TRIPLE_PAY[after.combo.symbol!] : PAIR_PAY,
      )
      expect(after.net - base).toBe(after.combo.pay - 1)
    })
    expect(wins).toBeGreaterThan(1000)
  })
})

// ------------------------------------------------------------------ 注额换算

describe('金币结算与注额', () => {
  it('未终局时 outcome 为 null', () => {
    expect(game.outcome?.(create(1))).toBeNull()
    expect(game.outcome?.(reduce(create(1), { type: 'pull' }))).toBeNull()
  })

  it('终局后 outcome 为本场净盈亏、单位「金币」', () => {
    const done = playSession(8)
    const o = game.outcome?.(done)
    expect(o).not.toBeNull()
    expect(o!.better).toBe('higher')
    expect(o!.unit).toBe('金币')
    expect(o!.score).toBe(done.net)
  })

  it('赔付额随注额等比缩放，不写死面值', () => {
    const done = playSession(31)
    const base = coinsOf(done, 1)
    for (const bet of [2, 4, 5, 10, 100]) {
      expect(coinsOf(done, bet)).toBe(base * bet)
    }
  })

  it('未终局不结算金币', () => {
    expect(game.coins!(create(1), { score: 12, better: 'higher', unit: '金币' }, 5)).toBe(0)
  })

  it('controls 至少提供一个拉杆按钮，终局后变成再来一局', () => {
    const c1 = game.controls!(create(1))
    expect(c1.length).toBeGreaterThanOrEqual(1)
    const lever = c1.find((c) => c.action.type === 'pull')
    expect(lever).toBeDefined()
    expect(lever!.primary).toBe(true)
    const spinning = reduce(create(1), { type: 'pull' })
    expect(game.controls!(spinning).find((c) => c.action.type === 'pull')!.disabled).toBe(true)
    expect(game.controls!(playSession(2)).some((c) => c.action.type === 'restart')).toBe(true)
  })
})

// ------------------------------------------------------------------ 纯函数性

describe('纯函数性', () => {
  it('reduce 不修改入参（入参已深冻结）', () => {
    let s = deepFreeze(create(555)) as State
    s = reduce(s, { type: 'pull' })
    s = deepFreeze(s) as State
    s = reduce(s, { type: 'step', n: 4 })
    s = deepFreeze(s) as State
    s = reduce(s, { type: 'step', n: 3 })
    s = deepFreeze(s) as State
    s = reduce(s, { type: 'skip' })
    expect(s.phase).toBe('ready')
    expect(s.round).toBe(1)
  })

  it('evaluate 不修改入参数组', () => {
    const reels = deepFreeze([1, 1, 2]) as number[]
    expect(evaluate(reels).pay).toBe(PAIR_PAY)
    expect(reels).toEqual([1, 1, 2])
  })

  it('非法动作原样返回入参（引用相同）', () => {
    const ready = create(77)
    expect(reduce(ready, { type: 'step', n: 3 })).toBe(ready)
    expect(reduce(ready, { type: 'skip' })).toBe(ready)
    const spinning = reduce(ready, { type: 'pull' })
    expect(reduce(spinning, { type: 'pull' })).toBe(spinning)
    expect(reduce(spinning, { type: 'step', n: 0 })).toBe(spinning)
    const over = playSession(12)
    expect(reduce(over, { type: 'pull' })).toBe(over)
    expect(reduce(over, { type: 'step', n: 5 })).toBe(over)
    expect(reduce(over, { type: 'skip' })).toBe(over)
  })

  it('定步推进：一次多步与逐步多步等价', () => {
    const oneShot = reduce(reduce(create(11), { type: 'pull' }), { type: 'step', n: SETTLE_TICK })
    let stepByStep = reduce(create(11), { type: 'pull' })
    for (let i = 0; i < SETTLE_TICK + 6; i++) stepByStep = reduce(stepByStep, { type: 'step', n: 1 })
    expect(stepByStep.net).toBe(oneShot.net)
    expect(stepByStep.round).toBe(oneShot.round)
    expect(stepByStep.phase).toBe(oneShot.phase)
    expect(stepByStep.combo).toEqual(oneShot.combo)
  })

  it('结算只发生一次：多余的步进不再重复计分', () => {
    let s = reduce(create(11), { type: 'pull' })
    s = reduce(s, { type: 'step', n: SETTLE_TICK })
    const settled = s
    expect(settled.round).toBe(1)
    expect(reduce(s, { type: 'step', n: 10 })).toBe(settled)
    expect(reduce(s, { type: 'skip' })).toBe(settled)
  })
})

// ------------------------------------------------------------------ 终局

describe('终局', () => {
  it('打满 10 局后进入终局，之后不再接受动作', () => {
    const done = playSession(6)
    expect(done.round).toBe(ROUNDS)
    expect(done.phase).toBe('over')
    expect(reduce(done, { type: 'pull' })).toBe(done)
    expect(game.outcome?.(done)).not.toBeNull()
  })

  it('restart 重开一场：清零并回到待拉杆，且不是同一个开局', () => {
    const done = playSession(6)
    const again = reduce(done, { type: 'restart' })
    expect(again.phase).toBe('ready')
    expect(again.round).toBe(0)
    expect(again.net).toBe(0)
    expect(again.combo.pay).toBe(0)
    expect(again.rng).toBe(done.rng) // 随机游标继续往下走
    let s = again
    while (s.phase !== 'over') s = playOne(s)
    expect(s.net === done.net && s.combo.symbol === done.combo.symbol).toBe(false)
  })

  it('空转不会卡死：连打 200 局始终能推进', () => {
    let s = create(0)
    for (let i = 0; i < 200; i++) {
      s = playOne(s)
      if (s.phase === 'over') s = reduce(s, { type: 'restart' })
    }
    expect(s.phase).toBe('ready')
    expect(Number.isInteger(s.round)).toBe(true)
  })

  it('混合动作序列不会产生非法状态', () => {
    let s = create(3)
    const bag: Action[] = [
      { type: 'pull' },
      { type: 'step', n: 2 },
      { type: 'step', n: 1 },
      { type: 'skip' },
      { type: 'restart' },
      { type: 'pull' },
    ]
    for (let i = 0; i < 500; i++) {
      s = reduce(s, bag[i % bag.length])
      expect(['ready', 'spinning', 'over']).toContain(s.phase)
      expect(Number.isFinite(s.net)).toBe(true)
    }
  })

  it('符号编号越界也能安全判定（不抛错）', () => {
    expect(evaluate([-1, -1, -1]).kind).toBe('triple')
    expect(evaluate([99, 99, 99]).symbol).toBe(symbolOf(99))
    expect(evaluate([0, 99, 0]).kind).toBe('pair')
  })
})
