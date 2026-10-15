/** 高尔夫球规则单测 */
import { describe, expect, it } from 'vitest'
import {
  AI,
  BALL_R,
  COLS,
  DRAG,
  FIELD_X,
  FIELD_H,
  FIELD_W,
  FIELD_Y,
  HOLE_COUNT,
  MAX_HOLE_STROKES,
  MIN_POWER,
  PLAYER,
  ROWS,
  SPEED_MAX,
  WATER_PENALTY,
  aimAngle,
  aiAction,
  canPlay,
  cellCenter,
  cellIndex,
  create,
  currentHole,
  outcome,
  reduce,
  terrainAt,
  totalStrokes,
} from './rules'
import type { Action, Hole, State, Terrain } from './rules'

// ---------------------------------------------------------------- 工具

/** 深冻结，用来证明 reduce 不会修改入参 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const k of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[k])
    }
  }
  return value
}

/** 标准一次击球：设置方向 → 蓄力 → 击球（走真实 action 序列） */
function strike(state: State, aim: number, power: number): State {
  let s = reduce(state, { type: 'aim', value: aim })
  s = reduce(s, { type: 'chargeStart' })
  return reduce(s, { type: 'shoot', power })
}

/** 逐 tick 推进到球停，统计需要的 tick 数 */
function rollToRest(state: State): { ticks: number; end: State } {
  let cur = state
  let ticks = 0
  while (cur.phase === 'rolling' && ticks < 2000) {
    cur = reduce(cur, { type: 'tick', ticks: 1 })
    ticks++
  }
  return { ticks, end: cur }
}

/** 把当前洞整张网格铺成同一种地形，用于隔离比较摩擦 */
function flatCourse(seed: number, terrain: Terrain): State {
  const base = create(seed)
  const holes: Hole[] = base.holes.map((h, i) => (i === base.holeIndex ? { ...h, tiles: new Array<Terrain>(COLS * ROWS).fill(terrain) } : h))
  return { ...base, holes }
}

/** 当前洞从发球点往 +y 铺水（发球格留出两格平地） */
function waterBelow(seed: number): State {
  const base = create(seed)
  const hole = currentHole(base)
  const teeCol = Math.floor((hole.tee.x - FIELD_X) / (FIELD_W / COLS))
  const teeRow = Math.floor((hole.tee.y - FIELD_Y) / (FIELD_H / ROWS))
  const tiles: Terrain[] = []
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const nearTee = Math.abs(col - teeCol) <= 1 && row <= teeRow + 1
      tiles.push(nearTee ? 'fair' : 'water')
    }
  }
  const holes = base.holes.map((h, i) => (i === base.holeIndex ? { ...h, tiles } : h))
  return { ...base, holes }
}

/** 模拟一整杆（AI 用真实 aiAction 驱动，跑完整段物理与自动收尾） */
function aiPlayStroke(state: State): State {
  let s = state
  for (let i = 0; i < 80; i++) {
    if (s.phase === 'rolling' || (s.wait > 0 && s.phase !== 'charging')) {
      s = reduce(s, { type: 'tick', ticks: 8 })
      continue
    }
    const action = aiAction(s)
    if (!action) break
    s = reduce(s, action)
  }
  return s
}

/** 玩家策略：始终对准球洞、满力 */
function playerAutoStroke(state: State): State {
  if (!canPlay(state)) return state
  return strike(state, aimAngleToCup(state), 1)
}

function aimAngleToCup(state: State): number {
  const hole = currentHole(state)
  const angle = Math.atan2(hole.cup.y - state.ball.y, hole.cup.x - state.ball.x)
  const aim = Math.max(0, Math.min(1, angle / (2 * Math.PI) + 0.5))
  return aim
}

/** 跑完整局（玩家满力对准 + AI 搜索），返回终局状态 */
function playWholeMatch(seed: number): { state: State; steps: number } {
  let s = create(seed)
  let steps = 0
  while (s.phase !== 'over' && steps < 4000) {
    steps++
    if (s.phase === 'rolling' || (s.wait > 0 && s.phase !== 'charging')) {
      s = reduce(s, { type: 'tick', ticks: 8 })
      continue
    }
    if (s.phase === 'aim' && s.turn === PLAYER && s.wait === 0) {
      s = playerAutoStroke(s)
      continue
    }
    const action = aiAction(s)
    if (!action) {
      s = reduce(s, { type: 'tick', ticks: 8 })
      continue
    }
    s = reduce(s, action)
  }
  return { state: s, steps }
}

// ---------------------------------------------------------------- 测试

describe('高尔夫球 · 建局与参数钳制', () => {
  it('create 生成三洞并从玩家开球', () => {
    const s = create(7)
    expect(s.holes.length).toBe(HOLE_COUNT)
    expect(s.turn).toBe(PLAYER)
    expect(s.phase).toBe('aim')
    expect(s.strokes).toEqual([0, 0])
    expect(s.ball.x).toBeCloseTo(currentHole(s).tee.x)
    expect(s.ball.y).toBeCloseTo(currentHole(s).tee.y)
    for (const hole of s.holes) expect(hole.tiles.length).toBe(COLS * ROWS)
  })

  it('蓄力量被钳制在 0..1', () => {
    let s = reduce(create(7), { type: 'chargeStart' })
    s = reduce(s, { type: 'charge', delta: 5 })
    expect(s.power).toBe(1)
    s = reduce(s, { type: 'charge', delta: -3 })
    expect(s.power).toBe(0)
    s = reduce(reduce(create(7), { type: 'chargeStart' }), { type: 'charge', delta: 0.5 })
    expect(s.power).toBeCloseTo(0.5)
  })

  it('方向滑条被钳制在 0..1，且映射到 -π..π', () => {
    let s = reduce(create(7), { type: 'aim', value: -3 })
    expect(s.aim).toBe(0)
    expect(aimAngle(s.aim)).toBeCloseTo(-Math.PI)
    s = reduce(s, { type: 'aim', value: 9 })
    expect(s.aim).toBe(1)
    expect(aimAngle(s.aim)).toBeCloseTo(Math.PI)
    s = reduce(s, { type: 'aim', value: 0.25 })
    expect(s.aim).toBeCloseTo(0.25)
    expect(aimAngle(s.aim)).toBeCloseTo(-Math.PI / 2)
  })

  it('力度低于 MIN_POWER 视为空杆，不计杆数', () => {
    const base = reduce(create(7), { type: 'chargeStart' })
    const s = reduce(base, { type: 'shoot', power: MIN_POWER / 2 })
    expect(s.phase).toBe('aim')
    expect(s.strokes[0]).toBe(0)
  })
})

describe('高尔夫球 · 地形摩擦', () => {
  it('四类地形摩擦系数不同，沙坑明显强于平地', () => {
    expect(DRAG.sand).toBeLessThan(DRAG.grass)
    expect(DRAG.grass).toBeLessThan(DRAG.fair)
    expect(DRAG.fair).toBeGreaterThan(0.9)
  })

  it('沙坑里的球比平地里的球快得多就停下', () => {
    const fair = strike(flatCourse(11, 'fair'), 0.25, 1)
    const sand = strike(flatCourse(11, 'sand'), 0.25, 1)
    const a = rollToRest(fair)
    const b = rollToRest(sand)
    expect(a.end.phase).toBe('aim')
    expect(b.end.phase).toBe('aim')
    expect(b.ticks).toBeLessThan(a.ticks * 0.6)
  })

  it('地形查询按格子取摩擦，边界也返回合法地形', () => {
    const hole = currentHole(create(3))
    expect(terrainAt(hole, FIELD_X + 1, FIELD_Y + 1)).toBeDefined()
    expect(terrainAt(hole, FIELD_X - 999, FIELD_Y - 999)).toBeDefined()
    const c = cellCenter(2, 3)
    expect(terrainAt(hole, c.x, c.y)).toBe(hole.tiles[cellIndex(2, 3)])
  })
})

describe('高尔夫球 · 物理推进', () => {
  it('球停下后速度归零、阶段回到瞄准', () => {
    const s = rollToRest(strike(create(5), 0.25, 0.6)).end
    expect(s.phase).toBe('aim')
    expect(s.vel.x).toBe(0)
    expect(s.vel.y).toBe(0)
  })

  it('球始终不出界（长距离多次反弹后仍在球场内）', () => {
    let s = strike(flatCourse(9, 'fair'), 0.25, 1)
    expect(s.phase).toBe('rolling')
    for (let i = 0; i < 400 && s.phase === 'rolling'; i++) {
      s = reduce(s, { type: 'tick', ticks: 1 })
      expect(s.ball.x).toBeGreaterThanOrEqual(FIELD_X + BALL_R - 1e-6)
      expect(s.ball.x).toBeLessThanOrEqual(FIELD_X + FIELD_W - BALL_R + 1e-6)
      expect(s.ball.y).toBeGreaterThanOrEqual(FIELD_Y + BALL_R - 1e-6)
      expect(s.ball.y).toBeLessThanOrEqual(FIELD_Y + FIELD_H - BALL_R + 1e-6)
    }
    expect(s.phase).not.toBe('rolling')
  })

  it('满力初速度随力度线性缩放', () => {
    const full = strike(create(5), 0.25, 1)
    const half = strike(create(5), 0.25, 0.5)
    expect(Math.hypot(full.vel.x, full.vel.y)).toBeCloseTo(SPEED_MAX)
    expect(Math.hypot(half.vel.x, half.vel.y)).toBeCloseTo(SPEED_MAX * 0.5)
  })
})

describe('高尔夫球 · 水障碍罚则', () => {
  it('落水罚 1 杆、球退回本杆击球点，仍由同一方继续', () => {
    const base = waterBelow(21)
    const before = reduce(base, { type: 'chargeStart' })
    const s = rollToRest(strike(base, 0.75, 1)).end
    expect(terrainAt(currentHole(before), before.ball.x, before.ball.y)).toBe('fair')
    expect(s.penalties).toBe(before.penalties + WATER_PENALTY)
    expect(s.strokes[0]).toBe(1 + WATER_PENALTY)
    expect(s.ball.x).toBeCloseTo(before.ball.x)
    expect(s.ball.y).toBeCloseTo(before.ball.y)
    expect(s.phase).toBe('aim')
    expect(s.turn).toBe(PLAYER)
    expect(s.note).toContain('落水')
  })
})

describe('高尔夫球 · 回合与杆数', () => {
  it('每击一杆杆数 +1，球停后回合交给 AI', () => {
    const s0 = strike(create(5), 0.25, 0.7)
    expect(s0.strokes).toEqual([1, 0])
    const s1 = rollToRest(s0).end
    expect(s1.wait).toBeGreaterThan(0)
    const s2 = reduce(s1, { type: 'tick', ticks: 40 })
    expect(s2.turn).toBe(AI)
    expect(s2.strokes).toEqual([1, 0])
  })

  it('AI 走同一个 reduce：蓄力后击球，杆数计入 AI', () => {
    let s = create(5)
    s = rollToRest(strike(s, 0.25, 0.7)).end
    s = reduce(s, { type: 'tick', ticks: 40 })
    expect(s.turn).toBe(AI)
    s = aiPlayStroke(s)
    expect(s.strokes[1]).toBeGreaterThanOrEqual(1)
    expect(s.strokes[0]).toBe(1)
    expect(s.turn).toBe(PLAYER)
  })

  it('AI 只在 AI 回合返回动作', () => {
    const s = create(5)
    expect(aiAction(s)).toBeNull()
    const s2: State = { ...s, turn: AI }
    expect(aiAction(s2)?.type).toBe('chargeStart')
    expect(aiAction({ ...s2, phase: 'over' })).toBeNull()
  })
})

describe('高尔夫球 · 终局', () => {
  it('打完三洞必定终局，总杆少者胜', () => {
    const { state, steps } = playWholeMatch(31)
    expect(state.phase).toBe('over')
    expect(state.results.length).toBe(HOLE_COUNT)
    expect(steps).toBeLessThan(4000)
    const p = totalStrokes(state, PLAYER)
    const a = totalStrokes(state, AI)
    expect(p).toBeGreaterThan(0)
    expect(a).toBeGreaterThan(0)
    const result = outcome(state)
    expect(result).not.toBeNull()
    expect(result?.better).toBe('lower')
    expect(result?.unit).toBe('杆')
    expect(result?.score).toBe(p)
    expect(result?.win).toBe(p < a)
  })

  it('杆数打满即封顶收洞，保证该分支也能走到下一洞', () => {
    let s = create(4)
    s = { ...s, strokes: [MAX_HOLE_STROKES, MAX_HOLE_STROKES] }
    s = strike(s, 0.25, 0.8)
    s = rollToRest(s).end
    expect(s.phase).toBe('holed')
    const next = reduce(s, { type: 'tick', ticks: 60 })
    expect(next.holeIndex).toBe(1)
    expect(next.strokes).toEqual([0, 0])
  })

  it('未结束时 outcome 返回 null', () => {
    expect(outcome(create(4))).toBeNull()
  })
})

describe('高尔夫球 · 可复现与纯度', () => {
  it('同种子 + 同操作序列必得同一局', () => {
    const script: Action[] = [
      { type: 'aim', value: 0.3 },
      { type: 'chargeStart' },
      { type: 'charge', delta: 0.4 },
      { type: 'shoot' },
      { type: 'tick', ticks: 30 },
      { type: 'tick', ticks: 60 },
    ]
    const run = (seed: number): State => {
      let s = create(seed)
      for (const a of script) s = reduce(s, a)
      return s
    }
    expect(JSON.stringify(run(2024))).toBe(JSON.stringify(run(2024)))
    expect(create(1)).not.toEqual(create(2))
  })

  it('reduce 不修改入参（深冻结后依然安全）', () => {
    const frozen = deepFreeze(create(77))
    const before = JSON.stringify(frozen)
    const actions: Action[] = [
      { type: 'aim', value: 0.9 },
      { type: 'chargeStart' },
      { type: 'charge', delta: 0.6 },
      { type: 'shoot' },
      { type: 'tick', ticks: 120 },
      { type: 'cancelCharge' },
      { type: 'aim', value: 0.1 },
    ]
    let s = frozen
    for (const a of actions) s = reduce(s, a)
    expect(JSON.stringify(frozen)).toBe(before)
    expect(s).not.toBe(frozen)
    expect(aiAction(frozen)).toBeNull()
  })
})
