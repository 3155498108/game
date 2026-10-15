/**
 * 玩具棒球 · 规则单测（node 环境，无 DOM）。
 */
import { describe, it, expect } from 'vitest'
import {
  create,
  reduce,
  judge,
  windowOpen,
  timingOffset,
  FOUL_HALF,
  FLY_HALF,
  PITCH_TICKS,
  RESULT_HOLD_TICKS,
  TOTAL_PITCHES,
  WINDOW_HALF,
  PERFECT_TICK,
  type State,
} from './rules'

/** 推进一个 tick */
function stepOnce(s: State): State {
  return reduce(s, { type: 'tick', n: 1 })
}

/** 在偏差 offset 处挥棒（offset 为负表示挥早，正数表示挥晚） */
function swingAtOffset(s: State, offset: number): State {
  const target = s.pitch.center + offset
  let cur = s
  let guard = 0
  while (cur.phase === 'pitch' && !cur.pitch.swung && cur.pitch.t < target && guard < PITCH_TICKS * 2) {
    cur = stepOnce(cur)
    guard += 1
  }
  return reduce(cur, { type: 'swing' })
}

/** 完整打一球：给出 offset 则在该时机挥棒，否则一直等到球自然落地 */
function playPitch(s: State, offset: number | null): State {
  if (offset !== null) return swingAtOffset(s, offset)
  let cur = s
  let guard = 0
  while (cur.phase === 'pitch' && guard < PITCH_TICKS * 2) {
    cur = stepOnce(cur)
    guard += 1
  }
  return cur
}

/** 等结果展示结束，进入下一球（返回时若已终局则停在 over） */
function settleAndNext(s: State): State {
  let cur = s
  let guard = 0
  while (cur.phase === 'result' && guard < RESULT_HOLD_TICKS * 2) {
    cur = stepOnce(cur)
    guard += 1
  }
  return cur
}

/** 打一整局：每球都在给定 offset 处挥棒 */
function playGame(seed: number, offset: number): State {
  let cur = create(seed)
  for (let i = 0; i < TOTAL_PITCHES; i++) {
    cur = settleAndNext(playPitch(cur, offset))
  }
  return cur
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    Object.getOwnPropertyNames(v).forEach((k) => deepFreeze((v as Record<string, unknown>)[k]))
    Object.freeze(v)
  }
  return v
}

describe('玩具棒球 · 击球判定', () => {
  it('判定窗口内（非完美）命中为界内安打', () => {
    const s = playPitch(create(7), WINDOW_HALF - 1)
    expect(s.last?.kind).toBe('inPlay')
    expect(s.last?.hits).toBe(1)
    expect(s.hits).toBe(1)
    expect(s.score).toBe(1)
  })

  it('判定窗口两端也判为界内（边界闭合）', () => {
    for (const off of [-WINDOW_HALF, WINDOW_HALF]) {
      expect(judge(off)).toBe('inPlay')
    }
  })

  it('判定窗口外挥棒为界外，且拿不到安打', () => {
    const off = FLY_HALF + 1
    expect(judge(off)).toBe('foul')
    const s = playPitch(create(7), off)
    expect(s.last?.kind).toBe('foul')
    expect(s.hits).toBe(0)
    expect(s.score).toBe(0)
  })

  it('偏离窗口很远则挥棒落空', () => {
    expect(judge(FOUL_HALF + 1)).toBe('miss')
    expect(judge(-(FOUL_HALF + 1))).toBe('miss')
    const s = playPitch(create(3), FOUL_HALF + 1)
    expect(s.last?.kind).toBe('miss')
    expect(s.hits).toBe(0)
  })

  it('完美时机为全垒打', () => {
    const s = playPitch(create(11), 0)
    expect(s.last?.kind).toBe('homeRun')
    expect(s.last?.hits).toBe(2)
    expect(s.score).toBe(3)
  })

  it('早挥与晚挥受罚完全对称', () => {
    for (let d = 0; d <= FOUL_HALF + 3; d++) {
      expect(judge(-d)).toBe(judge(d))
    }
    // 实际推进两局对比分数
    const early = playGame(21, -(WINDOW_HALF + 2))
    const late = playGame(21, WINDOW_HALF + 2)
    expect(early.score).toBe(late.score)
    expect(early.hits).toBe(late.hits)
    expect(early.results.map((r) => r.kind)).toEqual(late.results.map((r) => r.kind))
    expect(early.results.every((r) => r.offset < 0)).toBe(true)
    expect(late.results.every((r) => r.offset > 0)).toBe(true)
  })

  it('挥得越接近中心质量越高（完美 ≤ 界内 ≤ 界外 ≤ 落空）', () => {
    expect(judge(0)).toBe('homeRun')
    expect(judge(PERFECT_TICK)).toBe('homeRun')
    expect(judge(PERFECT_TICK + 1)).toBe('inPlay')
    expect(judge(WINDOW_HALF + 1)).toBe('fly')
    expect(judge(FLY_HALF + 1)).toBe('foul')
    expect(judge(FOUL_HALF + 1)).toBe('miss')
  })

  it('窗口在球进入击球区时才会亮起', () => {
    const s = create(5)
    expect(windowOpen(s)).toBe(false)
    let cur = s
    for (let i = 0; i < cur.pitch.center - WINDOW_HALF; i++) cur = stepOnce(cur)
    expect(timingOffset(cur)).toBe(-WINDOW_HALF)
    expect(windowOpen(cur)).toBe(true)
    cur = stepOnce(cur)
    expect(windowOpen(cur)).toBe(true)
  })
})

describe('玩具棒球 · 计分与终局', () => {
  it('安打数正确累加', () => {
    let cur = create(2)
    for (let i = 0; i < 3; i++) {
      cur = settleAndNext(playPitch(cur, 3))
      expect(cur.hits).toBe(i + 1)
      expect(cur.score).toBe(i + 1)
    }
    expect(cur.results).toHaveLength(3)
  })

  it('没挥棒也算一球', () => {
    const s = playPitch(create(9), null)
    expect(s.last?.kind).toBe('take')
    expect(s.results).toHaveLength(1)
    expect(s.pitchNo).toBe(1)
    expect(s.hits).toBe(0)
    const next = settleAndNext(s)
    expect(next.pitchNo).toBe(2)
    expect(next.phase).toBe('pitch')
  })

  it('10 球后正确终局并结算', () => {
    let cur = create(4)
    for (let i = 0; i < TOTAL_PITCHES; i++) cur = settleAndNext(playPitch(cur, null))
    expect(cur.over).toBe(true)
    expect(cur.phase).toBe('over')
    expect(cur.results).toHaveLength(TOTAL_PITCHES)
    expect(cur.score).toBe(0)
    expect(cur.hits).toBe(0)
  })

  it('全垒打按 2 安打 3 分计入总分', () => {
    let cur = create(6)
    for (let i = 0; i < TOTAL_PITCHES; i++) cur = settleAndNext(playPitch(cur, 0))
    expect(cur.over).toBe(true)
    expect(cur.hits).toBe(TOTAL_PITCHES * 2)
    expect(cur.score).toBe(TOTAL_PITCHES * 3)
  })

  it('终局后动作原样返回入参（引用相等）', () => {
    const over = playGame(8, 0)
    expect(reduce(over, { type: 'swing' })).toBe(over)
    expect(reduce(over, { type: 'tick', n: 10 })).toBe(over)
  })

  it('一球只能挥一次，第二次挥棒被忽略', () => {
    const s = playPitch(create(12), 1)
    expect(s.last?.kind).toBe('homeRun')
    expect(reduce(s, { type: 'swing' })).toBe(s)
  })

  it('单次 tick action 批量推进与逐 tick 推进结果一致', () => {
    let a = create(13)
    let b = create(13)
    a = reduce(a, { type: 'tick', n: 37 })
    for (let i = 0; i < 37; i++) b = stepOnce(b)
    expect(a).toEqual(b)
  })
})

describe('玩具棒球 · 可复现与纯度', () => {
  it('同种子 + 同点击序列必得同一局', () => {
    const a = playGame(2024, 2)
    const b = playGame(2024, 2)
    expect(a).toEqual(b)
    const c = playGame(2025, 2)
    expect(c.results.length).toBe(a.results.length)
    expect(c.score).toBe(a.score)
  })

  it('同种子下逐 tick 推进与批量推进结果一致', () => {
    let a = create(99)
    let b = create(99)
    a = swingAtOffset(a, -4)
    b = swingAtOffset(b, -4)
    a = reduce(a, { type: 'tick', n: 60 })
    b = reduce(b, { type: 'tick', n: 60 })
    expect(a).toEqual(b)
  })

  it('reduce 不修改入参（深冻结后仍可安全推进）', () => {
    const frozen = deepFreeze(create(31))
    const snapshot = JSON.stringify(frozen)
    const swung = swingAtOffset(frozen, 0)
    expect(swung).not.toBe(frozen)
    expect(JSON.stringify(frozen)).toBe(snapshot)
    expect(frozen.results).toHaveLength(0)
    expect(frozen.hits).toBe(0)
    expect(frozen.score).toBe(0)
    // 入参里的嵌套对象也不能被原地改写
    expect(frozen.pitch.swingTick).toBe(-1)
    expect(frozen.pitch.t).toBe(0)
  })

  it('深冻结状态下连打一整局也不会抛错', () => {
    let cur = deepFreeze(create(77))
    for (let i = 0; i < TOTAL_PITCHES; i++) cur = settleAndNext(playPitch(cur, -6))
    expect(cur.over).toBe(true)
    expect(cur.score).toBe(0)
  })
})
