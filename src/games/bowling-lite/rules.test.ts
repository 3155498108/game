import { describe, it, expect } from 'vitest'
import {
  VW,
  VH,
  DT,
  GRAVITY,
  FRAME_PINS,
  FRAMES,
  PIN_R,
  PIN_GAP,
  PIN_ROW_GAP,
  HEADPIN_Y,
  PIT_Y,
  PIN_PAIR_FALL_SPEED,
  PIN_ROLL,
  BALL_R,
  BALL_AIR,
  WALL_MARGIN,
  ANGLE_MAX,
  MIN_THROW,
  MAX_THROW,
  MAX_ROLL_TICKS,
  STRIKE_BONUS,
  SPARE_BONUS,
  setupPins,
  rack,
  resolveFrame,
  create,
  reduce,
  run,
  stepOnce,
  clampAngle,
  clampPower,
  throwSpeed,
  totalScore,
  currentScore,
} from './rules'
import type { Action, Ball, Pin, State } from './rules'
import { Rng, hashSeed } from '../../core/rng'

/** 从当前状态开始推进，直到本球结束或超过上限（stepOnce 逐 tick 走，与渲染层无关） */
function advance(s: State, maxTicks = 600): State {
  let cur = s
  let i = 0
  while (cur.phase === 'rolling' && i < maxTicks) {
    cur = stepOnce(cur)
    i++
  }
  return cur
}

/** 构造一个「已经在滚动中」的测试局面 */
function rolling(pins: Pin[], ball: Ball, base: State): State {
  return { ...base, phase: 'rolling', pins, ball, ticks: 0, slow: 0 }
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const k of Object.keys(o as Record<string, unknown>)) {
      deepFreeze((o as Record<string, unknown>)[k])
    }
  }
  return o
}

const inLane = (x: number, y: number, r: number): boolean =>
  x >= WALL_MARGIN + r - 1e-6 &&
  x <= VW - WALL_MARGIN - r + 1e-6 &&
  y >= WALL_MARGIN + r - 1e-6 &&
  y <= VH - WALL_MARGIN - r + 1e-6

describe('瓶阵布置', () => {
  it('三角排列 10 瓶：每排 1/2/3/4，头瓶居中，纵向等距、左右对称', () => {
    const pins = setupPins()
    expect(pins).toHaveLength(10)
    expect(pins.filter((p) => p.row === 1)).toHaveLength(1)
    expect(pins.filter((p) => p.row === 2)).toHaveLength(2)
    expect(pins.filter((p) => p.row === 3)).toHaveLength(3)
    expect(pins.filter((p) => p.row === 4)).toHaveLength(4)

    const head = pins.find((p) => p.row === 1)!
    expect(head.x).toBeCloseTo(VW / 2, 6)
    expect(head.y).toBeCloseTo(HEADPIN_Y, 6)

    for (let row = 2; row <= 4; row++) {
      const rowPins = pins.filter((p) => p.row === row)
      const xs = rowPins.map((p) => p.x).sort((a, b) => a - b)
      const ys = rowPins.map((p) => p.y)
      expect(new Set(ys).size).toBe(1)
      expect(ys[0]).toBeCloseTo(HEADPIN_Y - (row - 1) * PIN_ROW_GAP, 6)
      expect(xs[0]).toBeCloseTo(VW / 2 - ((row - 1) / 2) * PIN_GAP, 6)
      expect(xs[xs.length - 1]).toBeCloseTo(VW / 2 + ((row - 1) / 2) * PIN_GAP, 6)
      expect((xs[0] + xs[xs.length - 1]) / 2).toBeCloseTo(VW / 2, 6)
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(PIN_GAP, 6)
    }
  })

  it('初始瓶阵两两不重叠且都在场地内', () => {
    const pins = setupPins()
    for (const p of pins) {
      expect(inLane(p.x, p.y, PIN_R)).toBe(true)
      for (const q of pins) {
        if (q.id <= p.id) continue
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(PIN_R * 2 - 1e-6)
      }
    }
  })

  it('摆瓶只加 ±2 的可播种抖动，同种子结果一致', () => {
    const a = rack(new Rng(hashSeed(5)))
    const b = rack(new Rng(hashSeed(5)))
    expect(a).toHaveLength(10)
    expect(a).toEqual(b)
    const base = setupPins()
    a.forEach((p, i) => {
      expect(Math.abs(p.y - base[i].y)).toBeLessThanOrEqual(2 + 1e-9)
      expect(p.x).toBeCloseTo(base[i].x, 6)
    })
  })
})

describe('倒瓶判定：倒下即移出物理世界', () => {
  it('R1 球撞瓶会把瓶撞倒，并立刻从 pins 移除', () => {
    const head = setupPins()[0]
    const s = advance(rolling([head], { x: head.x, y: head.y + 60, vx: 0, vy: -900 }, create(3)))
    expect(s.pins).toHaveLength(0)
    expect(s.pins.find((p) => p.id === head.id)).toBeUndefined()
    expect(s.fallen.map((f) => f.id)).toContain(head.id)
  })

  it('倒下的瓶不再参与碰撞：球穿过原位置既不被偏折也不会复现', () => {
    const head = setupPins()[0]
    const s1 = advance(rolling([head], { x: head.x, y: head.y + 60, vx: 0, vy: -900 }, create(3)))
    const f = s1.fallen.find((x) => x.id === head.id)!
    expect(s1.pins).toHaveLength(0)

    // 远处留一个站着的瓶，否则 standing 清空会让本球提前结束、拿不到 ball
    const far: Pin = { id: 7, row: 4, col: 4, x: 620, y: 560, vx: 0, vy: 0 }
    // 把同样的球放到倒瓶位置（t=1 时与倒下点中心距 < BALL_R + PIN_R，若该瓶还在必被偏折）
    const s2 = run(rolling([far], { x: f.x - 20, y: f.y + 20, vx: 0, vy: -900 }, s1), 1)
    expect(s2.pins.map((p) => p.id)).toEqual([far.id])
    expect(s2.pins.find((p) => p.id === head.id)).toBeUndefined()
    expect(s2.ball).not.toBeNull()
    expect(s2.ball!.vx).toBe(0)
  })

  it('R3 瓶撞瓶：相对法向速度够大时双方都倒下并移出物理世界', () => {
    const a: Pin = { id: 90, row: 1, col: 1, x: 300, y: 700, vx: PIN_PAIR_FALL_SPEED + 120, vy: 0 }
    const b: Pin = { id: 91, row: 1, col: 1, x: 300 + PIN_R * 2 - 2, y: 700, vx: 0, vy: 0 }
    const s = run(rolling([a, b], { x: 690, y: 1000, vx: 0, vy: 0 }, create(1)), 1)
    expect(s.pins).toHaveLength(0)
    expect(s.fallen.map((f) => f.id).sort()).toEqual([90, 91])
  })

  it('R3 瓶撞瓶速度不够时两瓶都保留、只交换法向分量', () => {
    const a: Pin = { id: 90, row: 1, col: 1, x: 300, y: 700, vx: 120, vy: 0 }
    const b: Pin = { id: 91, row: 1, col: 1, x: 300 + PIN_R * 2 - 2, y: 700, vx: 0, vy: 0 }
    const s = run(rolling([a, b], { x: 690, y: 1000, vx: 0, vy: 0 }, create(1)), 1)
    expect(s.pins).toHaveLength(2)
    expect(s.fallen).toHaveLength(0)
    // 等质量 + 恢复系数 0.6 ⇒ 法向冲量对称：a 只剩小头、b 拿走大头，x 向动量守恒
    const v0 = 120 * PIN_ROLL
    expect(s.pins[0].vx).toBeGreaterThan(0)
    expect(s.pins[0].vx).toBeLessThan(v0 * 0.25)
    expect(s.pins[1].vx).toBeGreaterThan(v0 * 0.7)
    expect(s.pins[0].vx + s.pins[1].vx).toBeCloseTo(v0, 6)
    // 只推离位置：两瓶仍不重叠
    expect(Math.hypot(s.pins[1].x - s.pins[0].x, s.pins[1].y - s.pins[0].y)).toBeGreaterThanOrEqual(
      PIN_R * 2 - 1e-6,
    )
  })

  it('R4 越过坑线的瓶算倒下并移出', () => {
    const p: Pin = { id: 50, row: 1, col: 1, x: 360, y: PIT_Y + 6, vx: 0, vy: -600 }
    const s = run(rolling([p], { x: 690, y: 1000, vx: 0, vy: 0 }, create(1)), 1)
    expect(s.pins).toHaveLength(0)
    expect(s.fallen.map((f) => f.id)).toEqual([50])
  })
})

describe('圆碰撞与边界', () => {
  const angles = [-ANGLE_MAX, -0.05, 0.05, ANGLE_MAX]

  it('任意角度全力投球，球与瓶都不出界', () => {
    for (const a of angles) {
      let s = create(9)
      s = reduce(s, { type: 'aim', angle: a })
      s = reduce(s, { type: 'power', power: 1 })
      s = reduce(s, { type: 'swing' })
      for (let i = 0; i < 320 && s.phase === 'rolling'; i++) {
        s = stepOnce(s)
        if (s.ball) expect(inLane(s.ball.x, s.ball.y, BALL_R)).toBe(true)
        for (const p of s.pins) expect(inLane(p.x, p.y, PIN_R)).toBe(true)
      }
      expect(s.ball).toBeNull()
    }
  })

  it('任意角度全力投球，两两圆都不重叠', () => {
    for (const a of angles) {
      let s = create(9)
      s = reduce(s, { type: 'aim', angle: a })
      s = reduce(s, { type: 'power', power: 1 })
      s = reduce(s, { type: 'swing' })
      for (let i = 0; i < 320 && s.phase === 'rolling'; i++) {
        s = stepOnce(s)
        const live = s.pins
        for (let x = 0; x < live.length; x++) {
          if (s.ball) {
            expect(Math.hypot(live[x].x - s.ball.x, live[x].y - s.ball.y)).toBeGreaterThanOrEqual(
              BALL_R + PIN_R - 0.5,
            )
          }
          for (let y = x + 1; y < live.length; y++) {
            expect(Math.hypot(live[x].x - live[y].x, live[x].y - live[y].y)).toBeGreaterThanOrEqual(
              PIN_R * 2 - 0.5,
            )
          }
        }
      }
    }
  })

  it('定步参数为常量且不含随机源', () => {
    let s = create(1)
    s = reduce(s, { type: 'power', power: 1 })
    s = reduce(s, { type: 'swing' })
    const b = s.ball!
    expect(b.y).toBeCloseTo(1180, 6)
    expect(Math.abs(b.vy)).toBeCloseTo(MAX_THROW, 6)
    expect(DT).toBeCloseTo(1 / 60, 9)
    // 一个 tick 的积分完全由常量算出（先加重力，再乘空气衰减）
    const one = run(s, 1).ball!
    expect(one.vy).toBeCloseTo((b.vy + GRAVITY * DT) * BALL_AIR, 6)
    expect(one.y).toBeCloseTo(b.y + one.vy * DT, 6)
    // 扣掉空气衰减的残留后，剩下的重力增量与初速无关（恒为 GRAVITY*DT*BALL_AIR）
    const gravityStep = (power: number): number => {
      const st = reduce(reduce(create(1), { type: 'power', power }), { type: 'swing' })
      // 初速 v0 = -throwSpeed，BALL_AIR*BALL_AIR 扣掉空气衰减后只剩重力增量
      return run(st, 1).ball!.vy + throwSpeed(power) * BALL_AIR
    }
    expect(gravityStep(0)).toBeCloseTo(GRAVITY * DT * BALL_AIR, 6)
    expect(gravityStep(1)).toBeCloseTo(gravityStep(0), 6)
    expect(gravityStep(0.5)).toBeCloseTo(gravityStep(0), 6)
    // 不含随机源：同一状态推进同一 tick，结果逐字节一致
    expect(JSON.stringify(run(s, 1))).toBe(JSON.stringify(run(s, 1)))
  })
})

describe('投球参数钳制', () => {
  it('角度与力度都被钳制在规定范围', () => {
    expect(clampAngle(9)).toBeCloseTo(ANGLE_MAX, 9)
    expect(clampAngle(-9)).toBeCloseTo(-ANGLE_MAX, 9)
    expect(clampPower(5)).toBe(1)
    expect(clampPower(-3)).toBe(0)

    let s = create(1)
    s = reduce(s, { type: 'aim', angle: 99 })
    s = reduce(s, { type: 'power', power: 99 })
    expect(s.angle).toBeCloseTo(ANGLE_MAX, 9)
    expect(s.power).toBe(1)

    s = reduce(s, { type: 'aim', angle: -99 })
    s = reduce(s, { type: 'power', power: -99 })
    expect(s.angle).toBeCloseTo(-ANGLE_MAX, 9)
    expect(s.power).toBe(0)

    expect(throwSpeed(1)).toBeCloseTo(MAX_THROW, 9)
    expect(throwSpeed(0)).toBeCloseTo(MIN_THROW, 9)
  })

  it('拖拽向量映射到角度与力度且同样受钳制', () => {
    let s = create(1)
    s = reduce(s, { type: 'dragStart', x: 360, y: 1100 })
    s = reduce(s, { type: 'dragMove', x: 360, y: 840 })
    expect(s.power).toBeCloseTo(1, 9)
    expect(s.angle).toBeCloseTo(0, 9)
    s = reduce(s, { type: 'dragMove', x: 2000, y: 0 })
    expect(s.angle).toBeCloseTo(ANGLE_MAX, 9)
    expect(s.power).toBe(1)
  })
})

describe('计分', () => {
  it('全中额外奖励：一球全倒 = 10 + STRIKE_BONUS', () => {
    expect(resolveFrame([10])).toEqual({
      balls: [10],
      score: 10 + STRIKE_BONUS,
      strike: true,
      spare: false,
    })
  })

  it('补中与普通局的基础分', () => {
    expect(resolveFrame([7, 3])).toEqual({ balls: [7, 3], score: 10 + SPARE_BONUS, strike: false, spare: true })
    expect(resolveFrame([4, 2])).toEqual({ balls: [4, 2], score: 6, strike: false, spare: false })
    expect(resolveFrame([0, 0])).toEqual({ balls: [0, 0], score: 0, strike: false, spare: false })
    // 第 10 局三球全中：每次全中都拿奖励
    expect(resolveFrame([10, 10, 10]).score).toBe(30 + 3 * STRIKE_BONUS)
  })

  it('全力正中直投 ⇒ 10 瓶全倒并拿到全中奖励', () => {
    let s = create(11)
    s = reduce(s, { type: 'aim', angle: 0 })
    s = reduce(s, { type: 'power', power: 1 })
    s = reduce(s, { type: 'swing' })
    s = advance(s)
    expect(s.frames).toHaveLength(1)
    expect(s.frames[0].balls).toEqual([FRAME_PINS])
    expect(s.frames[0].strike).toBe(true)
    expect(s.frames[0].score).toBe(FRAME_PINS + STRIKE_BONUS)
    expect(s.pins).toHaveLength(0)
    expect(s.phase).toBe('aim')
  })

  it('弱球够不到瓶阵 ⇒ 本球 0 瓶倒', () => {
    let s = create(4)
    s = reduce(s, { type: 'power', power: 0 })
    s = reduce(s, { type: 'swing' })
    s = advance(s)
    expect(s.balls).toEqual([0])
    expect(s.frames).toHaveLength(0)
    expect(s.pins).toHaveLength(10)
  })

  it('十局全中逐局累计总分（第 10 局三球各自计奖励）', () => {
    let s = create(11)
    let swings = 0
    // 第 10 局要打 3 球，所以按「直到终局」推进，而不是死循环 FRAMES 次
    while (s.phase !== 'done' && swings < 60) {
      s = reduce(s, { type: 'aim', angle: 0 })
      s = reduce(s, { type: 'power', power: 1 })
      s = reduce(s, { type: 'swing' })
      s = advance(s)
      swings++
    }
    expect(s.phase).toBe('done')
    expect(swings).toBe(FRAMES + 2)
    expect(s.frames).toHaveLength(FRAMES)
    expect(s.frames[0].score).toBe(FRAME_PINS + STRIKE_BONUS)
    expect(s.frames[FRAMES - 1].balls).toEqual([10, 10, 10])
    expect(s.frames[FRAMES - 1].score).toBe(30 + 3 * STRIKE_BONUS)
    expect(totalScore(s)).toBe((FRAMES - 1) * (FRAME_PINS + STRIKE_BONUS) + (30 + 3 * STRIKE_BONUS))
    expect(currentScore(s)).toBe(totalScore(s))
  })

  it('局数用尽必定终局（每球都打不满也不会卡死）', () => {
    let s = create(5)
    let swings = 0
    while (s.phase !== 'done') {
      s = reduce(s, { type: 'power', power: 0.1 })
      s = reduce(s, { type: 'swing' })
      s = advance(s)
      swings++
      expect(swings).toBeLessThan(60)
    }
    expect(swings).toBe(FRAMES * 2)
    expect(s.frame).toBe(FRAMES)
    expect(s.frames).toHaveLength(FRAMES)
    expect(totalScore(s)).toBe(0)
    // 终局后再投球无效
    const done = s
    expect(reduce(done, { type: 'swing' })).toBe(done)
  })

  it('单球 tick 数有上限，不会出现无限滚动', () => {
    let s = create(6)
    s = reduce(s, { type: 'power', power: 0.5 })
    s = reduce(s, { type: 'swing' })
    let n = 0
    while (s.phase === 'rolling' && n < MAX_ROLL_TICKS + 10) {
      s = stepOnce(s)
      n++
    }
    expect(n).toBeLessThanOrEqual(MAX_ROLL_TICKS)
    expect(s.phase).toBe('aim')
  })
})

describe('纯函数与可复现', () => {
  it('同种子 + 同投球序列 ⇒ 完全一致的对局', () => {
    const seq: Action[] = [
      { type: 'aim', angle: 0.05 },
      { type: 'power', power: 0.9 },
      { type: 'swing' },
    ]
    const play = (seed: number): State => {
      let s = create(seed)
      for (const a of seq) s = reduce(s, a)
      return advance(s)
    }
    expect(create(2024)).toEqual(create(2024))
    expect(create(2024)).not.toEqual(create(7))
    const a = play(2024)
    const b = play(2024)
    expect(a).toEqual(b)
    expect(play(7)).not.toEqual(a)
  })

  it('reduce 不修改入参（深冻结后仍可完整推进）', () => {
    let s = create(99)
    s = reduce(s, { type: 'power', power: 0.95 })
    s = reduce(s, { type: 'aim', angle: 0.02 })
    const frozen = deepFreeze({
      ...s,
      pins: s.pins.map((p) => ({ ...p })),
      fallen: s.fallen.map((f) => ({ ...f })),
    })
    const snapshot = JSON.stringify(frozen)
    // 会改变状态的 action：必须返回新对象，且绝不回写入参
    const mutating: Action[] = [
      { type: 'swing' },
      { type: 'step', n: 8 },
      { type: 'dragStart', x: 300, y: 900 },
      { type: 'dragMove', x: 320, y: 700 },
      { type: 'aim', angle: -0.02 },
    ]
    let cur = frozen
    for (const a of mutating) {
      const next = reduce(cur, a)
      expect(next).not.toBe(cur)
      cur = next
    }
    // 无效 / 空转的 action：必须原样返回同一个对象（球还在滚时不能再投、n=0 不推进）
    expect(cur.phase).toBe('rolling')
    const ignored: Action[] = [
      { type: 'swing' },
      { type: 'step', n: 0 },
    ]
    for (const a of ignored) {
      expect(reduce(cur, a)).toBe(cur)
    }
    expect(JSON.stringify(frozen)).toBe(snapshot)
  })

  it('run / stepOnce 不修改入参', () => {
    const s = reduce(reduce(create(3), { type: 'power', power: 1 }), { type: 'swing' })
    const snap = JSON.stringify(s)
    run(s, 8)
    stepOnce(s)
    expect(JSON.stringify(s)).toBe(snap)
  })
})
