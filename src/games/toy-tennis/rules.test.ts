/**
 * 玩具网球规则单测（node 环境，无 DOM）
 * 覆盖：边界反弹 / 球速递增与上限 / 漏接出界得分 / 先得 7 分终局 /
 *      AI 动作合法性 / 双方 AI 必然终局 / 单步耗时 / 同种子复现 / reduce 不改入参
 */
import { describe, expect, it } from 'vitest'
import {
  AI_Y,
  BALL_R,
  FIELD_H,
  FIELD_W,
  MAX_RALLY_HITS,
  MAX_SPEED,
  PADDLE_MAX,
  PADDLE_W,
  PLAYER_Y,
  SIDE_WALL,
  TARGET_SCORE,
  aiAction,
  bestActionFor,
  create,
  isLegal,
  legalActions,
  reduce,
  speedOf,
} from './rules'
import type { Action, State } from './rules'

/** 造一个正在 play 的对局状态 */
function playing(over: Partial<State>): State {
  return { ...create(1), phase: 'play', serveTicks: 0, ...over }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as unknown as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

describe('玩具网球 · 规则', () => {
  it('球在中场撞侧边围墙会反弹且不会穿墙', () => {
    const s = playing({ bx: 40, by: 640, bvx: -8, bvy: 3, px: 360, ax: 360 })
    const next = reduce(s, { type: 'tick', steps: 1 })
    // 撞墙后水平速度反向
    expect(next.bvx).toBe(8)
    // 位置被推回墙内
    expect(next.bx).toBeGreaterThanOrEqual(SIDE_WALL + BALL_R)
    expect(next.by).toBeGreaterThan(640)
  })

  it('球速随回合递增且有上限', () => {
    expect(speedOf(0)).toBeCloseTo(7, 6)
    expect(speedOf(1)).toBeGreaterThan(speedOf(0))
    for (let i = 1; i <= MAX_RALLY_HITS; i++) {
      expect(speedOf(i)).toBeGreaterThanOrEqual(speedOf(i - 1))
    }
    // 上限封顶，不会无限变快
    expect(speedOf(MAX_RALLY_HITS + 50)).toBe(MAX_SPEED)
    expect(speedOf(10000)).toBe(MAX_SPEED)

    // 端到端：接一次球后速度正好等于下一档球速
    const s = playing({ bx: 360, by: PLAYER_Y - 5, bvx: 0, bvy: 8, px: 360, ax: 360 })
    const next = reduce(s, { type: 'tick', steps: 1 })
    expect(next.rally).toBe(1)
    expect(next.lastHitter).toBe(0)
    expect(Math.hypot(next.bvx, next.bvy)).toBeCloseTo(speedOf(1), 6)
  })

  it('玩家漏接则电脑得分', () => {
    const s = playing({ bx: 100, by: PLAYER_Y - 5, bvx: 0, bvy: 8, px: 620, ax: 360 })
    const missed = reduce(s, { type: 'tick', steps: 1 })
    expect(missed.missed).toBe(0) // 玩家漏接，球继续往后场飞
    expect(missed.scoreA).toBe(0)

    const after = reduce(missed, { type: 'tick', steps: 40 })
    expect(after.lastReason).toBe('miss')
    expect(after.scoreA).toBe(1)
    expect(after.scoreP).toBe(0)
    expect(after.phase).toBe('serve') // 回到发球等待
    expect(after.serveTicks).toBeGreaterThan(0)
  })

  it('球飞出边线算出界，同样让对手得分', () => {
    const s = playing({ bx: FIELD_W - 20, by: 1160, bvx: 12, bvy: 2, px: 360, ax: 360 })
    const after = reduce(s, { type: 'tick', steps: 2 })
    expect(after.lastReason).toBe('out')
    expect(after.scoreA).toBe(1)
    expect(after.phase).toBe('serve')
  })

  it('先得 7 分者获胜，正确终局', () => {
    // 电脑拿第 7 分
    let a = playing({ scoreP: 3, scoreA: 6, bx: 100, by: PLAYER_Y - 5, bvx: 0, bvy: 8, px: 620, ax: 360 })
    a = reduce(a, { type: 'tick', steps: 60 })
    expect(a.phase).toBe('over')
    expect(a.scoreA).toBe(TARGET_SCORE)
    expect(a.winner).toBe(1)

    // 玩家拿第 7 分
    let b = playing({ scoreP: 6, scoreA: 2, bx: 100, by: AI_Y + 5, bvx: 0, bvy: -8, px: 360, ax: 620 })
    b = reduce(b, { type: 'tick', steps: 60 })
    expect(b.phase).toBe('over')
    expect(b.scoreP).toBe(TARGET_SCORE)
    expect(b.winner).toBe(0)

    // 终局后不再推进
    const done = reduce(b, { type: 'tick', steps: 30 })
    expect(done).toEqual(b)
  })

  it('AI 每一步都只从 legalActions 里选，且是合法手', () => {
    let s = create(2024)
    let steps = 0
    while (steps < 400) {
      const a: Action | null = aiAction(s)
      if (a === null) break
      expect(legalActions(s, 1)).toContainEqual(a)
      expect(isLegal(s, a)).toBe(true)
      s = reduce(s, a)
      s = reduce(s, { type: 'tick', steps: 1 })
      steps++
    }
    expect(steps).toBeGreaterThan(10)
  })

  it('双方 AI 对战必然走到终局并分出胜负（不卡死）', () => {
    let s = create(77)
    let guard = 0
    while (s.phase !== 'over' && guard < 200_000) {
      const p = bestActionFor(s, 0)
      if (p) s = reduce(s, p)
      const c = bestActionFor(s, 1)
      if (c) s = reduce(s, c)
      s = reduce(s, { type: 'tick', steps: 1 })
      guard++
    }
    expect(s.phase).toBe('over')
    expect(s.winner === 0 || s.winner === 1).toBe(true)
    expect(Math.max(s.scoreP, s.scoreA)).toBe(TARGET_SCORE)
    expect(guard).toBeLessThan(200_000)
  })

  it('AI 单步耗时实测远小于 50ms', () => {
    const s = playing({ bx: 300, by: 900, bvx: 6, bvy: -7, px: 360, ax: 200 })
    let worst = 0
    const N = 400
    for (let i = 0; i < N; i++) {
      const t0 = performance.now()
      aiAction(s)
      const d = performance.now() - t0
      if (d > worst) worst = d
    }
    // eslint-disable-next-line no-console
    console.log(`[toy-tennis] aiAction 最坏单步耗时 ${worst.toFixed(4)}ms（${N} 次采样）`)
    expect(worst).toBeLessThan(50)
  })

  it('同种子 + 同操作序列完全复现', () => {
    const run = (seed: number): string => {
      let s = create(seed)
      for (let i = 0; i < 4000 && s.phase !== 'over'; i++) {
        const a = bestActionFor(s, (i % 2 === 0 ? 0 : 1) as 0 | 1)
        if (a) s = reduce(s, a)
        s = reduce(s, { type: 'tick', steps: 1 })
      }
      return JSON.stringify(s)
    }
    const a = run(123)
    expect(run(123)).toBe(a)
    expect(run(124)).not.toBe(a)
  })

  it('reduce 不修改入参（深冻结后依然可用）', () => {
    const frozen = deepFreeze(playing({ bx: 300, by: 900, bvx: -9, bvy: 8, px: 360, ax: 360, scoreP: 2, scoreA: 3 }))
    const before = JSON.stringify(frozen)
    const actions: Action[] = [
      { type: 'tick', steps: 5 },
      { type: 'move', side: 0, dir: -1 },
      { type: 'move', side: 1, dir: 1 },
      { type: 'seek', x: 120 },
      { type: 'serve' },
      aiAction(frozen) as Action,
    ]
    for (const a of actions) {
      expect(() => reduce(frozen, a)).not.toThrow()
    }
    expect(JSON.stringify(frozen)).toBe(before)
  })

  it('球拍被限制在场地内，非法动作不改状态', () => {
    let s = create(5)
    for (let i = 0; i < 200; i++) s = reduce(s, { type: 'move', side: 0, dir: -1 })
    expect(s.px).toBeGreaterThanOrEqual(SIDE_WALL)
    expect(s.px).toBeLessThanOrEqual(PADDLE_MAX)
    expect(reduce(s, { type: 'move', side: 0, dir: 5 } as unknown as Action)).toBe(s)
    expect(reduce(s, { type: 'seek', x: Number.NaN })).toBe(s)
    expect(legalActions(s, 0)).toHaveLength(3)
    expect(PADDLE_W).toBeGreaterThan(0)
    expect(FIELD_W).toBeGreaterThan(0)
    expect(FIELD_H).toBeGreaterThan(PLAYER_Y)
  })
})
