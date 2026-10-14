import { describe, expect, it } from 'vitest'
import {
  DECK_SIZE,
  HAND_SIZE,
  PASS_LIMIT,
  aiAction,
  canFollow,
  create,
  isLegal,
  legalActions,
  play,
  playCandidates,
  playableCards,
  reduce,
  refillStock,
  stock,
  totalCards,
  type Action,
  type Player,
  type State,
} from './rules'
import type { Card } from '../../core/cards'
import { Rng } from '../../core/rng'

// ---- 与 makeDeck 的发牌顺序一致的取牌助手（♠0-12 / ♥13-25 / ♣26-38 / ♦39-51 / 小王52 / 大王53） ----
const S = (rank: number): Card => ({ id: rank - 1, suit: 'S', rank })
const H = (rank: number): Card => ({ id: 12 + rank, suit: 'H', rank })
const C = (rank: number): Card => ({ id: 25 + rank, suit: 'C', rank })
const D = (rank: number): Card => ({ id: 38 + rank, suit: 'D', rank })
const SMALL_JOKER: Card = { id: 52, suit: 'J', rank: 14 }
const BIG_JOKER: Card = { id: 53, suit: 'J', rank: 15 }

/** 构造完全可控的局面（随机数固定，便于逐字段断言） */
function scenario(opts: {
  tableTop?: Card | null
  hands: [Card[], Card[]]
  pile?: Card[]
  turn?: Player
  passes?: number
  over?: boolean
  rng?: number
}): State {
  const tableTop = opts.tableTop ?? null
  return {
    hands: [opts.hands[0], opts.hands[1]],
    deck: [],
    pile: opts.pile ?? [],
    tableTop,
    lastPlayed: tableTop,
    turn: opts.turn ?? 1,
    passes: opts.passes ?? 0,
    moves: 0,
    recycles: 0,
    over: opts.over ?? false,
    winner: 0,
    rng: opts.rng ?? 20240101,
  }
}

/** 与规则同一个入口判定：动作是否落在 legalActions 集合内 */
function inLegal(state: State, action: Action): boolean {
  return legalActions(state).some((a) => {
    if (a.type === 'pass') return action.type === 'pass'
    return action.type === 'play' && a.cardId === action.cardId
  })
}

describe('初始局面', () => {
  it('54 张牌：四花色各 13 张 + 大小王各 1，id 互不重复', () => {
    const s = create(42)
    const all = [...s.hands[0], ...s.hands[1], ...s.deck, ...s.pile]
    expect(all.length).toBe(DECK_SIZE)
    expect(new Set(all.map((c) => c.id)).size).toBe(DECK_SIZE)
    for (const suit of ['S', 'H', 'C', 'D']) {
      expect(all.filter((c) => c.suit === suit).length).toBe(13)
    }
    expect(all.filter((c) => c.suit === 'J').map((c) => c.rank).sort((a, b) => a - b)).toEqual([14, 15])
  })

  it('人均 27 张、牌堆与弃牌堆为空、桌面为空、玩家先出', () => {
    const s = create(42)
    expect(s.hands[0].length).toBe(HAND_SIZE)
    expect(s.hands[1].length).toBe(HAND_SIZE)
    expect(stock(s)).toBe(0)
    expect(s.pile.length).toBe(0)
    expect(s.tableTop).toBeNull()
    expect(s.lastPlayed).toBeNull()
    expect(s.turn).toBe(1)
    expect(s.passes).toBe(0)
    expect(s.moves).toBe(0)
    expect(s.recycles).toBe(0)
    expect(s.over).toBe(false)
    expect(s.winner).toBe(0)
  })

  it('牌数守恒：手牌 + 牌堆 + 弃牌堆 === 54', () => {
    const s = create(7)
    expect(totalCards(s)).toBe(DECK_SIZE)
    const n = play(s, s.hands[0][3].id)
    expect(totalCards(n)).toBe(DECK_SIZE)
    expect(n.hands[0].length).toBe(HAND_SIZE - 1)
    expect(n.pile.length).toBe(1)
  })

  it('首出可任选：桌面为空时 27 张手牌全部可以打出', () => {
    const s = create(2024)
    expect(playableCards(s, 1).length).toBe(HAND_SIZE)
    expect(legalActions(s).length).toBe(HAND_SIZE)
    expect(legalActions(s).every((a) => a.type === 'play')).toBe(true)
    // 任意一张都行
    for (const c of s.hands[0]) {
      const n = reduce(s, { type: 'play', cardId: c.id })
      expect(n).not.toBe(s)
      expect(n.tableTop).toEqual(c)
      expect(n.hands[0].length).toBe(HAND_SIZE - 1)
    }
  })
})

describe('接龙规则', () => {
  it('桌面 7♠ 之后只能出 6♠ 或 8♠', () => {
    const s = scenario({
      tableTop: S(7),
      hands: [[S(5), S(6), S(8), S(9)], [S(6), S(8)]],
    })
    const ok = playableCards(s, 1).map((c) => c.id)
    expect(ok).toEqual([S(6).id, S(8).id])
    expect(isLegal(s, { type: 'play', cardId: S(6).id })).toBe(true)
    expect(isLegal(s, { type: 'play', cardId: S(8).id })).toBe(true)
  })

  it('其它花色同点数、相差大于 1 的牌都非法', () => {
    const s = scenario({
      tableTop: S(7),
      hands: [[H(7), D(7), C(7), S(5), S(9), S(7 - 2)], []],
    })
    for (const bad of [H(7), D(7), C(7), S(5), S(9)]) {
      expect(isLegal(s, { type: 'play', cardId: bad.id })).toBe(false)
    }
    expect(legalActions(s)).toEqual([{ type: 'pass' }])
  })

  it('边界：桌面为 A 时只能出 2，不能出更小的牌', () => {
    const top = S(1)
    expect(canFollow(S(2), top)).toBe(true)
    expect(canFollow(S(13), top)).toBe(false)
    const s = scenario({ tableTop: top, hands: [[S(1), S(2), S(13)], []] })
    expect(playableCards(s, 1).map((c) => c.rank)).toEqual([2])
    expect(isLegal(s, { type: 'play', cardId: S(13).id })).toBe(false)
    const n = play(s, S(2).id)
    expect(n.tableTop).toEqual(S(2))
  })

  it('边界：桌面为 K 时只能出 Q，没有 K+1', () => {
    const top = S(13)
    expect(canFollow(S(12), top)).toBe(true)
    expect(canFollow(S(1), top)).toBe(false)
    const s = scenario({ tableTop: top, hands: [[S(12), S(1)], []] })
    expect(playableCards(s, 1).map((c) => c.rank)).toEqual([12])
    // 出 Q 之后回到「Q 的两端」，A 依然接不上
    const n = play(s, S(12).id)
    expect(n.tableTop).toEqual(S(12))
    expect(playableCards(n, 2).map((c) => c.rank)).not.toContain(1)
  })

  it('canFollow 是唯一判定：与 legalActions 的结果始终一致', () => {
    for (const top of [null, S(7), H(1), C(13), D(4)]) {
      const s = scenario({ tableTop: top, hands: [[S(6), S(7), S(8), BIG_JOKER], []] })
      const byRule = s.hands[0].filter((c) => canFollow(c, top)).map((c) => c.id).sort((a, b) => a - b)
      const byAction = playCandidates(s, 1).map((a) => (a.type === 'play' ? a.cardId : -1)).sort((a, b) => a - b)
      expect(byAction).toEqual(byRule)
    }
  })
})

describe('万能牌（大小王）', () => {
  it('大小王任何时候都能打出', () => {
    for (const top of [null, S(7), H(1), C(13), D(4)]) {
      expect(canFollow(SMALL_JOKER, top)).toBe(true)
      expect(canFollow(BIG_JOKER, top)).toBe(true)
    }
    const s = scenario({ tableTop: C(13), hands: [[SMALL_JOKER, BIG_JOKER], []] })
    expect(playableCards(s, 1).map((c) => c.id)).toEqual([52, 53])
  })

  it('打出王之后，桌面的花色与点数都不变', () => {
    const s = scenario({ tableTop: S(7), hands: [[BIG_JOKER, S(5)], [S(8)]], turn: 1 })
    const n = play(s, BIG_JOKER.id)
    expect(n.tableTop).toEqual(S(7))
    expect(n.tableTop?.suit).toBe('S')
    expect(n.tableTop?.rank).toBe(7)
    expect(n.lastPlayed).toEqual(BIG_JOKER)
    expect(n.pile[n.pile.length - 1]).toEqual(BIG_JOKER)
    expect(n.hands[0]).toEqual([S(5)])
    expect(n.turn).toBe(2)
  })

  it('桌面为空时打出王，桌面仍为空（王不建立接龙基准）', () => {
    const s = scenario({ hands: [[SMALL_JOKER, S(5)], [H(4)]] })
    const n = play(s, SMALL_JOKER.id)
    expect(n.tableTop).toBeNull()
    // 桌面还是空的，所以下一家依然首出可任选
    expect(playableCards(n, 2).map((c) => c.id)).toEqual([H(4).id])
  })

  it('打出王之后，对手仍按上一张非王牌接', () => {
    const s = scenario({ tableTop: S(7), hands: [[SMALL_JOKER, H(5)], [S(8), BIG_JOKER, S(9)]] })
    const n = play(s, SMALL_JOKER.id)
    expect(n.tableTop).toEqual(S(7))
    const ok = playableCards(n, 2)
    expect(ok.map((c) => c.id)).toEqual([S(8).id, BIG_JOKER.id])
    expect(isLegal(n, { type: 'play', cardId: S(8).id })).toBe(true)
    expect(isLegal(n, { type: 'play', cardId: S(9).id })).toBe(false)
  })
})

describe('回合、跳过与胜负', () => {
  it('无牌可出 → 跳过回合：passes 递增、回合交给对方，其余不变', () => {
    const s = scenario({ tableTop: H(5), hands: [[S(1), C(13)], [H(6)]], turn: 1 })
    expect(legalActions(s)).toEqual([{ type: 'pass' }])
    const n = reduce(s, { type: 'pass' })
    expect(n.passes).toBe(1)
    expect(n.turn).toBe(2)
    expect(n.hands[0]).toEqual(s.hands[0])
    expect(n.hands[1]).toEqual(s.hands[1])
    expect(n.pile).toEqual(s.pile)
    expect(n.tableTop).toEqual(s.tableTop)
    expect(n.tableTop).not.toBeNull()
    // 对方能接，继续正常进行
    expect(isLegal(n, { type: 'play', cardId: H(6).id })).toBe(true)
  })

  it('有牌可出时不能跳过（非法动作被拒绝且状态不变）', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(8)], [S(8)]], turn: 1 })
    expect(legalActions(s)).toEqual([{ type: 'play', cardId: S(8).id }])
    const n = reduce(s, { type: 'pass' })
    expect(n).toBe(s)
    expect(n.passes).toBe(0)
  })

  it('非法出牌被拒绝，状态（含 rng / hands / pile）完全不变', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(8), H(7), S(2)], []], rng: 999 })
    const before = JSON.stringify(s)
    for (const bad of [H(7), S(2)]) {
      const n = reduce(s, { type: 'play', cardId: bad.id })
      expect(n).toBe(s)
    }
    // 手里没有的牌 / 不存在的 id 同样被拒
    expect(reduce(s, { type: 'play', cardId: S(9).id })).toBe(s)
    expect(reduce(s, { type: 'play', cardId: -1 })).toBe(s)
    expect(JSON.stringify(s)).toBe(before)
    expect(s.rng).toBe(999)
  })

  it('手牌清空即判胜：winner、over、桌面与回合', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(8)], [S(6)]], turn: 1 })
    const n = play(s, S(8).id)
    expect(n.hands[0]).toHaveLength(0)
    expect(n.over).toBe(true)
    expect(n.winner).toBe(1)
    expect(n.turn).toBe(1)
    expect(n.tableTop).toEqual(S(8))
    expect(n.pile).toEqual([S(8)])
    expect(legalActions(n)).toEqual([])
  })

  it('对局结束后任何动作都不改变状态', () => {
    const done = play(scenario({ tableTop: S(7), hands: [[S(8)], [S(6)]] }), S(8).id)
    expect(reduce(done, { type: 'play', cardId: done.hands[1][0].id })).toBe(done)
    expect(reduce(done, { type: 'pass' })).toBe(done)
    expect(aiAction(done)).toBeNull()
  })
})

describe('牌堆洗回与死局救援', () => {
  it('牌堆耗尽时把弃牌堆洗回成为新牌堆，并推进 rng', () => {
    const s = scenario({ tableTop: H(3), hands: [[], []], pile: [H(2), H(9), S(5), C(7)] })
    const n = refillStock(s)
    expect(n.deck).toHaveLength(4)
    expect(n.pile).toHaveLength(0)
    expect([...n.deck].map((c) => c.id).sort((a, b) => a - b)).toEqual([S(5).id, C(7).id, H(2).id, H(9).id].sort((a, b) => a - b))
    expect(n.rng).not.toBe(s.rng)
    expect(n.hands).toEqual(s.hands)
    expect(s.pile).toHaveLength(4)
    expect(s.deck).toHaveLength(0)
    // 洗牌结果由 state.rng 决定，可复盘
    expect(refillStock(s)).toEqual(refillStock(s))
  })

  it('牌堆非空或弃牌堆为空时，原样返回（同一引用）', () => {
    const withStock = scenario({ tableTop: H(3), hands: [[], []], pile: [H(2)] })
    const stocked: State = { ...withStock, deck: [S(4)] }
    expect(refillStock(stocked)).toBe(stocked)
    // 弃牌堆为空：没有牌可洗回，原样返回
    const noPile = scenario({ tableTop: H(3), hands: [[], []] })
    expect(refillStock(noPile)).toBe(noPile)
  })

  it('双方都无牌可出时跳过会触发洗回补牌，双方各 +1 张', () => {
    const stuck = scenario({ tableTop: H(3), hands: [[S(1)], [C(1)]], pile: [H(2), H(13), S(4)], turn: 1 })
    expect(playableCards(stuck, 1)).toHaveLength(0)
    expect(playableCards(stuck, 2)).toHaveLength(0)
    const n = reduce(stuck, { type: 'pass' })
    expect(n.recycles).toBe(1)
    expect(n.passes).toBe(1)
    expect(n.turn).toBe(2)
    expect(n.pile).toHaveLength(0)
    expect(n.deck).toHaveLength(1)
    expect(n.hands[0]).toHaveLength(2)
    expect(n.hands[1]).toHaveLength(2)
    expect(totalCards(n)).toBe(totalCards(stuck))
    // 补进来的牌确实来自原来的弃牌堆（手牌会被重新排序，所以按成员查找而不是按下标）
    const pool = [H(2).id, H(13).id, S(4).id]
    const fresh = (hand: Card[]): number[] => hand.filter((c) => pool.indexOf(c.id) >= 0).map((c) => c.id)
    expect(fresh(n.hands[0])).toHaveLength(1)
    expect(fresh(n.hands[1])).toHaveLength(1)
    expect(fresh(n.hands[0])[0]).not.toBe(fresh(n.hands[1])[0])
  })

  it('反复跳过也推进不了局面时判平局，绝不让对局卡死', () => {
    const stuck = scenario({ tableTop: H(3), hands: [[S(1)], [C(1)]], turn: 1, passes: PASS_LIMIT - 1 })
    const n = reduce(stuck, { type: 'pass' })
    expect(n.passes).toBe(PASS_LIMIT)
    expect(n.over).toBe(true)
    expect(n.winner).toBe(0)
    expect(legalActions(n)).toEqual([])
  })

  it('连续模拟多整局都不抛错，总能分出结果', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = create(seed * 104729)
      const r = new Rng(seed * 31 + 7)
      let guard = 0
      while (!s.over && guard++ < 4000) {
        const acts = legalActions(s)
        expect(acts.length).toBeGreaterThan(0)
        const a = acts[r.int(acts.length)]
        s = reduce(s, a)
        expect(totalCards(s)).toBe(DECK_SIZE)
      }
      expect(s.over).toBe(true)
      expect([0, 1, 2]).toContain(s.winner)
      expect(guard).toBeLessThan(4000)
    }
  })
})

describe('纯函数与可复盘', () => {
  it('reduce 不修改入参（rng / hands / pile / deck / tableTop 全部不变）', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(8), BIG_JOKER], [S(6)]], pile: [C(3)], rng: 12345 })
    const snapshot = JSON.stringify(s)
    play(s, BIG_JOKER.id)
    play(s, S(8).id)
    reduce(s, { type: 'pass' })
    reduce(s, { type: 'play', cardId: H(9).id })
    expect(JSON.stringify(s)).toBe(snapshot)
    expect(s.rng).toBe(12345)
    expect(s.hands[0]).toHaveLength(2)
    expect(s.hands[1]).toHaveLength(1)
    expect(s.pile).toEqual([C(3)])
    expect(s.deck).toHaveLength(0)
    expect(s.tableTop).toEqual(S(7))
    expect(s.moves).toBe(0)
    expect(s.passes).toBe(0)
  })

  it('相同输入两次调用结果完全相等', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(8), BIG_JOKER], [S(6)]], pile: [C(3)], rng: 555 })
    expect(play(s, S(8).id)).toEqual(play(s, S(8).id))
    const j = play(s, BIG_JOKER.id)
    expect(play(j, S(8).id)).toEqual(play(j, S(8).id))
    const stuck = scenario({ tableTop: H(3), hands: [[S(1)], [C(1)]], pile: [H(2), H(13)] })
    expect(reduce(stuck, { type: 'pass' })).toEqual(reduce(stuck, { type: 'pass' }))
  })

  it('create 对同一 seed 完全一致，不同 seed 牌序不同', () => {
    const a = create(123)
    const b = create(123)
    expect(a).toEqual(b)
    expect(a.hands[0]).toEqual(b.hands[0])
    expect(a.rng).toBe(b.rng)
    expect(create(1).hands[0].map((c) => c.id)).not.toEqual(create(2).hands[0].map((c) => c.id))
  })

  it('一整串操作可以完整复盘（最终状态逐字段一致）', () => {
    const run = (): State => {
      let s = create(31337)
      const acts: Action[] = [
        { type: 'play', cardId: s.hands[0][0].id },
        { type: 'play', cardId: s.hands[1][0].id },
        { type: 'play', cardId: s.hands[0][1].id },
        { type: 'pass' },
        { type: 'play', cardId: s.hands[1][1].id },
      ]
      for (const a of acts) {
        if (inLegal(s, a)) s = reduce(s, a)
      }
      return s
    }
    expect(run()).toEqual(run())
  })
})

describe('AI', () => {
  it('只在电脑回合返回动作，其余时刻返回 null', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(8)], [S(6)]], turn: 1 })
    expect(aiAction(s)).toBeNull()
    const aiTurn = scenario({ tableTop: S(7), hands: [[S(8)], [S(6)]], turn: 2 })
    expect(aiAction(aiTurn)).not.toBeNull()
    const done: State = { ...aiTurn, over: true, winner: 2 }
    expect(aiAction(done)).toBeNull()
  })

  it('随机模拟多整局，每个 AI 动作都落在 legalActions 集合内', () => {
    for (let seed = 1; seed <= 10; seed++) {
      let s = create(seed * 7919 + 13)
      const r = new Rng(seed * 977 + 5)
      let guard = 0
      while (!s.over && guard++ < 4000) {
        expect(legalActions(s).length).toBeGreaterThan(0)
        const a = s.turn === 2 ? aiAction(s) : legalActions(s)[r.int(legalActions(s).length)]
        expect(a).not.toBeNull()
        expect(inLegal(s, a as Action)).toBe(true)
        s = reduce(s, a as Action)
        expect(totalCards(s)).toBe(DECK_SIZE)
        // 洗回补牌可能让手牌暂时超过开局张数，但两边加起来不会超过一副牌
        expect(s.hands[0].length + s.hands[1].length).toBeLessThanOrEqual(DECK_SIZE)
      }
      expect(s.over).toBe(true)
      expect(guard).toBeLessThan(4000)
    }
  })

  it('有牌可出时 AI 不会跳过，也不会先丢万能牌', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(9)], [S(6), S(8), BIG_JOKER, SMALL_JOKER]], turn: 2 })
    const a = aiAction(s)
    expect(a?.type).toBe('play')
    expect(a?.type === 'play' && a.cardId).not.toBe(BIG_JOKER.id)
    expect(a?.type === 'play' && a.cardId).not.toBe(SMALL_JOKER.id)
    // 小牌先出，把大牌和王留到最后
    expect([S(6).id, S(8).id]).toContain(a?.type === 'play' ? a.cardId : -1)
  })

  it('AI 能把握直接打完的机会', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(9), S(6)], [S(8)]], turn: 2 })
    expect(aiAction(s)).toEqual({ type: 'play', cardId: S(8).id })
    const n = play(s, S(8).id)
    expect(n.over).toBe(true)
    expect(n.winner).toBe(2)
    // 反例：桌上还压着王时，打完手牌并不算赢，AI 不会为假胜放弃万能牌
    const keep = scenario({ tableTop: S(7), hands: [[S(9)], [S(8), BIG_JOKER]], turn: 2 })
    const b = aiAction(keep)
    expect(b?.type).toBe('play')
    expect(b?.type === 'play' && b.cardId).not.toBe(BIG_JOKER.id)
  })

  it('AI 一张都出不了时返回「过」', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(9)], [H(4), D(10)]], turn: 2 })
    expect(legalActions(s)).toEqual([{ type: 'pass' }])
    expect(aiAction(s)).toEqual({ type: 'pass' })
  })

  it('桌面为空时 AI 首出挑最小的普通牌（大王留作万能）', () => {
    const s = scenario({ hands: [[], [S(9), S(2), BIG_JOKER]], turn: 2 })
    const a = aiAction(s)
    expect(a).toEqual({ type: 'play', cardId: S(2).id })
  })
})
