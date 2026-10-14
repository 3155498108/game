import { describe, expect, it } from 'vitest'
import { DECK_SIZE, create, guess, isHit, remaining, reduce, type Dir, type State } from './rules'
import type { Card, Suit } from '../../core/cards'

/** 构造一张指定点数的牌 */
function card(rank: number, suit: Suit = 'S', id = 0): Card {
  return { id, suit, rank }
}

/**
 * 构造一个完全可控的局面：deck 为按顺序发出的牌，deck[0] 就是当前牌。
 * 默认全用 52 张牌占位，保证「牌堆已生成且为 52 张」的语义不被破坏。
 */
function stateWith(first: Card[], opts: Partial<State> = {}): State {
  const base = create(20240101)
  const deck = first.slice()
  const current = deck[0]
  return {
    ...base,
    deck,
    used: [current],
    cursor: 1,
    current,
    prevCard: null,
    lastCard: null,
    lastGuess: null,
    lastHit: null,
    score: 0,
    streak: 0,
    best: 0,
    round: 0,
    reshuffles: 0,
    over: false,
    ...opts,
  }
}

/** 一个「当前牌 7，下一张 9」的顺子局面，后面补满占位牌 */
function rising(firstCard = card(7, 'S'), nextCard = card(9, 'H')): State {
  const filler = Array.from({ length: DECK_SIZE - 2 }, (_, i) => card(2, 'C', i + 2))
  return stateWith([firstCard, nextCard, ...filler])
}

describe('初始状态', () => {
  it('牌堆为 52 张互不相同的牌，当前牌已确定，局未开始', () => {
    const s = create(42)
    expect(s.deck.length).toBe(DECK_SIZE)
    expect(new Set(s.deck.map((c) => c.id)).size).toBe(DECK_SIZE)
    expect(s.current).not.toBeNull()
    expect(s.current).toEqual(s.deck[0])
    expect(s.used.length).toBe(1)
    expect(s.cursor).toBe(1)
    expect(remaining(s)).toBe(DECK_SIZE - 1)
    expect(s.over).toBe(false)
    expect(s.score).toBe(0)
    expect(s.streak).toBe(0)
    expect(s.best).toBe(0)
    expect(s.round).toBe(0)
  })

  it('当前牌是一张合法的 52 张牌里的牌', () => {
    const s = create(7)
    const c = s.current as Card
    expect(c.rank).toBeGreaterThanOrEqual(1)
    expect(c.rank).toBeLessThanOrEqual(13)
    expect(['S', 'H', 'D', 'C']).toContain(c.suit)
  })
})

describe('猜测结算', () => {
  it('猜大且下一张更大：连对与得分递增，当前牌更新为新翻开的牌', () => {
    const s = rising()
    const n = guess(s, 'higher')
    expect(n.lastHit).toBe(true)
    expect(n.score).toBe(1)
    expect(n.streak).toBe(1)
    expect(n.best).toBe(1)
    expect(n.round).toBe(1)
    expect(n.over).toBe(false)
    expect(n.current).toEqual(card(9, 'H'))
    expect(n.lastCard).toEqual(card(9, 'H'))
    expect(n.prevCard).toEqual(card(7, 'S'))
    expect(n.lastGuess).toBe('higher')
    expect(n.cursor).toBe(2)
    expect(n.used.length).toBe(2)
  })

  it('猜小且下一张更小同样算中', () => {
    const s = rising(card(9, 'D'), card(4, 'C'))
    const n = guess(s, 'lower')
    expect(n.lastHit).toBe(true)
    expect(n.score).toBe(1)
    expect(n.current).toEqual(card(4, 'C'))
    expect(n.over).toBe(false)
  })

  it('猜大但下一张更小：判错并结束游戏，得分不变', () => {
    const s = rising(card(9, 'D'), card(4, 'C'))
    const n = guess(s, 'higher')
    expect(n.lastHit).toBe(false)
    expect(n.over).toBe(true)
    expect(n.score).toBe(0)
    expect(n.streak).toBe(0)
    expect(n.current).toEqual(card(9, 'D'))
    expect(n.lastCard).toEqual(card(4, 'C'))
  })

  it('猜小但下一张更大：判错并结束游戏', () => {
    const s = rising()
    const n = guess(s, 'lower')
    expect(n.over).toBe(true)
    expect(n.score).toBe(0)
    expect(n.current).toEqual(card(7, 'S'))
  })

  it('结束后不再接受猜测，且返回同一个状态', () => {
    const over = guess(rising(), 'lower')
    expect(over.over).toBe(true)
    expect(guess(over, 'higher')).toBe(over)
    expect(reduce(over, { type: 'guess', dir: 'higher' })).toBe(over)
  })
})

describe('平局判定（规则：同点数两个方向都算猜错）', () => {
  it('点数相同且猜大 → 判错并结束', () => {
    const s = rising(card(7, 'S'), card(7, 'H'))
    const n = guess(s, 'higher')
    expect(n.lastHit).toBe(false)
    expect(n.over).toBe(true)
    expect(n.score).toBe(0)
  })

  it('点数相同且猜小 → 判错并结束', () => {
    const s = rising(card(7, 'S'), card(7, 'D'))
    const n = guess(s, 'lower')
    expect(n.lastHit).toBe(false)
    expect(n.over).toBe(true)
    expect(n.score).toBe(0)
  })

  it('花色不同但点数相同仍是平局（只比点数，不比花色）', () => {
    const a = card(10, 'S')
    const b = card(10, 'C')
    expect(isHit(a, b, 'higher')).toBe(false)
    expect(isHit(a, b, 'lower')).toBe(false)
    const n = guess(rising(a, b), 'higher')
    expect(n.lastHit).toBe(false)
    expect(n.over).toBe(true)
  })

  it('A(1) 与 2(2) 的大小关系正确', () => {
    expect(isHit(card(1), card(2), 'higher')).toBe(true)
    expect(isHit(card(2), card(1), 'higher')).toBe(false)
    expect(isHit(card(2), card(1), 'lower')).toBe(true)
  })
})

describe('连对与统计', () => {
  it('连续猜中时连对累加，最高连对随之刷新', () => {
    let s = create(9)
    // 用可控局面连猜三次
    const cards = [card(2, 'S'), card(3, 'H'), card(5, 'D'), card(9, 'C')]
    s = stateWith([...cards, ...Array.from({ length: DECK_SIZE - 4 }, (_, i) => card(2, 'S', i + 20))])
    for (let i = 0; i < 3; i++) {
      const prevRank = s.current ? s.current.rank : 0
      const nextRank = s.deck[s.cursor].rank
      s = guess(s, nextRank > prevRank ? 'higher' : 'lower')
    }
    expect(s.streak).toBe(3)
    expect(s.best).toBe(3)
    expect(s.score).toBe(3)
    expect(s.round).toBe(3)
    expect(s.over).toBe(false)
  })

  it('猜错后连对清零，但最高连对纪录保留', () => {
    const s = stateWith([card(3, 'S'), card(2, 'H'), card(9, 'D'), card(1, 'C')], { score: 2, streak: 2, best: 2 })
    const n = guess(s, 'higher') // 3 之后来 2，猜大必错
    expect(n.over).toBe(true)
    expect(n.streak).toBe(0)
    expect(n.best).toBe(2)
    expect(n.score).toBe(2)
  })

  it('猜错的那一轮不计入得分', () => {
    const s = stateWith([card(9, 'S'), card(4, 'H')], { score: 7, streak: 3, best: 4 })
    const n = guess(s, 'higher')
    expect(n.score).toBe(7)
    expect(n.best).toBe(4)
  })
})

describe('牌堆耗尽自动补牌', () => {
  it('cursor 到牌堆末尾时自动洗回重新发牌', () => {
    const s = stateWith([card(5, 'S'), card(6, 'H')], { cursor: 2 }) // 2 张牌已全部发出
    expect(remaining(s)).toBe(0)
    const n = guess(s, 'higher')
    expect(n.reshuffles).toBe(1)
    expect(n.deck.length).toBe(DECK_SIZE)
    expect(n.cursor).toBe(2)
    expect(n.used.length).toBe(2)
    // 当前牌不参与重发（仍在自己手上），新牌来自重新洗好的整副牌
    expect(n.used).toContain(n.current)
    expect(n.lastCard).not.toBeNull()
    expect(n.round).toBe(1)
    expect(n.lastHit).toBe(isHit(n.prevCard as Card, n.lastCard as Card, 'higher'))
  })

  it('补牌由 state.rng 决定，仍是可复盘的', () => {
    const s = stateWith([card(5, 'S'), card(6, 'H')], { cursor: 2 })
    expect(guess(s, 'higher')).toEqual(guess(s, 'higher'))
  })

  it('连续多次耗尽牌堆都会自动补牌，不会崩溃', () => {
    // 60 张点数互不相同的牌；每轮把 cursor 推到末尾，强制连续触发补牌
    const many = Array.from({ length: 60 }, (_, i) => card(i + 1, 'S', i))
    let s = stateWith(many, { cursor: many.length })
    for (let k = 1; k <= 5; k++) {
      s = guess(s, 'higher')
      expect(s.lastCard).not.toBeNull() // 没崩：补牌后一定有牌可翻
      expect(s.deck.length).toBeGreaterThanOrEqual(2)
      expect(s.used.length).toBeGreaterThanOrEqual(1)
      // 猜错只会结束对局，不影响发牌逻辑，这里继续压测补牌
      s = { ...s, over: false, cursor: s.deck.length }
    }
    expect(s.reshuffles).toBe(5)
    expect(s.deck.length).toBeGreaterThanOrEqual(2)
  })

  it('长局中牌堆始终可用，且统计字段不会越界', () => {
    let s = create(2024)
    let guard = 0
    while (!s.over && guard++ < 400) {
      const cur = s.current as Card
      const peek = s.cursor < s.deck.length ? s.deck[s.cursor] : null
      s = guess(s, peek && peek.rank > cur.rank ? 'higher' : 'lower')
      expect(s.lastCard).not.toBeNull()
      expect(s.deck.length).toBeGreaterThan(0)
      expect(s.used.length).toBeGreaterThanOrEqual(1)
    }
    expect(s.round).toBeGreaterThan(0)
    expect(s.best).toBeGreaterThanOrEqual(s.streak)
    expect(s.score).toBeLessThanOrEqual(s.round)
  })

  it('随机乱猜也能正常终止，不会越界取牌', () => {
    for (let seed = 1; seed <= 30; seed++) {
      let s = create(seed * 7919)
      let guard = 0
      while (!s.over && guard++ < 120) {
        const cur = s.current as Card
        const dir: Dir = guard % 2 === 0 ? 'higher' : 'lower'
        s = guess(s, dir)
        expect(s.lastCard).not.toBeNull()
        expect(s.deck.length).toBeGreaterThan(0)
        expect(cur.rank).toBeGreaterThan(0)
      }
      expect(s.over).toBe(true)
      expect(s.score).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参（牌堆、游标、已用牌、当前牌、rng 均不变）', () => {
    const s = stateWith([card(2, 'S'), card(3, 'H'), card(9, 'D')], { rng: 12345 })
    const deck = s.deck.slice()
    const used = s.used.slice()
    const cur = s.current
    const rng = s.rng
    const cursor = s.cursor
    guess(s, 'higher')
    expect(s.deck).toEqual(deck)
    expect(s.deck).toHaveLength(deck.length)
    expect(s.used).toEqual(used)
    expect(s.used).toHaveLength(1)
    expect(s.current).toEqual(cur)
    expect(s.cursor).toBe(cursor)
    expect(s.rng).toBe(rng)
    expect(s.score).toBe(0)
    expect(s.round).toBe(0)
    expect(s.reshuffles).toBe(0)
  })

  it('补牌路径同样不修改入参', () => {
    const s = stateWith([card(5, 'S'), card(6, 'H')], { cursor: 2 })
    const deck = s.deck.slice()
    const rng = s.rng
    const n = guess(s, 'higher')
    expect(n).not.toBe(s)
    expect(n.deck).not.toBe(s.deck)
    expect(s.deck).toEqual(deck)
    expect(s.rng).toBe(rng)
  })

  it('相同输入两次调用结果完全相等', () => {
    const s = rising()
    expect(guess(s, 'higher')).toEqual(guess(s, 'higher'))
    const over = guess(rising(), 'lower')
    expect(guess(over, 'higher')).toEqual(guess(over, 'higher'))
  })

  it('create 对同一 seed 完全一致（含牌序与 rng）', () => {
    const a = create(123)
    const b = create(123)
    expect(a).toEqual(b)
    expect(a.deck).toEqual(b.deck)
    expect(a.rng).toBe(b.rng)
  })

  it('create 对不同 seed 给出不同牌序', () => {
    const a = create(1)
    const b = create(2)
    expect(a.deck.map((c) => c.id)).not.toEqual(b.deck.map((c) => c.id))
  })

  it('同一串操作可以完整复盘（最终状态逐字段一致）', () => {
    const actions: Dir[] = ['higher', 'lower', 'higher', 'higher', 'lower']
    const run = (): State => {
      let s = create(31337)
      for (const d of actions) s = guess(s, d)
      return s
    }
    const a = run()
    const b = run()
    expect(a).toEqual(b)
    expect(a.deck).toBeDefined()
    expect(a.score).toBe(b.score)
    expect(a.best).toBe(b.best)
    expect(a.over).toBe(b.over)
  })

  it('reduce 返回新对象而不是就地修改', () => {
    const s = rising()
    const n = guess(s, 'higher')
    expect(n).not.toBe(s)
    expect(s.current).toEqual(card(7, 'S'))
  })
})
