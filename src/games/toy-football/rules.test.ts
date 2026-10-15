import { describe, expect, it } from 'vitest'
import {
  ANGLE_MAX,
  ANGLE_MIN,
  ANGLE_SLIDER,
  BALL_R,
  CHANCES,
  FIELD,
  GOAL_LEFT,
  GOAL_RIGHT,
  GOAL_Y,
  KICK,
  POWER_MAX,
  POWER_MIN,
  POWER_DEFAULT,
  POWER_SLIDER,
  create,
  difficultyOf,
  reduce,
  resolveCrossing,
  speedOf,
  valueFromX,
} from './rules'
import type { State } from './rules'

/** 递归冻结，用来证明 reduce 不会写入入参 */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const k of Object.keys(o as Record<string, unknown>)) {
      deepFreeze((o as Record<string, unknown>)[k])
    }
  }
  return o
}

/** 踢完整一脚直到本脚结算 */
function playShot(state: State, power: number, angle: number): State {
  let s = reduce(state, { type: 'setPower', value: power })
  s = reduce(s, { type: 'setAngle', value: angle })
  s = reduce(s, { type: 'kick' })
  let guard = 0
  while (s.phase === 'flight' && guard++ < 1000) {
    s = reduce(s, { type: 'advance', ticks: 1 })
  }
  return s
}

/** 在一段种子区间里找第一个满足条件的一脚 */
function findShot(
  pred: (s: State) => boolean,
  power = 60,
  angle = 0,
): { seed: number; state: State } | null {
  for (let seed = 1; seed <= 200; seed++) {
    const state = playShot(create(seed), power, angle)
    if (pred(state)) return { seed, state }
  }
  return null
}

/** 打满一整局十脚 */
function playFullGame(seed: number, power: number, angle: number): { state: State; goalCount: number } {
  let s = create(seed)
  let goalCount = 0
  for (let i = 0; i < CHANCES; i++) {
    s = playShot(s, power, angle)
    if (s.lastResult === 'goal') goalCount++
    if (s.phase === 'result') s = reduce(s, { type: 'next' })
  }
  return { state: s, goalCount }
}

describe('toy-football / 滑条范围与钳制', () => {
  it('初始力度角度落在滑条区间内', () => {
    const s = create(1)
    expect(s.power).toBeGreaterThanOrEqual(POWER_MIN)
    expect(s.power).toBeLessThanOrEqual(POWER_MAX)
    expect(s.angle).toBeGreaterThanOrEqual(ANGLE_MIN)
    expect(s.angle).toBeLessThanOrEqual(ANGLE_MAX)
  })

  it('力度超出范围会被钳制', () => {
    const s = create(1)
    expect(reduce(s, { type: 'setPower', value: -999 }).power).toBe(POWER_MIN)
    expect(reduce(s, { type: 'setPower', value: 9999 }).power).toBe(POWER_MAX)
    expect(reduce(s, { type: 'setPower', value: 55 }).power).toBe(55)
  })

  it('角度超出范围会被钳制', () => {
    const s = create(1)
    expect(reduce(s, { type: 'setAngle', value: -999 }).angle).toBe(ANGLE_MIN)
    expect(reduce(s, { type: 'setAngle', value: 9999 }).angle).toBe(ANGLE_MAX)
    expect(reduce(s, { type: 'setAngle', value: -12 }).angle).toBe(-12)
  })

  it('滑条横坐标换算在两端正好取到上下限', () => {
    expect(valueFromX(POWER_SLIDER, POWER_SLIDER.x, POWER_MIN, POWER_MAX)).toBe(POWER_MIN)
    expect(valueFromX(POWER_SLIDER, POWER_SLIDER.x + POWER_SLIDER.w, POWER_MIN, POWER_MAX)).toBe(POWER_MAX)
    expect(valueFromX(ANGLE_SLIDER, ANGLE_SLIDER.x, ANGLE_MIN, ANGLE_MAX)).toBe(ANGLE_MIN)
    expect(valueFromX(ANGLE_SLIDER, ANGLE_SLIDER.x + ANGLE_SLIDER.w, ANGLE_MIN, ANGLE_MAX)).toBe(ANGLE_MAX)
    expect(valueFromX(POWER_SLIDER, POWER_SLIDER.x - 500, POWER_MIN, POWER_MAX)).toBe(POWER_MIN)
    expect(valueFromX(ANGLE_SLIDER, ANGLE_SLIDER.x + 5000, ANGLE_MIN, ANGLE_MAX)).toBe(ANGLE_MAX)
  })

  it('力度单调映射到球速', () => {
    expect(speedOf(POWER_MIN)).toBeLessThan(speedOf(80))
    expect(speedOf(80)).toBeLessThan(speedOf(POWER_MAX))
  })

  it('飞行中与结算后不能再改滑条', () => {
    const flying = reduce(create(1), { type: 'kick' })
    expect(reduce(flying, { type: 'setPower', value: 99 }).power).toBe(flying.power)
    expect(reduce(flying, { type: 'setAngle', value: 30 }).angle).toBe(flying.angle)
  })
})

describe('toy-football / 出脚方向', () => {
  it('正角度向右飞、负角度向左飞、正中角竖直上飞', () => {
    const right = reduce(reduce(create(1), { type: 'setAngle', value: 30 }), { type: 'kick' })
    expect(right.ball.vx).toBeGreaterThan(0)
    expect(right.ball.vy).toBeLessThan(0)

    const left = reduce(reduce(create(1), { type: 'setAngle', value: -30 }), { type: 'kick' })
    expect(left.ball.vx).toBeLessThan(0)
    expect(left.ball.vy).toBeLessThan(0)

    const mid = reduce(reduce(create(1), { type: 'setAngle', value: 0 }), { type: 'kick' })
    expect(mid.ball.vx).toBe(0)
    expect(mid.ball.vy).toBeLessThan(0)
  })

  it('球按设定方向逐步推进', () => {
    let s = reduce(reduce(create(1), { type: 'setAngle', value: 25 }), { type: 'kick' })
    expect(s.phase).toBe('flight')
    const start = { ...s.ball }
    s = reduce(s, { type: 'advance', ticks: 5 })
    expect(s.ball.x).toBeGreaterThan(start.x)
    expect(s.ball.y).toBeLessThan(start.y)
    // 匀速直线：单位 tick 位移恒定
    expect(s.ball.x - start.x).toBeCloseTo(s.ball.vx * 5, 6)
    expect(s.ball.y - start.y).toBeCloseTo(s.ball.vy * 5, 6)
  })

  it('不是准备阶段时点按不踢球', () => {
    const flying = reduce(create(1), { type: 'kick' })
    expect(reduce(flying, { type: 'kick' }).ticks).toBe(flying.ticks)
  })
})

describe('toy-football / 判定规则', () => {
  it('门柱之外判出界', () => {
    expect(resolveCrossing(GOAL_LEFT - 10, 360, 0.9, 0.1)).toBe('out')
    expect(resolveCrossing(GOAL_RIGHT + 10, 360, 0.9, 0.1)).toBe('out')
  })

  it('守门员够得到且掷中判扑救，够不到或没掷中判进球', () => {
    expect(resolveCrossing(360, 360, 0.9, 0.1)).toBe('saved')
    expect(resolveCrossing(360, 360, 0.2, 0.9)).toBe('goal')
    expect(resolveCrossing(360, 360 + 200, 0.9, 0.1)).toBe('goal')
  })

  it('难度随机会数递增并被钳制', () => {
    expect(difficultyOf(0)).toBeLessThan(difficultyOf(9))
    expect(difficultyOf(0)).toBeGreaterThanOrEqual(0)
    expect(difficultyOf(99)).toBeLessThanOrEqual(1)
  })
})

describe('toy-football / 整局结算', () => {
  it('进球会加分并且球停在门里', () => {
    const hit = findShot((s) => s.lastResult === 'goal', 60, 0)
    expect(hit).not.toBeNull()
    const s = hit!.state
    expect(s.goals).toBe(1)
    expect(s.misses).toBe(0)
    expect(s.attempt).toBe(1)
    expect(s.ball.x).toBeGreaterThanOrEqual(GOAL_LEFT)
    expect(s.ball.x).toBeLessThanOrEqual(GOAL_RIGHT)
    expect(s.phase === 'result' || s.phase === 'over').toBe(true)
  })

  it('打偏出界不加分', () => {
    const miss = findShot((s) => s.lastResult === 'out', 90, ANGLE_MAX)
    expect(miss).not.toBeNull()
    const s = miss!.state
    expect(s.goals).toBe(0)
    expect(s.misses).toBe(1)
  })

  it('守门员能把球扑出来', () => {
    const save = findShot((s) => s.lastResult === 'saved', 60, 0)
    expect(save).not.toBeNull()
    const s = save!.state
    expect(s.saves).toBe(1)
    expect(s.goals).toBe(0)
    expect(s.misses).toBe(1)
  })

  it('十次机会用尽后正确终局并结算进球', () => {
    const { state, goalCount } = playFullGame(7, 85, 8)
    expect(state.phase).toBe('over')
    expect(state.attempt).toBe(CHANCES)
    expect(state.goals).toBe(goalCount)
    expect(state.goals + state.misses).toBe(CHANCES)
    expect(state.goals).toBeGreaterThanOrEqual(0)
    expect(state.goals).toBeLessThanOrEqual(CHANCES)
  })

  it('终局后不能再推进与准备下一脚', () => {
    const { state } = playFullGame(7, 85, 8)
    const frozen = { ...state.ball }
    expect(reduce(state, { type: 'next' }).phase).toBe('over')
    expect(reduce(state, { type: 'advance', ticks: 5 })).toBe(state)
    expect(state.ball).toEqual(frozen)
  })
})

describe('toy-football / 确定性', () => {
  it('同种子同一操作序列完全复现', () => {
    const run = () => {
      let s = create(4242)
      s = reduce(s, { type: 'setPower', value: 72 })
      s = reduce(s, { type: 'setAngle', value: -18 })
      s = reduce(s, { type: 'kick' })
      for (let i = 0; i < 60; i++) s = reduce(s, { type: 'advance', ticks: 2 })
      return s
    }
    expect(run()).toEqual(run())
  })

  it('不同种子会走不同的守门员轨迹', () => {
    const xs = new Set<number>()
    for (let seed = 1; seed <= 12; seed++) {
      const s = reduce(reduce(create(seed), { type: 'kick' }), { type: 'advance', ticks: 8 })
      // 球的轨迹只由力度角度决定，与种子无关；守门员轨迹必须因种子而异
      expect(s.ball.x).toBe(KICK.x)
      expect(s.ball.y).toBeCloseTo(KICK.y - speedOf(POWER_DEFAULT) * 8, 6)
      xs.add(Number(s.keeper.x.toFixed(4)))
    }
    expect(xs.size).toBeGreaterThan(1)
  })
})

describe('toy-football / 球不出界', () => {
  it('整个飞行过程中球始终留在边墙与底线之内', () => {
    for (const angle of [ANGLE_MIN, -12, 0, 12, ANGLE_MAX]) {
      let s = reduce(reduce(create(99), { type: 'setPower', value: POWER_MAX }), { type: 'setAngle', value: angle })
      s = reduce(s, { type: 'kick' })
      let guard = 0
      while (s.phase === 'flight' && guard++ < 1000) {
        expect(s.ball.x).toBeGreaterThanOrEqual(FIELD.left)
        expect(s.ball.x).toBeLessThanOrEqual(FIELD.right)
        expect(s.ball.y).toBeGreaterThanOrEqual(GOAL_Y)
        expect(s.ball.y + BALL_R).toBeLessThanOrEqual(FIELD.bottom)
        s = reduce(s, { type: 'advance', ticks: 1 })
      }
      expect(s.phase === 'result' || s.phase === 'over').toBe(true)
    }
  })
})

describe('toy-football / 纯函数约束', () => {
  it('reduce 全程不修改入参（深冻结下运行）', () => {
    const frozen = deepFreeze(create(2026))
    const snapshot = JSON.parse(JSON.stringify(frozen))

    let s = frozen
    s = reduce(s, { type: 'setPower', value: 999 })
    s = reduce(s, { type: 'setAngle', value: -999 })
    s = reduce(s, { type: 'advance', ticks: 8 })
    s = reduce(s, { type: 'kick' })
    for (let i = 0; i < 200 && s.phase === 'flight'; i++) {
      s = reduce(s, { type: 'advance', ticks: 1 })
    }
    s = reduce(s, { type: 'next' })
    s = reduce(s, { type: 'kick' })
    for (let i = 0; i < 200 && s.phase === 'flight'; i++) {
      s = reduce(s, { type: 'advance', ticks: 1 })
    }

    expect(JSON.parse(JSON.stringify(frozen))).toEqual(snapshot)
    expect(frozen.phase).toBe('aim')
    expect(frozen.ball).toEqual({ x: KICK.x, y: KICK.y, vx: 0, vy: 0 })
  })

  it('无效数值不会污染状态', () => {
    const frozen = deepFreeze(create(5))
    expect(() => reduce(frozen, { type: 'advance', ticks: Number.NaN })).not.toThrow()
    expect(reduce(frozen, { type: 'advance', ticks: Number.NaN })).toBe(frozen)
  })
})
