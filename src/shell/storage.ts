/**
 * localStorage 后端适配器。
 *
 * **逻辑在 `core/storage.ts`**，网页版与小程序版逐字节共享；
 * 这里只负责两件事：把 `localStorage` 接上去、把墙上时钟接上去。
 */
import type { Outcome } from '../core/types'
import { setStorageBackend, submitBest as coreSubmitBest } from '../core/storage'

export { readJSON, writeJSON, bestKey, readBest, formatBest } from '../core/storage'
export type { BestRecord } from '../core/storage'

/**
 * 把 localStorage 接上去。
 *
 * 单独抽成函数是为了**能重装**：`setStorageBackend` 会清空 `core/storage` 的内存兜底，
 * 「后端换了 = 换了一套存储」。测试因此可以在每条用例前重装一次后端，
 * 上一条用例写进去的值就不会漏到下一条。
 */
export function installLocalBackend(): void {
  setStorageBackend({
    get: (k) => window.localStorage.getItem(k) ?? '',
    set: (k, v) => window.localStorage.setItem(k, v),
  })
}

installLocalBackend()

/** 纪录时间戳由壳层给：core/ 不读墙上时钟 */
export function submitBest(gameId: string, o: Outcome): boolean {
  return coreSubmitBest(gameId, o, Date.now())
}
