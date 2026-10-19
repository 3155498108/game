/**
 * 存档的**共享逻辑**：JSON 读写 + 最佳成绩。
 *
 * ## 为什么从 `shell/` 搬到这里
 *
 * 两个理由，都是被小程序移植逼出来的：
 *
 * 1. **越层依赖**。麻将对对消（`mahjong-match`）的渲染层要存「每关最少步数 / 最快用时」，
 *    以前它 import 的是 `shell/storage` —— 共享层里的游戏代码居然认识站点壳。
 *    小程序版能跑，纯粹是因为那边**恰好**也有一个同名同 API 的文件；
 *    那种「碰巧成立」的依赖迟早会咬人。
 * 2. **两份手写副本**。网页版与小程序版各有一份 `shell/storage.ts`，
 *    两边要靠人工保持 API 一致。逻辑搬进来之后，两边各自只剩一个
 *    **后端适配器**（十来行），漂移的面小了一个数量级。
 *
 * ## 平台差异只剩两处，都由壳层注入
 *
 * - **存储后端**：网页版是 `localStorage`，小程序是 `wx.*StorageSync`；
 * - **墙上时钟**：`submitBest` 要记「这条纪录是什么时候破的」。
 *   `core/` 不碰 `Date`（和 `rules.ts` 同一条纪律：**时间不进纯逻辑层**），
 *   所以时间戳由调用方传进来。
 *
 * 这样 `core/` 依然是零依赖、可在 node 环境单测的纯模块。
 */
import type { Outcome } from './types'

export interface StorageBackend {
  /** 取原始字符串；取不到或出错一律返回 '' */
  get(key: string): string
  set(key: string, value: string): void
}

let backend: StorageBackend | null = null

/**
 * 内存兜底。
 *
 * 隐私模式、配额满、存储被第三方脚本禁用时，持久化那一层会抛异常——
 * 但**存档不该因此整个丢掉**。所以每次写都先落内存，再试着写持久层；
 * 读的时候先看持久层，没有再看内存。
 *
 * 这一层是共享逻辑的一部分，所以放在 `core/`：网页版与小程序版**都**有它。
 */
const mem = new Map<string, string>()

/**
 * 由站点壳在启动时注入一次。
 *
 * **注入新后端会一并清空内存兜底**：后端换了 = 换了一套存储，
 * 兜底的那一份理应跟着换，否则会出现「后端已经被清空、内存却还留着旧值，
 * 读回来的是陈的」这种怪事。
 */
export function setStorageBackend(b: StorageBackend): void {
  backend = b
  mem.clear()
}

function rawGet(key: string): string {
  try {
    const v = backend ? backend.get(key) : ''
    if (v !== '') return v
  } catch {
    /* 隐私模式等：回落到内存 */
  }
  return mem.get(key) ?? ''
}

function rawSet(key: string, value: string): void {
  mem.set(key, value)
  try {
    backend?.set(key, value)
  } catch {
    /* 忽略：内存里已经存了一份 */
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

/**
 * 若刷新纪录返回 true。
 *
 * `at` 是「这条纪录什么时候破的」的时间戳，**由调用方给**——
 * `core/` 不读墙上时钟，这条纪律和「动画不进 state」是同一条。
 */
export function submitBest(gameId: string, o: Outcome, at: number): boolean {
  const prev = readBest(gameId)
  const better = !prev || (o.better === 'higher' ? o.score > prev.score : o.score < prev.score)
  if (better) writeJSON(bestKey(gameId), { score: o.score, unit: o.unit, better: o.better, at })
  return better
}

export function formatBest(b: BestRecord | null): string {
  if (!b) return '暂无纪录'
  return `最佳 ${b.score}${b.unit}`
}
