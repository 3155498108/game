/** localStorage 安全封装：隐私模式 / 配额满 / JSON 损坏 均兜底，不让游戏崩溃 */
import type { Outcome } from '../core/types'

const mem = new Map<string, string>()

function rawGet(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key)
    if (v !== null) return v
  } catch {
    /* 隐私模式等：回落到内存 */
  }
  return mem.has(key) ? (mem.get(key) as string) : null
}

function rawSet(key: string, value: string): void {
  mem.set(key, value)
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* 忽略 */
  }
}

export function readJSON<T>(key: string, fallback: T): T {
  const raw = rawGet(key)
  if (raw === null) return fallback
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
