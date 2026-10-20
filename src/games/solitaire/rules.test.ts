import { describe, expect, it } from 'vitest'
import { SUITS, type Card, type Suit } from '../../core/cards'
import {
  FOUNDATION_COUNT,
  PILE_COUNT,
  PILE_FOUNDATION_BASE,
  PILE_STOCK,
  PILE_WASTE,
  TABLEAU_COUNT,
  type Action,
  type Pile,
  type State,
  canGrab,
  canPlace,
  canPlaceOnFoundation,
  canStackOn,
  create,
  draw,
  foundationCount,
  isValidRun,
  isWon,
  legalTargets,
  reduce,
} from './rules'

/** 造一张牌（id 只要唯一即可，规则层不依赖它的数值） */
function c(suit: Suit, rank: number): Card {
  return { id: SUITS.indexOf(suit) * 100 + rank, suit, rank }
}

/** 造一个状态：13 堆，桌面堆 0..6，牌堆 7，弃牌堆 8，基础堆 9..12 */
function stateOf(spec: Array<{ down?: Card[]; up?: Card[] }>): State {
  const piles: Pile[] = []
  for (let i = 0; i < PILE_COUNT; i++) {
    const s = spec[i] ?? {}
    piles.push({ down: (s.down ?? []).slice(), up: (s.up ?? []).slice() })
  }
  return { piles, selected: null, targets: [], moves: 0, redeals: 0, phase: 'play', rng: 0 }
}

const empty = (): Array<{ down?: Card[]; up?: Card[] }> => new Array(PILE_COUNT).fill(null).map(() => ({}))

describe('初始发牌', () => {
  it('七堆桌面分别 1..7 张，只有最上面一张摊开', () => {
    const s = create(42)
    for (let i = 0; i < TABLEAU_COUNT; i++) {
      const p = s.piles[i]
      expect(p.down.length, `第 ${i + 1} 堆扣着的牌数不对`).toBe(i)
      expect(p.up.length, `第 ${i + 1} 堆摊开的牌数不对`).toBe(1)
    }
  })

  it('牌堆 24 张、弃牌堆空、四个基础堆空', () => {
    const s = create(42)
    expect(s.piles[PILE_STOCK].down.length).toBe(24)
    expect(s.piles[PILE_WASTE].up.length).toBe(0)
    for (let f = 0; f < FOUNDATION_COUNT; f++) {
      expect(s.piles[PILE_FOUNDATION_BASE + f].up.length).toBe(0)
    }
  })

  it('52 张牌一张不多一张不少，且没有重复', () => {
    const s = create(7)
    const all = s.piles.flatMap((p) => [...p.down, ...p.up])
    expect(all.length).toBe(52)
    expect(new Set(all.map((x) => x.id)).size).toBe(52)
  })

  it('不同种子发的牌不一样', () => {
    const a = create(1).piles.flatMap((p) => [...p.down, ...p.up]).map((x) => x.id)
    const b = create(2).piles.flatMap((p) => [...p.down, ...p.up]).map((x) => x.id)
    expect(a).not.toEqual(b)
  })
})

describe('翻牌', () => {
  it('从牌堆翻一张到弃牌堆，牌堆少一张', () => {
    const s = create(42)
    const after = draw(s)
    expect(after.piles[PILE_STOCK].down.length).toBe(23)
    expect(after.piles[PILE_WASTE].up.length).toBe(1)
    // 翻出来的是牌堆最上面那张
    expect(after.piles[PILE_WASTE].up[0].id).toBe(s.piles[PILE_STOCK].down[23].id)
  })

  it('牌堆空了就把弃牌堆翻回去，次数不限', () => {
    let s = create(42)
    for (let i = 0; i < 24; i++) s = draw(s)
    expect(s.piles[PILE_STOCK].down.length).toBe(0)
    expect(s.piles[PILE_WASTE].up.length).toBe(24)
    const back = draw(s)
    expect(back.piles[PILE_STOCK].down.length).toBe(24)
    expect(back.piles[PILE_WASTE].up.length).toBe(0)
    expect(back.redeals).toBe(1)
  })

  it('翻回去之后还能再翻出来，牌不会丢', () => {
    let s = create(42)
    for (let i = 0; i < 24; i++) s = draw(s)
    s = draw(s) // 翻回
    s = draw(s) // 再翻一张
    const all = s.piles.flatMap((p) => [...p.down, ...p.up])
    expect(all.length).toBe(52)
  })
})

describe('基础堆规则', () => {
  it('空基础堆只收 A', () => {
    expect(canPlaceOnFoundation(c('S', 1), [])).toBe(true)
    expect(canPlaceOnFoundation(c('S', 2), [])).toBe(false)
  })

  it('必须同花色、点数大 1', () => {
    const f = [c('S', 1), c('S', 2)]
    expect(canPlaceOnFoundation(c('S', 3), f)).toBe(true)
    expect(canPlaceOnFoundation(c('H', 3), f)).toBe(false)
    expect(canPlaceOnFoundation(c('S', 4), f)).toBe(false)
  })

  it('基础堆一次只能接一张', () => {
    const s = stateOf(empty())
    expect(canPlace(s, [c('S', 1), c('H', 1)], PILE_FOUNDATION_BASE)).toBe(false)
  })
})

describe('桌面堆规则', () => {
  it('异色且点数大 1 才能叠', () => {
    expect(canStackOn(c('S', 5), c('H', 6))).toBe(true) // 黑 → 红，异色
    expect(canStackOn(c('H', 5), c('D', 6))).toBe(false) // 红 → 红，同色
    expect(canStackOn(c('S', 5), c('H', 5))).toBe(false) // 点数不对
  })

  it('空的桌面堆只收 K', () => {
    const s = stateOf(empty())
    expect(canPlace(s, [c('S', 13)], 0)).toBe(true)
    expect(canPlace(s, [c('S', 12)], 0)).toBe(false)
  })

  it('合法连牌判定', () => {
    expect(isValidRun([c('H', 7), c('S', 6), c('D', 5)])).toBe(true)
    expect(isValidRun([c('H', 7), c('H', 6)])).toBe(false)
  })
})

describe('抓牌与移动', () => {
  it('桌面堆可以抓摊开的牌，扣着的抓不了', () => {
    const s = stateOf([
      { down: [c('S', 1)], up: [c('H', 5)] },
      ...empty().slice(1),
    ])
    expect(canGrab(s, 0, 0)).toBe(true)
    expect(canGrab(s, 0, 5)).toBe(false)
  })

  it('弃牌堆与基础堆只能抓最上面一张', () => {
    const s = stateOf([
      ...empty().slice(0, PILE_WASTE),
      { up: [c('H', 5), c('S', 4)] },
      { up: [c('H', 9), c('S', 10)] },
    ])
    expect(canGrab(s, PILE_WASTE, 0)).toBe(true)
    expect(canGrab(s, PILE_WASTE, 1)).toBe(false)
    expect(canGrab(s, PILE_FOUNDATION_BASE, 0)).toBe(true)
  })

  it('牌堆不能抓（点它等于翻牌）', () => {
    const s = create(42)
    expect(canGrab(s, PILE_STOCK, 0)).toBe(false)
  })

  it('移动一张牌：源堆少一张，目标堆多一张', () => {
    const s = stateOf([
      { up: [c('H', 5)] },
      { up: [c('S', 6)] },
      ...empty().slice(2),
    ])
    // 选第一堆的 H5，放到第二堆的 S6 上（异色递减）
    const sel = reduce(s, { type: 'tap', pile: 0, index: 0 })
    expect(sel.selected).not.toBeNull()
    const moved = reduce(sel, { type: 'tap', pile: 1, index: 0 })
    expect(moved.piles[0].up.length).toBe(0)
    expect(moved.piles[1].up.length).toBe(2)
    expect(moved.piles[1].up[1].id).toBe(c('H', 5).id)
    expect(moved.moves).toBe(1)
  })

  it('连牌可以一起搬走', () => {
    const s = stateOf([
      { up: [c('H', 7), c('S', 6), c('D', 5)] },
      { up: [c('C', 8)] },
      ...empty().slice(2),
    ])
    const sel = reduce(s, { type: 'tap', pile: 0, index: 0 })
    const moved = reduce(sel, { type: 'tap', pile: 1, index: 0 })
    expect(moved.piles[0].up.length).toBe(0)
    expect(moved.piles[1].up.length).toBe(4)
  })

  it('搬走之后露出底下的牌会自动翻面', () => {
    const s = stateOf([
      { down: [c('S', 1), c('H', 2)], up: [c('D', 9)] },
      { up: [c('C', 10)] },
      ...empty().slice(2),
    ])
    const sel = reduce(s, { type: 'tap', pile: 0, index: 0 })
    const moved = reduce(sel, { type: 'tap', pile: 1, index: 0 })
    expect(moved.piles[0].down.length).toBe(1)
    expect(moved.piles[0].up.length).toBe(1)
    expect(moved.piles[0].up[0].id).toBe(c('H', 2).id)
  })

  it('非法落点不会被当成落点（牌不会跑到不合法的地方）', () => {
    const s = stateOf([
      { up: [c('H', 5)] },
      { up: [c('H', 6)] }, // 同色，不能叠
      ...empty().slice(2),
    ])
    const sel = reduce(s, { type: 'tap', pile: 0, index: 0 })
    expect(sel.targets).not.toContain(1)
    const after = reduce(sel, { type: 'tap', pile: 1, index: 0 })
    expect(after.piles[0].up.length).toBe(1)
    expect(after.piles[1].up.length).toBe(1)
  })

  it('基础堆顶牌可以移回桌面堆', () => {
    const s = stateOf([
      ...empty().slice(0, 1),
      { up: [c('H', 10)] }, // 桌面堆 1：红桃 10
      ...empty().slice(2, PILE_FOUNDATION_BASE),
      { up: [c('C', 9)] }, // 基础堆 0：梅花 9
    ])
    const sel = reduce(s, { type: 'tap', pile: PILE_FOUNDATION_BASE, index: 0 })
    expect(sel.selected).not.toBeNull()
    expect(sel.targets).toContain(1)
    const moved = reduce(sel, { type: 'tap', pile: 1, index: 0 })
    expect(moved.piles[PILE_FOUNDATION_BASE].up.length).toBe(0)
    expect(moved.piles[1].up.length).toBe(2)
  })
})

describe('选择与取消', () => {
  it('再点同一张牌取消选择', () => {
    const s = stateOf([{ up: [c('H', 5)] }, ...empty().slice(1)])
    const sel = reduce(s, { type: 'tap', pile: 0, index: 0 })
    expect(sel.selected).not.toBeNull()
    const off = reduce(sel, { type: 'tap', pile: 0, index: 0 })
    expect(off.selected).toBeNull()
    expect(off.targets.length).toBe(0)
  })

  it('点扣着的牌：取消选择', () => {
    const s = stateOf([{ down: [c('S', 1)], up: [c('H', 5)] }, ...empty().slice(1)])
    const sel = reduce(s, { type: 'tap', pile: 0, index: 0 })
    const off = reduce(sel, { type: 'tap', pile: 0, index: 3 })
    expect(off.selected).toBeNull()
  })

  it('选中的牌会算出合法落点', () => {
    const s = stateOf([
      { up: [c('H', 5)] },
      { up: [c('S', 6)] },
      { up: [c('S', 13)] },
      ...empty().slice(3),
    ])
    const sel = reduce(s, { type: 'tap', pile: 0, index: 0 })
    expect(sel.targets).toContain(1)
    expect(sel.targets).not.toContain(2)
  })

  it('合法落点的计算与 state 里登记的一致', () => {
    const s = stateOf([
      { up: [c('H', 5)] },
      { up: [c('S', 6)] },
      ...empty().slice(2),
    ])
    const sel = reduce(s, { type: 'tap', pile: 0, index: 0 })
    expect(sel.targets).toEqual(legalTargets(sel, sel.selected!))
  })
})

describe('自动上基础堆与结束', () => {
  it('auto 会把 A 送上基础堆', () => {
    const s = stateOf([
      { up: [c('S', 1)] },
      ...empty().slice(1),
    ])
    const after = reduce(s, { type: 'auto' })
    expect(foundationCount(after)).toBe(1)
    expect(after.piles[PILE_FOUNDATION_BASE].up[0].rank).toBe(1)
  })

  it('auto 没有可送的牌时不动', () => {
    const s = stateOf([{ up: [c('S', 7)] }, ...empty().slice(1)])
    expect(reduce(s, { type: 'auto' })).toBe(s)
  })

  it('放弃本局 → 结束，分数是已完成张数', () => {
    const s = stateOf([
      { up: [c('S', 1)] },
      ...empty().slice(1),
    ])
    const over = reduce(s, { type: 'giveUp' })
    expect(over.phase).toBe('over')
  })

  it('结束后不能再动（除了重新开始）', () => {
    const over = reduce(stateOf(empty()), { type: 'giveUp' })
    expect(reduce(over, { type: 'draw' })).toBe(over)
    const fresh = reduce(over, { type: 'newGame' })
    expect(fresh.phase).toBe('play')
    expect(fresh.moves).toBe(0)
  })

  it('52 张全上基础堆 = 通关', () => {
    const piles: Array<{ down?: Card[]; up?: Card[] }> = new Array(PILE_COUNT).fill(null).map(() => ({}))
    for (let f = 0; f < FOUNDATION_COUNT; f++) {
      const suit = SUITS[f]
      const cards: Card[] = []
      for (let rank = 1; rank <= 13; rank++) cards.push(c(suit, rank))
      piles[PILE_FOUNDATION_BASE + f] = { up: cards }
    }
    const s = stateOf(piles)
    expect(foundationCount(s)).toBe(52)
    expect(isWon(s)).toBe(true)
  })
})

describe('复盘性', () => {
  it('同 seed + 同操作序列 → 完全相同的结果', () => {
    const ops: Action[] = [
      { type: 'draw' },
      { type: 'draw' },
      { type: 'tap', pile: 0, index: 0 },
      { type: 'tap', pile: PILE_WASTE, index: 0 },
    ]
    const run = () => {
      let s = create(2026)
      for (const o of ops) s = reduce(s, o)
      return s
    }
    const a = run()
    const b = run()
    expect(a.piles.map((p) => p.up.map((c2) => c2.id))).toEqual(b.piles.map((p) => p.up.map((c2) => c2.id)))
    expect(a.moves).toBe(b.moves)
    expect(a.selected).toEqual(b.selected)
  })
})
