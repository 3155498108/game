/** 存档：localStorage → wx.storage。逻辑与网页版一致，只换后端 */
import type { Outcome } from '../core/types'

/**
 * 小程序没有 `localStorage`，存储 API 是 `wx.getStorageSync` / `wx.setStorageSync`。
 *
 * 这里刻意**继续存 JSON 字符串**而不是直接存对象：小程序其实支持直接存对象，
 * 但网页版的 `readJSON` 是按「字符串 + JSON.parse + 损坏回落」写的。
 * 保持同一套读写形态，两边的容错行为（解析失败回落默认值）才一致，
 * 存档被外部改坏时也不会因为两端处理方式不同而表现不同。
 */
function rawGet(key: string): string {
  try {
    const v = wx.getStorageSync(key)
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

function rawSet(key: string, value: string): void {
  try {
    wx.setStorageSync(key, value)
  } catch {
    /* 配额满 / 存储不可用：静默忽略，游戏本身不依赖存档 */
  }
}

export function readJSON<T>(key: string, fallback: T): T {
  const raw = rawGet(key)
  if (raw === '') return fallback
  try {
    const v = JSON.parse(raw) as unknown
    return (v ?? fallback) as T
  } catch {
    return fallback
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    rawSet(key, JSON.stringify(value))
  } catch {
    /* 忽略 */
  }
}

export interface BestRecord {
  score: number
  unit: string
  better: 'higher' | 'lower'
  at: number
}

export const bestKey = (gameId: string): string => `gs:${gameId}:best`

export function readBest(gameId: string): BestRecord | null {
  const v = readJSON<unknown>(bestKey(gameId), null)
  if (!v || typeof v !== 'object') return null
  const r = v as Partial<BestRecord>
  if (typeof r.score !== 'number' || !Number.isFinite(r.score)) return null
  return {
    score: r.score,
    unit: typeof r.unit === 'string' ? r.unit : '',
    better: r.better === 'lower' ? 'lower' : 'higher',
    at: typeof r.at === 'number' ? r.at : 0,
  }
}

/** 若刷新纪录返回 true */
export function submitBest(gameId: string, o: Outcome): boolean {
  const prev = readBest(gameId)
  const better = !prev || (o.better === 'higher' ? o.score > prev.score : o.score < prev.score)
  if (better) writeJSON(bestKey(gameId), { score: o.score, unit: o.unit, better: o.better, at: Date.now() })
  return better
}

export function formatBest(b: BestRecord | null): string {
  if (!b) return '暂无纪录'
  return `最佳 ${b.score}${b.unit}`
}
