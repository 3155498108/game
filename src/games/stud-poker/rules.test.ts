/**
 * 梭哈规则层测试。
 * 重点覆盖：牌型判定每一档与档位序、同点数平局、换牌后手牌恒 5 张且不重复、
 * 弃牌立即结算、牌堆耗尽洗回、Rng 是唯一随机源、create 纯、
 * reduce 不修改入参、非法动作不改状态、AI 强度契约、终局明确。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Card, Suit } from '../../core/cards'
import { Rng, hashSeed } from '../../core/rng'
import game from './index'
import {
  HAND_SIZE,
  KIND_ORDER,
  MAX_DISCARD,
  MAX_REDRAWS,
  aiAction,
  aiDiscards,
  aiPlan,
  compareHands,
  create,
  evaluateHand,
  handLabel,
  reduce,
  remaining,
  resolveBatch,
  resultLabel,
  strength,
  type Action,
  type HandKind,
  type State,
} from './rules'

/** 造一张测试用牌（id 只用于查重） */
function cd(suit: Suit, rank: number): Card {
  return { id: suit.charCodeAt(0) * 100 + rank, suit, rank }
}

function hand(list: readonly [Suit, number][]): Card[] {
  return list.map(([suit, rank]) => cd(suit, rank))
}

/** 每档牌型各一副样例（点数刻意普通，避免干扰跨档比较） */
const SAMPLES: Record<HandKind, Card[]> = {
  high: hand([['S', 7], ['H', 9], ['C', 11], ['D', 2], ['S', 5]]),
  pair: hand([['S', 7], ['H', 7], ['C', 11], ['D', 2], ['S', 5]]),
  twoPair: hand([['S', 7], ['H', 7], ['C', 11], ['D', 11], ['S', 2]]),
  trips: hand([['S', 7], ['H', 7], ['C', 7], ['D', 2], ['S', 5]]),
  straight: hand([['S', 5], ['H', 6], ['C', 7], ['D', 8], ['S', 9]]),
  flush: hand([['S', 2], ['S', 5], ['S', 9], ['S', 11], ['S', 13]]),
  fullHouse: hand([['S', 7], ['H', 7], ['C', 7], ['D', 2], ['S', 2]]),
  quads: hand([['S', 7], ['H', 7], ['C', 7], ['D', 7], ['S', 5]]),
  straightFlush: hand([['S', 5], ['S', 6], ['S', 7], ['S', 8], ['S', 9]]),
}

/** 深冻结，用于验证 reduce 不修改入参 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
    Object.freeze(value)
  }
  return value
}

/** 走完一整个玩家回合 + 电脑回合，返回终局状态 */
function playRound(seed: number, policy: 'max' | 'stay' = 'max'): State {
  let s = create(seed)
  if (policy === 'max') {
    s = reduce(s, { type: 'toggle', index: seed % HAND_SIZE })
    s = reduce(s, { type: 'redraw' })
    s = reduce(s, { type: 'toggle', index: 0 })
    s = reduce(s, { type: 'redraw' })
  }
  s = reduce(s, { type: 'stay' })
  const act = aiAction(s)
  expect(act).not.toBeNull()
  return reduce(s, act as Action)
}

describe('牌型判定', () => {
  it('散牌按最大牌与次大牌', () => {
    expect(evaluateHand(SAMPLES.high).kind).toBe('high')
    // A 必须真正写成 rank=1（Card.rank 里 A 就是 1），不能写 14-1=13，
    // 那样这手牌其实是一对 K，会被判成 'pair'——踩过一次。
    const a = evaluateHand(hand([['S', 1], ['H', 13], ['C', 9], ['D', 5], ['S', 2]]))
    const b = evaluateHand(hand([['S', 1], ['H', 12], ['C', 9], ['D', 5], ['S', 2]]))
    expect(a.kind).toBe('high')
    expect(b.kind).toBe('high')
    expect(compareHands(a, b)).toBe(1) // 同为 A 高，K 踢脚压 Q
  })

  it('识别一对', () => {
    const v = evaluateHand(SAMPLES.pair)
    expect(v.kind).toBe('pair')
    expect(v.ranks[0]).toBe(7)
  })

  it('识别两对（两对不看成三条）', () => {
    const v = evaluateHand(SAMPLES.twoPair)
    expect(v.kind).toBe('twoPair')
    expect(v.ranks.slice(0, 2)).toEqual([11, 7])
  })

  it('识别三条', () => {
    const v = evaluateHand(SAMPLES.trips)
    expect(v.kind).toBe('trips')
    expect(v.ranks[0]).toBe(7)
    // ranks 是「不含重复位」的比较列表：三条是 [三条点数, 踢脚…]，三条的点数只出现一次。
    // 写成 5 位（7,7,7,5,2）也够比较，但那是牌的排列而不是比较键，统一按前者。
    expect(v.ranks).toEqual([7, 5, 2])
  })

  it('识别顺子', () => {
    const v = evaluateHand(SAMPLES.straight)
    expect(v.kind).toBe('straight')
    expect(v.ranks[0]).toBe(9)
  })

  it('识别同花', () => {
    expect(evaluateHand(SAMPLES.flush).kind).toBe('flush')
  })

  it('识别葫芦', () => {
    const v = evaluateHand(SAMPLES.fullHouse)
    expect(v.kind).toBe('fullHouse')
    expect(v.ranks).toEqual([7, 2])
  })

  it('识别四条', () => {
    const v = evaluateHand(SAMPLES.quads)
    expect(v.kind).toBe('quads')
    expect(v.ranks).toEqual([7, 5])
  })

  it('识别同花顺', () => {
    const v = evaluateHand(SAMPLES.straightFlush)
    expect(v.kind).toBe('straightFlush')
    expect(v.ranks[0]).toBe(9)
  })

  it('A 可当 1 也可当 14：A2345 是 5 高顺子，10JQKA 是 A 高同花顺', () => {
    const low = evaluateHand(hand([['S', 1], ['H', 2], ['C', 3], ['D', 4], ['S', 5]]))
    expect(low.kind).toBe('straight')
    expect(low.ranks[0]).toBe(5)
    const high = evaluateHand(hand([['S', 10], ['S', 11], ['S', 12], ['S', 13], ['S', 1]]))
    expect(high.kind).toBe('straightFlush')
    // A 高顺记作 **14** 而不是 1：ranks 是纯比较列表，A 一律当最大。
    // 若这里记 1，A 高顺会变成最弱的顺子，被 2-3-4-5-6 压过去。
    expect(high.ranks[0]).toBe(14)
    // QKA23 不成顺子（只允许 A2345 与 10JQKA 两种折法）
    expect(evaluateHand(hand([['S', 1], ['H', 2], ['C', 3], ['D', 12], ['S', 13]])).kind).toBe('high')
  })

  it('档位序穷举：散牌 < 一对 < 两对 < 三条 < 顺子 < 同花 < 葫芦 < 四条 < 同花顺', () => {
    expect(KIND_ORDER.length).toBe(9)
    for (let i = 0; i < KIND_ORDER.length; i++) {
      for (let j = 0; j < KIND_ORDER.length; j++) {
        const a = evaluateHand(SAMPLES[KIND_ORDER[i]])
        const b = evaluateHand(SAMPLES[KIND_ORDER[j]])
        expect(compareHands(a, b)).toBe(i < j ? -1 : i > j ? 1 : 0)
      }
    }
    // 题面点名的关键相邻档位
    const named: HandKind[] = ['twoPair', 'trips', 'straight', 'flush', 'fullHouse', 'quads', 'straightFlush']
    for (let i = 0; i + 1 < named.length; i++) {
      expect(compareHands(evaluateHand(SAMPLES[named[i]]), evaluateHand(SAMPLES[named[i + 1]]))).toBe(-1)
    }
  })

  it('一对先比对子点数，再比踢脚', () => {
    const pair9 = evaluateHand(hand([['S', 9], ['H', 9], ['C', 1], ['D', 7], ['S', 3]]))
    const pair8 = evaluateHand(hand([['S', 8], ['H', 8], ['C', 1], ['D', 7], ['S', 3]]))
    expect(compareHands(pair9, pair8)).toBe(1)
    const kickerA = evaluateHand(hand([['S', 9], ['H', 9], ['C', 1], ['D', 7], ['S', 3]]))
    const kickerK = evaluateHand(hand([['S', 9], ['H', 9], ['C', 13], ['D', 7], ['S', 3]]))
    expect(compareHands(kickerA, kickerK)).toBe(1)
  })

  it('葫芦先比三条点数，再比对子点数', () => {
    const trip9low = evaluateHand(hand([['S', 9], ['H', 9], ['C', 9], ['D', 2], ['S', 2]]))
    const trip9high = evaluateHand(hand([['S', 9], ['H', 9], ['C', 9], ['D', 13], ['S', 13]]))
    const trip8ace = evaluateHand(hand([['S', 8], ['H', 8], ['C', 8], ['D', 1], ['S', 1]]))
    expect(compareHands(trip9low, trip9high)).toBe(-1)
    expect(compareHands(trip8ace, trip9high)).toBe(-1) // 三条点数优先，对子 A 也不能翻盘
  })

  it('四条先比四条点数，再比踢脚', () => {
    const q7low = evaluateHand(hand([['S', 7], ['H', 7], ['C', 7], ['D', 7], ['S', 5]]))
    const q7high = evaluateHand(hand([['S', 7], ['H', 7], ['C', 7], ['D', 7], ['S', 9]]))
    const q8low = evaluateHand(hand([['S', 8], ['H', 8], ['C', 8], ['D', 8], ['S', 2]]))
    expect(compareHands(q7high, q7low)).toBe(1)
    expect(compareHands(q8low, q7high)).toBe(1)
  })

  it('同花与同花顺按最大牌', () => {
    const flushA = evaluateHand(hand([['S', 1], ['S', 5], ['S', 9], ['S', 11], ['S', 12]]))
    const flushK = evaluateHand(hand([['S', 13], ['S', 5], ['S', 9], ['S', 11], ['S', 12]]))
    expect(compareHands(flushA, flushK)).toBe(1)
    expect(compareHands(evaluateHand(SAMPLES.straightFlush), evaluateHand(SAMPLES.flush))).toBe(1)
  })

  it('同点数完全相同的两手牌算平局', () => {
    const a = evaluateHand(hand([['S', 7], ['H', 7], ['C', 11], ['D', 2], ['S', 5]]))
    const b = evaluateHand(hand([['C', 7], ['D', 7], ['S', 11], ['H', 2], ['C', 5]]))
    expect(a.kind).toBe('pair')
    expect(b.kind).toBe('pair')
    expect(compareHands(a, b)).toBe(0)
    const hi = evaluateHand(hand([['S', 1], ['H', 13], ['C', 9], ['D', 5], ['S', 2]]))
    expect(compareHands(hi, hi)).toBe(0)
  })

  it('牌型标签为中文且能说明关键点数', () => {
    expect(handLabel(evaluateHand(SAMPLES.straightFlush))).toBe('同花顺 9 高')
    expect(handLabel(evaluateHand(SAMPLES.fullHouse))).toBe('葫芦 7 带 2')
    expect(handLabel(evaluateHand(SAMPLES.quads))).toBe('四条 7 带 5')
    expect(handLabel(evaluateHand(SAMPLES.pair))).toContain('一对 7')
  })

  it('strength 归一化且随牌型递增', () => {
    for (let i = 1; i < KIND_ORDER.length; i++) {
      expect(strength(evaluateHand(SAMPLES[KIND_ORDER[i]]))).toBeGreaterThan(strength(evaluateHand(SAMPLES[KIND_ORDER[i - 1]])))
    }
    expect(strength(evaluateHand(SAMPLES.straightFlush))).toBeLessThanOrEqual(1)
    expect(strength(evaluateHand(SAMPLES.high))).toBeGreaterThanOrEqual(0)
  })

  it('strength 与 compareHands 同向：谁赢谁 strength 大', () => {
    // 这才是 strength 真正要满足的契约——AI 用它排序，方向反了就会换错牌。
    // 上面那条「随牌型递增」只是代理断言：拿固定样本去试，样本一换就可能失效
    // （原来 base*0.72/kicker*0.28 时，J 高散牌就比 7 一对强，擦线才通过）。
    const probes: Card[][] = [
      hand([['S', 1], ['H', 13], ['C', 9], ['D', 5], ['S', 2]]),
      hand([['S', 7], ['H', 7], ['C', 11], ['D', 2], ['S', 5]]),
      hand([['S', 2], ['S', 5], ['S', 9], ['S', 11], ['S', 13]]),
      hand([['S', 7], ['H', 7], ['C', 7], ['D', 2], ['S', 2]]),
      hand([['S', 10], ['S', 11], ['S', 12], ['S', 13], ['S', 1]]),
    ]
    for (const a of probes) {
      for (const b of probes) {
        const va = evaluateHand(a)
        const vb = evaluateHand(b)
        const cmp = compareHands(va, vb)
        if (cmp > 0) expect(strength(va), 'A 赢 B 却更弱').toBeGreaterThan(strength(vb))
        else if (cmp < 0) expect(strength(va)).toBeLessThan(strength(vb))
      }
    }
  })
})

describe('开局与发牌', () => {
  it('create 是纯函数：同种子同结果，不同种子不同结果', () => {
    expect(create(42)).toEqual(create(42))
    expect(create(1).player).not.toEqual(create(2).player)
  })

  it('开局每人 5 张、互不重复、牌堆剩 42 张', () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = create(seed)
      expect(s.player).toHaveLength(HAND_SIZE)
      expect(s.ai).toHaveLength(HAND_SIZE)
      const held = [...s.player, ...s.ai]
      expect(new Set(held.map((c) => c.id)).size).toBe(10)
      const deckIds = new Set(s.deck.map((c) => c.id))
      expect(held.some((c) => deckIds.has(c.id))).toBe(false)
      expect(remaining(s)).toBe(42)
    }
  })

  it('开局即进入玩家回合，可弃牌也可换牌', () => {
    const s = create(7)
    expect(s.phase).toBe('player')
    expect(s.redrawsUsed).toBe(0)
    expect(s.score).toBe(0)
  })
})

describe('换牌', () => {
  it('换牌后手牌恒为 5 张，且全场不出现重复牌', () => {
    for (let seed = 0; seed < 60; seed++) {
      for (let k = 1; k <= MAX_DISCARD; k++) {
        let s = create(seed)
        for (let i = 0; i < k; i++) s = reduce(s, { type: 'toggle', index: i })
        s = reduce(s, { type: 'redraw' })
        expect(s.player).toHaveLength(HAND_SIZE)
        expect(s.ai).toHaveLength(HAND_SIZE)
        expect(new Set([...s.player, ...s.ai].map((c) => c.id)).size).toBe(10)
        const pool = [...s.deck, ...s.spent].map((c) => c.id)
        expect(pool.length).toBe(new Set(pool).size)
        expect(s.selected).toEqual([])
      }
    }
  })

  it('弃 1/2 张时按原位补牌，弃 3 张时换全新 5 张', () => {
    let s = create(12)
    s = reduce(s, { type: 'toggle', index: 0 })
    s = reduce(s, { type: 'toggle', index: 4 })
    const kept = [s.player[1], s.player[2], s.player[3]]
    s = reduce(s, { type: 'redraw' })
    expect(s.player.slice(1, 4)).toEqual(kept)
    expect(s.redrawsUsed).toBe(1)

    let t = create(12)
    const before = t.player.map((c) => c.id)
    for (let i = 0; i < MAX_DISCARD; i++) t = reduce(t, { type: 'toggle', index: i })
    t = reduce(t, { type: 'redraw' })
    expect(t.player).toHaveLength(HAND_SIZE)
    expect(t.player.map((c) => c.id)).not.toEqual(before)
  })

  it('换牌次数上限生效，用完后换牌与选牌都是空操作', () => {
    let s = create(5)
    for (let round = 0; round < MAX_REDRAWS; round++) {
      s = reduce(s, { type: 'toggle', index: 0 })
      s = reduce(s, { type: 'redraw' })
    }
    expect(s.redrawsUsed).toBe(MAX_REDRAWS)
    const after = reduce(s, { type: 'toggle', index: 0 })
    expect(after).toBe(s)
    expect(reduce(after, { type: 'redraw' })).toBe(after)
  })

  it('牌堆耗尽时把已用的牌洗回，且不产生重复牌', () => {
    const s0 = create(11)
    const all = [...s0.deck, ...s0.spent]
    const empty: State = {
      ...s0,
      deck: [],
      spent: all,
      player: all.slice(0, HAND_SIZE),
      ai: all.slice(HAND_SIZE, HAND_SIZE * 2),
      selected: [0],
    }
    const s1 = reduce(empty, { type: 'redraw' })
    expect(s1.reshuffles).toBe(empty.reshuffles + 1)
    expect(s1.player).toHaveLength(HAND_SIZE)
    expect(s1.deck).toHaveLength(all.length - 1)
    const ids = [...s1.deck, ...s1.spent].map((c) => c.id)
    expect(ids.length).toBe(new Set(ids).size)
  })
})

describe('非法动作与纯度', () => {
  it('非法动作原样返回入参（同一引用）', () => {
    const s = create(1)
    expect(reduce(s, { type: 'toggle', index: 9 })).toBe(s)
    expect(reduce(s, { type: 'toggle', index: -1 })).toBe(s)
    expect(reduce(s, { type: 'toggle', index: 1.5 })).toBe(s)
    expect(reduce(s, { type: 'redraw' })).toBe(s) // 没选牌
    expect(reduce(s, { type: 'next' })).toBe(s) // 还没结束
    expect(reduce(s, { type: 'fold' }), 'fold 合法').not.toBe(s)
    const aiTurn = reduce(s, { type: 'stay' })
    expect(reduce(aiTurn, { type: 'fold' })).toBe(aiTurn)
    expect(reduce(aiTurn, { type: 'toggle', index: 0 })).toBe(aiTurn)
    expect(reduce(aiTurn, { type: 'redraw' })).toBe(aiTurn)
    expect(reduce(aiTurn, { type: 'next' })).toBe(aiTurn)
  })

  it('reduce 不修改入参：深冻结后照样能跑完整局', () => {
    const s0 = deepFreeze(create(8))
    let s = s0
    s = reduce(s, { type: 'toggle', index: 2 })
    s = reduce(s, { type: 'redraw' })
    s = reduce(s, { type: 'stay' })
    s = reduce(s, aiAction(s) as Action)
    expect(s.phase).toBe('done')
    expect(s).not.toBe(s0)
    expect(s0.player).toHaveLength(HAND_SIZE)
    expect(s0.phase).toBe('player')
    expect(s0.score).toBe(0)
  })

  it('唯一随机源是 Rng：不调用 Math.random，且同种子同轨迹', () => {
    const spy = vi.spyOn(Math, 'random')
    try {
      spy.mockClear()
      const run = () => {
        let s = create(77)
        s = reduce(s, { type: 'toggle', index: 3 })
        s = reduce(s, { type: 'redraw' })
        s = reduce(s, { type: 'stay' })
        s = reduce(s, aiAction(s) as Action)
        return s
      }
      const first = run()
      const second = run()
      expect(spy).not.toHaveBeenCalled()
      expect(first).toEqual(second)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('结算与终局', () => {
  it('弃牌立即结算为输，不进入电脑回合', () => {
    const s = reduce(create(3), { type: 'fold' })
    expect(s.phase).toBe('done')
    expect(s.result).toBe('lose')
    expect(s.lastMult).toBe(-1)
    expect(s.score).toBe(-1)
    expect(s.playerFolded).toBe(true)
    expect(aiAction(s)).toBeNull()
    expect(resultLabel(s.result as 'lose')).toBe('你输了')
  })

  it('同点数平局：退还注额，倍数 0', () => {
    const base = reduce(create(21), { type: 'stay' })
    const s: State = {
      ...base,
      player: hand([['S', 7], ['H', 7], ['C', 11], ['D', 2], ['S', 5]]),
      ai: hand([['C', 7], ['D', 7], ['S', 11], ['H', 2], ['C', 5]]),
    }
    const done = reduce(s, { type: 'aiMove', plan: { fold: false, batches: [] } })
    expect(done.phase).toBe('done')
    expect(done.result).toBe('push')
    expect(done.lastMult).toBe(0)
    expect(done.score).toBe(0)
    expect(resultLabel('push')).toBe('平局')
  })

  it('赢方是四条及以上时拿 2 倍注', () => {
    const base = reduce(create(21), { type: 'stay' })
    const win: State = {
      ...base,
      player: hand([['S', 7], ['H', 7], ['C', 7], ['D', 7], ['S', 5]]),
      ai: hand([['S', 2], ['H', 4], ['C', 6], ['D', 8], ['S', 10]]),
    }
    const done = reduce(win, { type: 'aiMove', plan: { fold: false, batches: [] } })
    expect(done.result).toBe('win')
    expect(done.lastMult).toBe(2)
    expect(done.score).toBe(2)

    const lose: State = {
      ...base,
      player: hand([['S', 2], ['H', 4], ['C', 6], ['D', 8], ['S', 10]]),
      ai: hand([['S', 7], ['H', 7], ['C', 7], ['D', 7], ['S', 5]]),
    }
    const lost = reduce(lose, { type: 'aiMove', plan: { fold: false, batches: [] } })
    expect(lost.result).toBe('lose')
    expect(lost.lastMult).toBe(-2)
  })

  it('明确终局：任意种子连打多局都必然收敛到 done，并能开下一局', () => {
    for (let seed = 0; seed < 200; seed++) {
      const s = playRound(seed)
      expect(s.phase).toBe('done')
      expect(['win', 'lose', 'push']).toContain(s.result)
      expect(Number.isFinite(s.score)).toBe(true)
      const next = reduce(s, { type: 'next' })
      expect(next.phase).toBe('player')
      expect(next.round).toBe(s.round + 1)
      expect(next.result).toBeNull()
      // 下一局再次收敛
      const again = reduce(reduce(next, { type: 'fold' }), { type: 'next' })
      expect(again.phase).toBe('player')
      expect(again.round).toBe(s.round + 2)
    }
  })

  it('restart 重开一局并清空累计', () => {
    const lost = reduce(create(4), { type: 'fold' })
    const fresh = reduce(lost, { type: 'restart' })
    expect(fresh.phase).toBe('player')
    expect(fresh.round).toBe(1)
    expect(fresh.score).toBe(0)
    expect(fresh.result).toBeNull()
    expect(fresh.player).toHaveLength(HAND_SIZE)
  })
})

describe('电脑 AI', () => {
  it('aiAction 只在电脑回合返回动作', () => {
    const s = create(9)
    expect(aiAction(s)).toBeNull()
    const aiTurn = reduce(s, { type: 'stay' })
    const act = aiAction(aiTurn)
    expect(act?.type).toBe('aiMove')
    expect(reduce(s, act as Action)).toBe(s)
  })

  it('换牌策略：成型大牌不换，弱牌会换，且每批不超过 3 张', () => {
    // 同花：一张都不换
    expect(aiDiscards(hand([['S', 2], ['S', 5], ['S', 9], ['S', 11], ['S', 13]]))).toEqual([])
    // 三条：换掉两张单牌
    expect(aiDiscards(hand([['S', 7], ['H', 7], ['C', 7], ['D', 2], ['S', 5]])).sort((a, b) => a - b)).toEqual([3, 4])
    // 两对：只换落单那张
    expect(aiDiscards(hand([['S', 7], ['H', 7], ['C', 11], ['D', 11], ['S', 2]]))).toEqual([4])
    // 一对：留对子与最大踢脚，换掉另外两张
    const pairPicks = aiDiscards(hand([['S', 9], ['H', 9], ['C', 1], ['D', 7], ['S', 3]]))
    expect(pairPicks.length).toBe(2)
    expect(pairPicks.every((i) => i !== 0 && i !== 1)).toBe(true)
    // 散牌：最多换 2 张，且不会超过上限
    for (const cards of SAMPLES.high) void cards
    const junk = hand([['S', 2], ['H', 4], ['C', 6], ['D', 8], ['S', 10]])
    expect(aiDiscards(junk).length).toBeGreaterThan(0)
    expect(aiDiscards(junk).length).toBeLessThanOrEqual(MAX_DISCARD)
  })

  it('resolveBatch：已有对子就放弃「换最小两张」这批', () => {
    const pair = hand([['S', 9], ['H', 9], ['C', 1], ['D', 7], ['S', 3]])
    expect(resolveBatch(pair, { lowest: 2 })).toEqual([])
    const junk = hand([['S', 2], ['H', 4], ['C', 6], ['D', 8], ['S', 10]])
    expect(resolveBatch(junk, { lowest: 2 })).toEqual([0, 1])
    expect(resolveBatch(junk, { picks: [3, 1] })).toEqual([1, 3])
  })

  it('AI 不会必弃也不会必跟：既会弃牌，也会换牌跟到底', () => {
    let folds = 0
    let holds = 0
    let reds = 0
    for (let seed = 0; seed < 400; seed++) {
      const plan = aiPlan(reduce(create(seed), { type: 'stay' }))
      if (plan.fold) folds++
      else {
        holds++
        if (plan.batches.length > 0) reds++
      }
    }
    expect(folds).toBeGreaterThan(0)
    expect(holds).toBeGreaterThan(0)
    expect(reds).toBeGreaterThan(0)
  })

  it('AI 强度契约：面对「随机弃牌 / 不换牌」的玩家，赢面明显更大', () => {
    let aiWin = 0
    let playerWin = 0
    let push = 0
    for (let i = 0; i < 400; i++) {
      const r = new Rng(hashSeed(i * 7919 + 13))
      let s = create(2000 + i)
      // 随机弃牌策略：约四成弃牌，其余不换牌直接停牌
      s = r.chance(0.4) ? reduce(s, { type: 'fold' }) : reduce(s, { type: 'stay' })
      // 弃牌已当场终局结算，没有电脑回合；aiAction 在非 ai 回合返回 null 是契约
      const act = aiAction(s)
      if (act) s = reduce(s, act)
      if (s.result === 'lose') aiWin++
      else if (s.result === 'win') playerWin++
      else push++
    }
    expect(aiWin).toBeGreaterThan(playerWin * 1.3)
    expect(push).toBeGreaterThanOrEqual(0)
  })
})

describe('游戏模块契约', () => {
  it('meta 指向 stud-poker 且视口固定 720×1280', () => {
    expect(game.id).toBe('stud-poker')
    expect(game.viewport).toEqual({ width: 720, height: 1280 })
    expect(game.category).toBe('card')
  })

  it('outcome：未结束为 null，结束返回 金币 单位与胜负', () => {
    expect(game.outcome!(create(6))).toBeNull()
    const s = reduce(create(6), { type: 'fold' })
    expect(game.outcome!(s)).toEqual({ score: -1, better: 'higher', unit: '金币', win: false })
  })

  it('coins 按注额倍数换算，不写死面值', () => {
    const lost = reduce(create(3), { type: 'fold' })
    const lostOut = game.outcome!(lost)
    expect(lostOut).not.toBeNull()
    expect(game.coins!(lost, lostOut as NonNullable<typeof lostOut>, 100)).toBe(-100)
    expect(game.coins!(lost, lostOut as NonNullable<typeof lostOut>, 25)).toBe(-25)

    const base = reduce(create(21), { type: 'stay' })
    const won = reduce(
      { ...base, player: SAMPLES.quads, ai: SAMPLES.high },
      { type: 'aiMove', plan: { fold: false, batches: [] } },
    )
    const wonOut = game.outcome!(won)
    expect(wonOut).not.toBeNull()
    expect(wonOut!.win).toBe(true)
    expect(game.coins!(won, wonOut as NonNullable<typeof wonOut>, 50)).toBe(100) // 四条 2 倍注

    const tie = reduce(
      { ...base, player: SAMPLES.pair, ai: hand([['C', 7], ['D', 7], ['S', 11], ['H', 2], ['C', 5]]) },
      { type: 'aiMove', plan: { fold: false, batches: [] } },
    )
    const tieOut = game.outcome!(tie)
    expect(tieOut?.win).toBeUndefined()
    expect(game.coins!(tie, tieOut as NonNullable<typeof tieOut>, 50)).toBe(0)
  })

  it('controls 提供换牌 / 停牌 / 弃牌，结束后提供下一局，且动作都能被执行', () => {
    const fresh = create(4)
    const freshLabels = game.controls!(fresh).map((c) => c.label)
    expect(freshLabels.some((l) => l.includes('换'))).toBe(true)
    expect(freshLabels.some((l) => l.includes('停牌'))).toBe(true)
    expect(freshLabels.some((l) => l.includes('弃牌'))).toBe(true)
    expect(game.controls!(fresh).find((c) => c.label.includes('换'))?.disabled).toBe(true)

    const picked = reduce(fresh, { type: 'toggle', index: 0 })
    expect(game.controls!(picked).find((c) => c.label.includes('换 1 张'))?.disabled).toBe(false)

    const aiTurn = reduce(fresh, { type: 'stay' })
    expect(game.controls!(aiTurn)).toEqual([])

    const done = reduce(fresh, { type: 'fold' })
    expect(game.controls!(done).map((c) => c.label)).toEqual(['下一局'])

    // 声明出来的动作都必须是合法可执行的
    for (const st of [fresh, picked, done, reduce(picked, { type: 'redraw' })]) {
      for (const c of game.controls!(st)) {
        expect(reduce(st, c.action)).toBeDefined()
      }
    }
  })

  it('hint 始终给得出中文提示', () => {
    expect(game.hint!(create(4))).toContain('手牌')
    expect(game.hint!(reduce(create(4), { type: 'stay' }))).toContain('电脑')
    expect(game.hint!(reduce(create(4), { type: 'fold' }))).toContain('下一局')
  })
})
