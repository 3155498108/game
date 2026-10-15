/** 射靶规则单测（纯逻辑，node 环境） */
import { describe, expect, it } from 'vitest'
import {
  FIELD,
  RING_COUNT,
  RING_SCORES,
  TIME_TICKS,
  accuracy,
  create,
  fire,
  hitRing,
  levelOf,
  lifeFor,
  radiusFor,
  ringScore,
  step,
  type State,
} from './rules'

/** 在靶心沿 +x 偏移 ratio × 半径处开一枪（ratio ∈ [0,1] 表示环内位置） */
function shootAtRatio(seed: number, ratio: number): State {
  const s = create(seed)
  const t = s.target!
  return fire(s, t.x + t.r * ratio, t.y)
}

describe('射靶 · 各环分值', () => {
  it('各环分值正确：越靠靶心分数越高，靶心最高', () => {
    expect(shootAtRatio(7, 0.1).score).toBe(100) // 靶心 4 环
    expect(shootAtRatio(7, 0.4).score).toBe(50) // 3 环
    expect(shootAtRatio(7, 0.6).score).toBe(20) // 2 环
    expect(shootAtRatio(7, 0.9).score).toBe(10) // 最外 1 环
  })

  it('环号判定与分值表一一对应，且靶心为最高分', () => {
    expect(RING_COUNT).toBe(4)
    expect(RING_SCORES[0]).toBeLessThan(RING_SCORES[1])
    expect(RING_SCORES[1]).toBeLessThan(RING_SCORES[2])
    expect(RING_SCORES[2]).toBeLessThan(RING_SCORES[3])
    expect(RING_SCORES[RING_COUNT - 1]).toBe(Math.max(...RING_SCORES))
    expect(ringScore(0)).toBe(0)
    expect(ringScore(99)).toBe(0)
    for (let ring = 1; ring <= RING_COUNT; ring++) expect(ringScore(ring)).toBe(RING_SCORES[ring - 1])
  })

  it('靶心一点命中得 100 分且靶子随即消失', () => {
    const s = shootAtRatio(11, 0)
    expect(s.score).toBe(100)
    expect(s.hits).toBe(1)
    expect(s.target).toBeNull()
    expect(s.last).toEqual({ x: expect.any(Number), y: expect.any(Number), ring: 4, points: 100, hit: true })
  })
})

describe('射靶 · 未命中', () => {
  it('越界点击不命中，只记一次发射', () => {
    const s0 = create(3)
    const t = s0.target!
    const far = t.x + t.r + 30
    const s1 = fire(s0, far, t.y)
    expect(s1.last).toEqual({ x: far, y: t.y, ring: 0, points: 0, hit: false })
    expect(s1.hits).toBe(0)
    expect(s1.shots).toBe(1)
    expect(s1.score).toBe(0)
    expect(s1.target).not.toBeNull() // 打空不清除靶子
  })

  it('距离大于半径时环号为 0', () => {
    expect(hitRing(100, 100, 0, 0, 50)).toBe(0)
    expect(hitRing(0, 0, 0, 0, 50)).toBe(4)
  })

  it('没有靶子时开火不命中', () => {
    const s0 = create(5)
    const t0 = s0.target!
    const s1 = fire(s0, t0.x, t0.y) // 打掉靶子
    expect(s1.hits).toBe(1)
    expect(s1.target).toBeNull()
    const s2 = fire(s1, 360, 640) // 空档期开火
    expect(s2.hits).toBe(1)
    expect(s2.shots).toBe(2)
    expect(s2.last?.hit).toBe(false)
  })
})

describe('射靶 · 靶子停留与难度', () => {
  it('停留 tick 耗尽后靶子消失', () => {
    const s0 = create(9)
    const life = s0.target!.life
    expect(life).toBe(lifeFor(levelOf(1)))
    const s1 = step(s0, life)
    expect(s1.target).toBeNull()
    expect(s1.t).toBe(life)
  })

  it('下一个 tick 会生成新靶子，且难度随时间收紧', () => {
    const s0 = create(9)
    const s1 = step(s0, s0.target!.life + 1)
    expect(s1.target).not.toBeNull()
    expect(s1.spawned).toBe(2)
    expect(levelOf(2)).toBeGreaterThanOrEqual(0)
    expect(radiusFor(levelOf(40))).toBeLessThan(radiusFor(levelOf(0)))
    expect(lifeFor(levelOf(40))).toBeLessThan(lifeFor(levelOf(0)))
  })

  it('生成的新靶子始终完整落在场地内', () => {
    let s = create(21)
    for (let i = 0; i < 200; i++) {
      s = step(s, 3)
      const t = s.target
      if (!t) continue
      expect(t.x - t.r).toBeGreaterThanOrEqual(FIELD.left - 1)
      expect(t.x + t.r).toBeLessThanOrEqual(FIELD.right + 1)
      expect(t.y - t.r).toBeGreaterThanOrEqual(FIELD.top - 1)
      expect(t.y + t.r).toBeLessThanOrEqual(FIELD.bottom + 1)
      expect(Number.isInteger(t.life)).toBe(true)
      expect(t.life).toBeGreaterThan(0)
    }
  })
})

describe('射靶 · 发射与命中统计', () => {
  it('发射次数与命中次数统计正确，命中率随之可算', () => {
    const s0 = create(13)
    const t0 = s0.target!
    const s1 = fire(s0, t0.x, t0.y) // 命中
    expect(s1.shots).toBe(1)
    expect(s1.hits).toBe(1)
    expect(accuracy(s1)).toBe(1)

    const s2 = fire(s1, 5, 5) // 打空
    expect(s2.shots).toBe(2)
    expect(s2.hits).toBe(1)
    expect(accuracy(s2)).toBe(0.5)

    const s2b = step(s2, 1) // 下一 tick 生成新靶
    const t2 = s2b.target!
    expect(t2).not.toBeNull()
    const s3 = fire(s2b, t2.x, t2.y) // 再命中
    expect(s3.shots).toBe(3)
    expect(s3.hits).toBe(2)
    expect(s3.score).toBe(200)
    expect(accuracy(s3)).toBeCloseTo(2 / 3, 10)

    expect(accuracy(create(13))).toBe(0) // 未发射时命中率为 0
  })

  it('连中两靶分数累加', () => {
    const s0 = create(13)
    const t0 = s0.target!
    const s1 = fire(s0, t0.x + t0.r * 0.6, t0.y) // 2 环 20 分
    const t1 = step(s1, 1).target!
    const s2 = fire({ ...s1, target: t1 }, t1.x + t1.r * 0.1, t1.y) // 4 环 100 分
    expect(s2.score).toBe(120)
    expect(s2.seq).toBe(2)
  })
})

describe('射靶 · 60 秒终局', () => {
  it('tick 耗尽后正确终局并能算出命中率', () => {
    let s = create(17)
    const t0 = s.target!
    s = fire(s, t0.x, t0.y) // 命中一次
    const s1 = step(s, TIME_TICKS)
    expect(s1.over).toBe(true)
    expect(s1.t).toBe(TIME_TICKS)
    expect(s1.target).toBeNull()
    expect(s1.shots).toBe(1)
    expect(s1.hits).toBe(1)
    expect(accuracy(s1)).toBe(1)
  })

  it('终局后拒绝射击且状态不再变化', () => {
    const over = step(create(17), TIME_TICKS)
    const after = fire(over, 360, 640)
    expect(after).toBe(over)
    expect(step(over, 100)).toBe(over)
    expect(over.shots).toBe(0)
    expect(over.hits).toBe(0)
    expect(accuracy(over)).toBe(0)
  })

  it('多次小步推进与一次性推进等价', () => {
    const a = step(create(23), TIME_TICKS)
    let b = create(23)
    for (let i = 0; i < 8; i++) b = step(b, TIME_TICKS / 8)
    expect(a.t).toBe(b.t)
    expect(a.over).toBe(b.over)
    expect(a.target).toBeNull()
  })

  it('0 或负数 tick 不推进时间', () => {
    const s0 = create(29)
    expect(step(s0, 0)).toBe(s0)
    expect(step(s0, -5)).toBe(s0)
    expect(step(s0, 0.5).t).toBe(0)
  })
})

describe('射靶 · 可复现与纯度', () => {
  it('同种子 + 同操作序列必得同一局', () => {
    const play = (seed: number): State => {
      let s = create(seed)
      s = step(s, 4)
      const t = s.target!
      s = fire(s, t.x + 6, t.y)
      s = step(s, 20)
      s = fire(s, 12, 34)
      s = step(s, 300)
      return s
    }
    expect(play(2024)).toEqual(play(2024))
    expect(play(2024)).not.toEqual(play(2025))
  })

  it('reduce 不修改入参', () => {
    const s0 = create(31)
    const before = JSON.stringify(s0)
    const s1 = fire(s0, s0.target!.x, s0.target!.y)
    expect(JSON.stringify(s0)).toBe(before)
    const before1 = JSON.stringify(s1)
    step(s1, 50)
    expect(JSON.stringify(s1)).toBe(before1)
  })
})
