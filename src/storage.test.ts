/**
 * `core/storage.ts` 的直接测试。
 *
 * 这个模块是**两端共享**的（网页版与小程序版逐字节相同），
 * 所以它不能依赖任何平台 API——存储后端由壳层注入，时间戳由调用方传进来。
 *
 * 特别要盯住的是**内存兜底**：隐私模式、配额满、存储被禁用时，
 * 持久层会抛异常，但存档不该因此整个丢掉。
 * 这条行为以前只存在于网页版的 `shell/storage.ts` 里，小程序版没有——
 * 逻辑搬进 `core/` 之后，两端**都**有它了。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Outcome } from './core/types'
import {
  bestKey,
  formatBest,
  readBest,
  readJSON,
  setStorageBackend,
  submitBest,
  writeJSON,
} from './core/storage'

/** 一个正常的持久层 */
function memBackend(): Map<string, string> {
  const m = new Map<string, string>()
  setStorageBackend({
    get: (k) => m.get(k) ?? '',
    set: (k, v) => {
      m.set(k, v)
    },
  })
  return m
}

/** 一个会抛异常的后端，模拟隐私模式 / 配额满 */
function brokenBackend(): void {
  setStorageBackend({
    get: () => {
      throw new Error('隐私模式')
    },
    set: () => {
      throw new Error('配额已满')
    },
  })
}

/**
 * 一个「先好用、后来开始抛异常」的持久层。
 *
 * 为什么要单独造一个：**内存兜底要救的正是这种场景**——
 * 玩家已经玩了一会儿，存档写进去了，这时浏览器突然进入隐私模式 / 配额满了，
 * 读的时候开始抛异常，这时候应该还能读到之前写下的值。
 *
 * 注意这跟「换一个后端」是两回事：后端没换，只是它开始出问题了。
 */
function flakyBackend(): { broken: boolean; m: Map<string, string> } {
  const api = { broken: false, m: new Map<string, string>() }
  setStorageBackend({
    get: (k) => {
      if (api.broken) throw new Error('突然进入隐私模式')
      return api.m.get(k) ?? ''
    },
    set: (k, v) => {
      if (api.broken) throw new Error('配额已满')
      api.m.set(k, v)
    },
  })
  return api
}

function out(score: number, better: 'higher' | 'lower' = 'higher', unit = '分'): Outcome {
  return { score, better, unit }
}

beforeEach(() => {
  memBackend()
})

describe('JSON 读写', () => {
  it('正常存档原样读回', () => {
    writeJSON('t/a', { x: 1, y: 'z' })
    expect(readJSON('t/a', { x: 0, y: '' })).toEqual({ x: 1, y: 'z' })
  })

  it('key 不存在时回落默认值', () => {
    expect(readJSON('t/nope', 'fallback')).toBe('fallback')
  })

  it('坏 JSON 回落默认值，不抛错', () => {
    const m = memBackend()
    m.set('t/bad', '{ 这不是 JSON')
    expect(readJSON('t/bad', 'fallback')).toBe('fallback')
  })

  it('存进去 null 回落默认值', () => {
    writeJSON('t/null', null)
    expect(readJSON('t/null', 'fallback')).toBe('fallback')
  })

  it('持久层抛异常时回落到内存，存档不丢', () => {
    brokenBackend()
    writeJSON('t/priv', { v: 42 })
    expect(readJSON('t/priv', { v: 0 })).toEqual({ v: 42 })
  })

  it('持久层抛异常时读旧值也走内存', () => {
    // 注意：内存兜底只装**经 writeJSON 写过的**值。
    // 直接往后端 Map 里塞不算——那绕过了 rawSet，内存层根本没这一份。
    const api = flakyBackend()
    writeJSON('t/old', 'kept')
    // 后端没换，只是它开始抛异常了——这正是兜底要救的场景
    api.broken = true
    expect(readJSON('t/old', 'fallback')).toBe('kept')
  })

  it('换后端 = 换一套存储：内存兜底跟着一起清空', () => {
    // 这是 `setStorageBackend` 清空内存兜底的理由。
    //
    // 反例很具体：小程序测试里清掉了 wx 存储（模拟「玩家清了缓存」），
    // 但内存兜底里还留着上一条用例写下的旧余额，
    // 于是「持久层说没有、内存说有」，读回来的是陈的值。
    //
    // 后端换了 = 存储换了 = 兜底的那一份也该跟着换。
    writeJSON('t/swap', 'old')
    memBackend()
    expect(readJSON('t/swap', 'fallback')).toBe('fallback')
  })
})

describe('最佳纪录', () => {
  it('key 规范是 gs:<gameId>:best', () => {
    expect(bestKey('maze')).toBe('gs:maze:best')
  })

  it('没有纪录时返回 null', () => {
    expect(readBest('t/none')).toBeNull()
  })

  it('成绩非法时当作没有纪录', () => {
    const m = memBackend()
    m.set(bestKey('t/bad'), JSON.stringify({ score: '不是数字', unit: '分' }))
    expect(readBest('t/bad')).toBeNull()
    m.set(bestKey('t/nan'), JSON.stringify({ score: Number.NaN, unit: '分' }))
    expect(readBest('t/nan')).toBeNull()
  })

  it('越大越好：更高分才刷新', () => {
    expect(submitBest('t/high', out(10), 1)).toBe(true)
    expect(submitBest('t/high', out(20), 2)).toBe(true)
    expect(submitBest('t/high', out(15), 3)).toBe(false)
    expect(readBest('t/high')?.score).toBe(20)
  })

  it('越小越好：更小分才刷新', () => {
    expect(submitBest('t/low', out(30, 'lower'), 1)).toBe(true)
    expect(submitBest('t/low', out(20, 'lower'), 2)).toBe(true)
    expect(submitBest('t/low', out(25, 'lower'), 3)).toBe(false)
    expect(readBest('t/low')?.score).toBe(20)
  })

  it('纪录带时间戳与单位', () => {
    submitBest('t/stamp', out(7, 'higher', '步'), 123456)
    const r = readBest('t/stamp')
    expect(r?.at).toBe(123456)
    expect(r?.unit).toBe('步')
    expect(r?.better).toBe('higher')
  })

  it('展示文案', () => {
    expect(formatBest(null)).toBe('暂无纪录')
    expect(formatBest({ score: 42, unit: '分', better: 'higher', at: 0 })).toBe('最佳 42分')
  })
})

describe('core/ 的纪律：不碰墙上时钟、不碰 DOM', () => {
  const raw = import.meta.glob('./core/storage.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const src = raw['./core/storage.ts'] ?? ''

  /** 剥掉注释再扫：这个文件的文档注释里就写着「不碰 DOM 与全局存储」 */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1')

  it('源码读到了', () => {
    expect(src.length).toBeGreaterThan(0)
  })

  it('不读 Date —— 时间戳由调用方传进来', () => {
    expect(code).not.toMatch(/Date\.now|new Date/)
  })

  it('不碰 DOM 与全局存储', () => {
    expect(code).not.toMatch(/document\.|window\.|localStorage/)
  })
})
