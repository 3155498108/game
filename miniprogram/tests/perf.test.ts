import { describe, expect, it } from 'vitest'

import { installPerfShim, makePerfShim } from '../shell/perf'

describe('小程序 performance 垫片', () => {
  it('没装垫片时共享层会退化成 now() === 0 —— 这正是要修的病根', () => {
    // 网页版 render/anim.ts 的写法：typeof performance !== 'undefined' ? performance.now() : 0
    // 小程序默认没有 performance，于是所有动画时间都停在 0 时刻。
    const bare: { performance?: { now(): number } } = {}
    const fallback = typeof bare.performance !== 'undefined' ? bare.performance.now() : 0
    expect(fallback).toBe(0)
  })

  it('装上之后 performance.now() 可用且不为 undefined', () => {
    const g: { performance?: { now(): number } } = {}
    installPerfShim(g)
    expect(typeof g.performance?.now()).toBe('number')
    expect(Number.isFinite(g.performance!.now())).toBe(true)
  })

  it('不覆盖环境自带的 performance', () => {
    const own = { now: () => 12345 }
    const g: { performance?: { now(): number } } = { performance: own }
    installPerfShim(g)
    expect(g.performance).toBe(own)
    expect(g.performance!.now()).toBe(12345)
  })

  it('墙钟回拨时不倒退（这是用 Date.now 当底座必须补的一层）', () => {
    // 假时钟。注意 makePerfShim 构造时就会先读一次作为基准，
    // 所以序列第一格是被构造消费掉的，别把它当成第一次 now()。
    //   1000 = 构造基准
    //   1100 = 第一次 now()，+100
    //   1050 = 第二次 now()，墙钟回拨，丢弃
    //   1060 = 第三次 now()，+10
    const wall = [1000, 1100, 1050, 1060]
    let i = 0
    const shim = makePerfShim(() => wall[Math.min(i++, wall.length - 1)])

    const a = shim.now()
    const b = shim.now()
    const c = shim.now()

    expect(a).toBe(100)
    expect(b).toBe(100) // 回拨不产生负时长，也不吞掉之前累计的时间
    expect(c).toBe(110)
  })

  it('单调时钟从 0 起算，与 performance.now() 语义一致', () => {
    const shim = makePerfShim(() => 999999)
    expect(shim.now()).toBe(0)
  })
})
