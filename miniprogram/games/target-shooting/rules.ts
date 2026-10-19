/**
 * 射靶规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 时间一律用「整数 tick」表达：本文件内不出现 Date / performance / Math.random()，
 * 墙上时钟只存在于渲染层，由 index.ts 折算成整数 tick 后通过 action 推进。
 */
import { Rng } from '../../core/rng'
import { clamp, dist } from '../../core/geom'

// ---------------- 时间与场地常量 ----------------

/** 一个 tick 的逻辑时长（毫秒），渲染层按此折算整数 tick */
export const TICK_MS = 50
/** 限时挑战时长（秒） */
export const TIME_SECONDS = 60
/** 每秒 tick 数 */
export const TICKS_PER_SECOND = Math.round(1000 / TICK_MS)
/** 60 秒对应的总 tick 数 */
export const TIME_TICKS = TIME_SECONDS * TICKS_PER_SECOND

/** 可出现靶子的区域（顶部留给信息栏，底部留给提示区） */
export interface Field {
  left: number
  right: number
  top: number
  bottom: number
}
export const FIELD: Field = { left: 100, right: 620, top: 220, bottom: 1060 }

// ---------------- 环与分值 ----------------

/** 命中半径占靶半径的比例上界（由外到内，递减） */
export const RING_EDGES: readonly number[] = [1, 0.75, 0.5, 0.25]
/** 各环分值，索引 0 = 最外环 … 3 = 靶心（最高） */
export const RING_SCORES: readonly number[] = [10, 20, 50, 100]
/** 环数，共 4 环 */
export const RING_COUNT = RING_SCORES.length
/** 各环配色，由外到内 */
export const RING_COLORS: readonly string[] = ['#e8edf5', '#ef5350', '#f4f7fb', '#ffd54f']

/** 命中判定：返回环号 1…4，未命中返回 0 */
export function hitRing(x: number, y: number, cx: number, cy: number, r: number): number {
  const d = dist(x, y, cx, cy)
  if (d > r) return 0
  // 由内向外判定：先命中最小的环
  for (let i = RING_EDGES.length - 1; i >= 0; i--) {
    if (d <= r * RING_EDGES[i]) return i + 1
  }
  return 1
}

/** 环号对应分值，非法环号返回 0 */
export function ringScore(ring: number): number {
  return ring >= 1 && ring <= RING_SCORES.length ? RING_SCORES[ring - 1] : 0
}

// ---------------- 难度曲线 ----------------

/** 初始靶半径 / 最小靶半径 */
const R_MAX = 120
const R_MIN = 46
/** 初始停留 tick / 最短停留 tick */
const LIFE_MAX = 46
const LIFE_MIN = 8

/** 每出现 LEVEL_STEP 个靶子升一级难度 */
const LEVEL_STEP = 5

/** 已出现 spawned 个靶子时的难度等级 */
export function levelOf(spawned: number): number {
  return Math.floor(spawned / LEVEL_STEP)
}

/** 该等级下的靶半径（等级越高越小） */
export function radiusFor(level: number): number {
  return clamp(R_MAX - level * 9, R_MIN, R_MAX)
}

/** 该等级下的停留 tick 数（等级越高越短） */
export function lifeFor(level: number): number {
  return clamp(LIFE_MAX - level * 5, LIFE_MIN, LIFE_MAX)
}

// ---------------- 状态 ----------------

export interface Target {
  /** 自增序号，渲染动画签名用 */
  id: number
  x: number
  y: number
  /** 靶半径（像素） */
  r: number
  /** 剩余停留 tick 数 */
  life: number
  /** 出现时的停留 tick 总数，渲染剩余时间进度用 */
  life0: number
}

/** 最近一次射击的反馈，供渲染层画准星 */
export interface Shot {
  x: number
  y: number
  /** 命中环号，0 表示打空 */
  ring: number
  points: number
  hit: boolean
}

export interface State {
  /** 已推进的 tick 数 */
  t: number
  /** 随机游标 */
  rng: number
  score: number
  /** 发射次数 */
  shots: number
  /** 命中次数 */
  hits: number
  /** 当前靶子，空表示等待下一个 tick 生成 */
  target: Target | null
  /** 本局已出现过的靶子数，用于难度推进 */
  spawned: number
  /** 最近一次射击 */
  last: Shot | null
  /** 自增签名，保证每次射击的渲染动画唯一 */
  seq: number
  /** 是否已耗尽 60 秒 */
  over: boolean
}

export type Action =
  /** 推进 n 个 tick（渲染层按真实 dt 折算） */
  | { type: 'tick'; n: number }
  /** 在逻辑坐标 (x, y) 开一枪 */
  | { type: 'shoot'; x: number; y: number }

// ---------------- 内部工具 ----------------

/** 用随机游标生成一个靶子；prev 用于尽量避开与上一个靶心重叠 */
function spawnTarget(r: Rng, level: number, id: number, prev: Target | null): Target {
  const rad = radiusFor(level)
  const life = lifeFor(level)
  const minX = Math.round(FIELD.left + rad)
  const maxX = Math.round(FIELD.right - rad)
  const minY = Math.round(FIELD.top + rad)
  const maxY = Math.round(FIELD.bottom - rad)
  let x = minX
  let y = minY
  for (let attempt = 0; attempt < 6; attempt++) {
    x = r.range(minX, maxX)
    y = r.range(minY, maxY)
    if (!prev || dist(x, y, prev.x, prev.y) >= prev.r + rad) break
  }
  return { id, x, y, r: rad, life, life0: life }
}

export function create(seed: number): State {
  const r = new Rng(seed)
  const target = spawnTarget(r, levelOf(0), 1, null)
  return {
    t: 0,
    rng: r.s,
    score: 0,
    shots: 0,
    hits: 0,
    target,
    spawned: 1,
    last: null,
    seq: 0,
    over: false,
  }
}

/** 纯函数状态迁移：不读时间、不读全局随机数、不修改入参 */
export function reduce(state: State, action: Action): State {
  if (action.type === 'tick') return advance(state, action.n)
  if (action.type === 'shoot') return shoot(state, action.x, action.y)
  return state
}

/** 逐 tick 定步推进；到达时限立即终局 */
function advance(state: State, n: number): State {
  if (state.over) return state
  const steps = Math.floor(n)
  if (!(steps > 0)) return state
  let s = state
  for (let i = 0; i < steps; i++) {
    if (s.over) break
    const t = s.t + 1
    if (t >= TIME_TICKS) {
      s = { ...s, t: TIME_TICKS, target: null, over: true }
      break
    }
    if (s.target) {
      const left = s.target.life - 1
      s = { ...s, t, target: left > 0 ? { ...s.target, life: left } : null }
    } else {
      const r = new Rng(s.rng)
      const target = spawnTarget(r, levelOf(s.spawned), s.spawned + 1, null)
      s = { ...s, t, target, spawned: s.spawned + 1, rng: r.s }
    }
  }
  return s
}

/** 开一枪：无论是否命中都记一次发射；命中后靶子消失 */
function shoot(state: State, x: number, y: number): State {
  if (state.over) return state
  const shots = state.shots + 1
  const seq = state.seq + 1
  const tg = state.target
  const ring = tg ? hitRing(x, y, tg.x, tg.y, tg.r) : 0
  if (ring === 0) {
    return { ...state, shots, seq, last: { x, y, ring: 0, points: 0, hit: false } }
  }
  const points = ringScore(ring)
  return {
    ...state,
    shots,
    hits: state.hits + 1,
    score: state.score + points,
    seq,
    target: null,
    last: { x, y, ring, points, hit: true },
  }
}

// ---------------- 派生量 ----------------

/** 命中率 = 命中次数 / 发射次数；未发射时为 0 */
export function accuracy(state: State): number {
  return state.shots === 0 ? 0 : state.hits / state.shots
}

/** 剩余 tick 数 */
export function remainingTicks(state: State): number {
  return Math.max(0, TIME_TICKS - state.t)
}

/** 剩余秒数（供 HUD 显示） */
export function remainingSeconds(state: State): number {
  return remainingTicks(state) / TICKS_PER_SECOND
}

/** 是否已终局 */
export function isOver(state: State): boolean {
  return state.over
}

/** 测试与脚本用的便捷入口：开一枪 */
export function fire(state: State, x: number, y: number): State {
  return reduce(state, { type: 'shoot', x, y })
}

/** 测试与脚本用的便捷入口：推进 n 个 tick */
export function step(state: State, n: number): State {
  return reduce(state, { type: 'tick', n })
}
