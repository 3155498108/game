import { describe, expect, it } from 'vitest'
import type { Card, Suit } from '../../core/cards'
import {
  BET,
  BLACKJACK_PAYOUT,
  DEALER_HITS_SOFT_17,
  DECKS,
  DECK_SIZE,
  HOLE_INDEX,
  PUSH_PAYOUT,
  create,
  deal,
  dealerAction,
  dealerShouldHit,
  handValue,
  hit,
  isBlackjack,
  isWinResult,
  openHand,
  reduce,
  remaining,
  resultLabel,
  stand,
  type Action,
  type State,
} from './rules'

/** 构造一张指定点数的牌（rank 1=A，10..13 为 10/J/Q/K） */
function card(rank: number, suit: Suit = 'S', id = 0): Card {
  return { id, suit, rank }
}

/**
 * 构造完全可控的局面。
 * seat 的顺序与真实发牌一致：[玩家1, 庄家1, 玩家2, 庄家2]，之后是 rest 里的后续牌序。
 * 末尾自动补满占位牌，保证「牌堆已洗好且为 DECK_SIZE 张」的语义不被破坏。
 */
function stateWith(seat: [Card, Card, Card, Card], rest: Card[] = [], opts: Partial<State> = {}): State {
  const deck: Card[] = seat.slice()
  for (const c of rest) deck.push(c)
  let id = 9000
  while (deck.length < DECK_SIZE) deck.push(card(2, 'C', id++))
  return {
    ...create(20260101),
    deck,
    cursor: 4,
    used: seat.slice(),
    player: [seat[0], seat[2]],
    dealer: [seat[1], seat[3]],
    phase: 'player',
    reveal: false,
    bet: BET,
    score: 0,
    result: null,
    payout: 0,
    reshuffles: 0,
    rng: 777,
    ...opts,
  }
}

/** 把当前这一手打完：低于 stopAt 就 hit，然后 stand，最后一路推庄家 */
function playOneHand(s: State, stopAt = 17): State {
  let cur = s
  let guard = 0
  while (cur.phase !== 'done' && guard++ < 300) {
    if (cur.phase === 'player') cur = handValue(cur.player).total < stopAt ? hit(cur) : stand(cur)
    else cur = reduce(cur, { type: 'dealer' })
  }
  return cur
}

/** 从种子开局并打完第一手 */
function playRound(seed: number, stopAt = 17): State {
  return playOneHand(create(seed), stopAt)
}

describe('点数计算', () => {
  it('A 可作 1 或 11：A+5 取 16 且为软牌', () => {
    const v = handValue([card(1), card(5)])
    expect(v.total).toBe(16)
    expect(v.soft).toBe(true)
    expect(v.bust).toBe(false)
  })

  it('A+K 正好 21 点', () => {
    const v = handValue([card(1), card(13)])
    expect(v.total).toBe(21)
    expect(v.soft).toBe(true)
    expect(isBlackjack([card(1), card(13)])).toBe(true)
  })

  it('两张 A 只能当 12 点（一张降为 1）', () => {
    const v = handValue([card(1), card(1)])
    expect(v.total).toBe(12)
    expect(v.soft).toBe(true)
    expect(v.bust).toBe(false)
  })

  it('多张 A 逐张降级：三张 A 为 13 点', () => {
    const v = handValue([card(1), card(1), card(1)])
    expect(v.total).toBe(13)
    expect(v.soft).toBe(true)
    expect(v.bust).toBe(false)
  })

  it('两张 A 加 9 点仍不爆（22-10=21… 实为 11+11+9 降到 21）', () => {
    const v = handValue([card(1), card(1), card(9)])
    expect(v.total).toBe(21)
    expect(v.soft).toBe(true)
  })

  it('J / Q / K 各计 10 点', () => {
    expect(handValue([card(11)]).total).toBe(10)
    expect(handValue([card(12)]).total).toBe(10)
    expect(handValue([card(13)]).total).toBe(10)
    expect(handValue([card(10), card(10)]).total).toBe(20)
    expect(handValue([card(10), card(10)]).soft).toBe(false)
  })

  it('超过 21 点判爆牌，且不存在可降级的 A', () => {
    const v = handValue([card(13), card(13), card(13)])
    expect(v.total).toBe(30)
    expect(v.bust).toBe(true)
    expect(v.soft).toBe(false)
  })

  it('三张牌 21 点不是黑杰克', () => {
    expect(handValue([card(1), card(10), card(10)]).total).toBe(21)
    expect(isBlackjack([card(1), card(10), card(10)])).toBe(false)
  })
})

describe('发牌', () => {
  it('牌堆为 6 副共 312 张且 id 唯一，双方各 2 张', () => {
    const s = create(42)
    expect(DECKS).toBe(6)
    expect(DECK_SIZE).toBe(312)
    expect(s.deck).toHaveLength(DECK_SIZE)
    expect(new Set(s.deck.map((c) => c.id)).size).toBe(DECK_SIZE)
    expect(s.player).toHaveLength(2)
    expect(s.dealer).toHaveLength(2)
    expect(s.used).toHaveLength(4)
    expect(s.cursor).toBe(4)
    expect(remaining(s)).toBe(DECK_SIZE - 4)
    expect(s.bet).toBe(BET)
    expect(s.score).toBe(0)
    expect(s.payout).toBe(0)
    expect(s.result).toBeNull()
    expect(s.reveal).toBe(false)
  })

  it('发牌顺序为 玩家-庄家-玩家-庄家，庄家第二张是暗牌', () => {
    const s = create(2026)
    expect(s.player[0]).toEqual(s.deck[0])
    expect(s.dealer[0]).toEqual(s.deck[1])
    expect(s.player[1]).toEqual(s.deck[2])
    expect(s.dealer[HOLE_INDEX]).toEqual(s.deck[3])
    expect(s.used).toEqual([s.deck[0], s.deck[1], s.deck[2], s.deck[3]])
    // 未开局时不翻开暗牌
    expect(s.phase === 'done' || s.reveal === false).toBe(true)
  })

  it('暗牌在结算前不公开（reveal 为 false）', () => {
    const s = stateWith([card(10), card(7), card(9), card(6)])
    const n = stand(s)
    expect(s.reveal).toBe(false)
    expect(n.reveal).toBe(true)
    expect(n.dealer).toHaveLength(2)
  })
})

describe('玩家行动', () => {
  it('hit 会加一张牌并推进游标，阶段仍为 player', () => {
    const s = stateWith([card(10), card(7), card(7), card(6)], [card(2)])
    const n = hit(s)
    expect(n.player).toHaveLength(3)
    expect(n.player[2]).toEqual(card(2))
    expect(n.cursor).toBe(5)
    expect(n.used).toHaveLength(5)
    expect(handValue(n.player).total).toBe(19)
    expect(n.phase).toBe('player')
    expect(n.result).toBeNull()
  })

  it('stand 结束玩家行动：进入 dealer 阶段并翻开暗牌', () => {
    const s = stateWith([card(10), card(7), card(9), card(6)], [card(5)])
    const n = stand(s)
    expect(n.phase).toBe('dealer')
    expect(n.reveal).toBe(true)
    expect(n.player).toHaveLength(2)
    expect(n.result).toBeNull()
    expect(dealerAction(n)).toEqual({ type: 'dealer' })
    expect(dealerAction(s)).toBeNull()
  })

  it('连续 hit 每次只加一张牌', () => {
    let s = stateWith([card(2), card(7), card(3), card(6)], [card(4), card(5), card(6)])
    s = hit(s)
    s = hit(s)
    expect(s.player).toHaveLength(4)
    expect(handValue(s.player).total).toBe(14)
    expect(s.cursor).toBe(6)
    expect(s.phase).toBe('player')
  })

  it('非玩家阶段不接受 hit / stand，且返回同一状态', () => {
    const s = stateWith([card(10), card(7), card(9), card(6)], [card(5)])
    const st = stand(s)
    expect(hit(st)).toBe(st)
    expect(stand(st)).toBe(st)
    const done = reduce(st, { type: 'dealer' })
    expect(done.phase).toBe('done')
    expect(hit(done)).toBe(done)
    expect(stand(done)).toBe(done)
    expect(reduce(done, { type: 'dealer' })).toBe(done)
    expect(dealerAction(done)).toBeNull()
  })
})

describe('再来一手（deal）', () => {
  it('结算后 deal 重新发双方各 2 张，累计得分保留', () => {
    const base = stateWith([card(1), card(9), card(10), card(7)], [card(8), card(8), card(8), card(8)])
    const win = openHand(base)
    expect(win.score).toBe(15)
    const n = deal(win)
    expect(n.phase).toBe('player')
    expect(n.player).toHaveLength(2)
    expect(n.dealer).toHaveLength(2)
    expect(n.result).toBeNull()
    expect(n.payout).toBe(0)
    expect(n.score).toBe(15)
    expect(n.round).toBe(2)
    expect(n.cursor).toBe(8)
    expect(n.used).toHaveLength(8)
    expect(n.reveal).toBe(false)
    expect(win.round).toBe(1) // 入参未被修改
  })

  it('未结算时 deal 不生效', () => {
    const s = stateWith([card(10), card(7), card(9), card(6)])
    expect(deal(s)).toBe(s)
    const st = stand(s)
    expect(deal(st)).toBe(st)
  })

  it('连续多手不抛错，每手都能结算', () => {
    let s = playOneHand(create(4242))
    expect(s.phase).toBe('done')
    for (let i = 0; i < 30; i++) {
      s = deal(s)
      expect(s.player).toHaveLength(2)
      expect(s.dealer).toHaveLength(2)
      s = playOneHand(s)
      expect(s.phase).toBe('done')
      expect(s.result).not.toBeNull()
      expect(s.score).toBeGreaterThanOrEqual(0)
    }
    expect(s.round).toBe(31) // 第 1 手 + 再来 30 手
    expect(s.deck.length).toBeGreaterThan(0)
  })
})

describe('爆牌判定', () => {
  it('玩家爆牌（>21）立即判负并结束', () => {
    const s = stateWith([card(10), card(7), card(9), card(6)], [card(13)])
    const n = hit(s)
    expect(handValue(n.player).bust).toBe(true)
    expect(n.phase).toBe('done')
    expect(n.result).toBe('bust')
    expect(n.payout).toBe(0)
    expect(n.score).toBe(0)
    expect(n.reveal).toBe(true)
    expect(isWinResult(n.result as NonNullable<State['result']>)).toBe(false)
    expect(resultLabel('bust')).toContain('爆')
  })

  it('爆牌后庄家不再要牌', () => {
    const s = stateWith([card(10), card(7), card(9), card(6)], [card(13), card(2)])
    const n = hit(s)
    expect(n.dealer).toHaveLength(2)
    expect(reduce(n, { type: 'dealer' })).toBe(n)
  })
})

describe('庄家策略', () => {
  it('≤16 点必加牌，≥18 点停牌', () => {
    expect(dealerShouldHit(handValue([card(10), card(6)]))).toBe(true) // 16
    expect(dealerShouldHit(handValue([card(10), card(5)]))).toBe(true) // 15
    expect(dealerShouldHit(handValue([card(10), card(8)]))).toBe(false) // 18
    expect(dealerShouldHit(handValue([card(10), card(9)]))).toBe(false) // 19
    expect(dealerShouldHit(handValue([card(1), card(7)]))).toBe(false) // 软 18
  })

  it('soft 17（A+6）按项目配置要牌', () => {
    expect(DEALER_HITS_SOFT_17).toBe(true)
    const soft17 = handValue([card(1), card(6)])
    expect(soft17.total).toBe(17)
    expect(soft17.soft).toBe(true)
    expect(dealerShouldHit(soft17)).toBe(true)
    // 硬 17 停牌
    expect(dealerShouldHit(handValue([card(10), card(7)]))).toBe(false)
  })

  it('庄家按 soft 17 加到 20 点后停牌', () => {
    // 庄家 A+6 = 软 17，玩家 19
    const s = stateWith([card(10), card(1), card(9), card(6)], [card(3)])
    const n = reduce(stand(s), { type: 'dealer' })
    expect(n.dealer).toHaveLength(3)
    expect(handValue(n.dealer).total).toBe(20)
    expect(n.phase).toBe('done')
    expect(n.result).toBe('lose')
    expect(n.payout).toBe(0)
  })

  it('庄家每次 dealer action 最多要一张', () => {
    // 庄家 13 点（必加），后续依次为 2、2……
    const s = stateWith([card(10), card(7), card(9), card(6)], [card(2), card(2), card(2)])
    const a = reduce(stand(s), { type: 'dealer' })
    expect(a.dealer).toHaveLength(3)
    expect(handValue(a.dealer).total).toBe(15)
    expect(a.phase).toBe('dealer') // 15 < 17，继续要牌
    const b = reduce(a, { type: 'dealer' })
    expect(b.dealer).toHaveLength(4)
    expect(handValue(b.dealer).total).toBe(17)
    expect(b.phase).toBe('done')
  })

  it('庄家爆牌判玩家赢', () => {
    const s = stateWith([card(10), card(7), card(9), card(6)], [card(13)])
    const n = reduce(stand(s), { type: 'dealer' })
    expect(handValue(n.dealer).bust).toBe(true)
    expect(n.phase).toBe('done')
    expect(n.result).toBe('dealer-bust')
    expect(n.payout).toBe(BET * 1)
    expect(n.score).toBe(BET)
  })
})

describe('黑杰克与和局计分', () => {
  it('玩家两张即 21 点判胜，按 3:2 赔付', () => {
    const s = stateWith([card(1), card(9), card(10), card(7)])
    const n = openHand(s)
    expect(n.phase).toBe('done')
    expect(n.result).toBe('blackjack')
    expect(n.payout).toBe(BET * BLACKJACK_PAYOUT)
    expect(n.score).toBe(15)
    expect(n.reveal).toBe(true)
    expect(isWinResult(n.result as NonNullable<State['result']>)).toBe(true)
  })

  it('庄家黑杰克则玩家直接输', () => {
    const s = stateWith([card(5), card(1), card(7), card(10)])
    const n = openHand(s)
    expect(handValue(n.dealer).total).toBe(21)
    expect(n.phase).toBe('done')
    expect(n.result).toBe('dealer-blackjack')
    expect(n.payout).toBe(0)
    expect(n.score).toBe(0)
  })

  it('双方都是黑杰克判和局，退半个注记', () => {
    const s = stateWith([card(1), card(1), card(10), card(10)])
    const n = openHand(s)
    expect(n.result).toBe('push')
    expect(n.payout).toBe(BET * PUSH_PAYOUT)
    expect(n.score).toBe(5)
    expect(isWinResult('push')).toBe(false)
  })

  it('没有黑杰克时开局停在玩家阶段', () => {
    const s = openHand(stateWith([card(10), card(7), card(9), card(6)]))
    expect(s.phase).toBe('player')
    expect(s.result).toBeNull()
    expect(s.score).toBe(0)
  })
})

describe('点数比较', () => {
  it('双方停牌后玩家点数大则胜，赔付 1:1', () => {
    const s = stateWith([card(10), card(7), card(9), card(6)], [card(5)])
    const n = reduce(stand(s), { type: 'dealer' })
    expect(handValue(n.player).total).toBe(19)
    expect(handValue(n.dealer).total).toBe(18)
    expect(n.phase).toBe('done')
    expect(n.result).toBe('win')
    expect(n.payout).toBe(BET)
    expect(n.score).toBe(10)
    expect(dealerAction(n)).toBeNull()
  })

  it('玩家点数小则输，0 分', () => {
    const s = stateWith([card(8), card(10), card(7), card(8)])
    const n = reduce(stand(s), { type: 'dealer' })
    expect(handValue(n.player).total).toBe(15)
    expect(handValue(n.dealer).total).toBe(18)
    expect(n.result).toBe('lose')
    expect(n.payout).toBe(0)
    expect(n.score).toBe(0)
  })

  it('点数相同走和局，记 0.5 个胜场（5 分）', () => {
    const s = stateWith([card(8), card(10), card(9), card(7)])
    const n = reduce(stand(s), { type: 'dealer' })
    expect(handValue(n.player).total).toBe(17)
    expect(handValue(n.dealer).total).toBe(17)
    expect(n.phase).toBe('done')
    expect(n.result).toBe('push')
    expect(n.payout).toBe(5)
    expect(n.score).toBe(5)
    expect(n.payout / BET).toBe(0.5)
  })

  it('得分在多手之间累加：黑杰克 +15 后再来一手，普通胜 +10', () => {
    // 第一手：玩家 A+K 直接黑杰克；后续 4 张按「玩家 20 胜庄家 19」构造
    const base = stateWith(
      [card(1), card(9), card(10), card(7)],
      [card(10), card(8), card(10), card(9), card(2)],
    )
    const first = openHand(base)
    expect(first.score).toBe(15)
    const second = deal(first)
    expect(second.score).toBe(15) // 新的一手尚未结算
    const done = reduce(stand(second), { type: 'dealer' })
    expect(done.result).toBe('win')
    expect(done.payout).toBe(BET)
    expect(done.score).toBe(25) // 15 + 10
    expect(first.score).toBe(15)
  })
})

describe('牌堆耗尽自动补牌', () => {
  it('牌堆发完时把已用的牌洗回去继续发', () => {
    const s = stateWith([card(10), card(7), card(9), card(6)], [], { cursor: DECK_SIZE })
    expect(remaining(s)).toBe(0)
    const n = hit(s)
    expect(n.reshuffles).toBe(1)
    expect(n.deck).toHaveLength(4)
    expect(n.deck.map((c) => c.id).sort()).toEqual(s.used.map((c) => c.id).sort())
    expect(n.player).toHaveLength(3)
    expect(n.used).toHaveLength(5)
    expect(n.cursor).toBe(1)
  })

  it('补牌由 state.rng 决定，仍可复盘', () => {
    const s = stateWith([card(10), card(7), card(9), card(6)], [], { cursor: DECK_SIZE })
    expect(hit(s)).toEqual(hit(s))
  })

  it('极端情况（已用牌为空）退回整副新牌，不会崩溃', () => {
    const s = stateWith([card(10), card(7), card(9), card(6)], [], { cursor: DECK_SIZE, used: [] })
    const n = hit(s)
    expect(n.deck).toHaveLength(DECK_SIZE)
    expect(n.player).toHaveLength(3)
    expect(n.reshuffles).toBe(1)
  })

  it('连续模拟 60 局不抛错，每局都能结算', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = playRound(seed * 7919, 15 + (seed % 7))
      expect(s.phase).toBe('done')
      expect(s.result).not.toBeNull()
      expect(s.dealer.length).toBeGreaterThanOrEqual(2)
      expect(s.player.length).toBeGreaterThanOrEqual(2)
      expect(s.score).toBeGreaterThanOrEqual(0)
      expect(s.deck.length).toBeGreaterThan(0)
      expect(s.used.length).toBe(s.player.length + s.dealer.length)
    }
  })

  it('一路 hit 到爆牌也能正常结算', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = create(seed * 104729)
      let guard = 0
      while (s.phase !== 'done' && guard++ < 40) s = hit(s)
      expect(s.phase).toBe('done')
      expect(s.result).not.toBeNull()
      expect(s.player.length).toBeLessThanOrEqual(20)
    }
  })

  it('长局中多次洗回牌堆也不会越界', () => {
    let s = create(31337)
    let guard = 0
    while (s.phase !== 'done' && guard++ < 300) {
      s = handValue(s.player).total < 12 ? hit(s) : stand(s)
      while (s.phase === 'dealer') s = reduce(s, { type: 'dealer' })
      expect(s.deck.length).toBeGreaterThan(0)
      expect(s.cursor).toBeLessThanOrEqual(s.deck.length)
      expect(remaining(s)).toBeGreaterThanOrEqual(0)
    }
    expect(s.phase).toBe('done')
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参（牌堆、游标、手牌、used、rng 均不变）', () => {
    const s = stateWith([card(10), card(7), card(9), card(6)], [card(5)], { rng: 12345 })
    const deck = s.deck.slice()
    const used = s.used.slice()
    const player = s.player.slice()
    const dealer = s.dealer.slice()
    hit(s)
    expect(s.deck).toEqual(deck)
    expect(s.deck).toHaveLength(DECK_SIZE)
    expect(s.used).toEqual(used)
    expect(s.player).toEqual(player)
    expect(s.dealer).toEqual(dealer)
    expect(s.cursor).toBe(4)
    expect(s.rng).toBe(12345)
    expect(s.phase).toBe('player')
    expect(s.result).toBeNull()
  })

  it('stand / dealer / 结算路径同样不修改入参', () => {
    const s = stateWith([card(10), card(7), card(9), card(6)], [card(5)], { rng: 999 })
    const before = JSON.stringify(s)
    const st = stand(s)
    const done = reduce(st, { type: 'dealer' })
    expect(JSON.stringify(s)).toBe(before)
    expect(JSON.stringify(st)).not.toBe(before)
    expect(JSON.stringify(done)).not.toBe(JSON.stringify(st))
    expect(st.phase).toBe('dealer')
    expect(st.result).toBeNull()
    expect(done.result).toBe('win')
  })

  it('相同输入两次调用结果完全相等', () => {
    const s = stateWith([card(10), card(7), card(9), card(6)], [card(5), card(2)])
    expect(hit(s)).toEqual(hit(s))
    expect(reduce(s, { type: 'stand' })).toEqual(reduce(s, { type: 'stand' }))
    expect(reduce(stand(s), { type: 'dealer' })).toEqual(reduce(stand(s), { type: 'dealer' }))
  })

  it('reduce 返回新对象而不是就地修改', () => {
    const s = stateWith([card(10), card(7), card(7), card(6)], [card(2)])
    const n = hit(s)
    expect(n).not.toBe(s)
    expect(n.player).not.toBe(s.player)
    expect(n.used).not.toBe(s.used)
    expect(s.player).toHaveLength(2)
    // 未洗牌时牌堆数组可复用（不会被写），洗牌时必然是新数组
    const exhausted = stateWith([card(10), card(7), card(9), card(6)], [], { cursor: DECK_SIZE })
    const m = hit(exhausted)
    expect(m.deck).not.toBe(exhausted.deck)
  })

  it('create 对同一 seed 完全一致（可复盘）', () => {
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

  it('同一串操作可以完整复盘（终局逐字段一致）', () => {
    const run = (): State => {
      let s = create(20260313)
      const script: Action[] = [{ type: 'hit' }, { type: 'dealer' }, { type: 'hit' }, { type: 'stand' }, { type: 'dealer' }]
      for (const a of script) s = reduce(s, a)
      return s
    }
    const a = run()
    const b = run()
    expect(a).toEqual(b)
    expect(a.score).toBe(b.score)
    expect(a.result).toBe(b.result)
    expect(a.phase).toBe('done')
  })

  it('同样的策略在不同种子下不会串状态', () => {
    expect(playRound(11)).toEqual(playRound(11))
    expect(playRound(11).deck).not.toEqual(playRound(12).deck)
  })
})
