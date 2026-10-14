import { describe, expect, it } from 'vitest'
import { dieCenter, hitDie, hitSlot, slotRect } from './index'
import metaDefault, { meta } from './meta'
import {
  DIE_COUNT,
  LOWER_MAX,
  MAX_SCORE,
  ROLLS_PER_ROUND,
  SLOT_COUNT,
  SLOT_FOUR,
  SLOT_LARGE,
  SLOT_PAIR,
  SLOT_SMALL,
  SLOT_THREE,
  SLOT_TWO_PAIR,
  SLOT_YAHTZEE,
  SLOTS,
  UPPER_BONUS,
  UPPER_BONUS_TARGET,
  UPPER_MAX,
  UPPER_SLOT_COUNT,
  YAHTZEE_BONUS,
  bestSlot,
  create,
  filledCount,
  isFour,
  isPair,
  isSlot,
  isSmallStraight,
  isThree,
  isTwoPair,
  isYahtzee,
  lowerTotal,
  maxCount,
  reduce,
  scoreFor,
  slotValue,
  totalScore,
  upperBonus,
  upperTotal,
  worstSlot,
  yahtzeeBonus,
  type State,
} from './rules'

// ---------------- 测试辅助 ----------------

/** 掷一次骰 */
const roll = (s: State): State => reduce(s, { type: 'roll' })

/** 直接造出指定骰面的局面（跳过随机，便于断言判定） */
function withDice(s: State, dice: number[]): State {
  return { ...s, dice: dice.slice(), keep: [false, false, false, false, false], rollsLeft: ROLLS_PER_ROUND }
}

/** 直接造出指定计分表的局面 */
function withSlots(s: State, filled: Record<number, number>): State {
  const slots = new Array<number | null>(SLOT_COUNT).fill(null)
  for (const k of Object.keys(filled)) slots[Number(k)] = filled[Number(k)]
  const n = filledCount(slots)
  return { ...s, slots, round: SLOT_COUNT - n + 1, over: n >= SLOT_COUNT }
}

/** 确定性「随机」选一个空缺格（测试里不用 Math.random） */
function pseudoRandomEmptySlot(s: State, seed: number): number {
  const empty: number[] = []
  for (let i = 0; i < SLOT_COUNT; i++) if (s.slots[i] === null) empty.push(i)
  const x = (Math.imul((seed * 2654435761) >>> 0, 1664525) + 1013904223) >>> 0
  return empty[x % empty.length]
}

/** 用 AI 自动打完一整局 */
function playToEnd(seed: number): State {
  let s = create(seed)
  let guard = 0
  while (!s.over && guard++ < 60) {
    if (s.dice.length !== DIE_COUNT) s = roll(s)
    s = reduce(s, { type: 'auto' })
  }
  return s
}

const deep = (s: State): unknown => JSON.parse(JSON.stringify(s)) as unknown

// ---------------- 初始状态 ----------------

describe('初始状态', () => {
  it('开局是第 1 轮、3 次投掷、13 个空缺格', () => {
    const s = create(42)
    expect(s.round).toBe(1)
    expect(s.rollsLeft).toBe(ROLLS_PER_ROUND)
    expect(s.dice).toEqual([])
    expect(s.keep).toEqual([false, false, false, false, false])
    expect(s.slots).toEqual(new Array(SLOT_COUNT).fill(null))
    expect(s.slots).toHaveLength(SLOT_COUNT)
    expect(s.throws).toBe(0)
    expect(s.lastSlot).toBe(-1)
    expect(s.over).toBe(false)
  })

  it('同一 seed 的 create 完全一致（可复盘）', () => {
    expect(create(20260913)).toEqual(create(20260913))
  })

  it('不同 seed 走的是不同的随机游标', () => {
    expect(create(1).rng).not.toBe(create(2).rng)
  })

  it('13 个计分格：上段 6 格按点数求和，下段 7 格为固定分', () => {
    expect(SLOTS).toHaveLength(SLOT_COUNT)
    expect(SLOTS.slice(0, UPPER_SLOT_COUNT).map((s) => s.face)).toEqual([1, 2, 3, 4, 5, 6])
    expect(SLOTS.slice(UPPER_SLOT_COUNT).map((s) => s.label)).toEqual(['对子', '两对', '三条', '四条', '小顺', '大顺', '快艇'])
  })
})

// ---------------- 掷骰 ----------------

describe('掷骰', () => {
  it('第 1 掷掷出 5 颗骰子并消耗 1 次机会', () => {
    const s = roll(create(7))
    expect(s.dice).toHaveLength(DIE_COUNT)
    expect(s.rollsLeft).toBe(ROLLS_PER_ROUND - 1)
    expect(s.throws).toBe(1)
    expect(s.round).toBe(1)
  })

  it('5 颗骰子的点数恒在 1..6', () => {
    for (let seed = 1; seed <= 60; seed++) {
      let s = create(seed * 7919)
      for (let i = 0; i < 3; i++) {
        s = roll(s)
        expect(s.dice).toHaveLength(DIE_COUNT)
        for (const d of s.dice) expect(Number.isInteger(d) && d >= 1 && d <= 6).toBe(true)
      }
    }
  })

  it('每次 reduce 恰好消耗一次投掷机会，3 次后为 0', () => {
    let s = create(3)
    for (let i = 0; i < ROLLS_PER_ROUND; i++) {
      expect(s.rollsLeft).toBe(ROLLS_PER_ROUND - i)
      s = roll(s)
    }
    expect(s.rollsLeft).toBe(0)
    expect(s.throws).toBe(ROLLS_PER_ROUND)
  })

  it('机会用完后再掷是空操作（返回同一对象）', () => {
    let s = create(3)
    while (s.rollsLeft > 0) s = roll(s)
    expect(reduce(s, { type: 'roll' })).toBe(s)
  })

  it('勾选全部保留后重投，5 颗骰面一字不改', () => {
    let s = roll(create(11))
    for (let i = 0; i < DIE_COUNT; i++) s = reduce(s, { type: 'toggle', die: i })
    expect(s.keep).toEqual([true, true, true, true, true])
    const before = s.dice.slice()
    const after = roll(s)
    expect(after.dice).toEqual(before)
    expect(after.throws).toBe(2)
  })

  it('只勾选部分骰子时，勾选的那几颗保持不变', () => {
    let s = roll(create(11))
    s = reduce(s, { type: 'toggle', die: 0 })
    s = reduce(s, { type: 'toggle', die: 3 })
    const before = s.dice.slice()
    const after = roll(s)
    expect(after.dice[0]).toBe(before[0])
    expect(after.dice[3]).toBe(before[3])
    expect(after.dice).not.toEqual(before) // 至少有一颗被重投
  })

  it('勾选全部后重投仍能再掷一次（每次 reduce 只扣一次机会）', () => {
    let s = roll(create(5))
    for (let i = 0; i < DIE_COUNT; i++) s = reduce(s, { type: 'toggle', die: i })
    s = roll(s)
    expect(s.rollsLeft).toBe(1)
    s = roll(s)
    expect(s.rollsLeft).toBe(0)
  })

  it('第 1 掷会清空勾选位（保留无意义）', () => {
    let s = roll(create(9))
    s = reduce(s, { type: 'toggle', die: 1 })
    expect(s.keep[1]).toBe(true)
    s = reduce(s, { type: 'fill', slot: 0 })
    expect(s.dice).toEqual([])
    expect(s.keep).toEqual([false, false, false, false, false])
    s = roll(s)
    expect(s.keep).toEqual([false, false, false, false, false])
  })
})

// ---------------- 勾选保留 ----------------

describe('勾选保留', () => {
  it('toggle 会翻转该颗骰子的保留状态', () => {
    let s = roll(create(13))
    s = reduce(s, { type: 'toggle', die: 2 })
    expect(s.keep).toEqual([false, false, true, false, false])
    s = reduce(s, { type: 'toggle', die: 2 })
    expect(s.keep).toEqual([false, false, false, false, false])
  })

  it('越界与非整数的 die 不改变状态', () => {
    const s = roll(create(13))
    for (const d of [-1, DIE_COUNT, 1.5, NaN]) expect(reduce(s, { type: 'toggle', die: d })).toBe(s)
  })

  it('本轮还没掷骰时无法勾选', () => {
    const s = create(13)
    expect(reduce(s, { type: 'toggle', die: 0 })).toBe(s)
  })

  it('投掷机会用完后无法勾选', () => {
    let s = roll(create(13))
    while (s.rollsLeft > 0) s = roll(s)
    expect(reduce(s, { type: 'toggle', die: 0 })).toBe(s)
  })

  it('toggle 不修改入参', () => {
    const s = roll(create(13))
    const keep = s.keep.slice()
    reduce(s, { type: 'toggle', die: 1 })
    expect(s.keep).toEqual(keep)
  })
})

// ---------------- 单格计分 ----------------

describe('单格计分', () => {
  it('上段格只算该点数的骰面之和', () => {
    expect(scoreFor(0, [1, 1, 2, 3, 4])).toBe(2)
    expect(scoreFor(1, [1, 1, 2, 3, 4])).toBe(2)
    expect(scoreFor(2, [1, 1, 2, 4, 5])).toBe(0) // 没有 3 → 0 分
    expect(scoreFor(2, [1, 1, 2, 3, 4])).toBe(3)
    expect(scoreFor(3, [4, 4, 4, 4, 5])).toBe(16)
  })

  it('上段每格满分 = 5 × 点数', () => {
    for (let face = 1; face <= 6; face++) {
      const dice = new Array(DIE_COUNT).fill(face)
      expect(scoreFor(face - 1, dice)).toBe(5 * face)
      expect(SLOTS[face - 1].max).toBe(5 * face)
    }
  })

  it('对子 / 两对 / 三条 / 四条 判定正确', () => {
    expect(isPair([1, 1, 2, 3, 4])).toBe(true)
    expect(isPair([1, 2, 3, 4, 5])).toBe(false)
    expect(isTwoPair([3, 3, 5, 5, 1])).toBe(true)
    expect(isTwoPair([3, 3, 3, 5, 1])).toBe(false) // 四条不算两对
    expect(isThree([4, 4, 4, 1, 2])).toBe(true)
    expect(isThree([4, 4, 1, 2, 3])).toBe(false)
    expect(isFour([5, 5, 5, 5, 2])).toBe(true)
    expect(isFour([5, 5, 5, 2, 3])).toBe(false)
    expect(maxCount([5, 5, 5, 2, 3])).toBe(3)
  })

  it('下段各格分值与判定一致', () => {
    const pair = [2, 2, 3, 4, 5]
    expect(scoreFor(SLOT_PAIR, pair)).toBe(SLOTS[SLOT_PAIR].max)
    expect(scoreFor(SLOT_TWO_PAIR, pair)).toBe(0)
    expect(scoreFor(SLOT_PAIR, [1, 2, 3, 4, 5])).toBe(0)

    const twoPair = [2, 2, 3, 3, 5]
    expect(scoreFor(SLOT_TWO_PAIR, twoPair)).toBe(SLOTS[SLOT_TWO_PAIR].max)
    expect(scoreFor(SLOT_THREE, twoPair)).toBe(0)

    expect(scoreFor(SLOT_THREE, [6, 6, 6, 1, 2])).toBe(SLOTS[SLOT_THREE].max)
    expect(scoreFor(SLOT_FOUR, [6, 6, 6, 1, 2])).toBe(0)
    expect(scoreFor(SLOT_FOUR, [6, 6, 6, 6, 1])).toBe(SLOTS[SLOT_FOUR].max)
  })

  it('小顺认 1-2-3-4-5；大顺 2-3-4-5-6 同时也算小顺', () => {
    expect(isSmallStraight([1, 2, 3, 4, 5])).toBe(true)
    expect(isSmallStraight([2, 3, 4, 5, 6])).toBe(true)
    expect(isSmallStraight([1, 2, 3, 4, 6])).toBe(false)
    expect(isSmallStraight([1, 2, 3, 5, 6])).toBe(false)
    expect(scoreFor(SLOT_SMALL, [1, 2, 3, 4, 5])).toBe(SLOTS[SLOT_SMALL].max)
    expect(scoreFor(SLOT_LARGE, [1, 2, 3, 4, 5])).toBe(0)
    expect(scoreFor(SLOT_LARGE, [2, 3, 4, 5, 6])).toBe(SLOTS[SLOT_LARGE].max)
    expect(scoreFor(SLOT_SMALL, [2, 3, 4, 5, 6])).toBe(SLOTS[SLOT_SMALL].max)
  })

  it('快艇判定：五颗全同', () => {
    expect(isYahtzee([4, 4, 4, 4, 4])).toBe(true)
    expect(isYahtzee([4, 4, 4, 4, 5])).toBe(false)
    expect(scoreFor(SLOT_YAHTZEE, [1, 1, 1, 1, 1])).toBe(SLOTS[SLOT_YAHTZEE].max)
  })

  it('非法格序号得 0 分', () => {
    expect(isSlot(0)).toBe(true)
    expect(isSlot(SLOT_COUNT)).toBe(false)
    expect(isSlot(-1)).toBe(false)
    expect(isSlot(1.5)).toBe(false)
    expect(scoreFor(SLOT_COUNT, [1, 2, 3, 4, 5])).toBe(0)
  })
})

// ---------------- 填格与轮次 ----------------

describe('填格与轮次', () => {
  it('填格按当前骰面计分，并立刻开新一轮', () => {
    const s = withDice(create(1), [1, 1, 2, 3, 4])
    const n = reduce(s, { type: 'fill', slot: 0 })
    expect(n.slots[0]).toBe(2)
    expect(n.round).toBe(2)
    expect(n.rollsLeft).toBe(ROLLS_PER_ROUND)
    expect(n.dice).toEqual([])
    expect(n.lastSlot).toBe(0)
    expect(n.over).toBe(false)
  })

  it('13 个计分格各自只能填一次', () => {
    const s = reduce(withDice(create(1), [1, 1, 2, 3, 4]), { type: 'fill', slot: 0 })
    const again = reduce(s, { type: 'fill', slot: 0 })
    expect(again).toBe(s)
    expect(again.slots[0]).toBe(2)
    expect(filledCount(again.slots)).toBe(1)
  })

  it('abandon 填 0 表示放弃该格：格被占用且得 0 分', () => {
    const s = withDice(create(1), [1, 1, 2, 3, 4])
    const n = reduce(s, { type: 'fill', slot: SLOT_LARGE, abandon: true })
    expect(n.slots[SLOT_LARGE]).toBe(0)
    expect(n.slots[SLOT_LARGE]).not.toBe(null)
    expect(lowerTotal(n)).toBe(0)
  })

  it('已被占用的格不能重复填写（即使本轮还掷着骰）', () => {
    const s = withDice(withSlots(create(1), { [SLOT_LARGE]: 0 }), [1, 1, 2, 3, 4])
    expect(reduce(s, { type: 'fill', slot: SLOT_LARGE })).toBe(s)
    expect(reduce(s, { type: 'fill', slot: SLOT_LARGE, abandon: true })).toBe(s)
    expect(reduce(s, { type: 'fill', slot: 0 })).not.toBe(s) // 空缺格仍然可填
  })

  it('放弃上段格不计入上段合计，也不影响其他格的奖励判定', () => {
    const base = withSlots(create(1), { 0: 5, 1: 10, 2: 15, 3: 20 })
    const n = reduce(withDice(base, [4, 4, 4, 4, 4]), { type: 'fill', slot: 5, abandon: true })
    expect(upperTotal(n)).toBe(50)
    expect(upperBonus(n)).toBe(0)
  })

  it('本轮还没掷骰时不能填格', () => {
    const s = create(1)
    expect(reduce(s, { type: 'fill', slot: 0 })).toBe(s)
    expect(reduce(s, { type: 'auto' })).toBe(s)
  })

  it('非法格序号不改变状态', () => {
    const s = withDice(create(1), [1, 1, 2, 3, 4])
    for (const k of [-1, SLOT_COUNT, 1.5]) expect(reduce(s, { type: 'fill', slot: k })).toBe(s)
  })
})

// ---------------- 分数汇总 ----------------

describe('分数汇总', () => {
  it('上段 / 下段合计分别统计', () => {
    const s = withSlots(create(1), { 0: 5, 1: 10, 5: 30, [SLOT_PAIR]: 5, [SLOT_YAHTZEE]: 50 })
    expect(upperTotal(s)).toBe(45)
    expect(lowerTotal(s)).toBe(55)
  })

  it('上段合计 ≥63 加 35，不足则不加', () => {
    expect(upperBonus(withSlots(create(1), { 0: 30, 1: 32 }))).toBe(0)
    expect(upperBonus(withSlots(create(1), { 0: 30, 1: 33 }))).toBe(UPPER_BONUS)
    expect(upperBonus(withSlots(create(1), { 0: 30, 1: 33, 2: 0 }))).toBe(UPPER_BONUS)
    expect(UPPER_BONUS_TARGET).toBe(63)
  })

  it('快艇格拿到满分才额外加 50；格分与奖励分开计算', () => {
    const win = reduce(withDice(create(1), [3, 3, 3, 3, 3]), { type: 'fill', slot: SLOT_YAHTZEE })
    expect(win.slots[SLOT_YAHTZEE]).toBe(50)
    expect(yahtzeeBonus(win)).toBe(YAHTZEE_BONUS)
    // 快艇格 50 + 快艇奖励 50 = 100
    expect(totalScore(win)).toBe(100)
  })

  it('快艇格填 0（放弃）没有奖励', () => {
    const lose = reduce(withDice(create(1), [3, 3, 3, 3, 3]), { type: 'fill', slot: SLOT_YAHTZEE, abandon: true })
    expect(lose.slots[SLOT_YAHTZEE]).toBe(0)
    expect(yahtzeeBonus(lose)).toBe(0)
    expect(totalScore(lose)).toBe(0)
  })

  it('没有五同时填快艇格得 0，也没有奖励', () => {
    const s = reduce(withDice(create(1), [1, 2, 3, 4, 5]), { type: 'fill', slot: SLOT_YAHTZEE })
    expect(s.slots[SLOT_YAHTZEE]).toBe(0)
    expect(yahtzeeBonus(s)).toBe(0)
  })

  it('总分 = 上段 + 下段 + 上段奖励 + 快艇奖励', () => {
    const s = withSlots(create(1), { 0: 30, 1: 33, 5: 30, [SLOT_TWO_PAIR]: 15, [SLOT_FOUR]: 25 })
    expect(upperTotal(s)).toBe(93)
    expect(lowerTotal(s)).toBe(40)
    expect(totalScore(s)).toBe(93 + 40 + UPPER_BONUS)
  })

  it('理论满分恰好是 375：105 + 35 + 185 + 50', () => {
    expect(UPPER_MAX).toBe(105)
    expect(LOWER_MAX).toBe(185)
    expect(UPPER_BONUS).toBe(35)
    expect(YAHTZEE_BONUS).toBe(50)
    expect(UPPER_MAX + UPPER_BONUS + LOWER_MAX + YAHTZEE_BONUS).toBe(375)
    expect(MAX_SCORE).toBe(375)
  })

  it('13 格满分之和 = 上段 105 + 下段 185 = 290', () => {
    expect(SLOTS.reduce((a, s) => a + s.max, 0)).toBe(UPPER_MAX + LOWER_MAX)
    expect(SLOTS.slice(0, UPPER_SLOT_COUNT).reduce((a, s) => a + s.max, 0)).toBe(105)
    expect(SLOTS.slice(UPPER_SLOT_COUNT).reduce((a, s) => a + s.max, 0)).toBe(185)
  })

  it('任何局面总分都落在 0..375 之间', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const s = playToEnd(seed)
      expect(totalScore(s)).toBeGreaterThanOrEqual(0)
      expect(totalScore(s)).toBeLessThanOrEqual(MAX_SCORE)
    }
  })
})

// ---------------- AI 自动选格 ----------------

describe('AI 自动选格 bestSlot', () => {
  it('返回的一定是空缺格', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = roll(create(seed))
      const b = bestSlot(s)
      expect(isSlot(b)).toBe(true)
      expect(s.slots[b]).toBe(null)
    }
  })

  it('优于任何其他空缺格（含确定性伪随机挑的一格）', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = roll(create(seed))
      const b = bestSlot(s)
      const r = pseudoRandomEmptySlot(s, seed)
      if (r === b) continue
      expect(slotValue(s, b)).toBeGreaterThan(slotValue(s, r))
    }
  })

  it('目标函数在所有空缺格里取到最大值', () => {
    const s = withSlots(withDice(create(2), [6, 6, 3, 3, 1]), { 0: 5, 1: 10 })
    const b = bestSlot(s)
    for (let k = 0; k < SLOT_COUNT; k++) {
      if (s.slots[k] !== null) continue
      expect(slotValue(s, k)).toBeLessThanOrEqual(slotValue(s, b))
    }
  })

  it('五颗全同时优先填快艇格（50 分 + 50 奖励）', () => {
    expect(bestSlot(withDice(create(1), [4, 4, 4, 4, 4]))).toBe(SLOT_YAHTZEE)
  })

  it('快艇格已填后，五颗全同改填主线面自己的上段格', () => {
    const s = withSlots(withDice(create(1), [4, 4, 4, 4, 4]), { [SLOT_YAHTZEE]: 0 })
    expect(bestSlot(s)).toBe(3) // 上段「4」格
  })

  it('拿得到小顺时优先填小顺格', () => {
    expect(bestSlot(withDice(create(1), [1, 2, 3, 4, 5]))).toBe(SLOT_SMALL)
    expect(bestSlot(withDice(create(1), [2, 3, 4, 5, 6]))).toBe(SLOT_LARGE)
  })

  it('上段还差几分时，优先补齐去拿 +35', () => {
    // 上段已填 5+10+15+20 = 50，差 13 分；本轮有三个 5，补「5」格正好 +35
    const base = withSlots(create(1), { 0: 5, 1: 10, 2: 15, 3: 20 })
    expect(bestSlot(withDice(base, [5, 5, 5, 1, 2]))).toBe(4)
  })

  it('是纯函数：两次调用结果相同且不修改入参', () => {
    const s = roll(create(17))
    const before = deep(s)
    expect(bestSlot(s)).toBe(bestSlot(s))
    expect(deep(s)).toEqual(before)
  })

  it('本轮没掷骰或已终局时返回 -1', () => {
    expect(bestSlot(create(1))).toBe(-1)
    const over = withSlots(create(1), { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 })
    expect(over.over).toBe(true)
    expect(bestSlot(over)).toBe(-1)
  })

  it('worstSlot 是目标函数最小的空缺格', () => {
    const s = withDice(create(3), [1, 2, 3, 4, 5])
    const w = worstSlot(s)
    expect(s.slots[w]).toBe(null)
    for (let k = 0; k < SLOT_COUNT; k++) {
      if (s.slots[k] !== null) continue
      expect(slotValue(s, k)).toBeGreaterThanOrEqual(slotValue(s, w))
    }
  })

  it('auto 动作等价于填 bestSlot', () => {
    const s = withDice(create(23), [6, 6, 6, 6, 6])
    const b = bestSlot(s)
    expect(reduce(s, { type: 'auto' }).slots[b]).toBe(scoreFor(b, s.dice))
    expect(reduce(s, { type: 'auto' }).round).toBe(2)
  })
})

// ---------------- 终局 ----------------

describe('终局', () => {
  it('13 格填满即终局', () => {
    const s = playToEnd(777)
    expect(s.over).toBe(true)
    expect(filledCount(s.slots)).toBe(SLOT_COUNT)
    expect(s.slots.every((v) => v !== null)).toBe(true)
    expect(s.round).toBe(SLOT_COUNT)
  })

  it('每个种子都能在有限步内走到终局', () => {
    for (let seed = 1; seed <= 30; seed++) {
      expect(playToEnd(seed).over).toBe(true)
    }
  })

  it('终局后任何动作都不再改变状态', () => {
    const over = playToEnd(1234)
    for (const a of [
      { type: 'roll' },
      { type: 'toggle', die: 0 },
      { type: 'fill', slot: 0 },
      { type: 'auto' },
    ] as const) {
      expect(reduce(over, a)).toBe(over)
    }
  })

  it('终局保留最后一手骰面，便于展示', () => {
    const s = playToEnd(88)
    expect(s.dice).toHaveLength(DIE_COUNT)
    expect(s.dice.every((d) => d >= 1 && d <= 6)).toBe(true)
  })
})

// ---------------- 纯函数约束 ----------------

describe('纯函数约束', () => {
  it('reduce 不修改入参（各动作都验证）', () => {
    let s = roll(create(101))
    s = reduce(s, { type: 'toggle', die: 2 })
    s = reduce(s, { type: 'roll' })
    s = reduce(s, { type: 'fill', slot: 0 })
    const before = deep(s)
    for (const a of [
      { type: 'roll' },
      { type: 'toggle', die: 0 },
      { type: 'fill', slot: 1 },
      { type: 'auto' },
    ] as const) {
      reduce(s, a)
    }
    expect(deep(s)).toEqual(before)
  })

  it('相同输入两次调用结果完全相等', () => {
    const s = roll(create(303))
    expect(reduce(s, { type: 'roll' })).toEqual(reduce(s, { type: 'roll' }))
    expect(reduce(s, { type: 'toggle', die: 1 })).toEqual(reduce(s, { type: 'toggle', die: 1 }))
    expect(reduce(s, { type: 'auto' })).toEqual(reduce(s, { type: 'auto' }))
  })

  it('整局重放一致：同样 seed + 同样操作得到同样结果', () => {
    expect(playToEnd(20260913)).toEqual(playToEnd(20260913))
  })

  it('rules.ts 不含 Math.random / Date / performance / DOM', () => {
    // 用 Vite 的 ?raw 读源码，不依赖 @types/node
    const raw = import.meta.glob('./rules.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const src = raw['./rules.ts'] ?? ''
    expect(src.length).toBeGreaterThan(0)
    for (const bad of ['Math.random', 'new Date', 'performance.', 'document', 'window.']) {
      expect(src).not.toContain(bad)
    }
  })
})

// ---------------- meta 与布局 ----------------

describe('meta 与布局', () => {
  it('meta 同时有具名导出与默认导出，且内容一致', () => {
    expect(metaDefault).toBe(meta)
    expect(meta.id).toBe('yahtzee')
    expect(meta.name).toBe('快艇骰子')
  })

  it('meta 的逻辑坐标与单人设定符合规格', () => {
    expect(meta.viewport).toEqual({ width: 720, height: 1280 })
    expect(meta.orientation).toBe('portrait')
    expect(meta.players).toBe(1)
    expect(meta.category).toBe('card')
  })

  it('13 个计分格都排在 720×1280 内且互不重叠', () => {
    const rects = Array.from({ length: SLOT_COUNT }, (_, i) => slotRect(i))
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(720)
      expect(r.y + r.h).toBeLessThanOrEqual(1280)
      expect(r.w).toBeGreaterThanOrEqual(44)
      expect(r.h).toBeGreaterThanOrEqual(44)
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]
        const b = rects[j]
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlap).toBe(false)
      }
    }
  })

  it('命中测试能点中每一格与每一颗骰子', () => {
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const r = slotRect(slot)
      expect(hitSlot({ x: r.x + r.w / 2, y: r.y + r.h / 2 })).toBe(slot)
    }
    for (let i = 0; i < DIE_COUNT; i++) {
      expect(hitDie({ x: dieCenter(i)[0], y: dieCenter(i)[1] })).toBe(i)
    }
    expect(hitSlot({ x: 5, y: 1200 })).toBe(-1)
    expect(hitDie({ x: 5, y: 1200 })).toBe(-1)
  })
})
