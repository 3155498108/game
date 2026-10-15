import { describe, it, expect } from 'vitest'
import {
  BOB_X,
  CAST_CD_TICKS,
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  FISH_COUNT,
  MISS_PENALTY,
  SPECIES,
  TIME_TICKS,
  TICK_HZ,
  type State,
  advance,
  cast,
  create,
  hasBite,
  reduce,
  secondsLeft,
} from './rules'

/** 一直推进到有鱼咬钩为止，返回状态 */
function untilBite(s: State, limit = 4000): State {
  let cur = s
  for (let i = 0; i < limit; i++) {
    if (cur.over) break
    cur = advance(cur, 1)
    if (hasBite(cur)) return cur
  }
  throw new Error('推进到上限仍未出现咬钩')
}

/** 深冻结：一旦 reduce 修改入参就直接抛错 */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const k of Object.keys(o as object)) deepFreeze((o as Record<string, unknown>)[k])
    Object.freeze(o)
  }
  return o
}

describe('fishing · 鱼群游动', () => {
  it('鱼横向游动到边界会折返，且折返点正好贴边', () => {
    let s = create(2024)
    expect(s.fishes[0].x === FIELD_LEFT || s.fishes[0].x === FIELD_RIGHT).toBe(true)

    let flips = 0
    let prev = s.fishes[0]
    for (let i = 0; i < 1200; i++) {
      s = advance(s, 1)
      const now = s.fishes[0]
      // 咬钩耗尽会被换成新鱼（id 变化），此时不判定折返
      if (now.id === prev.id && now.hold === 0 && prev.hold === 0 && now.dir !== prev.dir) {
        expect(now.x === FIELD_LEFT || now.x === FIELD_RIGHT).toBe(true)
        flips++
      }
      prev = now
    }
    expect(flips).toBeGreaterThan(0)
  })

  it('鱼不会跑出边界（长时间推进后位置与泳道都合法）', () => {
    let s = advance(create(7), 2000)
    for (let i = 0; i < 600; i++) {
      s = advance(s, 1)
      for (const f of s.fishes) {
        expect(f.x).toBeGreaterThanOrEqual(FIELD_LEFT)
        expect(f.x).toBeLessThanOrEqual(FIELD_RIGHT)
        expect(f.y).toBeGreaterThanOrEqual(FIELD_TOP)
        expect(f.y).toBeLessThanOrEqual(FIELD_BOTTOM)
        expect(f.hold).toBeGreaterThanOrEqual(0)
      }
      expect(s.fishes.length).toBe(FISH_COUNT)
    }
  })
})

describe('fishing · 鱼种属性', () => {
  it('不同鱼的分值与停留时长各不相同且互相独立', () => {
    const weights = new Set(SPECIES.map((s) => s.weight))
    const holds = new Set(SPECIES.map((s) => s.hold))
    const speeds = new Set(SPECIES.map((s) => s.speed))
    expect(weights.size).toBe(SPECIES.length)
    expect(holds.size).toBe(SPECIES.length)
    expect(speeds.size).toBe(SPECIES.length)
    for (const s of SPECIES) {
      expect(s.weight).toBeGreaterThan(0)
      expect(s.hold).toBeGreaterThan(0)
      expect(s.speed).toBeGreaterThan(0)
    }
  })

  it('鱼被咬住时停留时长正好等于该鱼种的 hold', () => {
    const s = untilBite(create(99))
    const f = s.fishes.find((x) => x.id === s.biteId)!
    expect(f.hold).toBe(SPECIES[f.sp].hold)
    expect(f.x).toBe(BOB_X)
  })

  it('停留窗口逐 tick 递减，耗尽后鱼游走且补进新鱼', () => {
    let s = untilBite(create(1234))
    const id = s.biteId
    const g = SPECIES[s.fishes.find((f) => f.id === id)!.sp]
    s = advance(s, 1)
    expect(s.fishes.find((f) => f.id === id)!.hold).toBe(g.hold - 1)
    const gone = advance(s, g.hold - 1)
    expect(hasBite(gone)).toBe(false)
    expect(gone.fishes.some((f) => f.id === id)).toBe(false)
    expect(gone.fishes.length).toBe(FISH_COUNT)
  })
})

describe('fishing · 收杆判定', () => {
  it('收杆命中加分并移除该鱼', () => {
    const s0 = untilBite(create(555))
    const f = s0.fishes.find((x) => x.id === s0.biteId)!
    const g = SPECIES[f.sp]

    const s1 = cast(s0)
    expect(s1.weight).toBe(s0.weight + g.weight)
    expect(s1.caught).toBe(s0.caught + 1)
    expect(s1.miss).toBe(s0.miss)
    expect(hasBite(s1)).toBe(false)
    expect(s1.fishes.some((x) => x.id === f.id)).toBe(false)
    expect(s1.fishes.length).toBe(FISH_COUNT)
    expect(s1.lastCast?.kind).toBe('hit')
    expect(s1.lastCast?.w).toBe(g.weight)
    expect(s1.lastCast?.sp).toBe(f.sp)
  })

  it('空杆判负：计入空杆次数并扣分，且分数不会低于 0', () => {
    // 开局四条鱼都在边缘，水下无咬钩，此时收杆必为空杆
    const fresh = create(31)
    expect(hasBite(fresh)).toBe(false)
    const s1 = cast(fresh)
    expect(s1.miss).toBe(1)
    expect(s1.caught).toBe(0)
    expect(s1.weight).toBe(0) // 0 分不会被扣成负数
    expect(s1.lastCast?.kind).toBe('miss')

    // 已钓到鱼、冷却已过、且当下无鱼咬钩的状态，才能观察到扣分
    let s = cast(untilBite(create(31)))
    let quiet: State | null = null
    for (let i = 0; i < 400 && quiet === null; i++) {
      s = advance(s, 1)
      if (hasBite(s)) {
        s = cast(s)
        continue
      }
      if (s.castCd === 0) quiet = s
    }
    expect(quiet).not.toBeNull()
    const base = quiet as State
    expect(base.weight).toBeGreaterThan(0)
    const s2 = cast(base)
    expect(s2.miss).toBe(base.miss + 1)
    expect(s2.weight).toBe(base.weight - MISS_PENALTY)
    expect(s2.weight).toBeGreaterThanOrEqual(0)
    expect(s2.lastCast?.kind).toBe('miss')
  })

  it('收杆有冷却，终局后收杆无效', () => {
    const s0 = untilBite(create(88))
    const s1 = cast(s0)
    expect(cast(s1)).toBe(s1) // 冷却中，返回同一对象
    const s2 = advance(s1, CAST_CD_TICKS)
    expect(s2.castCd).toBe(0)
    expect(cast(s2).seq).toBe(s2.seq + 1) // 冷却结束即可再收
    const done = advance(s2, TIME_TICKS)
    expect(done.over).toBe(true)
    expect(cast(done)).toBe(done)
  })
})

describe('fishing · 90 秒限时终局', () => {
  it('时间耗尽后正确终局：over 置位、剩余时间归零、不再推进', () => {
    let s = advance(create(2026), TIME_TICKS - 5)
    expect(s.over).toBe(false)
    expect(secondsLeft(s)).toBeGreaterThan(0)

    const done = advance(s, 10)
    expect(done.over).toBe(true)
    expect(done.timeLeft).toBe(0)
    expect(hasBite(done)).toBe(false)
    expect(done.tick).toBe(TIME_TICKS)

    const after = advance(done, 50)
    expect(after.tick).toBe(done.tick)
    expect(after.weight).toBe(done.weight)
    expect(cast(done)).toBe(done)
    expect(reduce(done, { type: 'tick', ms: 100 })).toBe(done)
  })

  it('剩余秒数从 90 递减到 0', () => {
    const s = create(5)
    expect(secondsLeft(s)).toBe(90)
    expect(s.timeLeft).toBe(90 * TICK_HZ)
    expect(secondsLeft(advance(s, 30 * 30))).toBe(60)
  })

  it('tick 动作把毫秒折算成整数 tick，并保留余数', () => {
    const s = create(11)
    // 500ms = 15 个 tick（向上取整前先看余数）
    const a = reduce(s, { type: 'tick', ms: 1000 / TICK_HZ })
    expect(a.tick).toBe(1)
    expect(a.timeLeft).toBe(TIME_TICKS - 1)
    expect(a.rem).toBeCloseTo(0, 6)
    // 半帧不推进游戏，只累积余数
    const b = reduce(s, { type: 'tick', ms: (1000 / TICK_HZ) / 2 })
    expect(b.tick).toBe(0)
    expect(b.rem).toBeCloseTo((1000 / TICK_HZ) / 2, 6)
  })
})

describe('fishing · 纯度与可复现', () => {
  it('同种子 + 同操作序列 → 完全相同的一局', () => {
    const script = (s: State): State => {
      let cur = s
      for (let i = 0; i < 1500; i++) {
        cur = advance(cur, 1)
        if (hasBite(cur)) cur = cast(cur)
      }
      return cur
    }
    const a = script(create(20261015))
    const b = script(create(20261015))
    expect(a).toEqual(b)

    const c = script(create(20261016))
    expect(c.tick).toBe(a.tick)
    expect(c.weight).not.toBe(a.weight) // 不同种子 → 不同鱼群
  })

  it('create 同种子产出完全一致的初始局面', () => {
    expect(create(4242)).toEqual(create(4242))
  })

  it('reduce 不修改入参（深冻结下推进 / 收杆 / 重置均安全）', () => {
    const s = deepFreeze(untilBite(create(2024)))
    const snapshot = JSON.stringify(s)

    const afterStep = reduce(s, { type: 'tick', ms: 1000 / TICK_HZ })
    expect(JSON.stringify(s)).toBe(snapshot)
    expect(afterStep).not.toBe(s)

    const afterCast = reduce(s, { type: 'cast' })
    expect(JSON.stringify(s)).toBe(snapshot)
    expect(afterCast.weight).toBeGreaterThan(s.weight)

    const afterReset = reduce(s, { type: 'reset', seed: 9 })
    expect(JSON.stringify(s)).toBe(snapshot)
    expect(afterReset).toEqual(create(9))

    // 空杆路径同样不得改动入参
    const empty = deepFreeze(create(1))
    const snap2 = JSON.stringify(empty)
    const miss = reduce(empty, { type: 'cast' })
    expect(JSON.stringify(empty)).toBe(snap2)
    expect(miss.miss).toBe(1)
  })
})
