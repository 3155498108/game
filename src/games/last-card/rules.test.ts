import { describe, expect, it } from 'vitest'
import type { Card, Suit } from '../../core/cards'
import {
  DECK_SIZE,
  HAND_SIZE,
  aiAction,
  canPlay,
  create,
  drawCards,
  legalActions,
  other,
  play,
  playableCards,
  reduce,
  skip,
  type Action,
  type Side,
  type State,
} from './rules'

let idSeq = 1
/** 构造一张指定点数与花色的牌（id 自动递增，保证唯一） */
function card(rank: number, suit: Suit = 'S'): Card {
  return { id: idSeq++, suit, rank }
}

/** 构造一个完全可控的局面：牌堆 / 手牌 / 场上一手牌都能指定 */
function stateWith(
  o: {
    mine?: Card[]
    theirs?: Card[]
    top?: Card | null
    deck?: Card[]
    cursor?: number
    turn?: Side
    field?: Card[]
    rng?: number
  } = {},
): State {
  const base = create(20260101)
  const field = o.field ?? (o.top ? [o.top] : [])
  return {
    ...base,
    hands: [o.mine ?? [], o.theirs ?? []],
    field,
    tableTop: o.top === undefined ? null : o.top,
    deck: o.deck ?? base.deck,
    cursor: o.cursor ?? 0,
    turn: o.turn ?? 'player',
    plays: field.length,
    rng: o.rng ?? base.rng,
  }
}

/** 从 legalActions 里取第一个动作（出牌或跳过） */
const firstAction = (s: State): Action => legalActions(s)[0] as Action

describe('初始状态', () => {
  it('两人各 6 张手牌、牌堆剩余 40 张、场上为空、轮到玩家', () => {
    const s = create(42)
    expect(HAND_SIZE).toBe(6)
    expect(s.hands[0].length).toBe(HAND_SIZE)
    expect(s.hands[1].length).toBe(HAND_SIZE)
    expect(s.deck.length).toBe(DECK_SIZE)
    expect(s.cursor).toBe(HAND_SIZE * 2)
    expect(s.deck.length - s.cursor).toBe(DECK_SIZE - HAND_SIZE * 2)
    expect(s.tableTop).toBeNull()
    expect(s.field).toEqual([])
    expect(s.turn).toBe('player')
    expect(s.over).toBe(false)
    expect(s.winner).toBeNull()
    expect(s.plays).toBe(0)
    expect(s.skips).toBe(0)
    expect(s.reshuffles).toBe(0)
  })

  it('12 张手牌互不相同，且都不在剩余牌堆里', () => {
    const s = create(7)
    const all = s.hands[0].concat(s.hands[1])
    expect(new Set(all.map((c) => c.id)).size).toBe(HAND_SIZE * 2)
    const rest = s.deck.slice(s.cursor)
    for (const c of all) expect(rest.some((d) => d.id === c.id)).toBe(false)
  })

  it('轮流发牌：玩家与电脑各一张交替取走牌堆顶部的牌', () => {
    const s = create(99)
    expect(s.hands[0][0]).toEqual(s.deck[0])
    expect(s.hands[1][0]).toEqual(s.deck[1])
    expect(s.hands[0][1]).toEqual(s.deck[2])
    expect(s.hands[1][1]).toEqual(s.deck[3])
  })
})

describe('出牌规则', () => {
  it('开局场上为空：任意牌都合法', () => {
    const cards = [card(1, 'S'), card(13, 'H'), card(5, 'C')]
    const s = stateWith({ mine: cards, turn: 'player' })
    expect(playableCards(s).length).toBe(3)
    for (const c of cards) {
      expect(legalActions(s)).toContainEqual({ type: 'play', cardId: c.id })
      expect(canPlay(c, null)).toBe(true)
    }
  })

  it('规则一：点数小于场上最高牌 → 合法（与花色无关）', () => {
    const top = card(9, 'S')
    const low = card(4, 'H')
    expect(canPlay(low, top)).toBe(true)
    const s = stateWith({ mine: [low], top, turn: 'player' })
    expect(legalActions(s)).toEqual([{ type: 'play', cardId: low.id }])
  })

  it('规则一：A(1) 永远小于任何点数，也是最小的兜底', () => {
    expect(canPlay(card(1, 'C'), card(2, 'S'))).toBe(true)
  })

  it('规则二：与场上最高牌同花色且点数更大 → 合法', () => {
    const top = card(6, 'H')
    const big = card(12, 'H')
    expect(canPlay(big, top)).toBe(true)
    const s = stateWith({ mine: [big], top, turn: 'player' })
    expect(legalActions(s)).toEqual([{ type: 'play', cardId: big.id }])
  })

  it('规则二：同花色时点数不限，等于也能打', () => {
    expect(canPlay(card(6, 'H'), card(6, 'H'))).toBe(true)
  })

  it('大于最高牌且不同花色 → 非法', () => {
    const top = card(6, 'S')
    const bigger = card(13, 'D')
    expect(canPlay(bigger, top)).toBe(false)
    const s = stateWith({ mine: [bigger], top, turn: 'player' })
    expect(legalActions(s)).toEqual([{ type: 'skip' }])
  })

  it('等于最高牌点数但不同花色 → 非法', () => {
    const top = card(10, 'S')
    const same = card(10, 'C')
    expect(canPlay(same, top)).toBe(false)
    const s = stateWith({ mine: [same], top, turn: 'player' })
    expect(legalActions(s)).not.toContainEqual({ type: 'play', cardId: same.id })
  })

  it('小于最高牌时花色完全不影响判定（跨花色降牌永远合法）', () => {
    for (const suit of ['S', 'H', 'D', 'C'] as Suit[]) {
      expect(canPlay(card(3, suit), card(5, 'C'))).toBe(true)
    }
  })
})

describe('场面更新', () => {
  it('打出更小的牌：场上最高牌不变，出牌进入 field', () => {
    const top = card(10, 'S')
    const low = card(4, 'C')
    const keep = card(7, 'D')
    const s = stateWith({ mine: [low, keep], top })
    const n = play(s, low.id)
    expect(n.tableTop).toEqual(top)
    expect(n.field).toHaveLength(2)
    expect(n.field[n.field.length - 1]).toEqual(low)
    expect(n.hands[0]).toEqual([keep])
    expect(n.turn).toBe('ai')
    expect(n.plays).toBe(2)
  })

  it('同花色大牌会抬高场面，场上最高牌换成新牌', () => {
    const top = card(5, 'D')
    const big = card(11, 'D')
    const n = play(stateWith({ mine: [big], top }), big.id)
    expect(n.tableTop).toEqual(big)
    expect(n.field.map((c) => c.id)).toEqual([top.id, big.id])
  })

  it('非同花色大牌非法时场面自然不变（reduce 拒绝，状态原样返回）', () => {
    const top = card(5, 'D')
    const bad = card(11, 'S')
    const s = stateWith({ mine: [bad], top })
    expect(play(s, bad.id)).toBe(s)
  })

  it('开局第一张牌成为场上最高牌', () => {
    const first = card(2, 'C')
    const n = play(stateWith({ mine: [first] }), first.id)
    expect(n.tableTop).toEqual(first)
  })

  it('点数相同则保留先打出的那张牌', () => {
    const top = card(8, 'S')
    const twin = card(8, 'S')
    const n = play(stateWith({ mine: [twin], top, field: [top] }), twin.id)
    expect(n.tableTop).toEqual(top)
  })
})

describe('跳过', () => {
  it('无牌可出时跳过：skips 递增、交给对方、不抽牌', () => {
    const top = card(3, 'S')
    const dead = card(9, 'H')
    const s = stateWith({ mine: [dead], theirs: [card(1, 'C')], top, turn: 'player', cursor: 3 })
    const deckBefore = s.deck
    const cursorBefore = s.cursor
    const n = skip(s)
    expect(n.skips).toBe(1)
    expect(n.turn).toBe('ai')
    expect(n.hands[0]).toEqual([dead]) // 手牌不变
    expect(n.field).toEqual([top]) // 场上不变
    expect(n.deck).toEqual(deckBefore) // 不抽牌
    expect(n.cursor).toBe(cursorBefore)
    expect(n.lastSkip).toBe('player')
    expect(n.plays).toBe(s.plays)
  })

  it('legalActions 在无牌可出时只给出「跳过」', () => {
    const top = card(3, 'S')
    const s = stateWith({ mine: [card(9, 'H'), card(13, 'C')], top })
    expect(legalActions(s)).toEqual([{ type: 'skip' }])
  })

  it('仍有牌可打时跳过是非法的（状态不变）', () => {
    const top = card(9, 'S')
    const low = card(4, 'H')
    const s = stateWith({ mine: [low], top })
    expect(legalActions(s)).toEqual([{ type: 'play', cardId: low.id }])
    expect(skip(s)).toBe(s)
  })

  it('连续两次跳过会清空场面，保证对局不会死循环', () => {
    const top = card(1, 'S')
    const p1 = stateWith({ mine: [card(13, 'H')], theirs: [card(12, 'D')], top, turn: 'player', field: [top] })
    const p2 = skip(p1)
    expect(p2.tableTop).toEqual(top)
    expect(p2.turn).toBe('ai')
    // 电脑也无牌可出 → 再跳一次，场面清空
    const p3 = skip(p2)
    expect(p3.skips).toBe(2)
    expect(p3.tableTop).toBeNull()
    expect(p3.turn).toBe('player')
    expect(p3.consecutiveSkips).toBe(0)
    // 场面清空后任意牌都能打出
    expect(legalActions(p3).length).toBe(1)
    expect((legalActions(p3)[0] as Action).type).toBe('play')
  })
})

describe('胜负判定', () => {
  it('打完最后一张牌立即判胜，回合不再交给对方', () => {
    const last = card(4, 'S')
    const top = card(9, 'H')
    const n = play(stateWith({ mine: [last], theirs: [card(2, 'C'), card(3, 'D')], top, turn: 'player' }), last.id)
    expect(n.over).toBe(true)
    expect(n.winner).toBe('player')
    expect(n.hands[0]).toEqual([])
    expect(n.hands[1].length).toBeGreaterThan(0)
  })

  it('电脑打完手牌时玩家判负', () => {
    const last = card(4, 'S')
    const s = stateWith({ mine: [card(1, 'C')], theirs: [last], turn: 'ai' })
    const n = play(s, last.id)
    expect(n.over).toBe(true)
    expect(n.winner).toBe('ai')
  })

  it('结束后任何动作都被拒绝（引用相等）', () => {
    const last = card(4, 'S')
    const over = play(stateWith({ mine: [last], top: card(9, 'H'), turn: 'player' }), last.id)
    expect(reduce(over, { type: 'skip' })).toBe(over)
    expect(reduce(over, { type: 'play', cardId: last.id })).toBe(over)
    expect(aiAction(over)).toBeNull()
  })

  it('other 正确翻转行动方', () => {
    expect(other('player')).toBe('ai')
    expect(other('ai')).toBe('player')
  })
})

describe('非法动作', () => {
  it('打出比自己手牌里不存在的牌 → 状态不变', () => {
    const s = stateWith({ mine: [card(2, 'S')] })
    expect(reduce(s, { type: 'play', cardId: 9999 })).toBe(s)
  })

  it('替对方出牌 → 状态不变（只认当前回合的手牌）', () => {
    const mine = card(2, 'S')
    const theirs = card(3, 'H')
    const s = stateWith({ mine: [mine], theirs: [theirs], turn: 'player' })
    expect(reduce(s, { type: 'play', cardId: theirs.id })).toBe(s)
  })

  it('违反规则一的牌 → 状态不变', () => {
    const bad = card(13, 'H')
    const s = stateWith({ mine: [bad], top: card(10, 'S') })
    expect(reduce(s, { type: 'play', cardId: bad.id })).toBe(s)
  })
})

describe('牌堆耗尽自动补牌', () => {
  it('牌堆不够发牌时把已打出的牌洗回，重新发给双方', () => {
    const a = card(2, 'S')
    const b = card(5, 'H')
    const s = stateWith({ deck: [a, b], cursor: 2, field: [a, b] })
    expect(s.deck.length - s.cursor).toBe(0)
    const d = drawCards(s, 1)
    expect(d.cards).toHaveLength(1)
    expect(d.reshuffles).toBe(1)
    expect(d.deck).toHaveLength(2)
    expect(d.cursor).toBe(1)
  })

  it('已打出的牌也不够时再补一副新牌，绝不空堆崩溃', () => {
    // 牌堆还剩 1 张未发（cursor=0），场上没有可回收的牌 → 1 + 52 = 53 张洗回
    const s = stateWith({ deck: [card(2, 'S')], cursor: 0, field: [] })
    const d = drawCards(s, HAND_SIZE)
    expect(d.cards).toHaveLength(HAND_SIZE)
    expect(d.deck.length).toBe(DECK_SIZE + 1) // 牌堆剩的 1 张 + 新补的 52 张
    expect(d.reshuffles).toBe(1)
  })

  it('牌堆足够时直接顺次发牌，不触发洗回', () => {
    const d = drawCards(create(3), 2)
    expect(d.reshuffles).toBe(0)
    expect(d.cards).toEqual(create(3).deck.slice(HAND_SIZE * 2, HAND_SIZE * 2 + 2))
  })

  it('连续耗尽多次都自动补牌，不抛错', () => {
    let s = stateWith({ deck: [card(2, 'S')], cursor: 1, field: [card(2, 'S')] })
    for (let k = 1; k <= 5; k++) {
      s = { ...s, cursor: s.deck.length }
      const d = drawCards(s, HAND_SIZE)
      expect(d.cards.length).toBe(HAND_SIZE)
      s = { ...s, deck: d.deck, cursor: d.cursor, reshuffles: d.reshuffles, rng: d.rng }
      expect(s.reshuffles).toBe(k)
    }
  })

  it('随机模拟 40 整局不抛错，且每局都分出胜负', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = create(seed * 7919)
      let guard = 0
      while (!s.over && guard++ < 200) {
        const legal = legalActions(s)
        if (legal.length === 0) break
        s = reduce(s, legal[seed % legal.length])
        expect(s.deck.length - s.cursor).toBeGreaterThan(0)
      }
      expect(s.over).toBe(true)
      expect(s.winner === 'player' || s.winner === 'ai').toBe(true)
      expect(s.hands[s.winner === 'player' ? 0 : 1].length).toBe(0)
    }
  })
})

describe('AI', () => {
  it('轮到玩家或已结束时返回 null', () => {
    expect(aiAction(create(1))).toBeNull()
    const over = play(stateWith({ mine: [card(2, 'S')], turn: 'player' }), card(2, 'S').id)
    expect(aiAction(over)).toBeNull()
  })

  it('优先出不会抬高场面的牌', () => {
    const top = card(10, 'S')
    const low = card(4, 'C')
    const raise = card(12, 'C')
    const s = stateWith({ theirs: [low, raise], top, turn: 'ai', field: [top] })
    expect(aiAction(s)).toEqual({ type: 'play', cardId: low.id })
  })

  it('同花色低牌优于非同花色的小牌', () => {
    const top = card(10, 'S')
    const sameSuit = card(3, 'S')
    const otherSuit = card(5, 'H')
    const s = stateWith({ theirs: [otherSuit, sameSuit], top, turn: 'ai', field: [top] })
    expect(aiAction(s)).toEqual({ type: 'play', cardId: sameSuit.id })
  })

  it('场面为空时无法区分抬高与否，优先清掉大牌', () => {
    const big = card(13, 'S')
    const small = card(4, 'C')
    const s = stateWith({ theirs: [small, big], turn: 'ai' })
    expect(aiAction(s)).toEqual({ type: 'play', cardId: big.id })
  })

  it('能一把走完时立刻出完', () => {
    const only = card(2, 'C')
    const s = stateWith({ theirs: [only], turn: 'ai' })
    const a = aiAction(s)
    expect(a).toEqual({ type: 'play', cardId: only.id })
    expect(reduce(s, a as Action).winner).toBe('ai')
  })

  it('无牌可出时返回「跳过」', () => {
    const top = card(2, 'S')
    const s = stateWith({ theirs: [card(13, 'H')], top, turn: 'ai', field: [top] })
    expect(aiAction(s)).toEqual({ type: 'skip' })
  })

  it('整局对战中每个 AI action 都在 legalActions 内，且必然终局', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = create(seed * 7919)
      let guard = 0
      while (!s.over && guard++ < 200) {
        const legal = legalActions(s)
        expect(legal.length).toBeGreaterThan(0)
        let a: Action
        if (s.turn === 'ai') {
          a = aiAction(s) as Action
          expect(a).not.toBeNull()
          expect(legal).toContainEqual(a)
        } else {
          a = legal[seed % legal.length] as Action
          expect(legal).toContainEqual(a)
        }
        const next = reduce(s, a)
        expect(next).not.toBe(s) // 每个合法动作都必须推进状态
        s = next
      }
      expect(s.over).toBe(true)
      expect(s.plays + s.skips).toBeGreaterThan(0)
      expect(s.plays).toBeLessThanOrEqual(HAND_SIZE * 2)
    }
  })

  it('相同状态总是返回相同动作（可复盘）', () => {
    const s = stateWith({ theirs: [card(3, 'C'), card(11, 'H')], top: card(9, 'S'), turn: 'ai', field: [card(9, 'S')] })
    expect(aiAction(s)).toEqual(aiAction(s))
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参（手牌 / 场面 / 牌堆 / rng 均不变）', () => {
    const top = card(9, 'S')
    const c = card(4, 'C')
    const s = stateWith({ mine: [c], theirs: [card(2, 'D')], top, turn: 'player', cursor: 5, rng: 4242 })
    const hands = [s.hands[0].slice(), s.hands[1].slice()]
    const field = s.field.slice()
    const deck = s.deck.slice()
    play(s, c.id)
    expect(s.hands[0]).toEqual(hands[0])
    expect(s.hands[1]).toEqual(hands[1])
    expect(s.field).toEqual(field)
    expect(s.tableTop).toEqual(top)
    expect(s.deck).toEqual(deck)
    expect(s.cursor).toBe(5)
    expect(s.rng).toBe(4242)
    expect(s.plays).toBe(1)
    expect(s.skips).toBe(0)
    expect(s.turn).toBe('player')
  })

  it('跳过同样不修改入参', () => {
    const top = card(3, 'S')
    const s = stateWith({ mine: [card(9, 'H')], top, turn: 'player', cursor: 2 })
    const deck = s.deck.slice()
    const n = skip(s)
    expect(n).not.toBe(s)
    expect(n.deck).toEqual(deck)
    expect(s.deck).toEqual(deck)
    expect(s.cursor).toBe(2)
    expect(s.skips).toBe(0)
  })

  it('reduce 返回新对象而不是就地修改', () => {
    const c = card(4, 'C')
    const s = stateWith({ mine: [c] })
    const n = play(s, c.id)
    expect(n).not.toBe(s)
    expect(n.hands[0]).not.toBe(s.hands[0])
    expect(s.hands[0]).toHaveLength(1)
  })

  it('相同输入两次调用结果完全相等（出牌 / 跳过 / 结束）', () => {
    const c = card(4, 'C')
    const s = stateWith({ mine: [c], top: card(9, 'S'), field: [card(9, 'S')] })
    expect(play(s, c.id)).toEqual(play(s, c.id))

    const dead = stateWith({ mine: [card(9, 'H')], top: card(3, 'S'), field: [card(3, 'S')] })
    expect(skip(dead)).toEqual(skip(dead))

    const over = play(stateWith({ mine: [card(2, 'S')] }), card(2, 'S').id)
    expect(reduce(over, { type: 'skip' })).toEqual(reduce(over, { type: 'skip' }))
  })

  it('create 对同一 seed 完全一致（含牌序、手牌与 rng）', () => {
    const a = create(123)
    const b = create(123)
    expect(a).toEqual(b)
    expect(a.deck).toEqual(b.deck)
    expect(a.hands).toEqual(b.hands)
    expect(a.rng).toBe(b.rng)
  })

  it('create 对不同 seed 给出不同牌序', () => {
    expect(create(1).hands.flat().map((c) => c.id)).not.toEqual(create(2).hands.flat().map((c) => c.id))
  })

  it('同一串操作可以完整复盘', () => {
    const run = (): State => {
      let s = create(31337)
      for (let i = 0; i < 12 && !s.over; i++) {
        const legal = legalActions(s)
        s = reduce(s, legal[i % legal.length] as Action)
      }
      return s
    }
    expect(run()).toEqual(run())
  })

  it('人机对完整复盘（AI 参与）', () => {
    const run = (): State => {
      let s = create(2024)
      let guard = 0
      while (!s.over && guard++ < 200) {
        s = reduce(s, s.turn === 'ai' ? (aiAction(s) as Action) : firstAction(s))
      }
      return s
    }
    const a = run()
    const b = run()
    expect(a).toEqual(b)
    expect(a.over).toBe(true)
  })
})
