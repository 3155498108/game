import { describe, expect, it } from 'vitest'
import {
  BALL_LIMIT,
  BALL_MAX_LIFE,
  BALL_R,
  FLIPPER_MAX,
  FLIPPER_R,
  FLIPPER_Y,
  LAUNCH_MIN_X,
  LEFT_PIVOT_X,
  PEG_R,
  SLOT_COUNT,
  SLOT_TRIGGER_Y,
  VW,
  VH,
  create,
  pendingBalls,
  reduce,
  run,
  slotCenterX,
  slotIndexAt,
  type Ball,
  type State,
} from './rules'

/** 空钉阵 + 指定球：用于单独验证重力积分 */
function withBall(s: State, b: Partial<Ball>): State {
  return {
    ...s,
    pegs: [],
    balls: [{ x: VW / 2, y: 150, vx: 0, vy: 0, life: 0, scored: false, gain: 0, ...b }],
  }
}

/** 自动投放直到弹珠用尽；onFrame 在每一 tick 后回调（用于逐 tick 校验） */
function playOut(seed: number, maxTicks: number, onFrame?: (s: State) => void): { end: State; ticks: number } {
  let s = create(seed)
  let ticks = 0
  for (let i = 0; i < maxTicks; i++) {
    if (!s.over && pendingBalls(s) === 0 && s.ballsLeft > 0) {
      s = reduce(s, { type: 'launch', x: 60 + ((i * 137) % 600) })
    }
    s = reduce(s, { type: 'step', n: 1 })
    ticks++
    if (onFrame) onFrame(s)
    if (s.over) break
  }
  return { end: s, ticks }
}

/** 一局的轨迹摘要，用于复现性比对 */
function digest(s: State): string {
  return `${s.seq}|${s.score}|${s.balls.map((b) => `${b.x.toFixed(4)},${b.y.toFixed(4)},${b.gain}`).join(';')}`
}

describe('pachinko 弹戏', () => {
  it('create 返回可运行的初始状态', () => {
    const s = create(7)
    expect(s.ballsLeft).toBe(BALL_LIMIT)
    expect(s.balls.length).toBe(0)
    expect(s.score).toBe(0)
    expect(s.over).toBe(false)
    expect(s.slotValues.length).toBe(SLOT_COUNT)
    expect(s.slotValues.every((v) => v > 0)).toBe(true)
    expect(s.pegs.length).toBeGreaterThan(20)
    // 钉阵全部落在场地内，且左右边距一致
    for (const p of s.pegs) {
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(VW)
      expect(p.y).toBeGreaterThan(0)
      expect(p.y).toBeLessThan(SLOT_TRIGGER_Y)
    }
  })

  it('无碰撞时重力让 y 单调增大直到落底并结算', () => {
    // x 取正中：两挡板之间的通道里没有任何碰撞体，纯自由落体
    let s = withBall(create(3), { x: VW / 2 })
    let prevY = s.balls[0].y
    let ticks = 0
    while (!s.balls[0].scored && ticks < BALL_MAX_LIFE) {
      s = reduce(s, { type: 'step', n: 1 })
      ticks++
      expect(s.balls[0].y).toBeGreaterThanOrEqual(prevY)
      expect(s.balls[0].y).toBeLessThanOrEqual(VH)
      prevY = s.balls[0].y
    }
    expect(s.balls[0].scored).toBe(true)
    expect(s.balls[0].y).toBe(SLOT_TRIGGER_Y)
    // 落进哪个分值区就加该区分值
    expect(s.score).toBe(s.slotValues[slotIndexAt(s.balls[0].x)])
    expect(ticks).toBeLessThan(BALL_MAX_LIFE)
  })

  it('任意 tick 弹珠与钉子都不重叠', () => {
    let frames = 0
    const { end } = playOut(11, 20000, (f) => {
      frames++
      for (const b of f.balls) {
        if (b.scored) continue
        for (const p of f.pegs) {
          const d = Math.hypot(b.x - p.x, b.y - p.y)
          expect(d).toBeGreaterThanOrEqual(BALL_R + PEG_R - 1e-6)
        }
      }
    })
    expect(frames).toBeGreaterThan(20)
    expect(end.over).toBe(true)
  })

  it('落进哪个分值区就加该区的分', () => {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const base = create(5)
      const s = withBall(base, { x: slotCenterX(i), y: SLOT_TRIGGER_Y - 6 })
      let next = s
      let n = 0
      while (!next.balls[0].scored && n < 30) {
        next = reduce(next, { type: 'step', n: 1 })
        n++
      }
      expect(slotIndexAt(slotCenterX(i))).toBe(i)
      expect(next.score).toBe(base.slotValues[i])
      expect(next.lastScore).toEqual({ index: i, value: base.slotValues[i] })
      expect(next.balls[0].scored).toBe(true)
      expect(next.balls[0].gain).toBe(base.slotValues[i])
    }
  })

  it('弹珠用尽后正确终局', () => {
    const { end } = playOut(23, 20000)
    expect(end.over).toBe(true)
    expect(end.ballsLeft).toBe(0)
    expect(pendingBalls(end)).toBe(0)
    const sum = end.balls.reduce((a, b) => a + b.gain, 0)
    expect(end.score).toBe(sum)
    // 停在分值区里的球不会超过投放总数；卡在挡板上超时的球会被回收（0 分）
    expect(end.balls.length).toBeGreaterThan(0)
    expect(end.balls.length).toBeLessThanOrEqual(BALL_LIMIT)
    expect(end.balls.every((b) => b.scored)).toBe(true)
  })

  it('终局后所有 action 都不再改变状态', () => {
    const { end } = playOut(23, 20000)
    expect(reduce(end, { type: 'launch', x: 100 })).toBe(end)
    expect(reduce(end, { type: 'step', n: 4 })).toBe(end)
    expect(reduce(end, { type: 'setLeft', angle: 1 })).toBe(end)
    expect(reduce(end, { type: 'flipRight', delta: 0.5 })).toBe(end)
  })

  it('同种子完全可复现', () => {
    const a: string[] = []
    const b: string[] = []
    const ea = playOut(99, 20000, (s) => a.push(digest(s)))
    const eb = playOut(99, 20000, (s) => b.push(digest(s)))
    expect(ea.ticks).toBe(eb.ticks)
    expect(a).toEqual(b)
    expect(JSON.stringify(ea.end)).toBe(JSON.stringify(eb.end))
  })

  it('不同种子产出不同布局或分值梯度', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const s = create(seed)
      seen.add(JSON.stringify(s.pegs) + JSON.stringify(s.slotValues))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('任意 tick 弹珠都不出界', () => {
    let frames = 0
    const { end } = playOut(41, 20000, (f) => {
      frames++
      for (const b of f.balls) {
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.x).toBeLessThanOrEqual(VW)
        expect(b.y).toBeGreaterThanOrEqual(0)
        expect(b.y).toBeLessThanOrEqual(VH)
      }
    })
    expect(frames).toBeGreaterThan(20)
    expect(end.over).toBe(true)
  })

  it('reduce 不修改入参', () => {
    const s = create(17)
    const snapshot = JSON.stringify(s)
    let cur = s
    const actions = [
      { type: 'launch' as const, x: 120 },
      { type: 'step' as const, n: 30 },
      { type: 'setLeft' as const, angle: 0.9 },
      { type: 'setRight' as const, angle: -0.5 },
      { type: 'flipLeft' as const, delta: 0.16 },
      { type: 'flipRight' as const, delta: -0.16 },
      { type: 'step' as const, n: 90 },
    ]
    for (const a of actions) {
      const before = JSON.stringify(cur)
      cur = reduce(cur, a)
      // 每一步都产生了变化
      expect(JSON.stringify(cur)).not.toBe(before)
      // 且没有改写之前的任何一个状态
      expect(JSON.stringify(s)).toBe(snapshot)
    }
    expect(cur.leftAngle).toBeLessThanOrEqual(FLIPPER_MAX)
    expect(cur.rightAngle).toBeLessThanOrEqual(FLIPPER_MAX)
    expect(cur.leftAngle).toBeGreaterThanOrEqual(-FLIPPER_MAX)
    expect(cur.rightAngle).toBeGreaterThanOrEqual(-FLIPPER_MAX)
  })

  it('挡板角度可调并有明确碰撞：球被左挡板打向场内', () => {
    const s0 = create(13)
    const raised = reduce(s0, { type: 'setLeft', angle: FLIPPER_MAX })
    expect(raised.leftAngle).toBe(FLIPPER_MAX)
    expect(raised.leftActive).toBe(true)
    // 角度越界会被夹紧
    expect(reduce(s0, { type: 'setLeft', angle: 99 }).leftAngle).toBe(FLIPPER_MAX)

    const startX = LEFT_PIVOT_X + 30
    let s: State = {
      ...s0,
      pegs: [],
      balls: [{ x: startX, y: FLIPPER_Y - 34, vx: 0, vy: 0, life: 0, scored: false, gain: 0 }],
    }
    for (let i = 0; i < 20; i++) s = reduce(s, { type: 'step', n: 1 })
    // 左挡板把球往 +x（场内）方向弹开
    expect(s.balls[0].x).toBeGreaterThan(startX)
    expect(s.balls[0].x).toBeLessThanOrEqual(VW)
    // 挡板半径为常量，几何参数有效
    expect(FLIPPER_R).toBeGreaterThan(0)
    expect(BALL_R).toBeGreaterThan(0)
  })

  it('投放 x 被夹在投放区内', () => {
    const left = reduce(create(1), { type: 'launch', x: -999 })
    expect(left.ballsLeft).toBe(BALL_LIMIT - 1)
    expect(left.balls[0].x).toBe(LAUNCH_MIN_X)
    expect(left.balls[0].x).toBeGreaterThanOrEqual(BALL_R)

    const right = reduce(create(1), { type: 'launch', x: 9999 })
    expect(right.balls[0].x).toBeLessThanOrEqual(VW - BALL_R)
  })

  it('run(n) 与连续 n 次 step 结果一致', () => {
    const s0 = reduce(create(29), { type: 'launch', x: 200 })
    let a = s0
    for (let i = 0; i < 10; i++) a = run(a, 5)
    let b = s0
    for (let i = 0; i < 50; i++) b = reduce(b, { type: 'step', n: 1 })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
