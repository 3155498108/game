/**
 * `wx.*StorageSync` 后端适配器。
 *
 * **逻辑在 `core/storage.ts`**，网页版与小程序版逐字节共享；
 * 这里只负责两件事：把微信存储接上去、把墙上时钟接上去。
 *
 * 刻意**继续存 JSON 字符串**而不是直接存对象：小程序其实支持直接存对象，
 * 但 `core/storage.ts` 的 `readJSON` 是按「字符串 + JSON.parse + 损坏回落」写的。
 * 保持同一套读写形态，两边的容错行为（解析失败回落默认值）才一致，
 * 存档被外部改坏时也不会因为两端处理方式不同而表现不同。
 */
import type { Outcome } from '../core/types'
import { setStorageBackend, submitBest as coreSubmitBest } from '../core/storage'

export { readJSON, writeJSON, bestKey, readBest, formatBest } from '../core/storage'
export type { BestRecord } from '../core/storage'

/**
 * 把 wx 存储接上去。
 *
 * 单独抽成函数是为了**能重装**：`setStorageBackend` 会清空 `core/storage` 的内存兜底，
 * 「后端换了 = 换了一套存储」。测试因此可以在每条用例前重装一次后端，
 * 上一条用例写进去的值就不会漏到下一条。
 */
export function installWxBackend(): void {
  setStorageBackend({
    get: (k) => {
      const v = wx.getStorageSync(k)
      return typeof v === 'string' ? v : ''
    },
    set: (k, v) => {
      wx.setStorageSync(k, v)
    },
  })
}

installWxBackend()

/** 纪录时间戳由壳层给：core/ 不读墙上时钟 */
export function submitBest(gameId: string, o: Outcome): boolean {
  return coreSubmitBest(gameId, o, Date.now())
}
