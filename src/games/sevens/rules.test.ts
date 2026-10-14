import { describe, expect, it } from 'vitest'
import type { Card, Suit } from '../../core/cards'
import {
  AI,
  DECKS,
  DECK_SIZE,
  HAND_SIZE,
  PLAYER,
  SEVEN,
  aiAction,
  canPlayRank,
  create,
  legalActions,
  playPoints,
  reduce,
  type Action,
  type Side,
  type State,
} from './rules'

function card(rank: number, suit: Suit = 'S', id = 0): Card {
  return { id, suit, rank }
}

/** 构造一个完全可控的局面（不经过发牌，便于精确断言规则） */
function makeState(
  o: {
    player?: Card[]
    ai?: Card[]
    deck?: Card[]
    discard?: Card[]
    ranks?: number[]
    chain?: Card[]
    turn?: Side
    scores?: [number, number]
    rng?: number
  } = {},
): State {
  const discard = o.discard ?? []
  return {
    hands: [o.player ?? [], o.ai ?? []],
    deck: o.deck ?? [],
    discard,
    burn: [],
    discardRanks: o.ranks ?? discard.map((c) => c.rank),
    chain: o.chain ?? (discard.length > 0 ? [discard[discard.length - 1]] : []),
    bestChain: 1,
    scores: o.scores ?? [0, 0],
    turn: o.turn ?? PLAYER,
    moves: 0,
    reshuffles: 0,
    lastPlayed: discard.length > 0 ? discard[discard.length - 1] : null,
    lastDrawn: null,
    over: false,
    winner: null,
    rng: o.rng ?? 1,
  }
}

/** 桌面已有 7、手上有 6/8 的标准开局局面 */
function withSevenOnTable(extra: Partial<Parameters<typeof makeState>[0]> = {}): State {
  return makeState({ discard: [card(7, 'H', 100)], ranks: [7], chain: [card(7, 'H', 100)], ...extra })
}

/** 全场牌的总数（不变式） */
function totalCards(s: State): number {
  return s.deck.length + s.hands[0].length + s.hands[1].length + s.discard.length + s.burn.length
}

/** 场面固定在玩家回合，便于连续测试计分规则（不测回合交替） */
function asPlayer(s: State): State {
  return s.turn === PLAYER ? s : { ...s, turn: PLAYER }
}

// ---------------- 开局 ----------------

describe('开局发牌', () => {
  it('两人各 7 张（手上的 7 已在开局打出），牌堆剩 104 - 14 张，轮到玩家', () => {
    const s = create(20260101)
    expect(s.hands[0].length + s.hands[1].length + s.discard.length).toBe(HAND_SIZE * 2)
    expect(s.deck.length).toBe(DECK_SIZE - HAND_SIZE * 2)
    expect(DECK_SIZE).toBe(52 * DECKS)
    expect(s.turn).toBe(PLAYER)
    expect(s.over).toBe(false)
    expect(s.winner).toBeNull()
    expect(s.moves).toBe(0)
    expect(s.scores).toEqual([0, 0])
    expect(s.reshuffles).toBe(0)
    expect(totalCards(s)).toBe(DECK_SIZE)
  })

  it('开局手上的 7 必须立刻打出：手牌里没有 7，开局打出的牌只能是 7', () => {
    let sawSeven = false
    for (let k = 1; k <= 8; k++) {
      const s = create(k * 7919)
      expect(s.hands[0].every((c) => c.rank !== SEVEN)).toBe(true)
      expect(s.hands[1].every((c) => c.rank !== SEVEN)).toBe(true)
      expect(s.discard.every((c) => c.rank === SEVEN)).toBe(true)
      if (s.discard.length > 0) {
        sawSeven = true
        expect(s.discardRanks).toEqual([SEVEN])
        expect(s.chain.length).toBe(1)
      }
      // 没有 7 的极端开局：手牌里仍然不能留 7（已被全部打出）
      expect(s.hands[0].every((c) => c.rank !== SEVEN) && s.hands[1].every((c) => c.rank !== SEVEN)).toBe(true)
    }
    expect(sawSeven).toBe(true)
  })

  it('create 对同一 seed 完全一致，不同 seed 牌序不同', () => {
    expect(create(123)).toEqual(create(123))
    expect(create(123).rng).toBe(create(123).rng)
    expect(create(1).deck.map((c) => c.id)).not.toEqual(create(2).deck.map((c) => c.id))
  })
})

// ---------------- 接龙规则 ----------------

describe('出牌规则', () => {
  it('桌面没有 7 时不能出 6 或 8', () => {
    const s = makeState({ player: [card(6, 'S', 1), card(8, 'H', 2)] })
    expect(canPlayRank(s, 6)).toBe(false)
    expect(canPlayRank(s, 8)).toBe(false)
    expect(reduce(s, { type: 'play', cardId: 1 })).toBe(s)
    expect(reduce(s, { type: 'play', cardId: 2 })).toBe(s)
  })

  it('持有 7 后可以出 6 或 8，且两者都在合法动作里', () => {
    const s = withSevenOnTable({ player: [card(6, 'S', 1), card(8, 'H', 2), card(3, 'C', 3)] })
    expect(canPlayRank(s, 6)).toBe(true)
    expect(canPlayRank(s, 8)).toBe(true)
    expect(canPlayRank(s, 3)).toBe(false)
    expect(legalActions(s)).toEqual([
      { type: 'play', cardId: 1 },
      { type: 'play', cardId: 2 },
    ])
    const n6 = reduce(s, { type: 'play', cardId: 1 })
    expect(n6.discard[n6.discard.length - 1]).toEqual(card(6, 'S', 1))
    expect(n6.hands[0]).toHaveLength(2)
    const n8 = reduce(s, { type: 'play', cardId: 2 })
    expect(n8.discard[n8.discard.length - 1]).toEqual(card(8, 'H', 2))
    expect(n8.hands[0]).toHaveLength(2)
  })

  it('7 随时可以打出并解锁两侧', () => {
    const s = makeState({ player: [card(7, 'D', 9)], discard: [], ranks: [] })
    expect(canPlayRank(s, 7)).toBe(true)
    const n = reduce(s, { type: 'play', cardId: 9 })
    expect(n.discardRanks).toEqual([SEVEN])
    expect(canPlayRank(n, 6)).toBe(true)
    expect(canPlayRank(n, 8)).toBe(true)
    expect(canPlayRank(n, 5)).toBe(false)
  })

  it('打出 6 后解锁 5；打出 8 后解锁 9', () => {
    const s = withSevenOnTable({ player: [card(6, 'S', 1), card(8, 'C', 2), card(9, 'H', 3)] })
    const n = reduce(s, { type: 'play', cardId: 1 })
    expect(n.discardRanks).toEqual([6, 7])
    expect(canPlayRank(n, 5)).toBe(true)
    expect(canPlayRank(n, 7)).toBe(true)
    expect(canPlayRank(n, 9)).toBe(false)

    const m = reduce(s, { type: 'play', cardId: 2 })
    expect(m.discardRanks).toEqual([7, 8])
    expect(canPlayRank(m, 9)).toBe(true)
    expect(canPlayRank(m, 10)).toBe(false)
  })

  it('A(1) 只当小牌：2 在桌上就能接 A；K(13) 只当大牌：Q 在桌上就能接 K', () => {
    const a = withSevenOnTable({ player: [card(1, 'S', 1), card(13, 'H', 2)] })
    expect(canPlayRank(a, 1)).toBe(false) // 桌上只有 7，2 还没接上
    expect(canPlayRank(a, 13)).toBe(false)

    const b = makeState({ discard: [card(7, 'H', 100), card(2, 'C', 101)], ranks: [2, 7], player: [card(1, 'S', 1)] })
    expect(canPlayRank(b, 1)).toBe(true)
    const c = makeState({ discard: [card(7, 'H', 100), card(12, 'C', 101)], ranks: [7, 12], player: [card(13, 'H', 2)] })
    expect(canPlayRank(c, 13)).toBe(true)
    const d = makeState({ discard: [card(7, 'H', 100), card(2, 'C', 101)], ranks: [2, 7], player: [card(13, 'H', 2)] })
    expect(canPlayRank(d, 13)).toBe(false)
  })
})

// ---------------- 弃牌与补牌 ----------------

describe('无牌可打：弃一张 + 抽一张', () => {
  it('合法动作全部变成 discard，reduce 后手牌数不变、抽到的牌进入手牌、弃牌进入弃牌堆', () => {
    const s = makeState({
      player: [card(4, 'S', 1), card(4, 'H', 2), card(5, 'C', 3)],
      deck: [card(9, 'D', 50), card(10, 'C', 51)],
      rng: 777,
    })
    expect(legalActions(s)).toEqual([
      { type: 'discard', cardId: 1 },
      { type: 'discard', cardId: 2 },
      { type: 'discard', cardId: 3 },
    ])
    const n = reduce(s, { type: 'discard', cardId: 1 })
    expect(n.hands[0]).toHaveLength(3)
    expect(n.hands[0].map((c) => c.id)).toContain(50) // 抽到的 9 进手牌
    expect(n.hands[0].map((c) => c.id)).not.toContain(1) // 弃掉的 4 不在手牌
    expect(n.burn.map((c) => c.id)).toEqual([1])
    expect(n.deck.map((c) => c.id)).toEqual([51])
    expect(n.lastDrawn).toEqual(card(9, 'D', 50))
    expect(n.rng).toBe(777) // 没洗牌时随机游标不前进
    expect(n.turn).toBe(AI)
    expect(n.moves).toBe(1)
  })

  it('抽到的正好是 7，必须立即打出（桌面出现 7、手牌里没有它）', () => {
    const s = makeState({
      player: [card(4, 'S', 1), card(5, 'C', 3)],
      deck: [card(7, 'H', 77), card(10, 'C', 51)],
    })
    const n = reduce(s, { type: 'discard', cardId: 1 })
    expect(n.discard.map((c) => c.id)).toContain(77)
    expect(n.discardRanks).toEqual([SEVEN])
    expect(n.hands[0].map((c) => c.id)).not.toContain(77)
    expect(n.hands[0].map((c) => c.id)).toEqual([3]) // 抽到的 7 直接打出，只剩原来那两张里的一张
    expect(n.hands[0]).toHaveLength(1)
    expect(n.lastPlayed).toEqual(card(7, 'H', 77))
    expect(canPlayRank(n, 6)).toBe(true)
    expect(canPlayRank(n, 8)).toBe(true)
  })

  it('抽到的不是 7 时不触发强制出牌', () => {
    const s = makeState({ player: [card(4, 'S', 1)], deck: [card(9, 'D', 50)] })
    const n = reduce(s, { type: 'discard', cardId: 1 })
    expect(n.discard).toHaveLength(0)
    expect(n.discardRanks).toEqual([])
    expect(n.lastPlayed).toBeNull()
    expect(n.hands[0].map((c) => c.id)).toEqual([50])
  })

  it('有牌可打时不允许弃牌，状态不变', () => {
    const s = withSevenOnTable({ player: [card(6, 'S', 1), card(4, 'C', 2)] })
    expect(legalActions(s).some((a) => a.type === 'discard')).toBe(false)
    expect(reduce(s, { type: 'discard', cardId: 2 })).toBe(s)
  })

  it('无牌可打时不允许出牌，状态不变', () => {
    const s = makeState({ player: [card(6, 'S', 1)] })
    expect(reduce(s, { type: 'play', cardId: 1 })).toBe(s)
  })
})

// ---------------- chain 计分 ----------------

describe('连续串计分', () => {
  it('chain 越长单次得分越高（playPoints 随串长严格递增）', () => {
    for (const rank of [2, 7, 12]) {
      for (const first of [true, false]) {
        for (let len = 1; len < 12; len++) {
          expect(playPoints(len + 1, rank, first)).toBeGreaterThan(playPoints(len, rank, first))
        }
      }
    }
  })

  it('连续接 6→5→4：每次得分递增，串长与得分同步增长', () => {
    const seven = card(7, 'H', 100)
    let s = withSevenOnTable({ player: [card(6, 'S', 1), card(5, 'C', 2), card(4, 'D', 3)], scores: [0, 0] })
    s = { ...s, chain: [seven], bestChain: 1 }

    const gains: number[] = []
    for (const id of [1, 2, 3]) {
      s = asPlayer(s)
      const before = s.scores[PLAYER]
      s = reduce(s, { type: 'play', cardId: id })
      gains.push(s.scores[PLAYER] - before)
    }
    expect(s.chain.map((c) => c.rank)).toEqual([7, 6, 5, 4])
    expect(s.chain.length).toBe(4)
    expect(s.bestChain).toBe(4)
    expect(gains[0]).toBeGreaterThan(0)
    expect(gains[1]).toBeGreaterThan(gains[0])
    expect(gains[2]).toBeGreaterThan(gains[1])
  })

  it('长串一次得分高于短串：7→6 得 4 分，7→6→5 得 6 分', () => {
    const seven = card(7, 'H', 100)
    let s = withSevenOnTable({ player: [card(6, 'S', 1), card(5, 'C', 2)], scores: [0, 0] })
    const short = reduce(s, { type: 'play', cardId: 1 })
    const shortGain = short.scores[PLAYER]
    expect(short.chain).toEqual([seven, card(6, 'S', 1)])
    expect(shortGain).toBe(4)

    s = { ...s, chain: [seven] }
    const two = reduce(s, { type: 'play', cardId: 1 })
    const long2 = reduce(asPlayer(two), { type: 'play', cardId: 2 })
    const longGain = long2.scores[PLAYER] - two.scores[PLAYER]
    expect(long2.chain.map((c) => c.rank)).toEqual([7, 6, 5])
    expect(longGain).toBeGreaterThan(shortGain)
  })

  it('同一个点数第二次打出不再给首出奖励', () => {
    const seven = card(7, 'H', 100)
    const s = withSevenOnTable({ player: [card(6, 'S', 1), card(6, 'H', 2)] })
    const first = reduce(s, { type: 'play', cardId: 1 })
    const firstGain = first.scores[PLAYER]
    // 第二张 6 在同一局面里打出：串长同样为 2，唯一差别是「首出」奖励
    const second = reduce(asPlayer({ ...first, chain: [seven] }), { type: 'play', cardId: 2 })
    const secondGain = second.scores[PLAYER] - first.scores[PLAYER]
    expect(first.discardRanks).toEqual([6, 7])
    expect(firstGain).toBe(playPoints(2, 6, true))
    expect(secondGain).toBe(playPoints(2, 6, false))
    expect(firstGain - secondGain).toBe(2)
  })

  it('接不上当前串的点数会重开一串（chain 长度回到 1）', () => {
    // 桌面上 5、7、9 都有（中间断了），当前串停在 5：8 合法但接不上，串重开
    const five = card(5, 'S', 100)
    const s = makeState({
      player: [card(8, 'S', 1)],
      discard: [card(9, 'C', 101), card(7, 'H', 102), five],
      ranks: [5, 7, 9],
      chain: [five],
    })
    expect(canPlayRank(s, 8)).toBe(true)
    const n = reduce(s, { type: 'play', cardId: 1 })
    expect(n.chain).toEqual([card(8, 'S', 1)])
    expect(n.chain.length).toBe(1)
    expect(n.bestChain).toBe(1)
  })
})

// ---------------- 胜负 ----------------

describe('胜负与回合', () => {
  it('手牌为空即判胜，并换手给对手', () => {
    const s = withSevenOnTable({ player: [card(6, 'S', 1)], ai: [card(3, 'C', 20)] })
    const n = reduce(s, { type: 'play', cardId: 1 })
    expect(n.hands[0]).toHaveLength(0)
    expect(n.over).toBe(true)
    expect(n.winner).toBe(PLAYER)
    expect(n.turn).toBe(AI)
  })

  it('普通出牌只换手，双方交替行动', () => {
    const s = withSevenOnTable({ player: [card(6, 'S', 1), card(2, 'C', 2)], ai: [card(3, 'C', 20), card(4, 'D', 21)] })
    const n = reduce(s, { type: 'play', cardId: 1 })
    expect(n.turn).toBe(AI)
    expect(n.over).toBe(false)
    expect(n.moves).toBe(1)
  })

  it('结束后所有动作都不再改变状态', () => {
    const over = reduce(withSevenOnTable({ player: [card(6, 'S', 1)] }), { type: 'play', cardId: 1 })
    expect(over.over).toBe(true)
    expect(reduce(over, { type: 'play', cardId: 2 })).toBe(over)
    expect(reduce(over, { type: 'discard', cardId: 2 })).toBe(over)
    expect(legalActions(over)).toEqual([])
  })

  it('非法出牌被拒绝：牌不在手里 / 不满足接龙条件，状态完全不变', () => {
    const s = withSevenOnTable({ player: [card(6, 'S', 1), card(3, 'C', 2)] })
    expect(reduce(s, { type: 'play', cardId: 999 })).toBe(s)
    expect(reduce(s, { type: 'play', cardId: 2 })).toBe(s)
    expect(reduce(s, { type: 'discard', cardId: 999 })).toBe(s)
  })
})

// ---------------- AI ----------------

describe('AI', () => {
  it('不是电脑回合或已结束时返回 null', () => {
    const s = withSevenOnTable({ player: [card(6, 'S', 1)], ai: [card(6, 'H', 20)] })
    expect(aiAction(s)).toBeNull()
    expect(aiAction({ ...s, turn: AI })).not.toBeNull()
    expect(aiAction({ ...s, turn: AI, over: true })).toBeNull()
  })

  it('有 7 和其他可出的牌时优先打 7', () => {
    const s = withSevenOnTable({ turn: AI, ai: [card(7, 'S', 20), card(6, 'H', 21), card(8, 'C', 22)] })
    expect(aiAction(s)).toEqual({ type: 'play', cardId: 20 })
  })

  it('无牌可打时选择弃牌，并丢掉离桌面最远的一张', () => {
    // 桌面上只有 7：3/4/5 都打不出，其中 3 离桌面最远，应该先被丢掉
    const s = makeState({ turn: AI, ai: [card(5, 'S', 20), card(3, 'H', 21), card(4, 'C', 22)], discard: [card(7, 'H', 100)], ranks: [7], deck: [card(2, 'D', 30)] })
    const a = aiAction(s)
    expect(a).not.toBeNull()
    expect(a!.type).toBe('discard')
    expect(legalActions(s)).toContainEqual(a!)
    expect(a).toEqual({ type: 'discard', cardId: 21 })
    // 换掉抽到的牌不影响结论：3 依然是离 7 最远的
    const s2 = makeState({ turn: AI, ai: [card(5, 'S', 20), card(3, 'H', 21), card(4, 'C', 22)], discard: [card(7, 'H', 100)], ranks: [7], deck: [card(11, 'D', 30)] })
    expect(aiAction(s2)).toEqual({ type: 'discard', cardId: 21 })
  })

  it('能一次打光手牌时立刻取胜', () => {
    const s = withSevenOnTable({ turn: AI, ai: [card(6, 'S', 20)], player: [card(2, 'C', 1), card(2, 'D', 2)] })
    expect(aiAction(s)).toEqual({ type: 'play', cardId: 20 })
    expect(reduce(s, aiAction(s)!).over).toBe(true)
    expect(reduce(s, aiAction(s)!).winner).toBe(AI)
  })

  it('整局模拟：AI 的每个 action 都在 legalActions 内，且必然终局', () => {
    for (let seed = 1; seed <= 30; seed++) {
      let s = create(seed * 7919)
      let guard = 0
      while (!s.over && guard++ < 600) {
        const legal = legalActions(s)
        expect(legal.length).toBeGreaterThan(0)
        const act: Action = s.turn === AI ? aiAction(s)! : legal[seed % legal.length]
        // AI 返回的动作必定属于合法集合
        expect(legal).toContainEqual(act)
        s = reduce(s, act)
        expect(totalCards(s)).toBe(DECK_SIZE)
        expect(s.hands[s.turn === PLAYER ? AI : PLAYER].length).toBeGreaterThanOrEqual(0)
      }
      expect(s.over).toBe(true)
      expect(s.winner).not.toBeNull()
      expect(s.moves).toBeGreaterThan(0)
      expect(s.winner === PLAYER || s.winner === AI).toBe(true)
    }
  })

  it('AI 动作可复盘：相同状态总是返回相同动作', () => {
    const s = withSevenOnTable({ turn: AI, ai: [card(6, 'S', 20), card(8, 'H', 21), card(7, 'C', 22)], player: [card(2, 'D', 1)] })
    expect(aiAction(s)).toEqual(aiAction(s))
  })
})

// ---------------- 牌堆耗尽 ----------------

describe('牌堆耗尽自动补牌', () => {
  it('牌堆空时把桌面与弃牌堆洗回，reshuffles +1，且不丢牌不重复', () => {
    const s = makeState({
      player: [card(2, 'S', 1), card(3, 'C', 2)],
      ai: [card(4, 'D', 20)],
      deck: [],
      discard: [card(5, 'H', 100), card(6, 'C', 101)],
      ranks: [5, 6],
      rng: 4242,
    })
    const before = totalCards(s)
    const n = reduce(s, { type: 'discard', cardId: 1 })
    expect(n.reshuffles).toBe(1)
    expect(n.deck.length).toBe(2) // 池子 3 张，弃掉 1 张、抽走 1 张
    expect(n.discard).toHaveLength(0) // 桌面已洗回牌堆
    expect(n.discardRanks).toEqual([5, 6]) // 洗回不影响已接龙的面值
    expect(n.hands[0]).toHaveLength(2)
    expect(totalCards(n)).toBe(before)
    // 抽到的牌进了手牌且不在弃牌堆里
    expect(n.hands[0].map((c) => c.id)).toContain(n.lastDrawn?.id)
    expect(n.deck.some((c) => c.id === n.lastDrawn?.id)).toBe(false)
  })

  it('反复耗尽牌堆都能自动补牌，不会崩溃、不丢牌', () => {
    // 小局面反复抽牌：池子里永远没有 7，因此只会走「弃一张 + 抽一张」
    let s = makeState({
      player: [card(2, 'S', 1), card(3, 'C', 2)],
      ai: [card(4, 'D', 20)],
      deck: [],
      discard: [card(5, 'H', 100), card(6, 'C', 101)],
      ranks: [5, 6],
      rng: 2024,
    })
    const before = totalCards(s)
    for (let i = 0; i < 40 && !s.over; i++) {
      const legal = legalActions(s)
      if (legal.length === 0) break
      s = reduce(s, legal[0])
      expect(s.deck.length).toBeGreaterThanOrEqual(0)
      expect(totalCards(s)).toBe(before)
    }
    expect(s.reshuffles).toBeGreaterThanOrEqual(1)
    expect(s.deck.length).toBeGreaterThanOrEqual(0)
  })

  it('真实对局跑到牌堆耗尽也不崩溃', () => {
    let s = create(99)
    let guard = 0
    while (!s.over && guard++ < 4000) {
      const legal = legalActions(s)
      expect(legal.length).toBeGreaterThan(0)
      s = reduce(s, legal[guard % legal.length])
      expect(totalCards(s)).toBe(DECK_SIZE)
    }
    expect(s.over).toBe(true)
    expect(s.moves).toBeGreaterThan(0)
  })

  it('池子里只剩刚弃掉的那一张时也能补牌，手牌数与全场张数不变', () => {
    const s = makeState({ player: [card(2, 'S', 1)], deck: [], discard: [], ranks: [] })
    const before = totalCards(s)
    const n = reduce(s, { type: 'discard', cardId: 1 })
    expect(n.reshuffles).toBe(1)
    expect(n.deck).toHaveLength(0)
    expect(n.hands[0]).toHaveLength(1) // 抽回的就是刚丢掉的那张
    expect(n.hands[0][0].id).toBe(1)
    expect(n.lastDrawn).not.toBeNull()
    expect(totalCards(n)).toBe(before)
  })
})

// ---------------- 纯函数约束 ----------------

describe('纯函数约束', () => {
  it('reduce 不修改入参（手牌 / 桌面 / 弃牌 / rng 均不变）', () => {
    const s = makeState({
      player: [card(2, 'S', 1), card(3, 'C', 2)],
      ai: [card(4, 'D', 20)],
      deck: [card(9, 'H', 50), card(10, 'C', 51)],
      discard: [card(7, 'H', 100)],
      ranks: [7],
      rng: 31337,
    })
    const hands = s.hands.map((h) => h.slice())
    const discard = s.discard.slice()
    const deck = s.deck.slice()
    const rng = s.rng

    reduce(s, { type: 'discard', cardId: 1 })

    expect(s.hands[0]).toEqual(hands[0])
    expect(s.hands[1]).toEqual(hands[1])
    expect(s.discard).toEqual(discard)
    expect(s.deck).toEqual(deck)
    expect(s.burn).toHaveLength(0)
    expect(s.rng).toBe(rng)
    expect(s.scores).toEqual([0, 0])
    expect(s.moves).toBe(0)
    expect(s.turn).toBe(PLAYER)
    expect(s.discardRanks).toEqual([7])
  })

  it('出牌路径同样不修改入参', () => {
    const s = withSevenOnTable({ player: [card(6, 'S', 1), card(2, 'C', 2)], ai: [card(4, 'D', 20)] })
    const hand = s.hands[0].slice()
    const n = reduce(s, { type: 'play', cardId: 1 })
    expect(n).not.toBe(s)
    expect(s.hands[0]).toEqual(hand)
    expect(s.discard).toHaveLength(1)
    expect(s.chain).toHaveLength(1)
  })

  it('相同输入两次调用结果完全相等', () => {
    const s = makeState({ player: [card(2, 'S', 1)], deck: [card(9, 'H', 50)], rng: 555 })
    expect(reduce(s, { type: 'discard', cardId: 1 })).toEqual(reduce(s, { type: 'discard', cardId: 1 }))
    const t = withSevenOnTable({ player: [card(6, 'S', 1)] })
    expect(reduce(t, { type: 'play', cardId: 1 })).toEqual(reduce(t, { type: 'play', cardId: 1 }))
  })

  it('同一串操作可以完整复盘（最终状态逐字段一致）', () => {
    const run = (): State => {
      let s = create(20260420)
      let guard = 0
      while (!s.over && guard++ < 200) {
        const legal = legalActions(s)
        s = reduce(s, legal[guard % legal.length])
      }
      return s
    }
    expect(run()).toEqual(run())
  })
})
