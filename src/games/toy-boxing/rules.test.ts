/**
 * 玩具拳击规则单测（纯逻辑，可在 node 环境直接跑）
 */
import { describe, it, expect } from 'vitest'
import {
  PUNCHES,
  TOTAL_WINDUP,
  MAX_HP,
  COMBO_CAP,
  comboMultiplier,
  punchDamage,
  create,
  reduce,
  playTurn,
  perfectPunch,
  legalActions,
  evaluate,
  aiAction,
  aiActionFor,
  type Action,
  type PunchKind,
  type Side,
  type State,
} from './rules'

/** 递归冻结：reduce 若试图修改入参，在严格模式下会直接抛错 */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const k of Object.keys(o as object)) deepFreeze((o as Record<string, unknown>)[k])
    Object.freeze(o)
  }
  return o
}

/** 走到某个阶段的便捷函数：选向后逐 tick 推进 */
function chooseThenTick(seed: number, punch: PunchKind, n: number): State {
  return reduce(reduce(create(seed), { type: 'choose', punch }), { type: 'tick', n })
}

/** 自动对局：双方都由 AI 驱动，返回每一步后的状态快照 */
function runAuto(seed: number, maxSteps = 400): State[] {
  const out: State[] = []
  let s = create(seed)
  for (let i = 0; i < maxSteps && !s.over; i++) {
    const a = aiActionFor(s, s.turn)
    if (a === null) break
    s = reduce(s, a)
    out.push(s)
  }
  out.push(s)
  return out
}

describe('玩具拳击 · 拳种差异', () => {
  it('三个拳的伤害与出拳时间各不相同', () => {
    const all = PUNCHES.flatMap((p) => [p.damage, p.windup, p.window])
    expect(new Set(all).size).toBe(all.length)
    expect(new Set(PUNCHES.map((p) => p.damage)).size).toBe(3)
    expect(new Set(PUNCHES.map((p) => p.windup)).size).toBe(3)
    expect(new Set(PUNCHES.map((p) => p.window)).size).toBe(3)
    expect(TOTAL_WINDUP).toBe(PUNCHES.reduce((n, p) => n + p.windup, 0))
    // 勾拳伤害最高但蓄力最久，直拳最快
    expect(PUNCHES[0].windup).toBeLessThan(PUNCHES[2].windup)
    expect(PUNCHES[0].damage).toBeLessThan(PUNCHES[2].damage)
    expect(PUNCHES[0].window).toBeGreaterThan(PUNCHES[2].window)
  })

  it('三个拳完美出拳各自打出不同伤害', () => {
    const hits = PUNCHES.map((p) => playTurn(create(11), p.kind).lastDamage)
    expect(hits).toEqual(PUNCHES.map((p) => p.damage))
    expect(new Set(hits).size).toBe(3)
    expect(punchDamage('jab')).toBe(6)
    expect(punchDamage('cross')).toBe(12)
    expect(punchDamage('hook')).toBe(20)
  })
})

describe('玩具拳击 · 时机窗口', () => {
  it('窗口内出拳才造成伤害', () => {
    const chosen = reduce(create(1), { type: 'choose', punch: 'jab' })
    expect(chosen.phase).toBe('windup')
    const open = reduce(chosen, { type: 'tick', n: PUNCHES[0].windup })
    expect(open.phase).toBe('window')
    expect(open.timer).toBe(PUNCHES[0].window)
    const hit = reduce(open, { type: 'punch' })
    expect(hit.lastEvent).toBe('hit')
    expect(hit.foe.hp).toBe(MAX_HP - PUNCHES[0].damage)
    expect(hit.turn).toBe('foe')
  })

  it('蓄力未走完就出拳 = 落空，不掉血也不涨连击', () => {
    const s = chooseThenTick(1, 'jab', 2)
    expect(s.phase).toBe('windup')
    const miss = reduce(s, { type: 'punch' })
    expect(miss.lastEvent).toBe('whiff')
    expect(miss.foe.hp).toBe(MAX_HP)
    expect(miss.you.combo).toBe(0)
    expect(miss.lastDamage).toBe(0)
  })

  it('窗口走完仍未出拳自动判落空并交还回合', () => {
    const spec = PUNCHES[2]
    const miss = chooseThenTick(1, 'hook', spec.windup + spec.window)
    expect(miss.lastEvent).toBe('whiff')
    expect(miss.turn).toBe('foe')
    expect(miss.phase).toBe('choose')
    expect(miss.choice).toBeNull()
  })

  it('完美出拳辅助函数只走一次窗口', () => {
    const hit = perfectPunch(reduce(create(2), { type: 'choose', punch: 'cross' }))
    expect(hit.lastEvent).toBe('hit')
    expect(hit.foe.hp).toBe(MAX_HP - PUNCHES[1].damage)
  })
})

describe('玩具拳击 · 连击加成', () => {
  it('连击越高伤害越高，且逐级递增', () => {
    let s = create(3)
    // 回合交替进行：双方各打一次，所以伤害序列按「你 / 对手」成对出现
    const seq: number[] = []
    for (let i = 0; i < 6; i++) {
      s = playTurn(s, 'jab')
      seq.push(s.lastDamage)
    }
    expect(seq).toEqual([6, 6, 7, 7, 8, 8])
    expect(s.you.best).toBe(3)
    expect(s.foe.best).toBe(3)
    expect(punchDamage('jab', 0)).toBe(6)
    expect(punchDamage('jab', 1)).toBe(7)
    expect(punchDamage('jab', 2)).toBe(8)
    for (let i = 2; i < seq.length; i += 2) expect(seq[i]).toBeGreaterThan(seq[i - 2])
  })

  it('断连后连击清零、伤害回到基础值', () => {
    let s = create(3)
    for (let i = 0; i < 6; i++) s = playTurn(s, 'jab')
    expect(s.turn).toBe('you')
    expect(s.you.combo).toBe(3)

    // 玩家提前硬打 → 落空，连击清零
    s = reduce(reduce(s, { type: 'choose', punch: 'jab' }), { type: 'tick', n: 2 })
    s = reduce(s, { type: 'punch' })
    expect(s.lastEvent).toBe('whiff')
    expect(s.you.combo).toBe(0)
    expect(s.you.best).toBe(3)
    expect(s.turn).toBe('foe')

    // 对手也落空一次，让回合回到玩家
    s = reduce(reduce(s, { type: 'choose', punch: 'jab' }), { type: 'punch' })
    expect(s.foe.combo).toBe(0)
    expect(s.turn).toBe('you')

    s = playTurn(s, 'jab')
    expect(s.lastDamage).toBe(PUNCHES[0].damage)
    expect(s.you.combo).toBe(1)
  })

  it('连击加成有上限，不会无限膨胀', () => {
    expect(comboMultiplier(0)).toBe(1)
    expect(comboMultiplier(COMBO_CAP + 50)).toBe(comboMultiplier(COMBO_CAP))
    expect(punchDamage('hook', COMBO_CAP)).toBeGreaterThan(punchDamage('hook', 0))
  })
})

describe('玩具拳击 · 终局判定', () => {
  it('一方 HP 归零即终局并分出胜负', () => {
    let s = create(9)
    let guard = 0
    while (!s.over && guard++ < 200) s = playTurn(s, 'hook')
    expect(s.over).toBe(true)
    expect(s.foe.hp).toBe(0)
    expect(s.you.hp).toBeGreaterThan(0)
    expect(s.winner).toBe('you')
    // 终局后任何 action 都不再改变状态
    const frozen = deepFreeze(s)
    expect(reduce(frozen, { type: 'punch' })).toBe(frozen)
    expect(reduce(frozen, { type: 'tick', n: 5 })).toBe(frozen)
    expect(reduce(frozen, { type: 'choose', punch: 'jab' })).toBe(frozen)
    expect(legalActions(frozen)).toEqual([])
    expect(aiAction(frozen)).toBeNull()
  })

  it('玩家一直落空时会被电脑 KO，胜负方向相反', () => {
    let s = create(3)
    let guard = 0
    while (!s.over && guard++ < 300) {
      if (s.turn === 'you') {
        s = reduce(reduce(s, { type: 'choose', punch: 'jab' }), { type: 'punch' })
      } else {
        const a = aiActionFor(s, 'foe')
        if (a === null) break
        s = reduce(s, a)
      }
    }
    expect(s.over).toBe(true)
    expect(s.you.hp).toBe(0)
    expect(s.foe.hp).toBe(MAX_HP)
    expect(s.winner).toBe('foe')
  })
})

describe('玩具拳击 · AI', () => {
  it('AI 每步都只从 legalActions 里挑，且是合法手', () => {
    let s = create(7)
    for (let i = 0; i < 400 && !s.over; i++) {
      const side: Side = s.turn
      const a = aiActionFor(s, side)
      expect(a).not.toBeNull()
      const legal = legalActions(s)
      expect(legal).toContainEqual(a as Action)
      // 合法手逐个试算都不能抛错
      for (const cand of legal) expect(() => reduce(s, cand)).not.toThrow()
      s = reduce(s, a as Action)
    }
    expect(s.over).toBe(true)
  })

  it('AI 只在自己回合出手；回合推进时始终有合法手，不卡死', () => {
    const s0 = create(1)
    expect(aiAction(s0)).toBeNull() // 玩家回合
    let s = s0
    for (let i = 0; i < 200 && !s.over; i++) {
      expect(legalActions(s).length).toBeGreaterThan(0)
      if (s.turn === 'foe') expect(aiAction(s)).not.toBeNull()
      else expect(aiAction(s)).toBeNull()
      const a = aiActionFor(s, s.turn) as Action
      s = reduce(s, a)
    }
    expect(s.over).toBe(true)
  })

  it('AI 在蓄力期选择等待而不是硬打（不无谓落空）', () => {
    let s = create(21)
    while (s.turn === 'you' || s.phase === 'choose') {
      const a = aiActionFor(s, s.turn) as Action
      s = reduce(s, a)
    }
    expect(s.turn).toBe('foe')
    expect(s.phase).toBe('windup')
    const a = aiActionFor(s, 'foe') as Action
    expect(a.type).toBe('tick')
    // 等待后正好进入窗口，随后必然出拳命中
    const ready = reduce(s, a)
    expect(ready.phase).toBe('window')
    const struck = reduce(ready, aiAction(ready) as Action)
    expect(struck.lastEvent).toBe('hit')
    expect(struck.you.hp).toBeLessThan(MAX_HP)
  })

  it('双方 AI 对战必然走到终局，不会无限循环', () => {
    for (const seed of [1, 7, 42, 2024, -13]) {
      const steps = runAuto(seed)
      const last = steps[steps.length - 1]
      expect(last.over).toBe(true)
      expect(last.winner).not.toBe(0)
      expect(steps.length).toBeLessThan(400)
    }
  })

  it('AI 单步耗时打印实测值并远低于 50ms', () => {
    let s = create(2024)
    let worst = 0
    let steps = 0
    while (!s.over && steps < 400) {
      const t0 = performance.now()
      const a = aiActionFor(s, s.turn) as Action
      s = reduce(s, a)
      const dt = performance.now() - t0
      if (dt > worst) worst = dt
      steps++
    }
    console.log(`[toy-boxing] AI 单步最差耗时 ${worst.toFixed(4)}ms（共 ${steps} 步，终局 HP 你=${s.you.hp} 对手=${s.foe.hp}）`)
    expect(worst).toBeLessThan(50)
    expect(s.over).toBe(true)
  })

  it('评分函数在终局时给出明确的胜负偏好', () => {
    let s = create(4)
    let guard = 0
    while (!s.over && guard++ < 200) s = playTurn(s, 'hook')
    expect(evaluate(s, 'you')).toBeGreaterThan(0)
    expect(evaluate(s, 'foe')).toBeLessThan(0)
  })
})

describe('玩具拳击 · 可复现性与纯度', () => {
  it('同种子 + 同操作序列必然得到同一局', () => {
    expect(runAuto(42)).toEqual(runAuto(42))
    expect(create(42)).toEqual(create(42))
    expect(create(42).rng).not.toBe(create(43).rng)
  })

  it('不同种子会走出不同的出拳选择（电脑出拳由 Rng 驱动）', () => {
    const picks = new Set<PunchKind>()
    for (let seed = 1; seed <= 12; seed++) {
      const s0 = create(seed)
      const s1 = reduce(s0, aiActionFor(s0, 'you') as Action)
      picks.add(s1.choice as PunchKind)
    }
    expect(picks.size).toBeGreaterThan(1)
  })

  it('reduce 不修改入参（深冻结后依然可用）', () => {
    const base = deepFreeze(playTurn(create(5), 'cross'))
    const chosen = deepFreeze(reduce(base, { type: 'choose', punch: 'hook' }))
    expect(() => reduce(chosen, { type: 'tick', n: 3 })).not.toThrow()
    expect(() => reduce(chosen, { type: 'punch' })).not.toThrow()
    expect(() => reduce(chosen, { type: 'tick', n: 0 })).not.toThrow()
    expect(() => reduce(chosen, { type: 'choose', punch: 'jab' })).not.toThrow()
    const ticked = reduce(chosen, { type: 'tick', n: 3 })
    expect(ticked).not.toBe(chosen)
    expect(ticked.timer).toBe(chosen.timer - 3)
    expect(chosen.tickCount).toBe(base.tickCount)
    // 冻结后的 state 依旧能被完整推进到终局
    expect(() => runAuto(6)).not.toThrow()
    const s = deepFreeze(create(8))
    expect(() => perfectPunch(reduce(s, { type: 'choose', punch: 'hook' }))).not.toThrow()
  })
})
