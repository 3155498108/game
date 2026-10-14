import { describe, expect, it } from 'vitest'
import {
  COLOR_COUNT,
  MAX_ROUND,
  create,
  expected,
  isValidColor,
  pick,
  ready,
  reduce,
  remaining,
  type State,
} from './rules'

const ALL_COLORS = [0, 1, 2, 3]

/** 用正确答案打完当前这一轮，返回轮次结束后的状态 */
function playRound(s: State): State {
  let cur = ready(s)
  while (cur.phase === 'input') cur = reduce(cur, { type: 'pick', color: cur.sequence[cur.step] })
  return cur
}

/** 自动一路答对到通关 */
function playToEnd(s: State): State {
  let cur = s
  let guard = 0
  while (cur.phase !== 'won' && cur.phase !== 'over' && guard++ < MAX_ROUND + 2) cur = playRound(cur)
  return cur
}

/** 任意一个错误的颜色 */
const wrongColor = (s: State): number => (s.sequence[s.step] + 1) % COLOR_COUNT

describe('初始状态', () => {
  it('开局即第 1 轮：序列长度为 1、阶段为 show', () => {
    const s = create(42)
    expect(s.sequence.length).toBe(1)
    expect(s.phase).toBe('show')
    expect(s.round).toBe(1)
    expect(s.step).toBe(0)
    expect(s.hits).toBe(0)
    expect(s.lastPick).toBe(-1)
    expect(s.lastWrong).toBe(false)
  })

  it('不同种子都给出合法序列，且长度与轮次一致', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = create(seed * 7919)
      expect(s.sequence.length).toBe(s.round)
      expect(s.sequence.every((c) => isValidColor(c))).toBe(true)
    }
  })
})

describe('阶段机', () => {
  it('ready 把阶段从 show 切到 input，并清空答对步数', () => {
    const s = create(7)
    const n = reduce(s, { type: 'ready' })
    expect(n.phase).toBe('input')
    expect(n.step).toBe(0)
    expect(n.sequence).toEqual(s.sequence)
  })

  it('展示阶段玩家点色块无效（返回同一对象）', () => {
    const s = create(7)
    for (const c of ALL_COLORS) {
      expect(reduce(s, { type: 'pick', color: c })).toBe(s)
    }
    expect(s.step).toBe(0)
    expect(s.phase).toBe('show')
  })

  it('输入阶段重复提交 ready 是空操作', () => {
    const s = ready(create(7))
    expect(reduce(s, { type: 'ready' })).toBe(s)
  })

  it('非法颜色取值不改变状态', () => {
    const s = ready(create(7))
    expect(reduce(s, { type: 'pick', color: -1 })).toBe(s)
    expect(reduce(s, { type: 'pick', color: COLOR_COUNT })).toBe(s)
    expect(reduce(s, { type: 'pick', color: 1.5 })).toBe(s)
  })

  it('点对色块 → step +1，且停在输入阶段', () => {
    const s = playRound(create(3)) // 打完第 1 轮 → 第 2 轮，序列长度 2
    expect(s.phase).toBe('show')
    expect(s.sequence.length).toBe(2)
    const cur = reduce(s, { type: 'ready' })
    const want = expected(cur)
    const n = reduce(cur, { type: 'pick', color: want })
    expect(n.phase).toBe('input')
    expect(n.step).toBe(1)
    expect(n.lastPick).toBe(want)
    expect(n.lastWrong).toBe(false)
    expect(n.hits).toBe(2) // 累计：第 1 轮的 1 次 + 本次
    expect(remaining(n)).toBe(1)
  })

  it('step 达到序列长度 → 该轮完成：回到 show 且序列追加一个颜色', () => {
    const s = ready(create(11))
    const before = s.sequence.slice()
    const n = pick(s, s.sequence[0])
    expect(n.phase).toBe('show')
    expect(n.step).toBe(0)
    expect(n.round).toBe(2)
    expect(n.sequence.length).toBe(before.length + 1)
    expect(n.sequence.slice(0, before.length)).toEqual(before)
    expect(isValidColor(n.sequence[n.sequence.length - 1])).toBe(true)
  })

  it('每进入一轮，序列长度 +1（连续 4 轮）', () => {
    let s = create(5)
    for (let round = 1; round <= 4; round++) {
      expect(s.round).toBe(round)
      expect(s.sequence.length).toBe(round)
      s = playRound(s)
    }
    expect(s.phase).toBe('show')
    expect(s.round).toBe(5)
    expect(s.sequence.length).toBe(5)
  })

  it('连续多轮答对后，序列始终只含 4 种合法颜色', () => {
    const s = playToEnd(create(2026))
    expect(s.phase).toBe('won')
    expect(s.sequence.every((c) => ALL_COLORS.indexOf(c) >= 0)).toBe(true)
    expect(s.sequence.length).toBeLessThanOrEqual(MAX_ROUND)
  })
})

describe('失败与通关', () => {
  it('点错色块 → 立即结束，phase 为 over', () => {
    const s = ready(create(9))
    const n = pick(s, wrongColor(s))
    expect(n.phase).toBe('over')
    expect(n.lastWrong).toBe(true)
    expect(n.lastPick).toBe(wrongColor(s))
    expect(n.step).toBe(0)
    expect(n.round).toBe(1)
  })

  it('结束后不再接受点击与 ready', () => {
    const cur = ready(create(9))
    const over = pick(cur, wrongColor(cur))
    expect(over.phase).toBe('over')
    for (const c of ALL_COLORS) expect(reduce(over, { type: 'pick', color: c })).toBe(over)
    expect(reduce(over, { type: 'ready' })).toBe(over)
  })

  it('中途答错会记录到达的轮次', () => {
    let s = playRound(create(4)) // 打完第 1 轮 → 第 2 轮
    expect(s.round).toBe(2)
    s = reduce(s, { type: 'pick', color: ALL_COLORS[0] }) // 展示阶段点击无效
    expect(s.phase).toBe('show')
    s = ready(s)
    const n = pick(s, wrongColor(s))
    expect(n.phase).toBe('over')
    expect(n.round).toBe(2)
  })

  it('完成第 MAX_ROUND 轮 → phase 为 won，且序列长度不超过上限', () => {
    const s = playToEnd(create(1234))
    expect(s.phase).toBe('won')
    expect(s.round).toBe(MAX_ROUND)
    expect(s.sequence.length).toBe(MAX_ROUND)
    expect(s.step).toBe(0)
    expect(s.lastWrong).toBe(false)
  })

  it('通关后不再接受点击与 ready', () => {
    const won = playToEnd(create(1234))
    for (const c of ALL_COLORS) expect(reduce(won, { type: 'pick', color: c })).toBe(won)
    expect(reduce(won, { type: 'ready' })).toBe(won)
  })

  it('每个种子都能在有限步内分出胜负，不会卡住', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = playToEnd(create(seed * 104729))
      expect(s.phase === 'won' || s.phase === 'over').toBe(true)
    }
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参（rng / 序列 / step 全部原样）', () => {
    const s = ready(create(21))
    const seq = s.sequence.slice()
    const rng = s.rng
    const step = s.step
    const n = reduce(s, { type: 'pick', color: s.sequence[0] })
    expect(s.sequence).toEqual(seq)
    expect(s.rng).toBe(rng)
    expect(s.step).toBe(step)
    expect(s.phase).toBe('input')
    expect(n).not.toBe(s)
  })

  it('相同输入产生完全相同输出', () => {
    const s = ready(create(21))
    expect(reduce(s, { type: 'pick', color: s.sequence[0] })).toEqual(reduce(s, { type: 'pick', color: s.sequence[0] }))
  })

  it('create 对同一 seed 完全一致（可复盘）', () => {
    expect(create(8888)).toEqual(create(8888))
    const a = create(123)
    const b = create(123)
    expect(reduce(a, { type: 'ready' })).toEqual(reduce(b, { type: 'ready' }))
  })

  it('整局重放一致：同样的操作序列得到同样的最终状态', () => {
    const run = (): State => {
      let s = create(20260913)
      s = playRound(s)
      s = ready(s)
      return pick(s, wrongColor(s))
    }
    expect(run()).toEqual(run())
  })

  it('辅助函数与规则一致', () => {
    const s = ready(create(77))
    expect(isValidColor(0)).toBe(true)
    expect(isValidColor(3)).toBe(true)
    expect(isValidColor(4)).toBe(false)
    expect(expected(s)).toBe(s.sequence[s.step])
    expect(remaining(s)).toBe(s.sequence.length - s.step)
  })
})
