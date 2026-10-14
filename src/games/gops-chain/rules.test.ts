import { describe, expect, it } from 'vitest'
import {
  AI,
  DECK_SIZE,
  HAND_SIZE,
  PLAYER,
  STALL_LIMIT,
  UNDO_LIMIT,
  aiAction,
  canFollow,
  canPlay,
  ctxOf,
  create,
  hintAction,
  isLegal,
  legalActions,
  pass,
  play,
  playCandidates,
  playableCards,
  reduce,
  refillStock,
  roundSuit,
  sameAction,
  stock,
  totalCards,
  undo,
  type Action,
  type Player,
  type State,
} from './rules'
import type { Card, Suit } from '../../core/cards'
import { isJoker } from '../../core/cards'
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
  leadSuit?: Suit | null
  hands: [Card[], Card[]]
  pile?: Card[]
  deck?: Card[]
  turn?: Player
  lastPlayed?: Card | null
  lastSide?: Player
  chainPlays?: number
  passStreak?: number
  passes?: number
  rounds?: number
  undoLeft?: number
  over?: boolean
  rng?: number
}): State {
  const tableTop = opts.tableTop ?? null
  return {
    hands: [opts.hands[0], opts.hands[1]],
    deck: opts.deck ?? [],
    pile: opts.pile ?? [],
    tableTop,
    lastPlayed: opts.lastPlayed === undefined ? tableTop : opts.lastPlayed,
    lastSide: opts.lastSide ?? opts.turn ?? PLAYER,
    leadSuit: opts.leadSuit ?? null,
    turn: opts.turn ?? PLAYER,
    moves: 0,
    passes: opts.passes ?? 0,
    chainPlays: opts.chainPlays ?? 0,
    passStreak: opts.passStreak ?? 0,
    rounds: opts.rounds ?? 0,
    recycles: 0,
    undoLeft: opts.undoLeft ?? UNDO_LIMIT,
    undo: [],
    hintCardId: null,
    over: opts.over ?? false,
    winner: 0,
    rng: opts.rng ?? 20240101,
  }
}

/** 动作是否落在 legalActions 集合内（与 AI / 提示共用的判定） */
function inLegal(state: State, action: Action): boolean {
  return legalActions(state).some((a) => sameAction(a, action))
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

  it('人均 27 张、桌面为空、不限起手花色、悔牌 3 次、玩家先出', () => {
    const s = create(42)
    expect(s.hands[0].length).toBe(HAND_SIZE)
    expect(s.hands[1].length).toBe(HAND_SIZE)
    expect(stock(s)).toBe(0)
    expect(s.pile.length).toBe(0)
    expect(s.tableTop).toBeNull()
    expect(s.leadSuit).toBeNull()
    expect(roundSuit(s)).toBeNull()
    expect(s.turn).toBe(PLAYER)
    expect(s.moves).toBe(0)
    expect(s.chainPlays).toBe(0)
    expect(s.passStreak).toBe(0)
    expect(s.rounds).toBe(0)
    expect(s.over).toBe(false)
    expect(s.winner).toBe(0)
    expect(s.undoLeft).toBe(UNDO_LIMIT)
    expect(s.undo).toEqual([])
    expect(s.hintCardId).toBeNull()
  })

  it('牌数守恒：手牌 + 牌堆 + 弃牌堆 === 54', () => {
    const s = create(7)
    expect(totalCards(s)).toBe(DECK_SIZE)
    const n = play(s, s.hands[0][3].id)
    expect(totalCards(n)).toBe(DECK_SIZE)
    expect(n.hands[0].length).toBe(HAND_SIZE - 1)
    expect(n.pile.length).toBe(1)
  })

  it('首局不限花色：桌面为空时 27 张手牌全部可以打出', () => {
    const s = create(2024)
    expect(playableCards(s, PLAYER).length).toBe(HAND_SIZE)
    expect(legalActions(s).length).toBe(HAND_SIZE)
    expect(legalActions(s).every((a) => a.type === 'play')).toBe(true)
    for (const c of s.hands[0]) {
      const n = reduce(s, { type: 'play', cardId: c.id })
      expect(n).not.toBe(s)
      expect(n.hands[0].length).toBe(HAND_SIZE - 1)
      if (!isJoker(c)) expect(n.tableTop).toEqual(c)
    }
  })
})

describe('接龙规则：同花色只能往大接', () => {
  it('桌面 7♠ 之后只能出 8♠，6♠ 接不上', () => {
    expect(canFollow(S(8), S(7))).toBe(true)
    expect(canFollow(S(6), S(7))).toBe(false)
    expect(canFollow(S(9), S(7))).toBe(false)
    const s = scenario({ tableTop: S(7), hands: [[S(5), S(6), S(8), S(9)], [S(8)]] })
    expect(playableCards(s, PLAYER).map((c) => c.id)).toEqual([S(8).id])
    expect(isLegal(s, { type: 'play', cardId: S(8).id })).toBe(true)
    expect(isLegal(s, { type: 'play', cardId: S(6).id })).toBe(false)
    expect(isLegal(s, { type: 'play', cardId: S(9).id })).toBe(false)
  })

  it('跨花色不可接：桌面 7♠ 时 8♥ / 8♣ / 8♦ 全部非法', () => {
    const s = scenario({ tableTop: S(7), hands: [[H(8), C(8), D(8), S(8)], []] })
    expect(playableCards(s, PLAYER).map((c) => c.id)).toEqual([S(8).id])
    for (const bad of [H(8), C(8), D(8)]) {
      expect(isLegal(s, { type: 'play', cardId: bad.id })).toBe(false)
      expect(reduce(s, { type: 'play', cardId: bad.id })).toBe(s)
    }
  })

  it('边界：桌面为 A 只能接 2；桌面为 K 无人能接', () => {
    expect(canFollow(S(2), S(1))).toBe(true)
    const aTop = scenario({ tableTop: S(1), hands: [[S(1), S(2), S(13)], []] })
    expect(playableCards(aTop, PLAYER).map((c) => c.rank)).toEqual([2])
    const kTop = scenario({ tableTop: S(13), hands: [[S(12), S(1)], []] })
    expect(playableCards(kTop, PLAYER)).toHaveLength(0)
    expect(legalActions(kTop)).toEqual([{ type: 'pass' }])
  })

  it('出王之后仍然接同一张非王牌：王不建立接龙基准', () => {
    const s = scenario({ tableTop: S(7), hands: [[BIG_JOKER], [S(8), S(9)]], turn: PLAYER })
    const n = play(s, BIG_JOKER.id)
    expect(n.tableTop).toEqual(S(7))
    expect(roundSuit(n)).toBe('S')
    expect(n.lastPlayed).toEqual(BIG_JOKER)
    expect(n.turn).toBe(AI)
    expect(n.chainPlays).toBe(1)
    expect(playableCards(n, AI).map((c) => c.id)).toEqual([S(8).id])
  })

  it('canPlay 是唯一判定：与 legalActions 的结果始终一致', () => {
    const tops: Array<Card | null> = [null, S(7), H(1), C(13), D(4)]
    for (const top of tops) {
      const leadSuit: Suit | null = top === null ? 'D' : null
      const s = scenario({ tableTop: top, leadSuit, hands: [[S(6), D(5), D(6), BIG_JOKER], []] })
      const byRule = s.hands[0].filter((c) => canPlay(c, ctxOf(s, PLAYER))).map((c) => c.id)
      const byAction = playCandidates(s, PLAYER).map((a) => (a.type === 'play' ? a.cardId : -1))
      expect(byAction).toEqual(byRule)
    }
  })
})

describe('万能牌（大小王）', () => {
  it('大小王任何时候都能打出', () => {
    for (const top of [null, S(7), H(1), C(13), D(4)]) {
      expect(canPlay(SMALL_JOKER, { top, leadSuit: null, hasLeadSuit: false })).toBe(true)
      expect(canPlay(BIG_JOKER, { top, leadSuit: null, hasLeadSuit: false })).toBe(true)
    }
  })

  it('桌面为空时打出王，桌面仍为空（本轮还没有花色）', () => {
    const s = scenario({ hands: [[SMALL_JOKER, S(5)], [D(3)]] })
    const n = play(s, SMALL_JOKER.id)
    expect(n.tableTop).toBeNull()
    expect(roundSuit(n)).toBeNull()
    // 王没有建立基准，桌面仍为空 → 下一家依然可以任选花色起手
    expect(playableCards(n, AI).map((c) => c.id)).toEqual([D(3).id])
  })

  it('王也参与「必须完整接龙」：手上有王就不能过牌', () => {
    const s = scenario({ tableTop: C(13), hands: [[BIG_JOKER, H(4)], []] })
    expect(playableCards(s, PLAYER).map((c) => c.id)).toEqual([BIG_JOKER.id])
    expect(reduce(s, { type: 'pass' })).toBe(s)
  })
})

describe('必须完整接龙：还能接却被判过牌', () => {
  it('还有可接的牌时过牌被拒绝（引用相等，状态完全不变）', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(8), S(9)], [S(6)]], turn: PLAYER })
    expect(legalActions(s)).toEqual([{ type: 'play', cardId: S(8).id }])
    const before = JSON.stringify(s)
    expect(reduce(s, { type: 'pass' })).toBe(s)
    expect(JSON.stringify(s)).toBe(before)
    expect(s.passes).toBe(0)
    expect(s.turn).toBe(PLAYER)
  })

  it('确实接完（一张都接不上）时过牌被接受', () => {
    const s = scenario({ tableTop: C(13), hands: [[S(9), H(3)], [D(4)]], turn: PLAYER })
    expect(playableCards(s, PLAYER)).toHaveLength(0)
    const n = reduce(s, { type: 'pass' })
    expect(n).not.toBe(s)
    expect(n.passes).toBe(1)
    expect(n.passStreak).toBe(1)
    expect(n.turn).toBe(AI)
    expect(n.tableTop).toEqual(C(13))
  })

  it('一轮内连续接龙：双方都不能在还能接时过牌', () => {
    let s = scenario({ tableTop: S(5), hands: [[S(6), S(7), H(9)], [S(8), S(7)]], turn: PLAYER })
    expect(reduce(s, { type: 'pass' })).toBe(s)
    s = play(s, S(6).id)
    expect(s.chainPlays).toBe(1)
    expect(s.turn).toBe(AI)
    // 电脑必须接 7♠（手里正好有），不能过牌
    expect(reduce(s, { type: 'pass' })).toBe(s)
    s = play(s, S(7).id)
    expect(s.chainPlays).toBe(2)
    expect(s.tableTop).toEqual(S(7))
    expect(s.moves).toBe(2)
    expect(s.turn).toBe(PLAYER)
    // 玩家手里只剩 H(9)，接不上 8♠ → 这时才允许过牌
    expect(playableCards(s, PLAYER)).toHaveLength(0)
    s = reduce(s, { type: 'pass' })
    expect(s.turn).toBe(AI)
    expect(s.chainPlays).toBe(2)
  })

  it('连续两次过牌即一轮结束，桌面清空', () => {
    let s = scenario({
      tableTop: S(13),
      hands: [[H(3)], [D(9)]],
      turn: PLAYER,
      passStreak: 1,
      lastSide: PLAYER,
      lastPlayed: S(13),
    })
    expect(legalActions(s)).toEqual([{ type: 'pass' }])
    s = reduce(s, { type: 'pass' })
    expect(s.rounds).toBe(1)
    expect(s.passStreak).toBe(0)
    expect(s.chainPlays).toBe(0)
    expect(s.tableTop).toBeNull()
    expect(s.leadSuit).toBe('S')
    // 起手权归最后出牌者（这里就是玩家，因为上一张 S(13) 是玩家打的）
    expect(s.turn).toBe(PLAYER)
  })

  it('手牌清空即判胜：任何后续动作都不生效', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(8)], [S(6)]], turn: PLAYER })
    const n = play(s, S(8).id)
    expect(n.hands[0]).toHaveLength(0)
    expect(n.over).toBe(true)
    expect(n.winner).toBe(PLAYER)
    expect(legalActions(n)).toEqual([])
    expect(reduce(n, { type: 'pass' })).toBe(n)
    expect(reduce(n, { type: 'undo' })).toBe(n)
    expect(aiAction(n)).toBeNull()
    expect(hintAction(n)).toBeNull()
  })
})

describe('新一轮指定花色起手', () => {
  it('首局 leadSuit 为 null：起手时任意花色都行', () => {
    const s = scenario({ hands: [[S(3), H(9)], []] })
    expect(s.leadSuit).toBeNull()
    expect(playableCards(s, PLAYER).length).toBe(2)
  })

  it('指定花色起手：只能出该花色，其它花色被拒', () => {
    const s = scenario({ leadSuit: 'S', hands: [[S(3), H(9), D(5)], []], lastSide: PLAYER })
    expect(playableCards(s, PLAYER).map((c) => c.id)).toEqual([S(3).id])
    expect(isLegal(s, { type: 'play', cardId: H(9).id })).toBe(false)
    const n = play(s, S(3).id)
    expect(n.tableTop).toEqual(S(3))
    expect(roundSuit(n)).toBe('S')
  })

  it('指定花色时王仍然可以起手（万能牌兜底）', () => {
    const s = scenario({ leadSuit: 'C', hands: [[S(3), C(4), BIG_JOKER], [SMALL_JOKER]] })
    expect(playableCards(s, PLAYER).map((c) => c.id)).toEqual([C(4).id, BIG_JOKER.id])
    const n = play(s, BIG_JOKER.id)
    expect(n.tableTop).toBeNull()
    expect(n.turn).toBe(AI)
    // 王没有建立接龙基准：桌面仍为空，对手照样可以用自己的王起手
    const m = play(n, SMALL_JOKER.id)
    expect(m.tableTop).toBeNull()
    expect(m.turn).toBe(PLAYER)
    expect(m.hands[0].map((c) => c.id)).toEqual([S(3).id, C(4).id])
    // 连续两张王打出去之后，指定花色的限制依旧生效
    expect(playableCards(m, PLAYER).map((c) => c.id)).toEqual([C(4).id])
  })

  it('起手方手上没有指定花色时限制自动解除（防死局）', () => {
    const s = scenario({ leadSuit: 'C', hands: [[S(3), H(9)], []] })
    expect(ctxOf(s, PLAYER).hasLeadSuit).toBe(false)
    expect(playableCards(s, PLAYER).length).toBe(2)
    // 别人有该花色时不解除
    const t = scenario({ leadSuit: 'C', hands: [[S(3)], [C(4)]], turn: AI })
    expect(ctxOf(t, AI).hasLeadSuit).toBe(true)
    expect(playableCards(t, AI).map((c) => c.id)).toEqual([C(4).id])
  })

  it('指定花色 = 本轮最后一张非王牌的花色；最后一张是王则退回末牌花色', () => {
    const plain = scenario({ tableTop: S(7), hands: [[D(4)], [H(2)]], lastSide: AI, lastPlayed: H(2) })
    expect(pass(pass(plain)).leadSuit).toBe('H')
    const jokerLast = scenario({
      tableTop: S(7),
      hands: [[D(4)], [H(2)]],
      lastSide: AI,
      lastPlayed: BIG_JOKER,
    })
    const n = pass(pass(jokerLast))
    expect(n.leadSuit).toBe('S')
    expect(n.turn).toBe(AI)
  })

  it('一轮结束后由最后出牌者起手（并据此指定花色）', () => {
    let s = scenario({ hands: [[D(4), D(9), S(2)], [S(3), H(4)]], turn: PLAYER })
    s = play(s, D(4).id)
    expect(s.tableTop).toEqual(D(4))
    s = pass(s)
    expect(s.turn).toBe(PLAYER)
    s = pass(s)
    expect(s.rounds).toBe(1)
    // 最后出牌者是玩家，所以由玩家起手，且必须用 ♦ 起手（手里有 ♦，限制不解除）
    expect(s.turn).toBe(PLAYER)
    expect(s.leadSuit).toBe('D')
    expect(s.tableTop).toBeNull()
    const next = playableCards(s, PLAYER)
    expect(next.length).toBeGreaterThan(0)
    expect(next.every((c) => c.suit === 'D')).toBe(true)
    expect(next.map((c) => c.id)).not.toContain(S(2).id)
  })
})

describe('悔牌（一局 3 次）', () => {
  it('悔牌回到上一个动作之前：手牌回来、moves 减 1', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(8), H(3)], [S(6)]] })
    const played = play(s, S(8).id)
    expect(played.undo).toHaveLength(1)
    const back = reduce(played, { type: 'undo' })
    expect(back).not.toBe(played)
    expect(back.undoLeft).toBe(UNDO_LIMIT - 1)
    expect(back.hands[0]).toEqual(s.hands[0])
    expect(back.moves).toBe(0)
    expect(back.tableTop).toEqual(S(7))
    expect(back.turn).toBe(PLAYER)
    expect(back.pile).toEqual(s.pile)
  })

  it('悔牌上限 3 次：第 4 次被拒绝且 undoLeft 保持 0', () => {
    let s = scenario({ tableTop: S(1), hands: [[S(2), S(3), S(4), S(5)], [S(13)]] })
    s = play(s, S(2).id) // 玩家出牌 → 压入 1 帧
    s = reduce(s, { type: 'pass' }) // 电脑无牌可接 → 过牌 → 压入第 2 帧
    s = play(s, S(3).id)
    s = reduce(s, { type: 'pass' })
    expect(s.undoLeft).toBe(UNDO_LIMIT)
    expect(s.moves).toBe(2)
    for (let i = 0; i < UNDO_LIMIT; i++) {
      const depth = s.undo.length
      s = undo(s)
      expect(s.undoLeft).toBe(UNDO_LIMIT - 1 - i)
      expect(s.undo).toHaveLength(depth - 1)
      expect(totalCards(s)).toBe(5)
    }
    expect(s.undoLeft).toBe(0)
    expect(s.undo).toHaveLength(0)
    const before = JSON.stringify(s)
    expect(reduce(s, { type: 'undo' })).toBe(s)
    expect(JSON.stringify(s)).toBe(before)
  })

  it('悔牌栈深度上限 3：连续出牌也不会无限增长，且悔牌后仍是合法局面', () => {
    let s = scenario({ tableTop: S(1), hands: [[S(2), S(3), S(4), S(5), S(6)], [S(13)]] })
    for (const id of [S(2).id, S(3).id, S(4).id, S(5).id]) {
      s = play(s, id)
      s = reduce(s, { type: 'pass' })
      expect(s.undo.length).toBeLessThanOrEqual(UNDO_LIMIT)
    }
    expect(s.moves).toBe(4)
    expect(s.undo).toHaveLength(UNDO_LIMIT)
    expect(s.undoLeft).toBe(UNDO_LIMIT)
    // 只能回退最近 3 个动作，但 3 次悔牌都能用掉
    s = undo(s)
    expect(legalActions(s).length).toBeGreaterThan(0)
    s = undo(s)
    expect(legalActions(s).length).toBeGreaterThan(0)
    s = undo(s)
    expect(s.undoLeft).toBe(0)
    expect(s.undo).toHaveLength(0)
    expect(s.moves).toBeLessThan(4)
  })

  it('悔牌栈空时也被拒绝', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(8)], []] })
    expect(s.undo).toEqual([])
    expect(reduce(s, { type: 'undo' })).toBe(s)
  })

  it('悔牌后整局仍然可复盘，且不影响牌数守恒', () => {
    let s = create(4242)
    s = play(s, s.hands[0][0].id)
    s = reduce(s, { type: 'undo' })
    expect(s).toEqual(reduce(reduce(create(4242), { type: 'play', cardId: create(4242).hands[0][0].id }), { type: 'undo' }))
    expect(totalCards(s)).toBe(DECK_SIZE)
  })
})

describe('牌堆洗回与死局救援', () => {
  it('牌堆耗尽时把弃牌堆洗回成为新牌堆，并推进 rng', () => {
    const s = scenario({ tableTop: H(3), hands: [[], []], pile: [H(2), H(9), S(5), C(7)] })
    const n = refillStock(s)
    expect(n.deck).toHaveLength(4)
    expect(n.pile).toHaveLength(0)
    const expected = [H(2).id, H(9).id, S(5).id, C(7).id].sort((a, b) => a - b)
    expect([...n.deck].map((c) => c.id).sort((a, b) => a - b)).toEqual(expected)
    expect(n.rng).not.toBe(s.rng)
    expect(s.pile).toHaveLength(4)
    expect(s.deck).toHaveLength(0)
    expect(refillStock(s)).toEqual(refillStock(s))
  })

  it('牌堆非空或弃牌堆为空时原样返回（同一引用）', () => {
    const withStock = scenario({ tableTop: H(3), hands: [[], []], pile: [H(2)], deck: [S(4)] })
    expect(refillStock(withStock)).toBe(withStock)
    const emptyPile = scenario({ tableTop: H(3), hands: [[], []] })
    expect(refillStock(emptyPile)).toBe(emptyPile)
  })

  it('一轮结束时牌堆耗尽：弃牌堆洗回并给双方各补 1 张', () => {
    const stuck = scenario({
      tableTop: H(3),
      hands: [[S(1)], [C(1)]],
      pile: [H(2), H(13)],
      turn: PLAYER,
      passStreak: 1,
    })
    expect(playableCards(stuck, PLAYER)).toHaveLength(0)
    const n = reduce(stuck, { type: 'pass' })
    expect(n.rounds).toBe(1)
    expect(n.recycles).toBe(1)
    expect(n.pile).toHaveLength(0)
    expect(n.deck).toHaveLength(0)
    expect(n.hands[0]).toHaveLength(2)
    expect(n.hands[1]).toHaveLength(2)
    expect(totalCards(n)).toBe(totalCards(stuck))
    // 补进来的牌确实来自原来的弃牌堆
    expect([H(2).id, H(13).id]).toContain(n.hands[0][1].id)
    expect(n.hands[0][1].id).not.toBe(n.hands[1][1].id)
  })

  it('反复过牌也推进不了局面时判平局，绝不让对局卡死', () => {
    const stuck = scenario({ tableTop: H(3), hands: [[S(1)], [C(1)]], turn: PLAYER, passes: STALL_LIMIT - 1 })
    const n = reduce(stuck, { type: 'pass' })
    expect(n.passes).toBe(STALL_LIMIT)
    expect(n.over).toBe(true)
    expect(n.winner).toBe(0)
    expect(legalActions(n)).toEqual([])
  })
})

describe('提示', () => {
  it('hint 返回的动作永远落在 legalActions 内', () => {
    const states: State[] = [
      create(11),
      create(97),
      scenario({ tableTop: S(7), hands: [[S(8), S(9), H(3)], [S(6)]], turn: PLAYER }),
      scenario({ tableTop: S(13), hands: [[H(3)], [D(4)]], turn: AI }),
      scenario({ leadSuit: 'D', hands: [[S(3), D(7)], []], turn: PLAYER }),
    ]
    for (const s of states) {
      const a = hintAction(s)
      expect(a).not.toBeNull()
      expect(inLegal(s, a as Action)).toBe(true)
    }
  })

  it('有牌可接时提示给出一张可接的牌，没有时给出「过」', () => {
    const ok = scenario({ tableTop: S(7), hands: [[S(8), S(9), H(3)], []] })
    const a = hintAction(ok)
    expect(a?.type).toBe('play')
    expect(a?.type === 'play' && a.cardId).toBe(S(8).id)
    const stuck = scenario({ tableTop: S(13), hands: [[H(3)], []] })
    expect(hintAction(stuck)).toEqual({ type: 'pass' })
  })

  it('对局结束后提示返回 null', () => {
    const done: State = { ...scenario({ tableTop: S(7), hands: [[S(8)], []], turn: AI }), over: true, winner: AI }
    expect(hintAction(done)).toBeNull()
  })

  it('提示只改 hintCardId，不动牌局、不占悔牌次数', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(8), S(9)], [S(6)]] })
    const n = reduce(s, { type: 'hint' })
    expect(n.hintCardId).not.toBeNull()
    expect(inLegal(n, { type: 'play', cardId: n.hintCardId as number })).toBe(true)
    expect(n.hands).toEqual(s.hands)
    expect(n.tableTop).toEqual(s.tableTop)
    expect(n.moves).toBe(0)
    expect(n.undoLeft).toBe(s.undoLeft)
    expect(n.undo).toEqual([])
  })
})

describe('纯函数与可复盘', () => {
  it('reduce 不修改入参（rng / hands / pile / tableTop 全部不变）', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(8), BIG_JOKER], [S(6)]], pile: [C(3)], rng: 12345 })
    const snapshot = JSON.stringify(s)
    play(s, BIG_JOKER.id)
    play(s, S(8).id)
    reduce(s, { type: 'pass' })
    reduce(s, { type: 'hint' })
    reduce(s, { type: 'undo' })
    reduce(s, { type: 'play', cardId: H(9).id })
    expect(JSON.stringify(s)).toBe(snapshot)
    expect(s.rng).toBe(12345)
    expect(s.hands[0]).toHaveLength(2)
    expect(s.hands[1]).toHaveLength(1)
    expect(s.pile).toEqual([C(3)])
    expect(s.deck).toHaveLength(0)
    expect(s.tableTop).toEqual(S(7))
    expect(s.moves).toBe(0)
    expect(s.undoLeft).toBe(UNDO_LIMIT)
  })

  it('相同输入两次调用结果完全相等（含 undo / hint / 过牌）', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(8), S(9)], [S(6)]], pile: [H(2)] })
    expect(play(s, S(8).id)).toEqual(play(s, S(8).id))
    const j = play(s, S(8).id)
    expect(reduce(j, { type: 'undo' })).toEqual(reduce(j, { type: 'undo' }))
    expect(reduce(j, { type: 'hint' })).toEqual(reduce(j, { type: 'hint' }))
    const stuck = scenario({ tableTop: S(13), hands: [[H(3)], [D(4)]], pile: [H(2)] })
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
      s = reduce(s, { type: 'hint' })
      s = reduce(s, { type: 'play', cardId: s.hands[0][0].id })
      s = reduce(s, { type: 'undo' })
      s = reduce(s, { type: 'play', cardId: s.hands[0][0].id })
      const cand = hintAction(s)
      if (cand) s = reduce(s, cand)
      return s
    }
    expect(run()).toEqual(run())
  })
})

describe('AI', () => {
  it('只在电脑回合返回动作，其余时刻返回 null', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(8)], [S(6)]], turn: PLAYER })
    expect(aiAction(s)).toBeNull()
    const aiTurn = scenario({ tableTop: S(7), hands: [[S(8)], [S(6)]], turn: AI })
    expect(aiAction(aiTurn)).not.toBeNull()
    const done: State = { ...aiTurn, over: true, winner: AI }
    expect(aiAction(done)).toBeNull()
  })

  it('AI 的候选全部来自 legalActions，并且能抓住直接打完的机会', () => {
    const s = scenario({ tableTop: S(7), hands: [[S(9), S(6)], [S(8)]], turn: AI })
    const legal = legalActions(s)
    expect(legal).toEqual([{ type: 'play', cardId: S(8).id }])
    const a = aiAction(s)
    expect(inLegal(s, a as Action)).toBe(true)
    expect(a).toEqual({ type: 'play', cardId: S(8).id })
    expect(play(s, S(8).id).winner).toBe(AI)
  })

  it('有牌可出时 AI 不跳过，也不先丢万能牌；接龙优先出小牌', () => {
    const s = scenario({ tableTop: S(7), hands: [[H(3), D(9)], [S(6), S(8), BIG_JOKER, SMALL_JOKER]], turn: AI })
    // 只能往大接：6♠ 接不上 7♠，候选是 8♠ 与两张王
    expect(legalActions(s).length).toBe(3)
    const a = aiAction(s)
    expect(a?.type).toBe('play')
    // 玩家接不上 8♠，先出小牌既能锁住对手又留了后续链
    expect(a?.type === 'play' && a.cardId).toBe(S(8).id)
  })

  it('AI 一张都出不了时返回「过」', () => {
    const s = scenario({ tableTop: S(13), hands: [[S(9)], [H(4), D(10)]], turn: AI })
    expect(legalActions(s)).toEqual([{ type: 'pass' }])
    expect(aiAction(s)).toEqual({ type: 'pass' })
  })

  it('指定花色起手时 AI 必定打出该花色（或王）', () => {
    const s = scenario({ leadSuit: 'H', hands: [[], [S(3), D(9), H(5), H(6)]], turn: AI })
    const a = aiAction(s)
    expect(a?.type).toBe('play')
    const id = a?.type === 'play' ? a.cardId : -1
    expect([H(5).id, H(6).id]).toContain(id)
    expect(roundSuit(play(s, id))).toBe('H')
  })
})

describe('整局模拟', () => {
  it('随机模拟多整局：必然终局、牌数守恒、动作始终合法', () => {
    for (let seed = 1; seed <= 10; seed++) {
      let s = create(seed * 7919 + 13)
      const r = new Rng(seed * 977 + 5)
      let guard = 0
      while (!s.over && guard++ < 6000) {
        const legal = legalActions(s)
        expect(legal.length).toBeGreaterThan(0)
        const a = s.turn === AI ? aiAction(s) : legal[r.int(legal.length)]
        expect(a).not.toBeNull()
        expect(inLegal(s, a as Action)).toBe(true)
        s = reduce(s, a as Action)
        expect(totalCards(s)).toBe(DECK_SIZE)
        expect(s.undoLeft).toBeGreaterThanOrEqual(0)
        expect(s.undo.length).toBeLessThanOrEqual(UNDO_LIMIT)
      }
      expect(s.over).toBe(true)
      expect([0, 1, 2]).toContain(s.winner)
      expect(guard).toBeLessThan(6000)
    }
  })

  it('双方都用 AI 也能把牌打完（AI 动作始终合法）', () => {
    for (let seed = 1; seed <= 6; seed++) {
      let s = create(seed * 104729 + 3)
      let guard = 0
      while (!s.over && guard++ < 6000) {
        const legal = legalActions(s)
        expect(legal.length).toBeGreaterThan(0)
        // 玩家一侧同样用共享的评分（hintAction 与 AI 同源），保证两边都不出非法牌
        const a = s.turn === AI ? aiAction(s) : hintAction(s)
        expect(a).not.toBeNull()
        expect(inLegal(s, a as Action)).toBe(true)
        s = reduce(s, a as Action)
      }
      expect(s.over).toBe(true)
    }
  })

  it('连续多整局都不抛错，AI 侧永远不会出非法牌', () => {
    for (let seed = 1; seed <= 6; seed++) {
      let s = create(seed * 6151 + 17)
      let guard = 0
      while (!s.over && guard++ < 6000) {
        const a = s.turn === AI ? aiAction(s) : legalActions(s)[0]
        if (s.turn === AI) {
          expect(a).not.toBeNull()
          expect(inLegal(s, a as Action)).toBe(true)
        }
        s = reduce(s, a as Action)
      }
      expect(s.over).toBe(true)
      expect(totalCards(s)).toBe(DECK_SIZE)
    }
  })
})