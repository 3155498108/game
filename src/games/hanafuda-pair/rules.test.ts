import { describe, expect, it } from 'vitest'
import {
  CARD_COUNT,
  DECK_SIZE,
  FLOWERS,
  MONTHS,
  PAIR_KINDS,
  create,
  flip,
  flowerOf,
  inBounds,
  inDeck,
  isComplete,
  kindLabel,
  makeKind,
  monthOf,
  partnerOf,
  reduce,
  type State,
} from './rules'

/**
 * 用一串字母直接指定牌面，例如 'abcdefghabcdefgh' 表示 a 与相距 8 位的 a 是一对。
 * 字母 → 花札标识 a..h 分别为 makeKind(0..7, 1)（同花、逐月递增，保证标识互不相同）。
 */
const LETTERS = 'abcdefgh'
function boardOf(spec: string): State {
  const kinds = spec.split('').map((c) => {
    const i = LETTERS.indexOf(c)
    if (i < 0) throw new Error('牌面不合法: ' + spec)
    return makeKind(i, 1)
  })
  if (kinds.length !== CARD_COUNT) throw new Error('牌面长度不合法: ' + spec)
  const base = create(1)
  return {
    ...base,
    kinds,
    up: kinds.map(() => false),
    pairs: 0,
    flips: 0,
    turns: 0,
    misses: 0,
    first: -1,
    second: -1,
    pending: false,
    matched: [],
    lastFlip: -1,
    hover: -1,
    won: false,
  }
}

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

const PAIRED = 'abcdefghabcdefgh'

describe('牌库与开局', () => {
  it('牌库是 12 个月 × 4 花 = 48 张', () => {
    expect(MONTHS).toBe(12)
    expect(FLOWERS).toBe(4)
    expect(DECK_SIZE).toBe(48)
  })

  it('牌面标识由月份 + 花组成，且可反解', () => {
    expect(makeKind(0, 0)).toBe(0)
    expect(makeKind(11, 3)).toBe(47)
    for (let m = 0; m < MONTHS; m++) {
      for (let f = 0; f < FLOWERS; f++) {
        const k = makeKind(m, f)
        expect(k).toBeGreaterThanOrEqual(0)
        expect(k).toBeLessThan(DECK_SIZE)
        expect(inDeck(k)).toBe(true)
        expect(monthOf(k)).toBe(m)
        expect(flowerOf(k)).toBe(f)
      }
    }
    expect(kindLabel(makeKind(0, 1))).toBe('正月梅')
    expect(kindLabel(makeKind(11, 0))).toBe('腊月松')
    expect(inDeck(DECK_SIZE)).toBe(false)
    expect(inDeck(-1)).toBe(false)
    expect(inDeck(1.5)).toBe(false)
  })

  it('开局 16 格全部背面朝上，计数全零', () => {
    const s = create(42)
    expect(s.kinds.length).toBe(CARD_COUNT)
    expect(s.up.every((v) => v === false)).toBe(true)
    expect(s.pairs).toBe(0)
    expect(s.flips).toBe(0)
    expect(s.turns).toBe(0)
    expect(s.misses).toBe(0)
    expect(s.first).toBe(-1)
    expect(s.second).toBe(-1)
    expect(s.hover).toBe(-1)
    expect(s.lastFlip).toBe(-1)
    expect(s.matched).toEqual([])
    expect(s.pending).toBe(false)
    expect(s.won).toBe(false)
    expect(isComplete(s)).toBe(false)
  })

  it('一局只用 48 张里的 8 种标识，每种恰好 2 张', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = create(seed * 7919)
      expect(s.kinds).toHaveLength(CARD_COUNT)
      expect(s.kinds.every(inDeck)).toBe(true)
      const counts = new Map<number, number>()
      for (const k of s.kinds) counts.set(k, (counts.get(k) ?? 0) + 1)
      expect(counts.size).toBe(PAIR_KINDS)
      for (const n of counts.values()) expect(n).toBe(2)
    }
  })

  it('create 对同一 seed 完全一致（可复盘）', () => {
    expect(create(123)).toEqual(create(123))
    expect(create(123).kinds).toEqual(create(123).kinds)
    expect(create(1).rng).toBe(create(1).rng)
  })

  it('不同 seed 仍然产出合法牌面，且开局多种多样', () => {
    const boards = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) {
      const s = create(seed)
      expect(s.kinds).toHaveLength(CARD_COUNT)
      expect(s.kinds.every(inDeck)).toBe(true)
      boards.add(s.kinds.join(','))
    }
    expect(boards.size).toBeGreaterThan(10)
  })
})

describe('翻牌与配对', () => {
  it('翻开第一张 → 该牌朝上，其余不动', () => {
    const s = boardOf(PAIRED)
    const n = flip(s, 0)
    expect(n.up[0]).toBe(true)
    expect(n.up.slice(1).every((v) => v === false)).toBe(true)
    expect(n.first).toBe(0)
    expect(n.second).toBe(-1)
    expect(n.pending).toBe(false)
    expect(n.flips).toBe(1)
    expect(n.turns).toBe(0)
    expect(n.pairs).toBe(0)
    expect(n.lastFlip).toBe(0)
    expect(n.won).toBe(false)
  })

  it('翻开两张同月同花 → 保持朝上并计一次配对（步数与翻牌次数）', () => {
    const s = flip(boardOf(PAIRED), 0)
    const n = flip(s, 8)
    expect(n.up[0]).toBe(true)
    expect(n.up[8]).toBe(true)
    expect(n.pairs).toBe(1)
    expect(n.flips).toBe(2)
    expect(n.turns).toBe(1)
    expect(n.misses).toBe(0)
    expect(n.pending).toBe(false)
    expect(n.first).toBe(-1)
    expect(n.second).toBe(-1)
    expect(n.matched).toEqual([0, 8])
  })

  it('翻开两张不同 → 两张留在朝上、进入待盖回，翻错计数 +1', () => {
    const s = flip(boardOf(PAIRED), 0)
    const n = flip(s, 1)
    expect(n.up[0]).toBe(true)
    expect(n.up[1]).toBe(true)
    expect(n.first).toBe(0)
    expect(n.second).toBe(1)
    expect(n.pending).toBe(true)
    expect(n.pairs).toBe(0)
    expect(n.flips).toBe(2)
    expect(n.turns).toBe(1)
    expect(n.misses).toBe(1)
    expect(n.matched).toEqual([])
  })

  it('配对判定只看牌面标识，与实体牌序号无关', () => {
    const s = boardOf(PAIRED)
    // 相邻的 0 号与 1 号是两种不同标识 → 不配对
    expect(s.kinds[0]).not.toBe(s.kinds[1])
    expect(flip(flip(s, 3), 4).pending).toBe(true)
    // 同一标识出现在相距 8 位的两格 → 配对
    expect(s.kinds[0]).toBe(s.kinds[8])
    expect(s.kinds[0]).not.toBe(s.kinds[1])
    expect(flip(flip(s, 3), 11).pairs).toBe(1)
    expect(partnerOf(s, 3)).toBe(11)
  })

  it('待盖回时翻第三张 → 被拒绝，返回原状态', () => {
    const s = flip(flip(boardOf(PAIRED), 0), 1)
    expect(s.pending).toBe(true)
    const n = reduce(s, { type: 'flip', index: 5 })
    expect(n).toBe(s)
    expect(n.up[5]).toBe(false)
    expect(n.flips).toBe(2)
  })

  it('settle 盖回两张不同的牌，计数不变', () => {
    const s = flip(flip(boardOf(PAIRED), 0), 1)
    const n = reduce(s, { type: 'settle' })
    expect(n.pending).toBe(false)
    expect(n.up[0]).toBe(false)
    expect(n.up[1]).toBe(false)
    expect(n.first).toBe(-1)
    expect(n.second).toBe(-1)
    expect(n.pairs).toBe(0)
    expect(n.flips).toBe(2)
    expect(n.turns).toBe(1)
    expect(n.misses).toBe(1)
  })

  it('不在待盖回状态时 settle 无效；配对成功的牌不会被盖回', () => {
    const s = boardOf(PAIRED)
    expect(reduce(s, { type: 'settle' })).toBe(s)
    const matched = flip(flip(s, 2), 10)
    expect(matched.pairs).toBe(1)
    const after = reduce(matched, { type: 'settle' })
    expect(after).toBe(matched)
    expect(after.up[2]).toBe(true)
    expect(after.up[10]).toBe(true)
  })

  it('盖回之后可以继续正常翻牌', () => {
    let s = flip(flip(boardOf(PAIRED), 0), 1)
    s = reduce(s, { type: 'settle' })
    s = flip(s, 0)
    expect(s.first).toBe(0)
    expect(s.flips).toBe(3)
    s = flip(s, 8)
    expect(s.pairs).toBe(1)
    expect(s.flips).toBe(4)
    expect(s.turns).toBe(2)
    expect(s.misses).toBe(1)
  })

  it('越界索引、非整数与已经朝上的牌都被拒绝', () => {
    const s = boardOf(PAIRED)
    expect(flip(s, -1)).toBe(s)
    expect(flip(s, CARD_COUNT)).toBe(s)
    expect(flip(s, 1.5)).toBe(s)
    expect(inBounds(0)).toBe(true)
    expect(inBounds(CARD_COUNT)).toBe(false)
    const opened = flip(s, 3)
    expect(flip(opened, 3)).toBe(opened)
    expect(partnerOf(s, -1)).toBe(-1)
  })

  it('hover / leave 只影响悬停，不影响牌面与计数', () => {
    const s = boardOf(PAIRED)
    const h = reduce(s, { type: 'hover', index: 6 })
    expect(h.hover).toBe(6)
    expect(h.kinds).toEqual(s.kinds)
    expect(h.up).toEqual(s.up)
    expect(h.flips).toBe(0)
    expect(reduce(h, { type: 'leave' }).hover).toBe(-1)
    expect(reduce(h, { type: 'hover', index: 6 })).toBe(h)
    expect(reduce(h, { type: 'hover', index: CARD_COUNT })).toBe(h)
  })
})

describe('通关', () => {
  it('配完最后一对 → 通关', () => {
    let s = boardOf(PAIRED)
    for (let k = 0; k < PAIR_KINDS - 1; k++) s = flip(flip(s, k), k + 8)
    expect(s.pairs).toBe(PAIR_KINDS - 1)
    expect(s.won).toBe(false)
    s = flip(flip(s, 7), 15)
    expect(s.pairs).toBe(PAIR_KINDS)
    expect(s.won).toBe(true)
    expect(isComplete(s)).toBe(true)
    expect(s.up.every((v) => v === true)).toBe(true)
    expect(s.flips).toBe(CARD_COUNT)
    expect(s.turns).toBe(PAIR_KINDS)
    expect(s.misses).toBe(0)
  })

  it('通关后不再接受任何动作', () => {
    const done = autoWin(2024)
    expect(done.won).toBe(true)
    expect(reduce(done, { type: 'flip', index: 0 })).toBe(done)
    expect(reduce(done, { type: 'settle' })).toBe(done)
    expect(reduce(done, { type: 'hover', index: 4 })).toBe(done)
    // leave 只清悬停，通关后的玩法字段一律不动
    const left = reduce(done, { type: 'leave' })
    expect(left.pairs).toBe(done.pairs)
    expect(left.flips).toBe(done.flips)
    expect(left.turns).toBe(done.turns)
    expect(left.won).toBe(done.won)
  })

  it('每一步都能配对时，一整局恰好翻 16 次牌', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = autoWin(seed * 7919)
      expect(s.won).toBe(true)
      expect(s.pairs).toBe(PAIR_KINDS)
      expect(s.flips).toBe(CARD_COUNT)
      expect(s.turns).toBe(PAIR_KINDS)
      expect(s.misses).toBe(0)
      expect(s.up.every((v) => v === true)).toBe(true)
      expect(s.pending).toBe(false)
    }
  })

  it('turns 恒等于 pairs + misses，翻牌次数与轮次一致', () => {
    const s0 = create(4242)
    const kinds = s0.kinds
    const partner = kinds.findIndex((k, i) => i > 0 && k === kinds[0])
    const other = kinds.findIndex((k, i) => i !== 0 && i !== partner && k !== kinds[0])
    const third = kinds.findIndex((k, i) => i !== 0 && i !== partner && i !== other && k !== kinds[0] && k !== kinds[other])
    let s = flip(s0, 0)
    s = flip(s, partner) // 配对成功 → pairs 1 / turns 1
    s = flip(s, other) // 翻错的第一张
    s = flip(s, third) // 翻错的第二张 → pending
    expect(s.pairs).toBe(1)
    expect(s.misses).toBe(1)
    expect(s.turns).toBe(s.pairs + s.misses)
    expect(s.flips).toBe(s.turns * 2)
    s = reduce(s, { type: 'settle' })
    expect(s.turns).toBe(2)
    expect(s.misses).toBe(1)
    expect(s.won).toBe(false)
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参', () => {
    const s = flip(flip(boardOf(PAIRED), 0), 1)
    const before = JSON.stringify(s)
    const next = reduce(s, { type: 'settle' })
    expect(JSON.stringify(s)).toBe(before)
    expect(s.kinds).toEqual(boardOf(PAIRED).kinds)
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
    const s = flip(boardOf(PAIRED), 0)
    expect(reduce(s, { type: 'flip', index: 8 })).toEqual(reduce(s, { type: 'flip', index: 8 }))
    expect(reduce(s, { type: 'hover', index: 3 })).toEqual(reduce(s, { type: 'hover', index: 3 }))
    expect(reduce(s, { type: 'flip', index: 4 })).toEqual(reduce(s, { type: 'flip', index: 4 }))
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
    const s = boardOf(PAIRED)
    expect(reduce(s, { type: 'flip', index: CARD_COUNT })).toBe(s)
    expect(reduce(s, { type: 'leave' })).toBe(s)
    expect(reduce(s, { type: 'settle' })).toBe(s)
  })

  it('重复洗牌重新开局可复现：同一 seed 反复开局结果一致', () => {
    const deals = Array.from({ length: 5 }, () => create(31337))
    for (const d of deals) expect(d).toEqual(deals[0])
    expect(deals[0].up.every((v) => v === false)).toBe(true)
  })
})
