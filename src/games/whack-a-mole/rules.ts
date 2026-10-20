/**
 * 打地鼠规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 时间一律用「整数 tick」表达：本文件不读墙上时钟、不碰全局随机数，
 * 真实时间由渲染层（index.ts）折算成整数 tick 后通过 action 推进。
 * 随机数统一走 core/rng.ts 的可播种随机数，随机游标（一个 32 位整数）存在 State.rng 里，
 * 因此「同一个种子 + 同一串操作」必然复现出同一局。
 */
import { Rng } from '../../core/rng'
import { clamp } from '../../core/geom'

// ---------------- 时间与场地常量 ----------------

/** 一个 tick 的逻辑时长（毫秒），渲染层按此折算整数 tick */
export const TICK_MS = 50
/** 每秒 tick 数 */
export const TICKS_PER_SECOND = Math.round(1000 / TICK_MS)
/** 限时挑战时长（秒） */
export const TIME_SECONDS = 60
/** 60 秒对应的总 tick 数 */
export const TIME_TICKS = TIME_SECONDS * TICKS_PER_SECOND

/** 洞的数量：3×3 九个洞 */
export const HOLE_COUNT = 9

/** 敲中一只地鼠的得分 */
export const SCORE_PER_HIT = 10

// ---------------- 难度曲线 ----------------

/** 初始停留 tick / 最短停留 tick */
const STAY_MAX = 30
const STAY_MIN = 8
/** 每敲中 HOLD_STEP 只，地鼠停留时间缩短 1 tick */
const HOLD_STEP = 5

/** 初始刷新间隔 tick / 最短刷新间隔 tick */
const GAP_MAX = 10
const GAP_MIN = 3
/** 每敲中 SPAWN_STEP 只，刷新间隔缩短 1 tick */
const SPAWN_STEP = 3

/** 该难度下的地鼠停留 tick 数（敲得越多，地鼠待得越短） */
export function stayTicks(whacks: number): number {
  return clamp(STAY_MAX - Math.floor(whacks / HOLD_STEP), STAY_MIN, STAY_MAX)
}

/** 该难度下的刷新间隔 tick 数（敲得越多，刷新越快） */
export function spawnGap(whacks: number): number {
  return clamp(GAP_MAX - Math.floor(whacks / SPAWN_STEP), GAP_MIN, GAP_MAX)
}

// ---------------- 状态 ----------------

/** 单个洞的状态 */
export interface Hole {
  /** 洞里是否有地鼠 */
  mole: boolean
  /** 这只地鼠探头的 tick（没有地鼠时保留上一次的值，供渲染与测试对照） */
  appearTick: number
  /** 这只地鼠缩回的 tick */
  leaveTick: number
  /** 这只地鼠是否已被敲中（敲中后立刻消失，同一只不许重复得分） */
  whacked: boolean
}

export interface State {
  /** 已推进的 tick 数 */
  t: number
  /** 剩余时间（tick） */
  ticksLeft: number
  /** 随机游标 */
  rng: number
  /** 本局种子（重开时据此派生新种子） */
  seed: number
  /** 九个洞的状态 */
  holes: Hole[]
  /** 下一次刷新地鼠的 tick */
  nextSpawnTick: number
  /** 敲中只数 */
  whacks: number
  /** 失误次数 */
  misses: number
  /** 总分，恒等于 whacks × SCORE_PER_HIT */
  score: number
  /** 最近一次敲的洞下标，-1 表示还没敲过 */
  lastHole: number
  /** 最近一次敲是否命中 */
  lastHit: boolean
  /** 自增签名（每次探头与敲击都 +1），渲染层拿它做动画签名 */
  seq: number
  /** 是否已到时限 */
  over: boolean
}

export type Action =
  /** 玩家敲第 i 个洞（洞号从 0 起） */
  | { type: 'whack'; hole: number }
  /** 推进若干个 tick（由渲染层按真实 dt 折算） */
  | { type: 'tick'; ticks: number }
  /** 重开一局（提示区的「重开」按钮） */
  | { type: 'restart' }

// ---------------- 内部工具 ----------------

/** 全新的一排空洞 */
function emptyHoles(): Hole[] {
  return Array.from({ length: HOLE_COUNT }, () => ({ mole: false, appearTick: 0, leaveTick: 0, whacked: false }))
}

/** 场上当前有地鼠的洞下标，没有则 -1 */
export function moleHole(state: State): number {
  return state.holes.findIndex((h) => h.mole)
}

export function create(seed: number): State {
  const s = seed | 0
  return {
    t: 0,
    ticksLeft: TIME_TICKS,
    rng: s,
    seed: s,
    holes: emptyHoles(),
    nextSpawnTick: 0,
    whacks: 0,
    misses: 0,
    score: 0,
    lastHole: -1,
    lastHit: false,
    seq: 0,
    over: false,
  }
}

// ---------------- 状态迁移 ----------------

/** 逐 tick 定步推进：先让到期的地鼠缩回去，再看要不要探头一只新的 */
function advance(state: State, ticks: number): State {
  if (state.over) return state
  const steps = Math.floor(ticks)
  if (!(steps > 0)) return state
  let s = state
  for (let i = 0; i < steps; i++) {
    if (s.over) break
    const t = s.t + 1
    // 到时限：立刻终局，场上的地鼠全部收回
    if (t >= TIME_TICKS) {
      s = { ...s, t: TIME_TICKS, ticksLeft: 0, holes: s.holes.map((h) => ({ ...h, mole: false })), over: true }
      break
    }

    // 1) 待够时间的那只地鼠缩回去
    const idx = s.holes.findIndex((h) => h.mole)
    if (idx >= 0 && t >= s.holes[idx].leaveTick) {
      s = { ...s, holes: s.holes.map((h, i) => (i === idx ? { ...h, mole: false, whacked: false } : h)) }
      s = { ...s, nextSpawnTick: t + spawnGap(s.whacks) }
    }

    // 2) 场上有地鼠就不刷新（洞与洞互斥，同一时刻只有一只）
    if (!s.holes.some((h) => h.mole) && t >= s.nextSpawnTick) {
      const r = new Rng(s.rng)
      const empty: number[] = []
      s.holes.forEach((h, i) => {
        if (!h.mole) empty.push(i)
      })
      const pick = empty[r.int(empty.length)]
      const life = stayTicks(s.whacks)
      s = {
        ...s,
        holes: s.holes.map((h, i) => (i === pick ? { mole: true, appearTick: t, leaveTick: t + life, whacked: false } : h)),
        rng: r.s,
        seq: s.seq + 1,
      }
    }

    s = { ...s, t, ticksLeft: TIME_TICKS - t }
  }
  return s
}

/** 敲洞：命中加 10 分并让地鼠立刻消失；敲空记一次失误 */
function applyWhack(state: State, hole: number): State {
  if (state.over) return state
  if (!Number.isInteger(hole) || hole < 0 || hole >= HOLE_COUNT) return state
  const target = state.holes[hole]

  // 敲空：记一次失误，不计分
  if (!target.mole || target.whacked) {
    return { ...state, misses: state.misses + 1, lastHole: hole, lastHit: false }
  }

  // 命中：加 10 分、敲击数 +1，地鼠立刻消失（同一只不许重复得分）
  const whacks = state.whacks + 1
  return {
    ...state,
    holes: state.holes.map((h, i) => (i === hole ? { ...h, mole: false, whacked: true, leaveTick: state.t } : h)),
    whacks,
    score: whacks * SCORE_PER_HIT,
    lastHole: hole,
    lastHit: true,
    seq: state.seq + 1,
    nextSpawnTick: state.t + spawnGap(whacks),
  }
}

/** 重开：按当前随机游标派生一个新种子，换一局新的布局（仍可复盘） */
function applyRestart(state: State): State {
  const r = new Rng(state.rng)
  return create(r.int(0x7fffffff) + 1)
}

/** 纯函数状态迁移：不读时间、不读全局随机数、不修改入参 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'whack':
      return applyWhack(state, action.hole)
    case 'tick':
      return advance(state, action.ticks)
    case 'restart':
      return applyRestart(state)
    default:
      return state
  }
}

// ---------------- 派生量 ----------------

/** 命中率 = 敲击数 / (敲击数 + 失误数)；一次都没敲时为 0 */
export function accuracy(state: State): number {
  const total = state.whacks + state.misses
  return total === 0 ? 0 : state.whacks / total
}

/** 剩余秒数（供 HUD 显示） */
export function remainingSeconds(state: State): number {
  return state.ticksLeft / TICKS_PER_SECOND
}

/** 是否已终局 */
export function isOver(state: State): boolean {
  return state.over
}

// ---------------- 测试与脚本用的便捷入口 ----------------

/** 推进 n 个 tick */
export function step(state: State, n: number): State {
  return reduce(state, { type: 'tick', ticks: n })
}

/** 敲第 i 个洞 */
export function whack(state: State, hole: number): State {
  return reduce(state, { type: 'whack', hole })
}
