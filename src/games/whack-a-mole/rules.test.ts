import { describe, expect, it } from 'vitest'
import {
  HOLE_COUNT,
  SCORE_PER_HIT,
  TIME_TICKS,
  TICK_MS,
  accuracy,
  create,
  reduce,
  remainingSeconds,
  spawnGap,
  stayTicks,
  step,
  whack,
  type State,
} from './rules'
import game, { controls as gameControls, effects as gameEffects, outcome as gameOutcome } from './index'

/** 场上有地鼠的洞下标，没有则 -1 */
const idx = (s: State): number => s.holes.findIndex((h) => h.mole)

/** 敲掉场上那只地鼠；场上没有地鼠就原样返回 */
function whackMole(s: State): State {
  const i = idx(s)
  return i < 0 ? s : whack(s, i)
}

/**
 * 跑一局脚本，把每次探头（洞号 @ 出现的 tick）记下来。
 * 用来验证「同一个种子 + 同一串操作」必然复现同一局。
 */
function playScript(seed: number): { log: string[]; state: State } {
  const log: string[] = []
  let s = create(seed)
  let seenTick = -1
  for (let i = 0; i < 240; i++) {
    s = step(s, 2)
    const i0 = idx(s)
    if (i0 >= 0) {
      const at = s.holes[i0].appearTick
      if (at !== seenTick) {
        log.push(`${i0}@${at}`)
        seenTick = at
      }
    }
    // 每 5 步敲一次场上那只地鼠
    if (i % 5 === 0) s = whackMole(s)
  }
  return { log, state: s }
}

describe('初始状态', () => {
  it('开局 9 个洞全空、剩余 1200 tick、分数为 0', () => {
    const s = create(42)
    expect(s.holes.length).toBe(HOLE_COUNT)
    expect(s.holes.every((h) => h.mole === false)).toBe(true)
    expect(s.ticksLeft).toBe(1200)
    expect(TIME_TICKS).toBe(1200)
    expect(s.score).toBe(0)
    expect(s.whacks).toBe(0)
    expect(s.misses).toBe(0)
    expect(s.over).toBe(false)
    expect(s.t).toBe(0)
  })

  it('create 对同一 seed 完全一致（可复盘）', () => {
    expect(create(8888)).toEqual(create(8888))
  })

  it('不同 seed 的开局状态结构相同（只有随机游标不同）', () => {
    const a = create(1)
    const b = create(2)
    expect(a.holes).toEqual(b.holes)
    expect(a.ticksLeft).toBe(b.ticksLeft)
    expect(a.rng).not.toBe(b.rng)
  })

  it('rules.ts 不含全局随机数、墙上时钟与 DOM', () => {
    // 用 Vite 的 ?raw 读源码，不依赖 @types/node
    const raw = import.meta.glob('./rules.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const src = raw['./rules.ts'] ?? ''
    expect(src.length).toBeGreaterThan(0)
    for (const bad of ['Math.random', 'new Date', 'Date.now', 'performance.', 'document.', 'window.', 'localStorage']) {
      expect(src, `rules.ts 里出现了 ${bad}`).not.toContain(bad)
    }
  })
})

describe('地鼠的探头与缩回', () => {
  it('推进一个 tick 后恰好有一只地鼠探头', () => {
    const s = step(create(7), 1)
    expect(s.holes.filter((h) => h.mole).length).toBe(1)
    expect(idx(s)).toBeGreaterThanOrEqual(0)
    expect(idx(s)).toBeLessThan(HOLE_COUNT)
  })

  it('地鼠的停留时长初始为 30 tick', () => {
    const s = step(create(7), 1)
    const h = s.holes[idx(s)]
    expect(h.leaveTick - h.appearTick).toBe(30)
    expect(stayTicks(0)).toBe(30)
  })

  it('停留到期后地鼠缩回去', () => {
    const s = step(create(7), 1)
    expect(idx(s)).toBeGreaterThanOrEqual(0)
    const gone = step(s, 30)
    expect(idx(gone)).toBe(-1)
    expect(gone.holes.every((h) => h.mole === false)).toBe(true)
  })

  it('地鼠缩回去后要等够刷新间隔才再探头', () => {
    const s = step(create(7), 1)
    const gone = step(s, 30) // t=31，地鼠缩回
    expect(idx(gone)).toBe(-1)
    const before = step(gone, spawnGap(0) - 1) // t=40，还没到刷新点
    expect(idx(before)).toBe(-1)
    const after = step(before, 1) // t=41，新的地鼠探头
    expect(idx(after)).toBeGreaterThanOrEqual(0)
  })

  it('任何时刻场上最多只有一只地鼠（洞与洞互斥）', () => {
    let s = create(11)
    for (let i = 0; i < 600; i++) {
      s = step(s, 1)
      expect(s.holes.filter((h) => h.mole).length).toBeLessThanOrEqual(1)
      if (i % 7 === 0) s = whackMole(s)
    }
  })
})

describe('敲击', () => {
  it('敲中地鼠 +10 分、敲击数 +1、地鼠立刻消失', () => {
    const s = step(create(3), 1)
    const i = idx(s)
    const n = whack(s, i)
    expect(n.score).toBe(SCORE_PER_HIT)
    expect(n.score).toBe(10)
    expect(n.whacks).toBe(1)
    expect(n.holes[i].mole).toBe(false)
    expect(n.holes[i].whacked).toBe(true)
    expect(idx(n)).toBe(-1)
    expect(n.lastHole).toBe(i)
    expect(n.lastHit).toBe(true)
  })

  it('分数恒等于敲击数 × 10', () => {
    let s = create(5)
    for (let i = 0; i < 20; i++) {
      s = step(s, 6)
      s = whackMole(s)
      expect(s.score).toBe(s.whacks * SCORE_PER_HIT)
    }
  })

  it('同一只地鼠不能重复得分（连敲两次只算一次）', () => {
    const s = step(create(3), 1)
    const i = idx(s)
    const first = whack(s, i)
    const second = whack(first, i)
    expect(first.score).toBe(10)
    expect(first.whacks).toBe(1)
    // 第二下点在的是空坑：不再加分，敲击数也不再涨
    expect(second.score).toBe(10)
    expect(second.whacks).toBe(1)
    expect(second.misses).toBe(1)
  })

  it('敲空的洞记一次失误，不加分', () => {
    const s = step(create(3), 1)
    const i = idx(s)
    const empty = (i + 1) % HOLE_COUNT
    const n = whack(s, empty)
    expect(n.misses).toBe(1)
    expect(n.whacks).toBe(0)
    expect(n.score).toBe(0)
    expect(n.lastHit).toBe(false)
    expect(n.lastHole).toBe(empty)
  })

  it('非法洞号不改变状态', () => {
    const s = step(create(3), 1)
    for (const bad of [-1, HOLE_COUNT, 1.5, Number.NaN]) {
      expect(reduce(s, { type: 'whack', hole: bad })).toBe(s)
    }
  })

  it('敲中后下一次探头被推迟到刷新间隔之后', () => {
    const s = step(create(3), 1)
    const i = idx(s)
    const n = whack(s, i)
    expect(n.nextSpawnTick).toBe(n.t + spawnGap(n.whacks))
    const before = step(n, spawnGap(n.whacks) - 1)
    expect(idx(before)).toBe(-1)
  })
})

describe('限时与终局', () => {
  it('60 秒（1200 tick）后 over 变 true', () => {
    const s = step(create(1), TIME_TICKS)
    expect(s.over).toBe(true)
    expect(s.t).toBe(TIME_TICKS)
  })

  it('到时限时剩余时间为 0，场上的地鼠全部收回', () => {
    const s = step(create(1), TIME_TICKS)
    expect(s.ticksLeft).toBe(0)
    expect(s.holes.every((h) => h.mole === false)).toBe(true)
  })

  it('结束后不再接受 whack（状态不再变化）', () => {
    const over = step(create(1), TIME_TICKS)
    for (let i = 0; i < HOLE_COUNT; i++) {
      expect(reduce(over, { type: 'whack', hole: i })).toBe(over)
    }
    expect(over.whacks).toBe(0)
    expect(over.misses).toBe(0)
    expect(over.score).toBe(0)
  })

  it('结束后 tick 也不再改变状态', () => {
    const over = step(create(1), TIME_TICKS)
    expect(reduce(over, { type: 'tick', ticks: 10 })).toBe(over)
    expect(reduce(over, { type: 'tick', ticks: 0 })).toBe(over)
  })

  it('剩余秒数随 tick 递减', () => {
    const s = step(create(1), 200)
    expect(s.ticksLeft).toBe(1000)
    expect(remainingSeconds(s)).toBe(50)
    expect(TICK_MS).toBe(50)
  })
})

describe('难度曲线', () => {
  it('每敲中 5 只，地鼠停留时间缩短 1 tick', () => {
    expect(stayTicks(0)).toBe(30)
    expect(stayTicks(4)).toBe(30)
    expect(stayTicks(5)).toBe(29)
    expect(stayTicks(10)).toBe(28)
  })

  it('地鼠停留时间有下限 8 tick', () => {
    expect(stayTicks(1000)).toBe(8)
    expect(stayTicks(110)).toBe(8)
  })

  it('每敲中 3 只，刷新间隔缩短 1 tick', () => {
    expect(spawnGap(0)).toBe(10)
    expect(spawnGap(2)).toBe(10)
    expect(spawnGap(3)).toBe(9)
    expect(spawnGap(6)).toBe(8)
  })

  it('刷新间隔有下限 3 tick', () => {
    expect(spawnGap(30)).toBe(3)
    expect(spawnGap(1000)).toBe(3)
  })

  it('敲得越多，地鼠待得越短、刷新越快', () => {
    expect(stayTicks(5)).toBeLessThan(stayTicks(0))
    expect(spawnGap(3)).toBeLessThan(spawnGap(0))
  })
})

describe('命中率与成绩', () => {
  it('命中率 = 敲击数 / (敲击数 + 失误数)', () => {
    const s = step(create(3), 1)
    const hit = whack(s, idx(s))
    const miss = whack(hit, (idx(hit) + 2) % HOLE_COUNT)
    expect(miss.whacks).toBe(1)
    expect(miss.misses).toBe(1)
    expect(accuracy(miss)).toBe(0.5)
  })

  it('一次都没敲时命中率为 0', () => {
    expect(accuracy(create(1))).toBe(0)
  })

  it('命中率在 0 与 1 之间', () => {
    let s = create(9)
    for (let i = 0; i < 30; i++) {
      s = step(s, 4)
      if (i % 2 === 0) s = whackMole(s)
      else s = whack(s, (idx(s) + 3) % HOLE_COUNT)
      expect(accuracy(s)).toBeGreaterThanOrEqual(0)
      expect(accuracy(s)).toBeLessThanOrEqual(1)
    }
  })
})

describe('可复盘性', () => {
  it('同一个 seed + 同一串操作，地鼠出现时刻与分数完全一致', () => {
    const a = playScript(20260913)
    const b = playScript(20260913)
    expect(a.log.length).toBeGreaterThan(3)
    expect(a.log).toEqual(b.log)
    expect(a.state.score).toBe(b.state.score)
    expect(a.state.whacks).toBe(b.state.whacks)
    expect(a.state.misses).toBe(b.state.misses)
    expect(a.state).toEqual(b.state)
  })

  it('不同 seed 的地鼠出现顺序不同', () => {
    const a = playScript(1)
    const b = playScript(2)
    expect(a.log.length).toBeGreaterThan(3)
    expect(b.log.length).toBeGreaterThan(3)
    expect(a.log.join('|')).not.toBe(b.log.join('|'))
  })

  it('reduce 不修改入参', () => {
    const s = step(create(21), 1)
    const holes = s.holes.map((h) => ({ ...h }))
    const rng = s.rng
    const score = s.score
    const n = whack(s, idx(s))
    expect(s.holes).toEqual(holes)
    expect(s.rng).toBe(rng)
    expect(s.score).toBe(score)
    expect(n).not.toBe(s)
  })

  it('tick 0 是不动点', () => {
    const s = step(create(21), 1)
    expect(reduce(s, { type: 'tick', ticks: 0 })).toBe(s)
    expect(reduce(s, { type: 'tick', ticks: -5 })).toBe(s)
  })

  it('非整数 tick 被向下取整', () => {
    const s = reduce(create(21), { type: 'tick', ticks: 2.9 })
    expect(s.t).toBe(2)
  })
})

describe('接线（index.ts）', () => {
  it('outcome：结束前为 null，结束后给出分数与单位', () => {
    expect(gameOutcome(create(1))).toBeNull()
    const over = step(create(1), TIME_TICKS)
    const o = gameOutcome(over)
    expect(o).not.toBeNull()
    expect(o!.score).toBe(over.score)
    expect(o!.better).toBe('higher')
    expect(o!.unit.length).toBeGreaterThan(0)
  })

  it('controls 里有「重开」按钮，且动作能送进 reduce', () => {
    const ctrls = gameControls(create(1))
    expect(ctrls.length).toBeGreaterThan(0)
    expect(ctrls[0].label).toBe('重开')
    const s = step(create(1), 100)
    const next = game.reduce(s, ctrls[0].action)
    expect(next.t).toBe(0)
    expect(next.whacks).toBe(0)
    expect(next.over).toBe(false)
  })

  it('敲中时 effects 给出粒子与音效，点空只给音效', () => {
    const s = step(create(9), 1)
    const hit = whack(s, idx(s))
    const hitFx = gameEffects(s, hit)
    expect(hitFx.some((f) => f.kind === 'burst')).toBe(true)
    expect(hitFx.some((f) => f.kind === 'sound')).toBe(true)
    const miss = whack(s, (idx(s) + 1) % HOLE_COUNT)
    const missFx = gameEffects(s, miss)
    expect(missFx.some((f) => f.kind === 'burst')).toBe(false)
    expect(missFx.some((f) => f.kind === 'sound')).toBe(true)
  })

  it('游戏模块装配完整：meta、视口与 tick 都在', () => {
    expect(game.id).toBe('whack-a-mole')
    expect(game.viewport).toEqual({ width: 720, height: 1280 })
    expect(typeof game.tick).toBe('function')
    expect(typeof game.input).toBe('function')
    expect(game.hint?.(create(1)).length).toBeGreaterThan(0)
  })
})
