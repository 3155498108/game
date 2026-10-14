/** 每日挑战：当天日期作为 seed，生成固定对局 */
import type { GameMeta } from '../core/types'
import { hashSeed } from '../core/rng'

/** 本地日期 → yyyymmdd 整数 */
export function todaySeed(d: Date = new Date()): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

export function todayLabel(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 当天的挑战游戏（按日期固定挑选） */
export function dailyGame(games: GameMeta[], seed: number = todaySeed()): GameMeta | undefined {
  if (games.length === 0) return undefined
  const sorted = games.slice().sort((a, b) => (a.id < b.id ? -1 : 1))
  return sorted[(hashSeed(seed) >>> 0) % sorted.length]
}
