import { describe, expect, it } from 'vitest'
import type { Card, Suit } from '../../core/cards'
import {
  DECK_SIZE,
  DECKS,
  HAND_SIZE,
  LEAD_RANK,
  MAX_CHAIN,
  WILDCARD_RANK,
  aiAction,
  canLeadSuit,
  canPlay,
  create,
  dealFrom,
  effectiveAfter,
  isLegal,
  lead,
  legalActions,
  other,
  pass,
  playableCards,
  play,
  remaining,
  reduce,
  sameAction,
  type Action,
  type Side,
  type State,
} from './rules'

let idSeq = 1
/** 构造一张指定点数与花色的牌（id 自动递增，保证唯一） */
function card(rank: number, suit: Suit = 'S'): Card {
  return { id: idSeq++, suit, rank }
}

/** 构造一个完全可控的局面：手牌 / 末牌 / 本轮花色 / 进度都能指定 */
function stateWith(
  o: {
    mine?: Card[]
    theirs?: Card[]
    turnCard?: Card | null
    turnRank?: number
    leadSuit?: Suit | null
    leader?: Side | null
    turn?: Side
    chainCount?: number
    passStreak?: number
    phase?: State['phase']
    pile?: Card[]
    deck?: Card[]
    cursor?: number
    rng?: number
    rounds?: number
  } = {},
): State {
  const base = create(20260101)
  const turnRank = o.turnRank ?? (o.turnCard ? o.turnCard.rank : 0)
  const leadSuit = o.leadSuit ?? (o.turnCard ? (o.turnCard.suit as Suit) : null)
  return {
    ...base,
    hands: [o.mine ?? [], o.theirs ?? []],
    pile: o.pile ?? (o.turnCard ? [o.turnCard] : []),
    turnCard: o.turnCard ?? null,
    turnRank,
    leadSuit,
    leader: o.leader ?? null,
    turn: o.turn ?? 'player',
    chainCount: o.chainCount ?? 0,
    passStreak: o.passStreak ?? 0,
    phase: o.phase ?? 'play',
    deck: o.deck ?? base.deck,
    cursor: o.cursor ?? base.cursor,
    rounds: o.rounds ?? 0,
    rng: o.rng ?? base.rng,
  }
}

/** 从 legalActions 里取第 i 个动作 */
const nthAction = (s: State, i = 0): Action => legalActions(s)[i] as Action

/** 人机对完整跑完一整局（玩家随便挑合法动作，电脑走 AI） */
function playOut(seed: number, maxSteps = 4000): { state: State; steps: number; aiActions: number } {
  let s = create(seed)
  let steps = 0
  let aiActions = 0
  while (!s.over && steps < maxSteps) {
    const legal = legalActions(s)
    if (legal.length === 0) break
    let a: Action
    if (s.turn === 'ai') {
      a = aiAction(s) as Action
      aiActions += 1
    } else {
      a = legal[steps % legal.length] as Action
    }
    const next = reduce(s, a)
    expect(next).not.toBe(s) // 每个合法动作都必须推进状态
    s = next
    steps += 1
  }
  return { state: s, steps, aiActions }
}

describe('初始状态', () => {
  it('两副无王共 104 张、两人各 52 张、牌堆剩余 0、先手固定为玩家', () => {
    const s = create(42)
    expect(DECKS).toBe(2)
    expect(DECK_SIZE).toBe(104)
    expect(HAND_SIZE).toBe(52)
    expect(s.deck).toHaveLength(104)
    expect(s.hands[0]).toHaveLength(HAND_SIZE)
    expect(s.hands[1]).toHaveLength(HAND_SIZE)
    expect(s.hands[0].length + s.hands[1].length).toBe(DECK_SIZE)
    expect(s.cursor).toBe(DECK_SIZE)
    expect(remaining(s)).toBe(0)
    expect(s.pile).toEqual([])
    expect(s.turnCard).toBeNull()
    expect(s.turnRank).toBe(0)
    expect(s.leadSuit).toBeNull()
    expect(s.leader).toBeNull()
    expect(s.turn).toBe('player')
    expect(s.chainCount).toBe(0)
    expect(s.passStreak).toBe(0)
    expect(s.phase).toBe('play')
    expect(s.over).toBe(false)
    expect(s.winner).toBeNull()
    expect(s.plays).toBe(0)
    expect(s.passes).toBe(0)
    expect(s.rounds).toBe(0)
  })

  it('104 张牌里没有大小王，两手牌互不相同', () => {
    const s = create(7)
    const all = s.hands[0].concat(s.hands[1])
    expect(all).toHaveLength(104)
    expect(all.every((c) => c.suit !== 'J')).toBe(true)
    expect(new Set(all.map((c) => c.id)).size).toBe(104)
    // 每种花色每种点数各 2 张
    const counts = new Map<string, number>()
    for (const c of all) counts.set(`${c.suit}${c.rank}`, (counts.get(`${c.suit}${c.rank}`) ?? 0) + 1)
    expect(counts.size).toBe(52)
    expect([...counts.values()].every((v) => v === 2)).toBe(true)
  })

  it('轮流发牌：玩家与电脑交替取走牌堆顶部的牌', () => {
    const s = create(99)
    expect(s.hands[0][0]).toEqual(s.deck[0])
    expect(s.hands[1][0]).toEqual(s.deck[1])
    expect(s.hands[0][1]).toEqual(s.deck[2])
    expect(s.hands[1][1]).toEqual(s.deck[3])
  })

  it('首局任意花色都可以开首牌', () => {
    const cards = [card(13, 'H'), card(5, 'C'), card(1, 'S')]
    const s = stateWith({ mine: cards, turn: 'player' })
    expect(playableCards(s).length).toBe(3)
    for (const c of cards) {
      expect(canPlay(c, 0, null)).toBe(true)
      expect(legalActions(s)).toContainEqual({ type: 'play', cardId: c.id })
    }
  })
})

describe('递减相邻接龙', () => {
  it('9♥ 之后只能出 8♥，出 10♥ 非法', () => {
    const top = card(9, 'H')
    const s = stateWith({ mine: [card(8, 'H'), card(10, 'H')], theirs: [card(1, 'C')], turnCard: top, turn: 'player' })
    expect(canPlay(card(8, 'H'), 9, 'H')).toBe(true)
    expect(canPlay(card(10, 'H'), 9, 'H')).toBe(false)
    const legal = legalActions(s)
    expect(legal).toContainEqual({ type: 'play', cardId: s.hands[0][0].id })
    expect(legal).not.toContainEqual({ type: 'play', cardId: s.hands[0][1].id })
  })

  it('点数必须恰好小 1：7♥ 接不上 9♥', () => {
    expect(canPlay(card(7, 'H'), 9, 'H')).toBe(false)
    expect(canPlay(card(9, 'H'), 9, 'H')).toBe(false)
    expect(canPlay(card(8, 'H'), 9, 'H')).toBe(true)
  })

  it('非万能牌不能跨花色接', () => {
    expect(canPlay(card(8, 'S'), 9, 'H')).toBe(false)
    expect(canPlay(card(8, 'D'), 9, 'H')).toBe(false)
    expect(canPlay(card(8, 'C'), 9, 'H')).toBe(false)
    const bad = card(8, 'S')
    const s = stateWith({ mine: [bad], theirs: [card(1, 'C')], turnCard: card(9, 'H'), turn: 'player' })
    expect(legalActions(s)).toEqual([{ type: 'pass' }])
    expect(play(s, bad.id)).toBe(s)
  })

  it('打出后本轮末牌与锁定花色随之更新', () => {
    const top = card(9, 'H')
    const eight = card(8, 'H')
    const keep = card(3, 'C')
    const s = stateWith({ mine: [eight, keep], theirs: [card(1, 'C')], turnCard: top, turn: 'player' })
    const n = play(s, eight.id)
    expect(n.turnCard).toEqual(eight)
    expect(n.turnRank).toBe(8)
    expect(n.leadSuit).toBe('H')
    expect(n.chainCount).toBe(1)
    expect(n.leader).toBe('player')
    expect(n.pile).toEqual([top, eight])
    expect(n.turn).toBe('ai')
    expect(n.hands[0]).toEqual([keep])
  })

  it('一轮内连续接龙：K♠→Q♠→J♠ 依次递减', () => {
    const k = card(13, 'S')
    const q = card(12, 'S')
    const j = card(11, 'S')
    // K♠ 已经是本轮末牌，轮到电脑出 Q♠，然后玩家出 J♠；双方各留一张废牌避免提前结束
    let s = stateWith({
      mine: [j, card(3, 'C')],
      theirs: [q, card(7, 'H')],
      turn: 'ai',
      turnCard: k,
      turnRank: 13,
      leadSuit: 'S',
      leader: 'player',
      chainCount: 1,
    })
    s = play(s, q.id)
    expect(s.turnRank).toBe(12)
    s = play(s, j.id)
    expect(s.turnRank).toBe(11)
    expect(s.chainCount).toBe(3)
    expect(s.leader).toBe('player')
  })

  it('A(1) 打出后链条自然终止：没有任何牌能接', () => {
    const a = card(1, 'S')
    const s = stateWith({ mine: [card(13, 'H')], theirs: [card(2, 'D')], turnCard: a, turnRank: 1, leadSuit: 'S', turn: 'player' })
    expect(playableCards(s)).toEqual([])
    expect(legalActions(s)).toEqual([{ type: 'pass' }])
  })
})

describe('万能牌 2', () => {
  it('2♠ 可以当任意花色的相邻点数接出（2♠ 当 9♥ 接在 10♥ 后）', () => {
    const wild = card(2, 'S')
    const s = stateWith({ mine: [wild], theirs: [card(1, 'C')], turnCard: card(10, 'H'), turnRank: 10, leadSuit: 'H', turn: 'player' })
    expect(canPlay(wild, 10, 'H')).toBe(true)
    const n = play(s, wild.id)
    expect(n.turnRank).toBe(9)
    expect(n.leadSuit).toBe('H') // 锁定花色跟随上一张
    expect(n.hands[0]).toEqual([])
    // 下一张必须接 8♥
    expect(canPlay(card(8, 'H'), n.turnRank, n.leadSuit)).toBe(true)
    expect(canPlay(card(8, 'S'), n.turnRank, n.leadSuit)).toBe(false)
  })

  it('万能牌接出的有效点数恒为 turnRank-1', () => {
    for (const r of [13, 9, 5, 2]) {
      const wild = card(2, 'C')
      const s = stateWith({ mine: [wild], theirs: [card(1, 'C')], turnRank: r, leadSuit: 'D', turnCard: card(r, 'D') })
      expect(effectiveAfter(s, wild)).toEqual({ rank: r - 1, suit: 'D' })
    }
  })

  it('刚打出 A（有效点数 1）时万能牌也无牌可接', () => {
    const wild = card(2, 'H')
    expect(canPlay(wild, 1, 'S')).toBe(false)
    expect(canPlay(wild, WILDCARD_RANK, 'S')).toBe(true)
  })

  it('用 2 开首时当作所选花色的 K', () => {
    const wild = card(2, 'D')
    const s = stateWith({ mine: [wild], theirs: [card(1, 'C')], leadSuit: 'H', turn: 'player' })
    expect(canPlay(wild, 0, 'H')).toBe(true)
    const n = play(s, wild.id)
    expect(n.turnRank).toBe(LEAD_RANK)
    expect(n.leadSuit).toBe('H')
    expect(canPlay(card(12, 'H'), n.turnRank, n.leadSuit)).toBe(true)
  })

  it('首局用 2 开首且尚未选花色时，视为它自己花色的 K', () => {
    const wild = card(2, 'C')
    const n = play(stateWith({ mine: [wild], theirs: [card(1, 'S')] }), wild.id)
    expect(n.turnRank).toBe(LEAD_RANK)
    expect(n.leadSuit).toBe('C')
  })
})

describe('选花色与锁定花色', () => {
  it('一轮结束后进入 chooseSuit，由打出首牌的一方选花色', () => {
    const top = card(3, 'S')
    const p1 = stateWith({ mine: [card(9, 'H')], theirs: [card(9, 'D')], turnCard: top, turn: 'player', leader: 'player', chainCount: 1 })
    const p2 = pass(p1) // 玩家过牌
    expect(p2.turn).toBe('ai')
    const p3 = pass(p2) // 电脑也过牌 → 本轮结束
    expect(p3.phase).toBe('chooseSuit')
    expect(p3.turn).toBe('player') // 打出首牌的一方来选
    expect(p3.turnCard).toBeNull()
    expect(p3.turnRank).toBe(0)
    expect(p3.leadSuit).toBeNull()
    expect(p3.chainCount).toBe(0)
    expect(p3.passStreak).toBe(0)
    expect(p3.rounds).toBe(1)
  })

  it('选花色阶段只列出手上真的有牌能出的花色', () => {
    const s = stateWith({
      mine: [card(10, 'C')],
      theirs: [card(1, 'S')],
      phase: 'chooseSuit',
      turn: 'player',
      turnRank: 0,
      leadSuit: null,
    })
    const suits = legalActions(s).map((a) => (a as { suit: Suit }).suit)
    expect(suits).toEqual(['C'])
    expect(canLeadSuit(s, 'S')).toBe(false)
    expect(canLeadSuit(s, 'C')).toBe(true)
  })

  it('手上只剩万能牌时四个花色都能选', () => {
    const s = stateWith({ mine: [card(2, 'S'), card(2, 'H')], theirs: [card(1, 'S')], phase: 'chooseSuit', turn: 'player' })
    expect(legalActions(s)).toHaveLength(4)
    for (const suit of ['S', 'H', 'D', 'C'] as Suit[]) expect(canLeadSuit(s, suit)).toBe(true)
  })

  it('选花色后只能出该花色（锁定花色）', () => {
    const heart8 = card(8, 'H')
    const heart9 = card(9, 'H')
    const club8 = card(8, 'C')
    const s = stateWith({ mine: [heart8, club8, heart9], theirs: [card(1, 'S')], phase: 'chooseSuit', turn: 'player' })
    const n = lead(s, 'H')
    expect(n.phase).toBe('play')
    expect(n.leadSuit).toBe('H')
    expect(n.turn).toBe('player')
    expect(n.turnRank).toBe(0)
    expect(n.leader).toBe('player')
    expect(n.chainCount).toBe(0)
    // 开首时该花色的牌都能出，别的花色一张都出不了
    expect(playableCards(n).map((c) => c.id).sort()).toEqual([heart8.id, heart9.id].sort())
    expect(play(n, club8.id)).toBe(n)
  })

  it('锁定花色后万能牌 2 依然可用', () => {
    const wild = card(2, 'D')
    const heart = card(9, 'H')
    const s = stateWith({ mine: [wild, heart, card(3, 'S')], theirs: [card(1, 'S')], leadSuit: 'H', turn: 'player' })
    expect(playableCards(s).map((c) => c.id).sort()).toEqual([wild.id, heart.id].sort())
  })

  it('非 chooseSuit 阶段发出 lead 动作 → 状态不变', () => {
    const s = stateWith({ mine: [card(9, 'H')], theirs: [card(1, 'S')] })
    expect(reduce(s, { type: 'lead', suit: 'H' })).toBe(s)
  })

  it('chooseSuit 阶段不能出牌', () => {
    const c = card(9, 'H')
    const s = stateWith({ mine: [c], theirs: [card(1, 'S')], phase: 'chooseSuit', turn: 'player' })
    expect(reduce(s, { type: 'play', cardId: c.id })).toBe(s)
  })
})

describe('一轮最多 13 张', () => {
  it('K♠→…→A♠ 连出 13 张后本轮强制结束', () => {
    // 玩家出 13/11/9/7/5/3/1 档，电脑出 12/10/8/6/4/2 档；双方各留一张接不上的废牌，
    // 保证不会因为「打空手牌」提前结束，13 张上限才是本轮真正的结束原因
    const pSpare = card(9, 'H')
    const aiSpare = card(3, 'H')
    const seq: Card[] = [
      card(13, 'S'),
      card(12, 'S'),
      card(11, 'S'),
      card(10, 'S'),
      card(9, 'S'),
      card(8, 'S'),
      card(7, 'S'),
      card(6, 'S'),
      card(5, 'S'),
      card(4, 'S'),
      card(3, 'S'),
      card(2, 'S'),
      card(1, 'S'),
    ]
    const s0 = stateWith({
      mine: [seq[0], seq[2], seq[4], seq[6], seq[8], seq[10], seq[12], pSpare],
      theirs: [seq[1], seq[3], seq[5], seq[7], seq[9], seq[11], aiSpare],
      turn: 'player',
    })
    let s: State = s0
    const required: number[] = []
    for (let i = 0; i < seq.length; i++) {
      // 每一档要接的那张牌都在合法集合里
      expect(legalActions(s)).toContainEqual({ type: 'play', cardId: (seq[i] as Card).id })
      if (i > 0) required.push(s.turnRank - 1) // 本步必须接的点数
      s = play(s, (seq[i] as Card).id)
      expect(s.plays).toBe(i + 1)
      if (i < seq.length - 1) {
        expect(s.phase).toBe('play')
        expect(s.chainCount).toBe(i + 1)
      }
    }
    // 13 张：K 开首后，第 2..13 张要接的点数依次是 12..1，每一张都精确 -1
    expect(required).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(s.chainCount).toBe(0) // 已归零，本轮结束
    expect(s.phase).toBe('chooseSuit')
    expect(s.turn).toBe('player') // 由打出首牌的一方重新选花色
    expect(s.turnCard).toBeNull()
    expect(s.leadSuit).toBeNull()
    expect(s.rounds).toBe(1)
    expect(s.plays).toBe(13)
    expect(s.over).toBe(false)
    expect(s.hands[0]).toEqual([pSpare])
    expect(s.hands[1]).toEqual([aiSpare])
  })

  it('显式上限判定：chainCount 达到 13 时本轮结束', () => {
    const a = card(1, 'S')
    const spare = card(5, 'H') // 接不上，不会被误判为可出
    const s = stateWith({
      mine: [a, spare],
      theirs: [card(12, 'S')],
      turnCard: card(2, 'S'),
      turnRank: 2,
      leadSuit: 'S',
      leader: 'ai',
      chainCount: MAX_CHAIN - 1,
      turn: 'player',
    })
    expect(s.chainCount).toBe(12)
    const n = play(s, a.id)
    expect(n.chainCount).toBe(0)
    expect(n.phase).toBe('chooseSuit')
    expect(n.turn).toBe('ai')
    expect(n.turnCard).toBeNull()
    expect(n.rounds).toBe(1)
    expect(n.over).toBe(false)
  })

  it('未达 13 张时本轮继续', () => {
    const a = card(1, 'S')
    const spare = card(5, 'H')
    const s = stateWith({
      mine: [a, spare],
      theirs: [card(12, 'S')],
      turnRank: 2,
      leadSuit: 'S',
      chainCount: 5,
      turn: 'player',
    })
    const n = play(s, a.id)
    expect(n.chainCount).toBe(6)
    expect(n.phase).toBe('play')
    expect(n.turnRank).toBe(1)
    expect(n.turnCard).toEqual(a)
    expect(n.hands[0]).toEqual([spare])
  })
})

describe('过牌与防死锁', () => {
  it('无牌可出时过牌：passes 递增、交给对方、不动牌堆', () => {
    const top = card(3, 'S')
    const dead = card(9, 'H')
    const s = stateWith({ mine: [dead], theirs: [card(1, 'C')], turnCard: top, turn: 'player', cursor: 10 })
    const deckBefore = s.deck
    const n = pass(s)
    expect(n.passes).toBe(1)
    expect(n.passStreak).toBe(1)
    expect(n.turn).toBe('ai')
    expect(n.hands[0]).toEqual([dead])
    expect(n.turnCard).toEqual(top)
    expect(n.deck).toEqual(deckBefore)
    expect(n.cursor).toBe(10)
    expect(n.phase).toBe('play')
  })

  it('仍有牌可出时过牌是非法的（状态不变）', () => {
    const s = stateWith({ mine: [card(8, 'S')], theirs: [card(1, 'C')], turnCard: card(9, 'S'), turn: 'player' })
    expect(legalActions(s)).toEqual([{ type: 'play', cardId: s.hands[0][0].id }])
    expect(pass(s)).toBe(s)
  })

  it('连续双方过牌 → 进入 chooseSuit，保证不会卡死', () => {
    const top = card(1, 'S')
    const p1 = stateWith({ mine: [card(13, 'H')], theirs: [card(12, 'D')], turnCard: top, turn: 'player', leader: 'ai', chainCount: 1 })
    const p2 = pass(p1)
    expect(p2.phase).toBe('play')
    const p3 = pass(p2)
    expect(p3.passes).toBe(2)
    expect(p3.phase).toBe('chooseSuit')
    expect(p3.turn).toBe('ai') // 首牌是它打的，由它重新选
    expect(p3.turnRank).toBe(0)
    // 新一轮它至少能选到自己有牌的花色并继续出牌
    expect(legalActions(p3).length).toBeGreaterThan(0)
    expect(legalActions(p3)[0].type).toBe('lead')
  })

  it('有人能接时过牌计数被清零', () => {
    const s = stateWith({
      mine: [card(10, 'S'), card(5, 'C')], // 9♠ 之后接不上，只能过牌
      theirs: [card(8, 'S'), card(6, 'H')], // 能接 8♠
      turnCard: card(9, 'S'),
      turnRank: 9,
      leadSuit: 'S',
      turn: 'player',
      leader: 'player',
      chainCount: 1,
    })
    const p1 = pass(s)
    expect(p1.passStreak).toBe(1)
    const p2 = reduce(p1, { type: 'play', cardId: p1.hands[1][0].id })
    expect(p2.turnRank).toBe(8)
    expect(p2.passStreak).toBe(0)
    expect(p2.phase).toBe('play') // 没有连续两次过牌，本轮继续
  })

  it('每个 play 阶段局面都至少有一个合法动作（不变量）', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = create(seed * 131)
      for (let i = 0; i < 60 && !s.over; i++) {
        const legal = legalActions(s)
        expect(legal.length).toBeGreaterThan(0)
        s = reduce(s, legal[i % legal.length] as Action)
      }
    }
  })
})

describe('胜负判定', () => {
  it('打完最后一张牌立即判胜，回合不再交给对方', () => {
    const last = card(8, 'S')
    const s = stateWith({ mine: [last], theirs: [card(2, 'C'), card(3, 'D')], turnCard: card(9, 'S'), turn: 'player', leader: 'ai', chainCount: 1 })
    const n = play(s, last.id)
    expect(n.over).toBe(true)
    expect(n.winner).toBe('player')
    expect(n.phase).toBe('done')
    expect(n.hands[0]).toEqual([])
    expect(n.hands[1].length).toBeGreaterThan(0)
  })

  it('电脑打完手牌时玩家判负', () => {
    const last = card(13, 'H')
    const s = stateWith({ mine: [card(1, 'C')], theirs: [last], turn: 'ai' })
    const n = play(s, last.id)
    expect(n.over).toBe(true)
    expect(n.winner).toBe('ai')
    expect(n.phase).toBe('done')
  })

  it('打光手牌与达到 13 张上限同时发生，判胜优先于本轮结束', () => {
    const a = card(1, 'S')
    const s = stateWith({ mine: [a], theirs: [card(12, 'S')], turnRank: 2, leadSuit: 'S', chainCount: MAX_CHAIN - 1, turn: 'player', leader: 'ai' })
    const n = play(s, a.id)
    expect(n.over).toBe(true)
    expect(n.winner).toBe('player')
    expect(n.phase).toBe('done')
  })

  it('结束后任何动作都被拒绝（引用相等）', () => {
    const last = card(8, 'S')
    const over = play(stateWith({ mine: [last], turnCard: card(9, 'S'), turn: 'player' }), last.id)
    expect(legalActions(over)).toEqual([])
    expect(reduce(over, { type: 'pass' })).toBe(over)
    expect(reduce(over, { type: 'play', cardId: last.id })).toBe(over)
    expect(reduce(over, { type: 'lead', suit: 'H' })).toBe(over)
    expect(aiAction(over)).toBeNull()
  })

  it('other 正确翻转行动方', () => {
    expect(other('player')).toBe('ai')
    expect(other('ai')).toBe('player')
  })
})

describe('非法动作', () => {
  it('打出不存在于手牌的牌 → 状态不变', () => {
    const s = stateWith({ mine: [card(2, 'S')] })
    expect(reduce(s, { type: 'play', cardId: 9999 })).toBe(s)
  })

  it('替对方出牌 → 状态不变', () => {
    const mine = card(9, 'S')
    const theirs = card(8, 'S')
    const s = stateWith({ mine: [mine], theirs: [theirs], turnCard: card(10, 'S'), turn: 'player' })
    expect(reduce(s, { type: 'play', cardId: theirs.id })).toBe(s)
  })

  it('违反递减相邻（出 10♥ 接 9♥）→ 状态不变', () => {
    const bad = card(10, 'H')
    const s = stateWith({ mine: [bad], theirs: [card(1, 'C')], turnCard: card(9, 'H'), turn: 'player' })
    expect(reduce(s, { type: 'play', cardId: bad.id })).toBe(s)
  })

  it('锁定花色后出别的花色 → 状态不变', () => {
    const bad = card(8, 'C')
    const s = stateWith({ mine: [bad], theirs: [card(1, 'S')], leadSuit: 'H', turn: 'player' })
    expect(reduce(s, { type: 'play', cardId: bad.id })).toBe(s)
  })

  it('isLegal 与 legalActions 判定一致', () => {
    const good = card(8, 'S')
    const bad = card(10, 'H')
    const s = stateWith({ mine: [good, bad], theirs: [card(1, 'C')], turnCard: card(9, 'S'), turn: 'player' })
    expect(isLegal(s, { type: 'play', cardId: good.id })).toBe(true)
    expect(isLegal(s, { type: 'play', cardId: bad.id })).toBe(false)
    expect(sameAction({ type: 'play', cardId: 3 }, { type: 'play', cardId: 3 })).toBe(true)
    expect(sameAction({ type: 'play', cardId: 3 }, { type: 'play', cardId: 4 })).toBe(false)
    expect(sameAction({ type: 'pass' }, { type: 'pass' })).toBe(true)
    expect(sameAction({ type: 'lead', suit: 'H' }, { type: 'lead', suit: 'D' })).toBe(false)
  })
})

describe('牌堆耗尽自动洗回', () => {
  it('牌堆不够发牌时把弃牌堆洗回，随机源来自 state.rng', () => {
    const a = card(2, 'S')
    const b = card(5, 'H')
    const s = stateWith({ deck: [a, b], cursor: 2, pile: [a, b] })
    expect(remaining(s)).toBe(0)
    const d = dealFrom(s, 1)
    expect(d.cards).toHaveLength(1)
    expect(d.reshuffles).toBe(1)
    expect(d.deck).toHaveLength(2)
    expect(d.cursor).toBe(1)
    expect(d.rng).not.toBe(s.rng)
    expect([...d.deck].sort((x, y) => x.id - y.id)).toEqual([a, b])
  })

  it('弃牌堆也为空时再补一副新牌，绝不空堆崩溃', () => {
    const s = stateWith({ deck: [card(2, 'S')], cursor: 0, pile: [] })
    const d = dealFrom(s, HAND_SIZE)
    expect(d.cards).toHaveLength(HAND_SIZE)
    expect(d.deck.length).toBe(DECK_SIZE + 1)
    expect(d.reshuffles).toBe(1)
  })

  it('连续耗尽多次都自动洗回，不抛错', () => {
    let s = stateWith({ deck: [card(2, 'S')], cursor: 1, pile: [card(2, 'S')] })
    for (let k = 1; k <= 5; k++) {
      const d = dealFrom({ ...s, cursor: s.deck.length }, HAND_SIZE)
      expect(d.cards.length).toBe(HAND_SIZE)
      s = { ...s, deck: d.deck, cursor: d.cursor, reshuffles: d.reshuffles, rng: d.rng }
      expect(s.reshuffles).toBe(k)
    }
  })

  it('洗回用掉的随机数可复盘：相同 state 洗出同样的顺序', () => {
    const s = stateWith({ deck: [card(2, 'S')], cursor: 1, pile: [card(5, 'H'), card(9, 'C')], rng: 777 })
    expect(dealFrom(s, 2)).toEqual(dealFrom(s, 2))
  })
})

describe('整局必然终止', () => {
  it('随机模拟 32 整局：全部 over === true，且动作总数有上界', () => {
    const TOTAL = DECK_SIZE
    // 动作上界：出牌 ≤104（每出一张少一张）；每次轮次结束最多 2 次过牌 + 1 次选花色；
    // 且每轮至少出 1 张牌，所以轮数 ≤ 出牌数。合计 ≤ 出牌 + 2×轮数 + 轮数 = 4×出牌。
    for (let seed = 1; seed <= 32; seed++) {
      const { state: s, steps } = playOut(seed * 7919)
      expect(s.over).toBe(true)
      expect(s.winner === 'player' || s.winner === 'ai').toBe(true)
      expect(s.hands[s.winner === 'player' ? 0 : 1]).toHaveLength(0)
      // 出牌 + 过牌 + 选花色 = 总动作数（每次轮次结束恰好对应一次选花色）
      expect(s.plays + s.passes + s.rounds).toBe(steps)
      expect(s.plays).toBeLessThanOrEqual(TOTAL)
      expect(steps).toBeLessThanOrEqual(TOTAL * 4)
      expect(s.pile).toHaveLength(s.plays)
      // 弃牌堆里的每一张牌都只被出过一次
      expect(new Set(s.pile.map((c) => c.id)).size).toBe(s.plays)
    }
  })

  it('每一轮都至少出了一张牌（不会靠连续过牌空转）', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const { state: s } = playOut(seed * 104729)
      // 每轮至少 1 张牌：轮数不会超过出牌总数
      expect(s.rounds).toBeLessThanOrEqual(s.plays)
      // 每轮内 k 张牌最多配 k+2 次过牌（连续两次过牌即结束本轮）
      expect(s.passes).toBeLessThanOrEqual(s.plays + s.rounds * 2)
    }
  })

  it('结束后状态不再变化', () => {
    const { state: over } = playOut(31337)
    expect(reduce(over, nthAction({ ...over, phase: 'play' }))).toBe(over)
    expect(legalActions(over)).toEqual([])
  })
})

describe('AI', () => {
  it('轮到玩家或已结束时返回 null', () => {
    expect(aiAction(create(1))).toBeNull()
    const only = card(9, 'S')
    const over = play(stateWith({ mine: [only] }), only.id)
    expect(over.over).toBe(true)
    expect(aiAction(over)).toBeNull()
  })

  it('aiAction 返回的动作必定在 legalActions 内（chooseSuit 阶段也成立）', () => {
    const s = stateWith({ theirs: [card(9, 'S'), card(8, 'C')], phase: 'chooseSuit', turn: 'ai', mine: [card(1, 'D')] })
    const a = aiAction(s)
    expect(a).not.toBeNull()
    expect(legalActions(s)).toContainEqual(a as Action)
  })

  it('优先甩万能牌 2', () => {
    const wild = card(2, 'S')
    const normal = card(3, 'H')
    const s = stateWith({ theirs: [normal, wild], turnCard: card(4, 'H'), turnRank: 4, leadSuit: 'H', turn: 'ai', leader: 'player', chainCount: 1 })
    expect(aiAction(s)).toEqual({ type: 'play', cardId: wild.id })
  })

  it('手上有多个 2 时不会一次把万能牌全甩光（保留后续收益）', () => {
    const wild1 = card(2, 'S')
    const wild2 = card(2, 'H')
    const normal = card(3, 'H')
    const s = stateWith({
      theirs: [normal, wild1, wild2, card(9, 'C')],
      turnCard: card(4, 'H'),
      turnRank: 4,
      leadSuit: 'H',
      turn: 'ai',
      leader: 'player',
      chainCount: 1,
    })
    const a = aiAction(s) as Action
    expect(a.type).toBe('play')
    // 两个 2 打分相同，任选其一即可，但绝不选普通牌把 2 留着不动
    expect([wild1.id, wild2.id]).toContain((a as { cardId: number }).cardId)
  })

  it('常规局面优先出小牌保留大牌', () => {
    const small = card(5, 'H')
    const big = card(11, 'H')
    const s = stateWith({
      theirs: [small, big, card(7, 'C'), card(9, 'C'), card(4, 'C'), card(3, 'C')],
      turnCard: card(6, 'H'),
      turnRank: 6,
      leadSuit: 'H',
      turn: 'ai',
      leader: 'player',
      chainCount: 1,
    })
    expect(s.hands[1].length).toBeGreaterThan(5)
    expect(aiAction(s)).toEqual({ type: 'play', cardId: small.id })
  })

  it('手牌快出完时优先出大牌抢先走完', () => {
    const big = card(12, 'H')
    const wild = card(2, 'C')
    const wild2 = card(2, 'D')
    // K♥ 之后 12♥ 与万能牌 2 都能接；手牌降到 5 张进入抢跑模式，应选大牌 12♥
    const s = stateWith({
      theirs: [big, wild, wild2, card(9, 'C'), card(4, 'C')],
      turnCard: card(13, 'H'),
      turnRank: 13,
      leadSuit: 'H',
      turn: 'ai',
      leader: 'player',
      chainCount: 1,
    })
    expect(s.hands[1].length).toBe(5)
    // 12♥ 与两张万能牌 2 都能接 K♥
    expect(playableCards(s).map((c) => c.id).sort()).toEqual([big.id, wild.id, wild2.id].sort())
    expect(aiAction(s)).toEqual({ type: 'play', cardId: big.id })
  })

  it('能一把走完时立刻出完', () => {
    const only = card(11, 'H')
    const s = stateWith({ theirs: [only], turnCard: card(12, 'H'), turnRank: 12, leadSuit: 'H', turn: 'ai' })
    const a = aiAction(s)
    expect(a).toEqual({ type: 'play', cardId: only.id })
    expect(reduce(s, a as Action).winner).toBe('ai')
  })

  it('优先出能把对手逼到无牌可出的牌', () => {
    // 对手只有 9♦，锁到 9♦ 之后电脑出 9♦ 就没人能接
    const lock = card(9, 'D')
    const other = card(5, 'D')
    const s = stateWith({
      theirs: [lock, other, card(1, 'C')],
      mine: [card(9, 'D')],
      turnCard: card(10, 'D'),
      turnRank: 10,
      leadSuit: 'D',
      turn: 'ai',
      leader: 'player',
      chainCount: 1,
    })
    expect(aiAction(s)).toEqual({ type: 'play', cardId: lock.id })
  })

  it('无牌可出时返回「过牌」', () => {
    const s = stateWith({ theirs: [card(13, 'H')], mine: [card(1, 'C')], turnCard: card(2, 'S'), turnRank: 2, leadSuit: 'S', turn: 'ai', leader: 'player', chainCount: 1 })
    expect(aiAction(s)).toEqual({ type: 'pass' })
  })

  it('chooseSuit 阶段挑自己牌最多的花色', () => {
    const s = stateWith({
      theirs: [card(9, 'H'), card(8, 'H'), card(7, 'H'), card(13, 'C')],
      mine: [card(1, 'S')],
      phase: 'chooseSuit',
      turn: 'ai',
    })
    expect(aiAction(s)).toEqual({ type: 'lead', suit: 'H' })
  })

  it('相同状态总是返回相同动作（可复盘）', () => {
    const s = stateWith({
      theirs: [card(9, 'H'), card(8, 'H'), card(2, 'S')],
      turnCard: card(10, 'H'),
      turnRank: 10,
      leadSuit: 'H',
      turn: 'ai',
      leader: 'player',
      chainCount: 1,
    })
    expect(aiAction(s)).toEqual(aiAction(s))
  })

  it('整局对战中每个 AI action 都在 legalActions 内，且必然终局', () => {
    let totalAi = 0
    for (let seed = 1; seed <= 30; seed++) {
      let s = create(seed * 7919)
      let guard = 0
      while (!s.over && guard++ < 4000) {
        const legal = legalActions(s)
        expect(legal.length).toBeGreaterThan(0)
        let a: Action
        if (s.turn === 'ai') {
          a = aiAction(s) as Action
          expect(a).not.toBeNull()
          expect(legal).toContainEqual(a)
          totalAi += 1
        } else {
          a = legal[guard % legal.length] as Action
          expect(legal).toContainEqual(a)
        }
        const next = reduce(s, a)
        expect(next).not.toBe(s)
        s = next
      }
      expect(s.over).toBe(true)
    }
    expect(totalAi).toBeGreaterThan(0)
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参（手牌 / 弃牌堆 / 牌堆 / rng 均不变）', () => {
    const top = card(9, 'S')
    const c = card(8, 'S')
    const s = stateWith({
      mine: [c],
      theirs: [card(2, 'C')],
      turnCard: top,
      leadSuit: 'S',
      leader: 'ai',
      chainCount: 1,
      turn: 'player',
      cursor: 10,
      rng: 4242,
    })
    const hands = [s.hands[0].slice(), s.hands[1].slice()]
    const pile = s.pile.slice()
    const deck = s.deck.slice()
    const n = play(s, c.id)
    // 入参一个字段都没动
    expect(s.hands[0]).toEqual(hands[0])
    expect(s.hands[1]).toEqual(hands[1])
    expect(s.pile).toEqual(pile)
    expect(s.turnCard).toEqual(top)
    expect(s.turnRank).toBe(9)
    expect(s.leadSuit).toBe('S')
    expect(s.deck).toEqual(deck)
    expect(s.cursor).toBe(10)
    expect(s.rng).toBe(4242)
    expect(s.plays).toBe(0)
    expect(s.passes).toBe(0)
    expect(s.turn).toBe('player')
    expect(s.phase).toBe('play')
    expect(s.hands[0]).toHaveLength(1)
    // 新状态才是推进后的
    expect(n).not.toBe(s)
    expect(n.plays).toBe(1)
    expect(n.hands[0]).toHaveLength(0)
  })

  it('选花色与过牌同样不修改入参', () => {
    const top = card(1, 'S')
    const cs = stateWith({ mine: [card(9, 'H')], theirs: [card(1, 'S')], phase: 'chooseSuit', turn: 'player', rng: 99 })
    const hands = cs.hands[0].slice()
    lead(cs, 'H')
    expect(cs.hands[0]).toEqual(hands)
    expect(cs.phase).toBe('chooseSuit')
    expect(cs.leadSuit).toBeNull()
    expect(cs.rng).toBe(99)

    const ps = stateWith({ mine: [card(13, 'H')], theirs: [card(12, 'D')], turnCard: top, turn: 'player', rng: 7 })
    const deck = ps.deck.slice()
    pass(ps)
    expect(ps.pile).toEqual([top])
    expect(ps.deck).toEqual(deck)
    expect(ps.passes).toBe(0)
    expect(ps.passStreak).toBe(0)
    expect(ps.rng).toBe(7)
  })

  it('reduce 返回新对象而不是就地修改', () => {
    const c = card(8, 'S')
    const s = stateWith({ mine: [c], turnCard: card(9, 'S'), leadSuit: 'S' })
    const n = play(s, c.id)
    expect(n).not.toBe(s)
    expect(n.hands[0]).not.toBe(s.hands[0])
    expect(s.hands[0]).toHaveLength(1)
  })

  it('相同输入两次调用结果完全相等（出牌 / 过牌 / 选花色）', () => {
    const c = card(8, 'S')
    const ps = stateWith({ mine: [c], turnCard: card(9, 'S'), leadSuit: 'S', leader: 'ai', chainCount: 1 })
    expect(play(ps, c.id)).toEqual(play(ps, c.id))

    const ds = stateWith({ mine: [card(13, 'H')], theirs: [card(12, 'D')], turnCard: card(1, 'S'), turn: 'player' })
    expect(pass(ds)).toEqual(pass(ds))

    const cs = stateWith({ mine: [card(9, 'H')], theirs: [card(1, 'S')], phase: 'chooseSuit', turn: 'player' })
    expect(lead(cs, 'H')).toEqual(lead(cs, 'H'))
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

  it('人机对完整复盘（AI 参与）', () => {
    const run = (): State => playOut(2024).state
    const a = run()
    const b = run()
    expect(a).toEqual(b)
    expect(a.over).toBe(true)
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
})
