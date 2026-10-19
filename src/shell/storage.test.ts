/**
 * 网页版存储**适配器**的直接测试。
 *
 * `core/storage.ts` 的逻辑另有测试（`src/storage.test.ts`），
 * 这里盯的是**壳层这一层适配器**——它是整个存储路径上唯一有平台差异的地方，
 * 而且这一层目前一行测试都没有（浏览器才有 localStorage，别的测试碰不到它）。
 *
 * 两条要盯住的性质：
 *
 * 1. **真的落到 localStorage 上**。`core/storage.ts` 有一层内存兜底，
 *    所以「读回来有值」**证明不了**写进去了——只读内存也读得到。
 *    必须直接翻 localStorage。
 * 2. **墙上时钟由壳层提供**。`core/` 不碰 `Date`（和 rules.ts 同一条纪律），
 *    `submitBest` 的时间戳是壳层传进去的。漏传或者传 0，纪录就丢了时间。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Outcome } from '../core/types'
import { installLocalBackend, readBest, readJSON, submitBest, writeJSON } from './storage'

/** 假的 localStorage：只实现用到的那两个方法 */
const ls = new Map<string, string>()

function installFakeLocalStorage(): void {
  ;(globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string): string | null => (ls.has(k) ? ls.get(k)! : null),
      setItem: (k: string, v: string): void => {
        ls.set(k, v)
      },
    },
  }
}

function out(score: number, better: 'higher' | 'lower' = 'higher', unit = '分'): Outcome {
  return { score, better, unit }
}

beforeEach(() => {
  ls.clear()
  installFakeLocalStorage()
  // 每条用例前重装后端：`setStorageBackend` 会清空 core/storage 的内存兜底，
  // 「后端换了 = 换了一套存储」，上一条用例的残留不会漏过来。
  installLocalBackend()
})

describe('localStorage 适配器', () => {
  it('写入真的落到 localStorage 上，而不是只留在内存兜底里', () => {
    writeJSON('t/a', { x: 1 })
    expect(ls.get('t/a')).toBe('{"x":1}')
  })

  it('读的是 localStorage 上的值', () => {
    ls.set('t/b', '{"y":2}')
    expect(readJSON('t/b', { y: 0 })).toEqual({ y: 2 })
  })

  it('localStorage 里没有的 key 回落默认值', () => {
    expect(readJSON('t/nope', 'fallback')).toBe('fallback')
  })

  it('submitBest 由壳层提供墙上时钟：纪录带的是真时间戳', () => {
    // core/submitBest 强制要一个 `at` 参数——壳层不给就没有时间。
    // 这里断言它落在「现在」附近，而不是 0 那种占位值。
    const before = Date.now()
    submitBest('t/game', out(42))
    const r = readBest('t/game')
    expect(r?.score).toBe(42)
    expect(r!.at).toBeGreaterThanOrEqual(before)
    expect(r!.at).toBeLessThanOrEqual(Date.now())
  })

  it('纪录落在 localStorage 上，key 是 gs:<gameId>:best', () => {
    submitBest('t/game2', out(7, 'higher', '步'))
    const raw = ls.get('gs:t/game2:best')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw as string)).toMatchObject({ score: 7, unit: '步', better: 'higher' })
  })
})
