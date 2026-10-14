import { describe, expect, it } from 'vitest'
import {
  CARD_COUNT,
  PAIR_KINDS,
  create,
  flip,
  inBounds,
  isComplete,
  partnerOf,
  reduce,
  type State,
} from './rules'

/** 用一段字符串直接指定牌面，例如 '0123456701234567' 表示 0/0 相距 8 位成对 */
function stateOf(spec: string): State {
  const faces = spec.split('').map((c) => Number(c))
  if (faces.length !== CARD_COUNT || faces.some((f) => !inBounds(f))) throw new Error('牌面不合法: ' + spec)
  const base = create(1)
  return {
    ...base,
    faces,
    up: faces.map(() => false),
    pairs: 0,
    flips: 0,
    first: -1,
    second: -1,
    pending: false,
    matched: [],
    lastFlip: -1,
    hover: -1,
    won: false,
  }
}

/** 同一图案成对出现的牌面：0 与 8、1 与 9 …… */
const PAIRED = '0123456701234567'

/** 每一步都能配对的一整局，用来验证必然可通关 */
function autoWin(seed: number): State {
  let s = create(seed)
  let guard = 0
  while (!s.won && guard++ < 200) {
    if (s.pending) {
      s = reduce(s, { type: 'settle' })
      continue
    }
    const i = s.up.findIndex((v) => !v)
    if (i < 0) break
    s = reduce(s, { type: 'flip', index: i })
    if (s.first < 0) break // 防御：不该发生，走了就说明规则有问题
    const other = partnerOf(s, i)
    expect(other).toBeGreaterThanOrEqual(0)
    s = reduce(s, { type: 'flip', index: other })
  }
  return s
}

describe('初始局面', () => {
  it('16 张牌、8 种图案各 2 次、全部背面朝上、未通关', () => {
    const s = create(42)
    expect(s.faces.length).toBe(CARD_COUNT)
    expect(s.faces.every((f) => f >= 0 && f < PAIR_KINDS)).toBe(true)
    const counts = new Array<number>(PAIR_KINDS).fill(0)
    for (const f of s.faces) counts[f] += 1
    expect(counts).toEqual(new Array<number>(PAIR_KINDS).fill(2))
    expect(s.up.every((v) => v === false)).toBe(true)
    expect(s.won).toBe(false)
    expect(s.pending).toBe(false)
    expect(isComplete(s)).toBe(false)
  })

  it('初始计数全为零，first/second/hover 均为 -1', () => {
    const s = create(7)
    expect(s.pairs).toBe(0)
    expect(s.flips).toBe(0)
    expect(s.first).toBe(-1)
    expect(s.second).toBe(-1)
    expect(s.lastFlip).toBe(-1)
    expect(s.hover).toBe(-1)
    expect(s.matched).toEqual([])
  })

  it('create 对同一 seed 完全一致（可复盘），不同 seed 仍是合法牌面', () => {
    expect(create(123)).toEqual(create(123))
    expect(create(1).faces).not.toEqual(create(2).faces)
    expect(create(999).faces.every((f) => f >= 0 && f < PAIR_KINDS)).toBe(true)
  })
})

describe('翻牌', () => {
  it('翻开第一张 → 该牌朝上，其余不动', () => {
    const s = stateOf(PAIRED)
    const n = flip(s, 0)
    expect(n.up[0]).toBe(true)
    expect(n.up.slice(1).every((v) => v === false)).toBe(true)
    expect(n.first).toBe(0)
    expect(n.second).toBe(-1)
    expect(n.pending).toBe(false)
    expect(n.flips).toBe(1)
    expect(n.pairs).toBe(0)
    expect(n.lastFlip).toBe(0)
    expect(n.won).toBe(false)
  })

  it('翻开两张相同 → 两张保持朝上、配对数 +1、翻牌次数 +2', () => {
    const s = flip(stateOf(PAIRED), 0)
    const n = flip(s, 8)
    expect(n.up[0]).toBe(true)
    expect(n.up[8]).toBe(true)
    expect(n.pairs).toBe(1)
    expect(n.flips).toBe(2)
    expect(n.pending).toBe(false)
    expect(n.first).toBe(-1)
    expect(n.second).toBe(-1)
    expect(n.matched).toEqual([0, 8])
    expect(n.won).toBe(false)
  })

  it('翻开两张不同 → 进入待盖回状态（两张朝上但未配对）', () => {
    const s = flip(stateOf(PAIRED), 0)
    const n = flip(s, 1)
    expect(n.up[0]).toBe(true)
    expect(n.up[1]).toBe(true)
    expect(n.first).toBe(0)
    expect(n.second).toBe(1)
    expect(n.pending).toBe(true)
    expect(n.pairs).toBe(0)
    expect(n.flips).toBe(2)
    expect(n.matched).toEqual([])
  })

  it('待盖回状态下翻第三张 → 被拒绝，状态原样不变', () => {
    const s = flip(flip(stateOf(PAIRED), 0), 1)
    expect(s.pending).toBe(true)
    const n = reduce(s, { type: 'flip', index: 5 })
    expect(n).toBe(s)
    expect(n.up[5]).toBe(false)
    expect(n.flips).toBe(2)
  })

  it('盖回（settle）→ 两张不同的牌都盖回、配对数不变', () => {
    const s = flip(flip(stateOf(PAIRED), 0), 1)
    const n = reduce(s, { type: 'settle' })
    expect(n.pending).toBe(false)
    expect(n.up[0]).toBe(false)
    expect(n.up[1]).toBe(false)
    expect(n.first).toBe(-1)
    expect(n.second).toBe(-1)
    expect(n.pairs).toBe(0)
    expect(n.flips).toBe(2)
  })

  it('不在待盖回状态时 settle 无效', () => {
    const s = stateOf(PAIRED)
    expect(reduce(s, { type: 'settle' })).toBe(s)
    const matched = flip(flip(s, 0), 8)
    expect(reduce(matched, { type: 'settle' })).toBe(matched)
  })

  it('盖回后可以继续正常翻牌', () => {
    let s = flip(flip(stateOf(PAIRED), 0), 1)
    s = reduce(s, { type: 'settle' })
    s = flip(s, 0)
    expect(s.first).toBe(0)
    expect(s.flips).toBe(3)
    s = flip(s, 8)
    expect(s.pairs).toBe(1)
    expect(s.flips).toBe(4)
  })

  it('越界索引与已经朝上的牌都被拒绝', () => {
    const s = stateOf(PAIRED)
    expect(flip(s, -1)).toBe(s)
    expect(flip(s, CARD_COUNT)).toBe(s)
    expect(flip(s, 1.5)).toBe(s)
    const opened = flip(s, 3)
    expect(flip(opened, 3)).toBe(opened)
  })

  it('配对成功的牌不会被再次盖回', () => {
    const matched = flip(flip(stateOf(PAIRED), 2), 10)
    expect(matched.pairs).toBe(1)
    const after = reduce(matched, { type: 'settle' })
    expect(after.up[2]).toBe(true)
    expect(after.up[10]).toBe(true)
  })

  it('hover / leave 只影响悬停，不影响牌面与计数', () => {
    const s = stateOf(PAIRED)
    const h = reduce(s, { type: 'hover', index: 6 })
    expect(h.hover).toBe(6)
    expect(h.faces).toEqual(s.faces)
    expect(h.up).toEqual(s.up)
    expect(h.flips).toBe(0)
    expect(reduce(h, { type: 'leave' }).hover).toBe(-1)
    expect(reduce(h, { type: 'hover', index: 6 })).toBe(h)
    expect(reduce(h, { type: 'hover', index: CARD_COUNT })).toBe(h)
  })
})

describe('通关', () => {
  it('配完最后一对 → 通关状态', () => {
    let s = stateOf(PAIRED)
    for (let k = 0; k < PAIR_KINDS - 1; k++) s = flip(flip(s, k), k + 8)
    expect(s.pairs).toBe(PAIR_KINDS - 1)
    expect(s.won).toBe(false)
    s = flip(flip(s, 7), 15)
    expect(s.pairs).toBe(PAIR_KINDS)
    expect(s.won).toBe(true)
    expect(isComplete(s)).toBe(true)
    expect(s.up.every((v) => v === true)).toBe(true)
    expect(s.flips).toBe(CARD_COUNT)
  })

  it('通关后不再接受任何动作', () => {
    const done = autoWin(2024)
    expect(done.won).toBe(true)
    expect(reduce(done, { type: 'flip', index: 0 })).toBe(done)
    expect(reduce(done, { type: 'settle' })).toBe(done)
    expect(reduce(done, { type: 'hover', index: 4 })).toBe(done)
  })

  it('每一步都能配对时，一整局恰好翻 16 次牌', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = autoWin(seed * 7919)
      expect(s.won).toBe(true)
      expect(s.pairs).toBe(PAIR_KINDS)
      expect(s.flips).toBe(CARD_COUNT)
      expect(s.up.every((v) => v === true)).toBe(true)
      expect(s.pending).toBe(false)
    }
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参（rng / faces / up / 计数全部原样）', () => {
    const s = flip(flip(stateOf(PAIRED), 0), 1)
    const before = JSON.stringify(s)
    const next = reduce(s, { type: 'settle' })
    expect(JSON.stringify(s)).toBe(before)
    expect(s.faces).toEqual(stateOf(PAIRED).faces)
    expect(s.up[0]).toBe(true)
    expect(s.up[1]).toBe(true)
    expect(s.pending).toBe(true)
    expect(s.flips).toBe(2)
    expect(s.rng).toBe(create(1).rng)
    // 新状态必须是新对象与新数组
    expect(next).not.toBe(s)
    expect(next.up).not.toBe(s.up)
  })

  it('相同输入两次调用结果完全相等', () => {
    const s = flip(stateOf(PAIRED), 0)
    expect(reduce(s, { type: 'flip', index: 8 })).toEqual(reduce(s, { type: 'flip', index: 8 }))
    expect(reduce(s, { type: 'hover', index: 3 })).toEqual(reduce(s, { type: 'hover', index: 3 }))
  })

  it('同一串动作的完整过程可复盘', () => {
    const play = (): State => {
      let s = create(555)
      s = reduce(s, { type: 'flip', index: 2 })
      s = reduce(s, { type: 'flip', index: 7 })
      s = reduce(s, { type: 'settle' })
      s = reduce(s, { type: 'flip', index: partnerOf(s, 2) })
      return s
    }
    expect(play()).toEqual(play())
  })

  it('被拒绝的动作用于返回原状态引用（不产生无谓的新对象）', () => {
    const s = stateOf(PAIRED)
    expect(reduce(s, { type: 'flip', index: CARD_COUNT })).toBe(s)
    expect(reduce(s, { type: 'leave' })).toBe(s)
    expect(reduce(s, { type: 'settle' })).toBe(s)
  })
})
