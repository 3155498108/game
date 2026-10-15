/**
 * 玩具冰壶（toy-curling）· 规则单测
 * 覆盖：摩擦减速、圆-圆碰撞与动量传递、分离迭代上限、蓄力/方向钳制、
 * 按距圆心距离计分、多轮累计与总分对比、壶不出界、碰撞不穿透、同种子可复现、reduce 纯度。
 */
import { describe, expect, it } from 'vitest'
import {
  BUTTON,
  HOUSE_R,
  MAX_ANGLE,
  MAX_SEPARATION_ITERS,
  MAX_SLIDE_TICKS,
  MAX_SPEED,
  MIN_POWER,
  RING_1,
  RING_3,
  ROUNDS,
  SHEET,
  STONE_R,
  THROWS_PER_END,
  THROW_Y,
  aiAction,
  create,
  endScore,
  reduce,
  resolveCollisions,
  simulate,
  stonePoints,
  winnerOf,
} from './rules'
import type { Action, State, Stone } from './rules'

// ---------------- 测试辅助 ----------------

function stone(id: number, owner: 0 | 1, x: number, y: number, vx = 0, vy = 0): Stone {
  return { id, owner, x, y, vx, vy }
}

/** 一块滑行中的场上局面 */
function sliding(stones: Stone[], slideTicks = 0): State {
  return { ...create(3), phase: 'sliding', stones, slideTicks }
}

/** 一直推进直到所有冰壶停下 */
function settle(s: State): State {
  let cur = s
  let guard = 0
  while (cur.phase === 'sliding' && guard < MAX_SLIDE_TICKS + 10) {
    cur = reduce(cur, { type: 'tick' })
    guard += 1
  }
  return cur
}

/** 结算停顿 → 下一局 / 终局 */
function advance(s: State): State {
  return s.phase === 'settle' ? reduce(s, { type: 'next' }) : s
}

/** 打完整一局：双方各投 STONES_PER_SIDE 只，全部停下后停在 settle */
function playEnd(s: State, power: number, angle: number): State {
  let cur = s
  for (let k = 0; k < THROWS_PER_END; k++) {
    cur = settle(reduce(cur, { type: 'shoot', power, angle }))
  }
  return cur
}

/** 场上仍然重叠的壶对数（用一点点容差吸收浮点误差） */
function overlapPairs(list: readonly Stone[]): number {
  let n = 0
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      if (!a || !b) continue
      if (Math.hypot(a.x - b.x, a.y - b.y) < STONE_R * 2 - 1e-6) n += 1
    }
  }
  return n
}

function minGap(list: readonly Stone[]): number {
  let g = Number.POSITIVE_INFINITY
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      if (!a || !b) continue
      g = Math.min(g, Math.hypot(a.x - b.x, a.y - b.y))
    }
  }
  return g
}

function clone(list: readonly Stone[]): Stone[] {
  return list.map((s) => ({ ...s }))
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const k of Object.keys(o as object)) {
      deepFreeze((o as Record<string, unknown>)[k])
    }
  }
  return o
}

// ---------------- 物理 ----------------

describe('玩具冰壶 · 物理', () => {
  it('摩擦逐 tick 减速，速度低于阈值即停', () => {
    const fired = reduce(create(1), { type: 'shoot', power: 1, angle: 0 })
    expect(fired.phase).toBe('sliding')
    const first = fired.stones[0]
    expect(first).toBeDefined()
    if (!first) return
    const y0 = first.y
    const sp0 = Math.hypot(first.vx, first.vy)

    let s = fired
    let ticks = 0
    while (s.phase === 'sliding' && ticks < MAX_SLIDE_TICKS + 10) {
      s = reduce(s, { type: 'tick' })
      ticks += 1
    }

    expect(s.phase).not.toBe('sliding')
    expect(ticks).toBeGreaterThan(100) // 明显是减速停下来的，不是立刻停
    for (const st of s.stones) expect(Math.hypot(st.vx, st.vy)).toBe(0)

    const travelled = s.stones[0]!.y - y0
    expect(travelled).toBeGreaterThan(200)
    // 无摩擦匀速时会是 sp0 * ticks 的距离，实际被摩擦吃掉了大半
    expect(travelled).toBeLessThan(sp0 * ticks * 0.6)
  })

  it('圆-圆碰撞：沿连心线分离，不重叠，并传递法向动量', () => {
    const start = sliding([stone(0, 0, 360, 700, 0, 12), stone(1, 1, 360, 750)])
    const hit = reduce(start, { type: 'tick' })
    const mover = hit.stones[0]!
    const target = hit.stones[1]!
    // 静止壶被撞后获得速度 → 动量已传递；出手壶相应减速
    expect(target.vy).toBeGreaterThan(0)
    expect(mover.vy).toBeLessThan(12)
    expect(mover.vy + target.vy).toBeGreaterThan(0)
    // 分离生效：不重叠
    expect(Math.hypot(mover.x - target.x, mover.y - target.y)).toBeGreaterThanOrEqual(STONE_R * 2 - 1e-6)
  })

  it('碰撞不会让壶互相穿透', () => {
    const start = sliding([
      stone(0, 0, 360, 700, 0, 14),
      stone(1, 1, 360, 742),
      stone(2, 0, 300, 860, 0, 2),
      stone(3, 1, 430, 700, 0, 9),
    ])
    const done = settle(start)
    expect(done.phase).not.toBe('sliding')
    expect(minGap(done.stones)).toBeGreaterThanOrEqual(STONE_R * 2 - 1e-6)
  })

  it('分离迭代上限生效：请求更多迭代与上限完全等价', () => {
    expect(MAX_SEPARATION_ITERS).toBe(4)
    const stack = [
      stone(0, 0, 360, 800),
      stone(1, 1, 360, 800),
      stone(2, 0, 360, 800),
      stone(3, 1, 360, 800),
      stone(4, 0, 360, 800),
      stone(5, 1, 360, 800),
    ]
    const capped = clone(stack)
    resolveCollisions(capped, MAX_SEPARATION_ITERS)
    const over = clone(stack)
    resolveCollisions(over, 99)
    expect(over).toEqual(capped)

    // 单次迭代不足以分离这么多重叠壶，4 次后重叠明显减少（上限确实起作用）
    const once = clone(stack)
    resolveCollisions(once, 1)
    expect(overlapPairs(once)).toBeGreaterThan(overlapPairs(capped))
    expect(overlapPairs(capped)).toBeLessThan(overlapPairs(once))
  })

  it('壶不会出界（各种极端蓄力与方向）', () => {
    const cases: [number, number][] = [
      [1, MAX_ANGLE],
      [1, -MAX_ANGLE],
      [1, 0],
      [0.3, MAX_ANGLE],
      [0.5, -MAX_ANGLE / 2],
    ]
    for (const [power, angle] of cases) {
      const done = settle(reduce(create(11), { type: 'shoot', power, angle }))
      expect(done.phase).not.toBe('sliding')
      for (const st of done.stones) {
        expect(st.x).toBeGreaterThanOrEqual(SHEET.left + STONE_R - 1e-6)
        expect(st.x).toBeLessThanOrEqual(SHEET.right - STONE_R + 1e-6)
        expect(st.y).toBeGreaterThanOrEqual(SHEET.top + STONE_R - 1e-6)
        expect(st.y).toBeLessThanOrEqual(SHEET.bottom - STONE_R + 1e-6)
      }
    }
  })
})

// ---------------- 输入钳制 ----------------

describe('玩具冰壶 · 蓄力与方向钳制', () => {
  it('蓄力量与方向都被钳制在合法范围', () => {
    const hi = reduce(create(5), { type: 'shoot', power: 9, angle: 99 })
    const first = hi.stones[0]!
    expect(Math.hypot(first.vx, first.vy)).toBeCloseTo(MAX_SPEED, 6)
    expect(Math.atan2(first.vx, first.vy)).toBeCloseTo(MAX_ANGLE, 6)

    const lo = reduce(create(5), { type: 'shoot', power: -3, angle: -99 })
    const l0 = lo.stones[0]!
    expect(Math.hypot(l0.vx, l0.vy)).toBeCloseTo(MAX_SPEED * MIN_POWER, 6)
    expect(Math.atan2(l0.vx, l0.vy)).toBeCloseTo(-MAX_ANGLE, 6)
  })

  it('按住调向会持续生效并停在最大角度', () => {
    let s = reduce(create(5), { type: 'aim', dir: -1, hold: true })
    for (let i = 0; i < 200; i++) s = reduce(s, { type: 'tick' })
    expect(s.angle).toBeCloseTo(-MAX_ANGLE, 9)

    let t = reduce(create(5), { type: 'aim', dir: 1, hold: true })
    for (let i = 0; i < 200; i++) t = reduce(t, { type: 'tick' })
    expect(t.angle).toBeCloseTo(MAX_ANGLE, 9)
  })

  it('蓄力条涨到 1 后不再溢出', () => {
    let s = reduce(create(5), { type: 'charge' })
    for (let i = 0; i < 300; i++) s = reduce(s, { type: 'tick' })
    expect(s.charging).toBe(true)
    expect(s.power).toBe(1)

    const fired = reduce(s, { type: 'release' })
    expect(fired.phase).toBe('sliding')
    expect(fired.power).toBe(0)
    expect(fired.stones[0]!.id).toBe(0)
  })

  it('单次微调方向不会留下持续按住的状态', () => {
    const s = reduce(create(5), { type: 'aim', dir: 1 })
    expect(s.aimDir).toBe(0)
    expect(s.angle).toBeGreaterThan(0)
  })
})

// ---------------- 计分 ----------------

describe('玩具冰壶 · 计分', () => {
  it('停止后按距圆心距离计分，越近越高', () => {
    const near = endScore([stone(0, 0, BUTTON.x, BUTTON.y)])
    // 取样必须落在不同的环带上：RING_3 = 100 是 2 分环，RING_3 + 1 = 101 已经掉进 1 分环，
    // 那样和 edge（HOUSE_R = 110，同为 1 分环）就分不出高下了
    const mid = endScore([stone(0, 0, BUTTON.x + RING_3, BUTTON.y)])
    const edge = endScore([stone(0, 0, BUTTON.x + HOUSE_R, BUTTON.y)])
    expect(near.points).toBeGreaterThan(mid.points)
    expect(mid.points).toBeGreaterThan(edge.points)
    expect(near).toEqual({ team: 0, points: 5 })
    expect(edge.points).toBe(1)

    // 单壶得分随距离单调不增
    let prev = 99
    for (let d = 0; d <= 160; d += 2) {
      const p = stonePoints(d)
      expect(p).toBeLessThanOrEqual(prev)
      prev = p
    }
  })

  it('最近壶在 house 外则空局，多壶时只统计比对手更近的壶', () => {
    const outside = endScore([stone(0, 0, BUTTON.x + HOUSE_R + 20, BUTTON.y)])
    expect(outside).toEqual({ team: -1, points: 0 })

    const board = [
      stone(0, 0, BUTTON.x, BUTTON.y),
      stone(1, 0, BUTTON.x + RING_3 + 1, BUTTON.y),
      stone(2, 1, BUTTON.x + RING_1 + 1, BUTTON.y),
    ]
    const res = endScore(board)
    expect(res.team).toBe(0)
    // 对方最近壶 d=49，本方只有圆心那一壶（5 分）比它更近；d=101 那壶不在前，先排除
    expect(res.points).toBe(5)
  })

  it('累计总分等于各局得分之和，并与胜者一致', () => {
    const one = playEnd(advance(create(9)), 0.84, 0)
    expect(one.phase).toBe('settle')
    const p0 = one.total[0]
    const p1 = one.total[1]
    expect(p0 + p1).toBeGreaterThan(0)

    let s = create(9)
    for (let r = 0; r < ROUNDS; r++) {
      s = playEnd(advance(s), 0.84, 0)
    }
    s = advance(s)
    expect(s.over).toBe(true)
    expect(s.phase).toBe('over')
    expect(s.round).toBe(ROUNDS)
    expect(s.total[0]).toBe(p0 * ROUNDS)
    expect(s.total[1]).toBe(p1 * ROUNDS)
    expect(winnerOf(s)).toBe(s.winner)
  })

  it('结算停顿可以跳过，并且最后一局后必然终局', () => {
    let s = create(4)
    for (let r = 0; r < ROUNDS - 1; r++) {
      s = advance(playEnd(advance(s), 0.84, 0))
      expect(s.over).toBe(false)
      expect(s.round).toBe(r + 2)
      expect(s.stones).toHaveLength(0)
      expect(s.throws).toBe(0)
    }
    s = advance(playEnd(advance(s), 0.84, 0))
    expect(s.over).toBe(true)
    // 终局后任何动作都是空操作（引用相等）
    expect(reduce(s, { type: 'tick' })).toBe(s)
    expect(reduce(s, { type: 'shoot', power: 1, angle: 0 })).toBe(s)
    expect(reduce(s, { type: 'next' })).toBe(s)
  })
})

// ---------------- AI ----------------

describe('玩具冰壶 · AI', () => {
  it('非 AI 回合或非瞄准阶段返回 null', () => {
    expect(aiAction(create(3))).toBeNull()
    const slidingState = reduce(create(3), { type: 'shoot', power: 0.8, angle: 0 })
    expect(aiAction(slidingState)).toBeNull()
  })

  it('AI 枚举候选 action 并用同一个 reduce 试算，返回合法的出壶动作', () => {
    let s = create(3)
    s = settle(reduce(s, { type: 'shoot', power: 0.84, angle: 0 }))
    expect(s.turn).toBe(1)

    const act = aiAction(s)
    expect(act).not.toBeNull()
    if (!act || act.type !== 'shoot') return
    expect(act.power).toBeGreaterThan(0)
    expect(act.power).toBeLessThanOrEqual(1)
    expect(Math.abs(act.angle)).toBeLessThanOrEqual(MAX_ANGLE)

    // simulate 会把这一投一直推到停下，real 必须用同一个 settle 推到同样的位置才可比
    const sim = simulate(s, act.power, act.angle)
    const real = settle(reduce(s, act))
    expect(sim.stones).toEqual(real.stones)
    expect(sim.total).toEqual(real.total)
    expect(sim.phase).not.toBe('sliding')

    const after = reduce(s, act)
    expect(after.phase).toBe('sliding')
    expect(after.stones).toHaveLength(2)
    expect(after.stones[1]!.owner).toBe(1)
  })

  it('整局（含 AI）能走到终局，不会卡死', () => {
    let s = create(5)
    let guard = 0
    while (!s.over && guard < 20000) {
      if (s.phase === 'aim') {
        const act = s.turn === 1 ? aiAction(s) : { type: 'shoot' as const, power: 0.84, angle: 0 }
        if (act) s = reduce(s, act)
        else s = reduce(s, { type: 'tick', steps: 8 })
      } else {
        s = reduce(s, { type: 'tick', steps: 8 })
      }
      guard += 1
    }
    expect(s.over).toBe(true)
    expect(s.round).toBe(ROUNDS)
    expect(s.total[0] + s.total[1]).toBeGreaterThan(0)
  })
})

// ---------------- 纯度与可复现 ----------------

describe('玩具冰壶 · 纯函数与可复现', () => {
  it('同种子同动作序列结果完全一致（含 AI）', () => {
    const a = create(1234)
    const b = create(1234)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))

    const script: Action[] = [
      { type: 'aim', dir: -1, hold: true },
      { type: 'tick', steps: 8 },
      { type: 'charge' },
      { type: 'tick', steps: 8 },
      { type: 'release' },
      { type: 'tick', steps: 8 },
    ]
    let s1 = a
    let s2 = b
    for (const act of script) {
      s1 = reduce(s1, act)
      s2 = reduce(s2, act)
      expect(JSON.stringify(s1)).toBe(JSON.stringify(s2))
    }
    const aiA = aiAction(s1)
    const aiB = aiAction(s2)
    expect(aiA).toEqual(aiB)
    if (aiA && aiB) {
      expect(JSON.stringify(reduce(s1, aiA))).toBe(JSON.stringify(reduce(s2, aiB)))
    }
  })

  it('reduce 不修改入参：深冻结状态下所有分支都不抛错', () => {
    const frozen = deepFreeze(create(77))
    expect(() => reduce(frozen, { type: 'tick' })).not.toThrow()
    expect(() => reduce(frozen, { type: 'aim', dir: 1 })).not.toThrow()
    expect(() => reduce(frozen, { type: 'aim', dir: -1, hold: true })).not.toThrow()
    expect(() => reduce(frozen, { type: 'charge' })).not.toThrow()
    expect(() => reduce(frozen, { type: 'release' })).not.toThrow()
    expect(() => reduce(frozen, { type: 'shoot', power: 0.5, angle: 0 })).not.toThrow()
    expect(() => reduce(frozen, { type: 'next' })).not.toThrow()
    // 入参内容未被改动
    expect(frozen.stones).toHaveLength(0)
    expect(frozen.power).toBe(0)

    const frozenSliding = deepFreeze(
      sliding([stone(0, 0, 360, THROW_Y, 0, 12), stone(1, 1, 360, THROW_Y + 120)]),
    )
    let s: State = frozenSliding
    for (let i = 0; i < 400; i++) {
      s = reduce(s, { type: 'tick' })
      if (s.phase !== 'sliding') break
    }
    expect(s.phase).not.toBe('sliding')
    // 原始冻结状态原封不动
    expect(frozenSliding.stones[0]!.vy).toBe(12)
    expect(frozenSliding.stones[0]!.y).toBe(232)
  })
})
