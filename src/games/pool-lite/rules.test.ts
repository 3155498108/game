/**
 * 台球简化版 pool-lite 规则测试。
 * 覆盖：圆形碰撞分离、迭代上限、恢复系数与动能、库边反射、
 * 最小编号顺序规则、犯规判定、回合结束、AI 合法性、必然终局、可复现、纯度。
 */
import { describe, expect, it } from 'vitest'
import {
  BALL_R,
  MAX_SEPARATION_ITERATIONS,
  MAX_SHOTS,
  MAX_TICK_STEPS,
  PLAY,
  RESTITUTION,
  TICK_MS,
  aiAction,
  allStopped,
  clampIterations,
  create,
  isCorrectOrder,
  legalActions,
  nextTarget,
  reduce,
  reflectWalls,
  resolveCollisions,
  separationIterations,
  tickAction,
  type Action,
  type Ball,
  type State,
} from './rules'

// ------------------------------------------------------------------ 测试工具

function ball(id: number, x: number, y: number, vx = 0, vy = 0): Ball {
  return { id, x, y, vx, vy, pocketed: false }
}

function pocketed(id: number): Ball {
  return { id, x: 0, y: 0, vx: 0, vy: 0, pocketed: true }
}

/** 深冻结，用于验证 reduce 不修改入参 */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v)
    Object.freeze(o)
  }
  return o
}

function kinetic(balls: readonly Ball[]): number {
  return balls.reduce((s, b) => s + 0.5 * (b.vx * b.vx + b.vy * b.vy), 0)
}

/** 构造只含白球 + 指定编号球的干净局面 */
function scenario(balls: Ball[], extra: Partial<State> = {}): State {
  const base = create(4242)
  return {
    ...base,
    balls,
    phase: 'aim',
    turn: 1,
    target: nextTarget(balls),
    score: [0, 0],
    penalty: [0, 0],
    shots: 0,
    potted: [],
    lastShot: null,
    over: false,
    winner: 0,
    drag: null,
    ...extra,
  }
}

/** 用真实 tick 推进到本杆结束 */
function runToSettle(s: State): State {
  let cur = s
  let guard = 0
  while (cur.phase === 'rolling' && guard < 5000) {
    cur = reduce(cur, { type: 'tick', steps: MAX_TICK_STEPS })
    guard += MAX_TICK_STEPS
  }
  return cur
}

function shootWith(s: State, angle: number, power: number): State {
  const aimed = reduce(s, { type: 'aim', angle, power })
  return runToSettle(reduce(aimed, { type: 'shoot' }))
}

// ------------------------------------------------------------------ 物理

describe('圆形刚体碰撞', () => {
  it('重叠的两球解算后不再重叠', () => {
    const before = [ball(0, 100, 100, 900, 0), ball(1, 128, 100, 0, 0)]
    const after = resolveCollisions(before)
    const d = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y)
    expect(d).toBeGreaterThanOrEqual(BALL_R * 2 - 1e-6)
  })

  it('多球拥挤时解算后全部两两不重叠', () => {
    const before = [
      ball(0, 300, 300, 800, 0),
      ball(1, 320, 300, 0, 0),
      ball(2, 336, 308, 0, 0),
      ball(3, 330, 320, 0, 0),
    ]
    const after = resolveCollisions(before)
    for (let i = 0; i < after.length; i++) {
      for (let j = i + 1; j < after.length; j++) {
        const d = Math.hypot(after[i].x - after[j].x, after[i].y - after[j].y)
        expect(d).toBeGreaterThanOrEqual(BALL_R * 2 - 1e-6)
      }
    }
  })

  it('分离迭代上限 ≤4 且真的钳制在代码里', () => {
    expect(MAX_SEPARATION_ITERATIONS).toBeLessThanOrEqual(4)
    expect(clampIterations(99)).toBe(MAX_SEPARATION_ITERATIONS)
    expect(clampIterations(4)).toBe(4)
    expect(clampIterations(2)).toBe(2)
    expect(clampIterations(-3)).toBe(0)
    expect(clampIterations(Number.NaN)).toBe(0)
    // 传入超大迭代数与传入上限的结果完全一致 → 上限真实生效
    const crowded = [ball(0, 300, 300), ball(1, 320, 300), ball(2, 336, 308)]
    expect(resolveCollisions(crowded, 99)).toEqual(resolveCollisions(crowded, MAX_SEPARATION_ITERATIONS))
    expect(separationIterations(3)).toBe(MAX_SEPARATION_ITERATIONS)
    expect(separationIterations(0)).toBe(0)
  })

  it('恢复系数固定且碰撞后总动能不增加', () => {
    expect(RESTITUTION).toBeGreaterThan(0)
    expect(RESTITUTION).toBeLessThan(1)
    // 正碰：相对法向速度按固定恢复系数衰减（分离后为负）
    const head: Ball[] = [ball(0, 100, 100, 900, 0), ball(1, 125, 100, 0, 0)]
    const out = resolveCollisions(head)
    const rel = out[0].vx - out[1].vx // 连心线沿 +x
    expect(rel).toBeCloseTo(-900 * RESTITUTION, 6)
    expect(kinetic(out)).toBeLessThan(kinetic(head))
    // 斜碰与不同速度：同一个固定恢复系数，动能同样不增加
    const head2: Ball[] = [ball(0, 500, 500, 1200, 300), ball(1, 520, 480, -200, 100)]
    const out2 = resolveCollisions(head2)
    expect(kinetic(out2)).toBeLessThanOrEqual(kinetic(head2) + 1e-6)
    const head3: Ball[] = [ball(0, 200, 200, 0, 1500), ball(1, 200, 226, 0, 0)]
    const out3 = resolveCollisions(head3)
    expect(kinetic(out3)).toBeLessThan(kinetic(head3))
    expect(out3[0].vy - out3[1].vy).toBeCloseTo(-1500 * RESTITUTION, 6)
    // 切向（不沿连心线）分量不参与碰撞：并排侧擦时动能保持不变
    const graze: Ball[] = [ball(0, 200, 200, 1500, 0), ball(1, 200, 226, 0, 0)]
    expect(kinetic(resolveCollisions(graze))).toBeCloseTo(kinetic(graze), 6)
  })

  it('矩形库边反射：法向翻转并乘固定恢复系数', () => {
    const left = reflectWalls([ball(0, PLAY.x - 5, 400, -600, 100)])[0]
    expect(left.vx).toBeCloseTo(600 * RESTITUTION, 6)
    expect(left.x).toBeCloseTo(PLAY.x, 6)
    const top = reflectWalls([ball(0, 400, PLAY.y - 5, 100, -600)])[0]
    expect(top.vy).toBeCloseTo(600 * RESTITUTION, 6)
    expect(top.y).toBeCloseTo(PLAY.y, 6)
    const right = reflectWalls([ball(0, PLAY.x + PLAY.w + 5, 400, 600, 0)])[0]
    expect(right.vx).toBeCloseTo(-600 * RESTITUTION, 6)
    expect(right.x).toBeCloseTo(PLAY.x + PLAY.w, 6)
    // 台内的球不动
    const inside = ball(0, 400, 400, 300, -200)
    expect(reflectWalls([inside])[0]).toEqual(inside)
  })
})

// ------------------------------------------------------------------ 规则

describe('最小编号顺序规则', () => {
  it('下一颗该进的球是台面上最小编号', () => {
    const balls = [ball(0, 100, 100), pocketed(1), ball(2, 200, 200), ball(3, 300, 300), pocketed(4), ball(5, 400, 400)]
    expect(nextTarget(balls)).toBe(2)
    expect(nextTarget([ball(0, 1, 1), ball(5, 2, 2), ball(3, 3, 3)])).toBe(3)
    expect(nextTarget([ball(0, 1, 1), pocketed(2), pocketed(3)])).toBe(0)
  })

  it('落袋顺序判定：只有打进当前目标球才算正确', () => {
    expect(isCorrectOrder([1], 1)).toBe(true)
    expect(isCorrectOrder([1, 0], 1)).toBe(true)
    expect(isCorrectOrder([2], 1)).toBe(false)
    expect(isCorrectOrder([1, 2], 1)).toBe(false)
    expect(isCorrectOrder([0], 1)).toBe(false)
    expect(isCorrectOrder([], 1)).toBe(false)
  })

  it('打进当前目标球：不算犯规且保住回合', () => {
    // 台面保留 3 号球，保证这一杆不会直接清台终局
    const s = scenario([
      ball(0, PLAY.x + 180, 640),
      ball(1, PLAY.x + PLAY.w - 60, 640),
      ball(3, 300, 300),
      pocketed(2),
      pocketed(4),
      pocketed(5),
    ])
    expect(s.target).toBe(1)
    const after = shootWith(s, 0, 0.95)
    expect(after.lastShot).not.toBeNull()
    expect(after.lastShot!.foul).toBe(false)
    expect(after.lastShot!.potted).toContain(1)
    expect(after.score[0]).toBe(1)
    expect(after.turn).toBe(1)
    expect(after.over).toBe(false)
    expect(after.target).toBe(nextTarget(after.balls))
    expect(after.target).toBe(3)
  }, 20000)

  it('顺序错误：打进非目标球判犯规并交换回合', () => {
    // 台面上只剩 1 号（目标）与 2 号；把 2 号摆在右中袋口正前方
    const s = scenario([ball(0, PLAY.x + 180, 640), ball(1, 560, 980), ball(2, PLAY.x + PLAY.w - 60, 640), pocketed(3), pocketed(4), pocketed(5)])
    expect(s.target).toBe(1)
    const after = shootWith(s, 0, 0.95)
    expect(after.lastShot).not.toBeNull()
    expect(after.lastShot!.potted).toContain(2)
    expect(after.lastShot!.foul).toBe(true)
    expect(after.lastShot!.reason).toContain('顺序错误')
    expect(after.turn).toBe(2)
  }, 20000)

  it('母球落袋判罚：罚杆 +1、犯规、回合交给对手', () => {
    const s = scenario([ball(0, PLAY.x + 180, 640), ball(1, 600, 980), pocketed(2), pocketed(3), pocketed(4), pocketed(5)])
    const after = shootWith(s, 0, 1)
    expect(after.lastShot!.potted).toContain(0)
    expect(after.lastShot!.foul).toBe(true)
    expect(after.lastShot!.reason).toContain('母球落袋')
    expect(after.penalty[0]).toBe(1)
    expect(after.turn).toBe(2)
    // 母球复位后可继续击球
    expect(after.balls[0].pocketed).toBe(false)
    expect(after.balls[0].vx).toBe(0)
  }, 20000)

  it('全部球停止后回合结束并结算', () => {
    let s = create(99)
    s = reduce(s, { type: 'aim', angle: 0.5, power: 0.4 })
    s = reduce(s, { type: 'shoot' })
    expect(s.phase).toBe('rolling')
    s = runToSettle(s)
    expect(s.phase).not.toBe('rolling')
    expect(allStopped(s.balls)).toBe(true)
    expect(s.lastShot).not.toBeNull()
    expect(s.shots).toBe(1)
  }, 20000)

  it('一局必然结束：杆数达到上限强制终局', () => {
    let s = create(11)
    s = { ...s, shots: MAX_SHOTS - 1 }
    s = reduce(s, { type: 'aim', angle: 1.2, power: 0.3 })
    s = reduce(s, { type: 'shoot' })
    s = runToSettle(s)
    expect(s.shots).toBe(MAX_SHOTS)
    expect(s.over).toBe(true)
    expect(s.phase).toBe('over')
    expect(s.winner).not.toBe(0)
  }, 20000)

  it('清台后立即终局', () => {
    const s = scenario(
      [ball(0, PLAY.x + 180, 640), pocketed(1), ball(2, PLAY.x + PLAY.w - 60, 640), pocketed(3), pocketed(4), pocketed(5)],
      { score: [1, 0] },
    )
    expect(s.target).toBe(2)
    const after = shootWith(s, 0, 0.95)
    expect(nextTarget(after.balls)).toBe(0)
    expect(after.over).toBe(true)
    expect(after.winner).toBe(1)
  }, 20000)
})

// ------------------------------------------------------------------ AI 与终局

describe('AI 与终局', () => {
  it('AI 只从 legalActions 里挑，且挑到的是合法手', () => {
    let s: State = { ...create(2024), turn: 2 }
    let asked = 0
    for (let i = 0; i < 8 && asked < 4 && !s.over; i++) {
      if (s.phase === 'rolling') {
        s = runToSettle(s)
        continue
      }
      s = { ...s, turn: 2 } // 模拟 AI 接管回合
      const legal = legalActions(s)
      expect(legal.length).toBeGreaterThan(0)
      const a = aiAction(s)
      expect(a).not.toBeNull()
      expect(legal).toContainEqual(a)
      s = reduce(s, a as Action)
      s = reduce(s, { type: 'shoot' })
      asked++
    }
    expect(asked).toBeGreaterThan(0)
    expect(s.shots).toBeGreaterThan(0)
  }, 60000)

  it('AI 非自己回合返回 null，非法阶段候选为空', () => {
    const s = create(5)
    expect(aiAction(s)).toBeNull()
    expect(legalActions(s).length).toBeGreaterThan(0)
    const rolling = reduce(s, { type: 'shoot' })
    expect(legalActions(rolling)).toEqual([])
    expect(aiAction({ ...rolling, turn: 2 })).toBeNull()
  })

  it('双方 AI 对战必然走到终局（不卡死）', () => {
    let s: State = { ...create(777), turn: 2 }
    let guard = 0
    while (!s.over && guard < 800) {
      if (s.phase === 'rolling') {
        s = runToSettle(s)
        continue
      }
      if (s.turn === 1) s = { ...s, turn: 2 } // 模拟双方都由 AI 接管
      const a = aiAction(s)
      expect(a).not.toBeNull()
      s = reduce(s, a as Action)
      s = reduce(s, { type: 'shoot' })
      guard++
    }
    expect(s.over).toBe(true)
    expect(s.winner).not.toBe(0)
    expect(s.shots).toBeLessThanOrEqual(MAX_SHOTS)
  }, 120000)
})

// ------------------------------------------------------------------ 可复现与纯度

describe('可复现与纯度', () => {
  it('同种子同操作序列必得同一局', () => {
    const script: Action[] = [
      { type: 'aim', angle: 0.2, power: 0.8 },
      { type: 'shoot' },
      { type: 'tick', steps: 8 },
      { type: 'tick', steps: 8 },
      { type: 'power', power: 0.5 },
      { type: 'aim', angle: -1.1 },
      { type: 'shoot' },
      { type: 'tick', steps: 8 },
    ]
    const run = () => {
      let s = create(31337)
      for (const a of script) s = reduce(s, a)
      return s
    }
    const a = run()
    const b = run()
    expect(a).toEqual(b)
    expect(create(31337)).toEqual(create(31337))
    expect(create(31337).balls).not.toBe(create(31337).balls)
    // 不同种子只是摆球不同，球体集合一致
    const idsOf = (seed: number) => create(seed).balls.map((b) => b.id).slice().sort((p, q) => p - q)
    expect(idsOf(1)).toEqual(idsOf(2))
  })

  it('reduce 不修改入参（深冻结入参后不抛错、状态不变）', () => {
    const base = create(5150)
    const frozen = deepFreeze(base)
    const snapshot = JSON.stringify(frozen)
    const seq: Action[] = [
      { type: 'aim', angle: 1.4, power: 0.9 },
      { type: 'aimStart', angle: 0.2 },
      { type: 'power', power: 0.7 },
      { type: 'cue', x: 300, y: 500 },
      { type: 'release' },
      { type: 'shoot' },
      { type: 'tick', steps: 8 },
      { type: 'tick', steps: 8 },
      { type: 'tick', steps: 8 },
      { type: 'tick', steps: 8 },
      { type: 'tick', steps: 8 },
    ]
    let s = frozen
    for (const a of seq) s = reduce(s, a)
    expect(JSON.stringify(frozen)).toBe(snapshot)
    expect(s).not.toBe(frozen)
    expect(s.shots).toBe(1)
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.balls)).toBe(true)
    expect(Object.isFrozen(frozen.balls[0])).toBe(true)

    // 已终局时任何 action 都不得改状态
    const over = deepFreeze({ ...create(6), over: true, phase: 'over' as const })
    expect(reduce(over, { type: 'shoot' })).toBe(over)
    expect(reduce(over, { type: 'tick', steps: 4 })).toBe(over)
    expect(reduce(over, { type: 'aim', angle: 1 })).toBe(over)
  })

  it('rules.ts 不含 Math.random / Date / performance / DOM', () => {
    // 用 Vite 的 ?raw 读源码，不依赖 @types/node
    const raw = import.meta.glob('./rules.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const src = raw['./rules.ts'] ?? ''
    expect(src.length).toBeGreaterThan(0)
    expect(src).not.toMatch(/Math\.random/)
    expect(src).not.toMatch(/new Date|Date\.now|performance\./)
    expect(src).not.toMatch(/document\.|window\.|localStorage/)
  })

  it('回合推进只用整数 tick，且 render 层可折算 dt', () => {
    const s = create(8)
    expect(tickAction(0)).toEqual({ type: 'tick', steps: 0 })
    expect(tickAction(TICK_MS)).toEqual({ type: 'tick', steps: 1 })
    expect(tickAction(TICK_MS * 3)).toEqual({ type: 'tick', steps: 3 })
    // 单次 action 推进步数封顶，避免一帧卡顿后瞬移
    expect(tickAction(99999).steps).toBe(MAX_TICK_STEPS)
    expect(Number.isInteger(tickAction(37.4).steps)).toBe(true)
    // 未击球时推进不改变状态
    expect(reduce(s, { type: 'tick', steps: 4 })).toBe(s)
  })
})
