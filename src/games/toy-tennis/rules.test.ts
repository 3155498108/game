/**
 * 玩具网球规则单测（node 环境，无 DOM）
 * 覆盖：边界反弹 / 球速递增与上限 / 漏接出界得分 / 先得 7 分终局 /
 *      AI 动作合法性 / AI 追球与持续对拉（回归）/ 出界归属 /
 *      双方 AI 必然终局 / 单步耗时 / 同种子复现 / reduce 不改入参
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

  it('球被接住后 missed 回到 null（回归：曾写成 0，AI 落点预测从此永久失效）', () => {
    // 击球只代表「球还在飞」，不代表哪一方漏接了。
    // 一旦这里写回 0，landingX 的 `missed !== null` 就会永远成立，
    // 电脑球拍会退回中线从此不再追球 —— 表现为「只有发球会动，之后不动了」。
    const playerHit = reduce(playing({ bx: 360, by: PLAYER_Y - 5, bvx: 0, bvy: 7, rally: 2 }), {
      type: 'tick',
      steps: 1,
    })
    expect(playerHit.rally).toBe(3)
    expect(playerHit.lastHitter).toBe(0)
    expect(playerHit.missed).toBeNull()
    expect(playerHit.bvy).toBeLessThan(0) // 打回去是往上的

    const aiHit = reduce(playing({ bx: 360, by: AI_Y + 5, bvx: 0, bvy: -7, rally: 2 }), {
      type: 'tick',
      steps: 1,
    })
    expect(aiHit.rally).toBe(3)
    expect(aiHit.lastHitter).toBe(1)
    expect(aiHit.missed).toBeNull()
    expect(aiHit.bvy).toBeGreaterThan(0) // 打回去是往下的
  })

  it('AI 会真的追球：斜向来球时球拍离开中线并把球打回去（回归：曾 400 帧全是 dir 0）', () => {
    let s = playing({ bx: 360, by: 620, bvx: -6, bvy: -7, px: 360, ax: 360 })
    const startAx = s.ax
    let moved = 0
    let excursion = 0
    let hitBack = false
    for (let i = 0; i < 90 && s.phase === 'play'; i++) {
      const a = aiAction(s)
      if (a) {
        const n = reduce(s, a)
        if (n !== s) moved++
        s = n
      }
      excursion = Math.max(excursion, Math.abs(s.ax - startAx))
      const rallyBefore = s.rally
      s = reduce(s, { type: 'tick', steps: 1 })
      if (s.rally > rallyBefore && s.lastHitter === 1) hitBack = true
    }
    expect(moved).toBeGreaterThan(3)
    // 球拍确实被吸引到了预测落点附近，而不是钉在中线
    expect(excursion).toBeGreaterThan(100)
    expect(hitBack).toBe(true)
    // 打回去之后球是往下的（bvy > 0），不是原地卡住
    expect(s.bvy).toBeGreaterThan(0)
  })

  it('一整局里 AI 会反复击球，而不是只在发球时动一下', () => {
    let s = create(31337)
    let aiHits = 0
    let guard = 0
    while (s.phase !== 'over' && guard++ < 60_000) {
      const before = s.rally
      const a = aiAction(s)
      if (a) s = reduce(s, a)
      s = reduce(s, { type: 'tick', steps: 1 })
      if (s.rally > before && s.lastHitter === 1) aiHits++
      // 玩家是超人：每帧贴住球
      s = reduce(s, { type: 'seek', x: s.bx })
    }
    expect(s.phase).toBe('over')
    expect(aiHits).toBeGreaterThanOrEqual(5)
  })

  it('出界判给「球飞出去的那一侧」丢分，而不是永远判玩家输（回归：随 missed 一起坏掉）', () => {
    // 球还在电脑这半场上方就已经飞出左边线 → 电脑丢分，玩家得分
    const aiOut = reduce(playing({ bx: 5, by: 100, bvx: -9, bvy: -6, px: 360, ax: 200, rally: 3 }), {
      type: 'tick',
      steps: 1,
    })
    expect(aiOut.phase).toBe('serve')
    expect(aiOut.lastReason).toBe('out')
    expect(aiOut.scoreP).toBe(1)
    expect(aiOut.scoreA).toBe(0)

    // 对称地：球在玩家这半场飞出右边线 → 玩家丢分
    const pOut = reduce(playing({ bx: 715, by: 900, bvx: 9, bvy: 6, px: 200, ax: 360, rally: 3 }), {
      type: 'tick',
      steps: 1,
    })
    expect(pOut.phase).toBe('serve')
    expect(pOut.lastReason).toBe('out')
    expect(pOut.scoreP).toBe(0)
    expect(pOut.scoreA).toBe(1)
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
