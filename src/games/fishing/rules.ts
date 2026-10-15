/**
 * 钓鱼规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 核心模型：
 * - 时间全部以 tick 表达，TIME_TICKS = 90 秒 × TICK_HZ。墙上时钟不进入 state。
 * - 鱼在水下横向来回游动；游到浮漂竖线附近即被「咬住」，停在浮漂处 stay 个 tick，
 *   这段窗口就是玩家的收杆时机；窗口耗尽鱼就游走，此时收杆为空杆。
 * - 随机数只走 Rng（游标存在 state.rng 里），同种子 + 同操作序列必得同一局。
 * - 抛物线收杆动画属于渲染层旁路，状态里只记 lastCast。
 */
import { Rng } from '../../core/rng'

// ---------------- 场地与节拍 ----------------
export const VW = 720
export const VH = 1280
/** 水面高度 */
export const WATER_TOP = 330
/** 鱼群活动区左右边界 */
export const FIELD_LEFT = 60
export const FIELD_RIGHT = VW - 60
export const FIELD_TOP = WATER_TOP + 150
export const FIELD_BOTTOM = VH - 210
/** 浮漂所在的竖线 */
export const BOB_X = VW / 2
/** 浮漂（钓线出水处）高度 */
export const BOB_Y = WATER_TOP - 26
/** 咬钩判定半宽（x 方向，单位：逻辑像素） */
export const BITE_HALF = 26

/** 逻辑推进频率 */
export const TICK_HZ = 30
export const TICK_MS = 1000 / TICK_HZ
/** 90 秒限时 */
export const TIME_SECONDS = 90
export const TIME_TICKS = TIME_SECONDS * TICK_HZ
/** 单帧最多补算的 tick 数，防止切回标签页时瞬移 */
export const MAX_STEPS = 30
/** 同时在水里的鱼数 */
export const FISH_COUNT = 4
/** 收杆冷却（tick），防止连点刷分 */
export const CAST_CD_TICKS = 10

// ---------------- 鱼的种类 ----------------
export interface Species {
  /** 中文名，用于 UI */
  name: string
  /** 分值 = 重量（斤） */
  weight: number
  /** 被咬住后可停留的 tick 数，即收杆窗口 */
  hold: number
  /** 每 tick 游动的逻辑像素 */
  speed: number
  /** 体长（逻辑像素） */
  size: number
  color: string
}

/** 越大越难得：分值高 → 停留窗口短 */
export const SPECIES: readonly Species[] = [
  { name: '小鲫鱼', weight: 1, hold: 42, speed: 4.6, size: 26, color: '#9fb3cf' },
  { name: '鲤鱼', weight: 3, hold: 34, speed: 3.4, size: 34, color: '#ffa726' },
  { name: '鲈鱼', weight: 5, hold: 26, speed: 3.0, size: 38, color: '#42a5f5' },
  { name: '金枪鱼', weight: 9, hold: 16, speed: 4.2, size: 48, color: '#ab47bc' },
  { name: '锦鲤王', weight: 14, hold: 10, speed: 2.4, size: 54, color: '#ef5350' },
]

// ---------------- 状态 ----------------
export interface Fish {
  /** 全局唯一自增 id */
  id: number
  /** 种类下标 */
  sp: number
  /** 中心 x */
  x: number
  /** 中心 y */
  y: number
  /** 游动方向：1 向右，-1 向左 */
  dir: 1 | -1
  /** 停在浮漂处的剩余 tick；> 0 表示正被咬住 */
  hold: number
}

/** 最近一次收杆，供渲染旁路画抛物线 */
export interface CastInfo {
  kind: 'hit' | 'miss'
  /** 命中的种类下标，空杆为 -1 */
  sp: number
  /** 抛物线终点 */
  x: number
  y: number
  /** 命中的重量，空杆为 0 */
  w: number
}

export interface State {
  /** 已推进的 tick 数 */
  tick: number
  /** 剩余时间（tick） */
  timeLeft: number
  /** 是否已终局 */
  over: boolean
  fishes: Fish[]
  /** 当前咬钩的鱼 id，-1 表示没有 */
  biteId: number
  /** 累计总重量（斤） */
  weight: number
  /** 上钩尾数 */
  caught: number
  /** 空杆次数 */
  miss: number
  /** 收杆冷却剩余 tick */
  castCd: number
  lastCast: CastInfo | null
  /** 自增序号，保证每次收杆的签名唯一 */
  seq: number
  /** tick 换算余下的毫秒数 */
  rem: number
  /** 下一条鱼的 id */
  nextId: number
  /** 随机游标 */
  rng: number
}

export type Action =
  | { type: 'tick'; ms: number }
  | { type: 'cast' }
  | { type: 'reset'; seed: number }

/** 空杆扣除的重量（分数不会低于 0） */
export const MISS_PENALTY = 1

// ---------------- 内部工具 ----------------

/** 在场地左/右边缘生成一条新鱼，游向场地内部 */
function spawnFish(r: Rng, id: number, laneY?: number): Fish {
  const sp = r.int(SPECIES.length)
  const fromLeft = r.chance(0.5)
  const y = laneY ?? r.range(FIELD_TOP, FIELD_BOTTOM)
  return {
    id,
    sp,
    x: fromLeft ? FIELD_LEFT : FIELD_RIGHT,
    y: Math.max(FIELD_TOP, Math.min(FIELD_BOTTOM, y)),
    dir: fromLeft ? 1 : -1,
    hold: 0,
  }
}

export function create(seed: number): State {
  const r = new Rng(seed)
  const fishes: Fish[] = []
  for (let i = 0; i < FISH_COUNT; i++) fishes.push(spawnFish(r, i))
  return {
    tick: 0,
    timeLeft: TIME_TICKS,
    over: false,
    fishes,
    biteId: -1,
    weight: 0,
    caught: 0,
    miss: 0,
    castCd: 0,
    lastCast: null,
    seq: 0,
    rem: 0,
    nextId: FISH_COUNT,
    rng: r.s,
  }
}

/** 推进一个 tick：游动 / 折返 / 咬钩 / 停留倒数 / 游走后补鱼 */
function stepOnce(state: State): State {
  const r = new Rng(state.rng)
  const timeLeft = state.timeLeft - 1
  if (timeLeft <= 0) {
    return {
      ...state,
      tick: state.tick + 1,
      timeLeft: 0,
      over: true,
      biteId: -1,
      castCd: 0,
      fishes: state.fishes.map((f) => (f.hold > 0 ? { ...f, hold: 0 } : f)),
      rng: r.s,
    }
  }

  const castCd = state.castCd > 0 ? state.castCd - 1 : 0
  let biteId = state.biteId
  let nextId = state.nextId
  const fishes: Fish[] = []

  for (const f of state.fishes) {
    // 正被咬住：原地停留倒计时，耗尽即游走并从边缘补一条新鱼
    if (f.id === biteId && f.hold > 0) {
      const hold = f.hold - 1
      if (hold > 0) {
        fishes.push({ ...f, hold })
        continue
      }
      biteId = -1
      fishes.push(spawnFish(r, nextId++, f.y))
      continue
    }

    // 自由游动：到边界折返
    const sp = SPECIES[f.sp]
    let x = f.x + f.dir * sp.speed
    let dir: 1 | -1 = f.dir
    if (x <= FIELD_LEFT) {
      x = FIELD_LEFT
      dir = 1
    } else if (x >= FIELD_RIGHT) {
      x = FIELD_RIGHT
      dir = -1
    }

    // 浮漂附近且当前无人咬钩 → 咬住
    if (biteId === -1 && Math.abs(x - BOB_X) <= BITE_HALF) {
      biteId = f.id
      fishes.push({ ...f, x: BOB_X, dir, hold: sp.hold })
      continue
    }
    fishes.push({ ...f, x, dir })
  }

  // 防御：biteId 指向的鱼若已不存在，清空
  if (biteId !== -1 && !fishes.some((f) => f.id === biteId && f.hold > 0)) biteId = -1

  return { ...state, tick: state.tick + 1, timeLeft, castCd, biteId, fishes, nextId, rng: r.s }
}

/** 纯函数：连续推进 steps 个 tick，终局后自动停止 */
export function advance(state: State, steps: number): State {
  let s = state
  const n = Math.max(0, Math.floor(steps))
  for (let i = 0; i < n; i++) {
    if (s.over) break
    s = stepOnce(s)
  }
  return s
}

/** 收杆。纯函数，不修改入参 */
export function cast(state: State): State {
  if (state.over || state.castCd > 0) return state

  const target = state.biteId === -1 ? null : state.fishes.find((f) => f.id === state.biteId) ?? null

  // 空杆：没有鱼咬钩
  if (!target || target.hold <= 0) {
    return {
      ...state,
      biteId: -1,
      miss: state.miss + 1,
      weight: Math.max(0, state.weight - MISS_PENALTY),
      castCd: CAST_CD_TICKS,
      seq: state.seq + 1,
      lastCast: { kind: 'miss', sp: -1, x: BOB_X, y: BOB_Y, w: 0 },
    }
  }

  // 命中：计重、移除该鱼、同泳道补一条新鱼
  const r = new Rng(state.rng)
  const g = SPECIES[target.sp]
  const fishes = state.fishes.slice()
  const i = fishes.findIndex((f) => f.id === target.id)
  fishes[i] = spawnFish(r, state.nextId, target.y)
  return {
    ...state,
    fishes,
    nextId: state.nextId + 1,
    biteId: -1,
    weight: state.weight + g.weight,
    caught: state.caught + 1,
    castCd: CAST_CD_TICKS,
    seq: state.seq + 1,
    rng: r.s,
    lastCast: { kind: 'hit', sp: target.sp, x: target.x, y: target.y, w: g.weight },
  }
}

/** 纯函数状态迁移：不读时间、不读全局随机数、不修改入参 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'tick': {
      if (state.over) return state
      const ms = Math.max(0, Math.min(action.ms, 1000))
      const total = state.rem + ms
      let steps = Math.floor(total / TICK_MS)
      if (steps > MAX_STEPS) steps = MAX_STEPS
      const rem = total - steps * TICK_MS
      if (steps <= 0) return { ...state, rem }
      return { ...advance(state, steps), rem }
    }
    case 'cast':
      return cast(state)
    case 'reset':
      return create(action.seed)
  }
}

// ---------------- GameModule 可选扩展的纯逻辑部分 ----------------

/** 站点壳每帧以 dt(ms) 调用；渲染层负责算真实 dt */
export function tick(dt: number): Action {
  return { type: 'tick', ms: dt }
}

/** 是否正在咬钩（UI 提示用） */
export function hasBite(state: State): boolean {
  return state.biteId !== -1
}

/** 剩余秒数（向上取整） */
export function secondsLeft(state: State): number {
  return Math.ceil(state.timeLeft / TICK_HZ)
}
