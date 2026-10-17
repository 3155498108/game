import { describe, expect, it } from 'vitest'
import { makeDeck } from '../../core/cards'
import type { Card } from '../../core/cards'
import type { Effect } from '../../core/types'
import game, { meta } from './index'
import {
  DECKS,
  MAX_HAND,
  ODDS,
  SHOE_SIZE,
  STEP_MS,
  bankerDraws,
  cardPoints,
  create,
  handTotal,
  isSide,
  netMultiple,
  payoutNet,
  playerDraws,
  reduce,
  settle,
} from './rules'
import type { Action, Result, Side, State } from './rules'

/** 深冻结：freeze 之后若 reduce 试图改入参会直接抛错 */
function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const k of Object.keys(v as Record<string, unknown>)) {
      deepFreeze((v as Record<string, unknown>)[k])
    }
  }
  return v
}

/** 跑完一整局：下注 → 发牌 → 要牌 → 比点 → 结算 */
function runRound(s: State, side: Side): State {
  let cur = reduce(s, { type: 'placeBet', side })
  for (let i = 0; i < 12 && cur.phase === 'playing'; i++) cur = reduce(cur, { type: 'step', dt: STEP_MS })
  if (cur.phase !== 'done') throw new Error('对局没有在 12 步内结束')
  return cur
}

function card(id: number, rank: number, suit: Card['suit'] = 'S'): Card {
  return { id, rank, suit }
}

/** 首两张牌的总点数 */
function firstTwoTotal(cards: readonly Card[]): number {
  return handTotal(cards.slice(0, 2))
}

describe('百家乐 meta', () => {
  it('meta 同时具名导出与默认导出，且 id 等于目录名', () => {
    expect(meta.id).toBe('baccarat')
    expect(meta.viewport).toEqual({ width: 720, height: 1280 })
    expect(meta.category).toBe('card')
    expect(game.id).toBe('baccarat')
  })
})

describe('百家乐 点数换算', () => {
  it('A=1，2~9 原值，10/J/Q/K=10', () => {
    expect(cardPoints(card(0, 1))).toBe(1) // A
    for (let r = 2; r <= 9; r++) expect(cardPoints(card(r, r))).toBe(r)
    expect(cardPoints(card(10, 10))).toBe(10) // 10
    expect(cardPoints(card(11, 11))).toBe(10) // J
    expect(cardPoints(card(12, 12))).toBe(10) // Q
    expect(cardPoints(card(13, 13))).toBe(10) // K
  })

  it('只看点数，不看花色', () => {
    // 四张 10 点牌合计 40，个位为 0：换任何花色结果都一样
    const sameRank: Card[] = [
      card(0, 13, 'S'),
      card(1, 13, 'H'),
      card(2, 12, 'D'),
      card(3, 12, 'C'),
    ]
    expect(handTotal(sameRank)).toBe(0)
    const bySuit: Card[] = [card(0, 5, 'S'), card(1, 5, 'H'), card(2, 4, 'C'), card(3, 4, 'D')]
    expect(handTotal(bySuit)).toBe(handTotal([card(0, 5, 'D'), card(1, 5, 'C'), card(2, 4, 'H'), card(3, 4, 'S')]))
    expect(handTotal(bySuit)).toBe(8)
  })

  it('总点数只留个位，且恒在 0..9', () => {
    expect(handTotal([card(0, 9), card(1, 9)])).toBe(8)
    expect(handTotal([card(0, 10), card(1, 10)])).toBe(0)
    expect(handTotal([card(0, 7)])).toBe(7)
    for (const c of makeDeck({ decks: DECKS })) expect(cardPoints(c)).toBeLessThanOrEqual(10)
  })
})

describe('百家乐 要牌表', () => {
  it('闲家：对 0~5 要牌，对 6~9 停牌（逐值断言）', () => {
    for (let t = 0; t <= 5; t++) expect(playerDraws(t)).toBe(true)
    for (let t = 6; t <= 9; t++) expect(playerDraws(t)).toBe(false)
  })

  it('庄家：对 0~5 / 7 / 9 要牌，对 6 / 8 停牌（逐值断言）', () => {
    const draw = [true, true, true, true, true, true, false, true, false, true]
    for (let t = 0; t <= 9; t++) expect(bankerDraws(t)).toBe(draw[t])
  })

  it('200 个种子里，闲家与庄家的手牌张数都严格服从要牌表', () => {
    let playerDrew = 0
    let bankerDrew = 0
    for (let seed = 1; seed <= 200; seed++) {
      const s = runRound(create(seed), 'player')
      if (playerDraws(firstTwoTotal(s.player))) {
        expect(s.player).toHaveLength(3)
        playerDrew++
      } else {
        expect(s.player).toHaveLength(2)
      }
      if (bankerDraws(firstTwoTotal(s.banker))) {
        expect(s.banker).toHaveLength(3)
        bankerDrew++
      } else {
        expect(s.banker).toHaveLength(2)
      }
    }
    expect(playerDrew).toBeGreaterThan(0)
    expect(bankerDrew).toBeGreaterThan(0)
  })

  it('每手牌不会超过 3 张', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const s = runRound(create(seed), 'tie')
      expect(s.player.length).toBeGreaterThanOrEqual(2)
      expect(s.player.length).toBeLessThanOrEqual(MAX_HAND)
      expect(s.banker.length).toBeGreaterThanOrEqual(2)
      expect(s.banker.length).toBeLessThanOrEqual(MAX_HAND)
    }
  })

  it('每手总点数都在 0..9 之间', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const s = runRound(create(seed), 'banker')
      for (const hand of [s.player, s.banker]) {
        const t = handTotal(hand)
        expect(t).toBeGreaterThanOrEqual(0)
        expect(t).toBeLessThanOrEqual(9)
        expect(hand.reduce((a, c) => a + cardPoints(c), 0) % 10).toBe(t)
      }
    }
  })
})

describe('百家乐 结算与赔率', () => {
  it('比点：相等为和，否则大者胜', () => {
    expect(settle(7, 5)).toBe('player')
    expect(settle(5, 7)).toBe('banker')
    expect(settle(6, 6)).toBe('tie')
    expect(settle(0, 0)).toBe('tie')
    expect(settle(0, 9)).toBe('banker')
  })

  it('赔率表：庄 1:1、闲 1:1、和 8:1', () => {
    expect(ODDS).toEqual({ banker: 1, player: 1, tie: 8 })
  })

  it('三种下注 × 三种结果共 9 种组合的净收益', () => {
    const table: Record<Side, Record<Result, number>> = {
      banker: { banker: 1, player: -1, tie: 0 },
      player: { player: 1, banker: -1, tie: 0 },
      tie: { tie: 8, banker: -1, player: -1 },
    }
    for (const bet of ['banker', 'player', 'tie'] as Side[]) {
      for (const res of ['banker', 'player', 'tie'] as Result[]) {
        expect(payoutNet(bet, res)).toBe(table[bet][res])
      }
    }
  })

  it('和局押中 = 8 倍注 + 本金（coins 随注额换算）', () => {
    let tieState: State | null = null
    for (let seed = 1; seed <= 300 && !tieState; seed++) {
      const s = runRound(create(seed), 'tie')
      if (s.result === 'tie') tieState = s
    }
    expect(tieState).not.toBeNull()
    const s = tieState!
    expect(s.bet).toBe('tie')
    const o = game.outcome!(s)!
    for (const bet of [1, 10, 100, 7]) {
      expect(game.coins!(s, o, bet)).toBe(bet * 8)
      // 8 倍注 + 本金：净盈亏正好是注额的 8 倍
      expect(game.coins!(s, o, bet) + bet).toBe(bet * 9)
    }
  })

  it('coins：押中按赔率倍数换算，随注额等比缩放', () => {
    // 用确定的手牌构造终局：闲 7（A+6）vs 庄 5（2+3）
    const s: State = {
      ...create(1),
      phase: 'done',
      stage: 'done',
      bet: 'player',
      player: [card(0, 1), card(1, 6)],
      banker: [card(2, 2), card(3, 3)],
      result: 'player',
      lastNet: payoutNet('player', 'player'),
    }
    expect(handTotal(s.player)).toBe(7)
    expect(handTotal(s.banker)).toBe(5)
    const o = game.outcome!(s)!
    expect(o).toEqual({ score: 0, better: 'higher', unit: '金币', win: true })
    for (const bet of [1, 10, 100, 7]) {
      expect(game.coins!(s, o, bet)).toBe(bet)
      expect(Math.abs(game.coins!(s, o, bet) / bet / 1 - 1)).toBeLessThan(1e-9)
    }
  })

  it('coins：押中「和」返 8 倍注 + 本金（净 8 倍）', () => {
    const s: State = {
      ...create(1),
      phase: 'done',
      stage: 'done',
      bet: 'tie',
      player: [card(0, 4), card(1, 5)],
      banker: [card(2, 9), card(3, 10)],
      result: 'tie',
      lastNet: 8,
    }
    expect(handTotal(s.player)).toBe(9)
    expect(handTotal(s.banker)).toBe(9)
    const o = game.outcome!(s)!
    expect(game.coins!(s, o, 10)).toBe(80)
    expect(game.coins!(s, o, 100)).toBe(800)
    expect(game.coins!(s, o, 25)).toBe(200)
    // 8 倍注 + 本金 = 90，净盈亏 80
    expect(game.coins!(s, o, 10) + 10).toBe(90)
  })

  it('coins：押庄闲遇和退还本金（0），押错输掉全部注额', () => {
    const tieState: State = {
      ...create(1),
      phase: 'done',
      stage: 'done',
      bet: 'banker',
      player: [card(0, 4), card(1, 5)],
      banker: [card(2, 9), card(3, 10)],
      result: 'tie',
      lastNet: 0,
    }
    const o = game.outcome!(tieState)!
    expect(game.coins!(tieState, o, 50)).toBe(0)
    const loseState: State = { ...tieState, bet: 'player', result: 'banker', lastNet: -1 }
    expect(game.coins!(loseState, game.outcome!(loseState)!, 50)).toBe(-50)
  })

  it('coins：未结算的牌局不结算', () => {
    const s = create(1)
    expect(netMultiple(s)).toBe(0)
    const o = game.outcome!(s)!
    expect(game.coins!(s, o, 100)).toBe(0)
    expect(game.outcome!(s)).toBeNull()
  })
})

describe('百家乐 牌局流程', () => {
  it('create：开局是下注阶段，牌堆 8 副并已洗过', () => {
    const s = create(2024)
    expect(s.phase).toBe('bet')
    expect(s.stage).toBe('bet')
    expect(s.shoe).toHaveLength(SHOE_SIZE)
    expect(s.pos).toBe(0)
    expect(s.shoes).toBe(1)
    expect(s.player).toEqual([])
    expect(s.banker).toEqual([])
    expect(new Set(s.shoe.map((c) => c.id)).size).toBe(SHOE_SIZE)
  })

  it('create 是纯函数：同种子两次调用完全一致', () => {
    expect(create(77)).toEqual(create(77))
    expect(JSON.stringify(create(5))).toBe(JSON.stringify(create(5)))
  })

  it('发牌顺序：闲、庄、闲、庄，各两张', () => {
    let s = reduce(create(3), { type: 'placeBet', side: 'player' })
    expect(s.stage).toBe('dealP0')
    s = reduce(s, { type: 'step', dt: STEP_MS })
    expect(s.stage).toBe('dealB0')
    expect(s.player).toHaveLength(1)
    expect(s.banker).toHaveLength(0)
    s = reduce(s, { type: 'step', dt: STEP_MS })
    expect(s.stage).toBe('dealP1')
    expect(s.player).toHaveLength(1)
    expect(s.banker).toHaveLength(1)
    s = reduce(s, { type: 'step', dt: STEP_MS })
    expect(s.stage).toBe('dealB1')
    expect(s.player).toHaveLength(2)
    expect(s.banker).toHaveLength(1)
    s = reduce(s, { type: 'step', dt: STEP_MS })
    expect(s.stage).toBe('playerCheck')
    expect(s.player).toHaveLength(2)
    expect(s.banker).toHaveLength(2)
    expect(s.pos).toBe(4)
  })

  it('同种子开局完全一致', () => {
    const a = runRound(create(4242), 'banker')
    const b = runRound(create(4242), 'banker')
    expect(a.result).toBe(b.result)
    expect(a.player.map((c) => c.id)).toEqual(b.player.map((c) => c.id))
    expect(a.banker.map((c) => c.id)).toEqual(b.banker.map((c) => c.id))
    expect(a.pos).toBe(b.pos)
  })

  it('每局最多 8 步必然结算，不会卡死', () => {
    for (let seed = 1; seed <= 50; seed++) {
      let s = reduce(create(seed), { type: 'placeBet', side: 'tie' })
      let steps = 0
      while (s.phase === 'playing') {
        s = reduce(s, { type: 'step', dt: STEP_MS })
        steps++
        expect(steps).toBeLessThanOrEqual(8)
      }
      expect(s.phase).toBe('done')
      expect(s.result).not.toBeNull()
      expect(s.rounds).toBe(1)
      expect(steps).toBeGreaterThanOrEqual(4)
    }
  })

  it('tick 折算出的 dt 不会跳步：冷却没走完不发牌', () => {
    let s = reduce(create(11), { type: 'placeBet', side: 'player' })
    // 下注后冷却为 0，第一步立刻发出第一张牌
    s = reduce(s, { type: 'step', dt: 0 })
    expect(s.player).toHaveLength(1)
    expect(s.cooldown).toBe(STEP_MS)
    // 冷却没走完：dt 不够就不发下一张
    s = reduce(s, { type: 'step', dt: STEP_MS / 4 })
    expect(s.player).toHaveLength(1)
    expect(s.cooldown).toBeCloseTo(STEP_MS - STEP_MS / 4, 6)
    // dt 为 0 也不会跳步
    s = reduce(s, { type: 'step', dt: 0 })
    expect(s.player).toHaveLength(1)
    // 冷却走满：按 闲庄闲庄 顺序发出第二张（庄家的第一张）
    s = reduce(s, { type: 'step', dt: STEP_MS })
    expect(s.player).toHaveLength(1)
    expect(s.banker).toHaveLength(1)
    expect(s.stage).toBe('dealP1')
  })

  it('牌堆耗尽自动洗回', () => {
    let s = create(13)
    for (let i = 0; i < 200; i++) s = runRound(s, 'player')
    expect(s.shoes).toBeGreaterThan(1)
    expect(s.shoe).toHaveLength(SHOE_SIZE)
    expect(s.pos).toBeLessThanOrEqual(SHOE_SIZE)
    expect(s.pos).toBeGreaterThan(0)
    expect(s.rounds).toBe(200)
    expect(s.result).not.toBeNull()
  })

  it('结算后可以再开一局：局数与累计收益累加', () => {
    let s = create(31)
    s = runRound(s, 'player')
    const first = s.result
    const profit = s.profit
    s = reduce(s, { type: 'placeBet', side: 'banker' })
    expect(s.phase).toBe('playing')
    expect(s.player).toEqual([])
    expect(s.banker).toEqual([])
    expect(s.result).toBeNull()
    expect(s.profit).toBe(profit)
    s = runRound(s, 'banker')
    expect(s.rounds).toBe(2)
    expect(s.profit).toBe(profit + payoutNet('banker', s.result!))
    expect(first).not.toBeNull()
  })
})

describe('百家乐 非法输入与纯度', () => {
  it('发牌中不能改注，终局后 step 无效', () => {
    const idle = create(2)
    const playing = reduce(idle, { type: 'placeBet', side: 'player' })
    expect(reduce(playing, { type: 'placeBet', side: 'tie' })).toBe(playing)
    const done = runRound(create(2), 'player')
    const after = reduce(done, { type: 'step', dt: STEP_MS })
    expect(after).toBe(done)
    expect(reduce(idle, { type: 'step', dt: STEP_MS })).toBe(idle)
  })

  it('非法下注与未知动作不改状态', () => {
    const s = create(6)
    expect(isSide('banker') && isSide('player') && isSide('tie')).toBe(true)
    expect(isSide('tiee')).toBe(false)
    expect(reduce(s, { type: 'placeBet', side: 'nope' } as unknown as Action)).toBe(s)
    expect(reduce(s, { type: 'nope' } as unknown as Action)).toBe(s)
  })

  it('reduce 不修改入参（深冻结后可安全推进）', () => {
    const s0 = deepFreeze(create(31415))
    const before = JSON.stringify(s0)
    let s = s0
    for (let i = 0; i < 12 && s.phase !== 'done'; i++) {
      s = s.phase === 'bet' ? reduce(s, { type: 'placeBet', side: 'player' }) : reduce(s, { type: 'step', dt: STEP_MS })
    }
    expect(s.phase).toBe('done')
    expect(JSON.stringify(s0)).toBe(before)
    expect(Object.isFrozen(s0.shoe)).toBe(true)
    expect(s0.player).toEqual([])
  })

  it('controls：发牌中禁用三种下注', () => {
    const idle = create(8)
    const cs = game.controls!(idle)
    expect(cs.map((c) => c.label)).toEqual(['下注·庄 1:1', '下注·闲 1:1', '下注·和 8:1'])
    expect(cs.every((c) => !c.disabled)).toBe(true)
    const playing = reduce(idle, { type: 'placeBet', side: 'player' })
    expect(game.controls!(playing).every((c) => c.disabled)).toBe(true)
    expect(game.controls!(runRound(create(8), 'tie')).every((c) => !c.disabled)).toBe(true)
  })

  it('effects：发牌有反馈，结算按输赢给不同反馈', () => {
    let s = create(12)
    s = reduce(s, { type: 'placeBet', side: 'player' })
    const dealt = reduce(s, { type: 'step', dt: STEP_MS })
    expect(game.effects!(s, dealt).some((e) => e.kind === 'sound' && e.name === 'flip')).toBe(true)
    // 跑到结算帧
    let prev = dealt
    let fx: Effect[] = []
    for (let i = 0; i < 12 && prev.phase !== 'done'; i++) {
      const next = reduce(prev, { type: 'step', dt: STEP_MS })
      const f = game.effects!(prev, next)
      if (next.phase === 'done') fx = f
      prev = next
    }
    expect(prev.phase).toBe('done')
    expect(fx.some((e) => e.kind === 'sound')).toBe(true)
  })

  it('hint：下注中 / 发牌中 / 已结算三种文案', () => {
    expect(game.hint!(create(15))).toContain('选择下注')
    const playing = reduce(create(15), { type: 'placeBet', side: 'tie' })
    expect(game.hint!(playing)).toContain('发牌')
    const done = runRound(create(15), 'tie')
    expect(game.hint!(done)).toContain('你押和')
  })
})
