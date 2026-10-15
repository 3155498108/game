/**
 * 轨道车规则（纯逻辑，零 DOM 依赖，可在 node 环境直接单测）。
 *
 * 三条分层约定（延续 DECISIONS 3.3 / 3.5）：
 * 1. **时间不进 state**：本文件没有任何时间源，也不出现 Date / performance / Math.random。
 *    渲染层把帧间隔折算成整数 tick，再以 `{ type: 'advance', ticks }` 推进本状态机。
 *    TICK_MS 取 16ms ≈ 一帧，故 tickRate ≈ 60 次/秒。
 * 2. **随机全部走 Rng**：障碍与金币由 state.rng 播种，同种子 + 同操作序列必得同一局，
 *    满足「每日挑战」与复盘对账。
 * 3. 连续运动只记逻辑值（dist / ticks 为整数），画面上的平滑位移由渲染层补间完成。
 *
 * 赛道以「世界距离 dist」为唯一坐标：车头在 dist 处，实体携带的是「距车头的距离 d」，
 * 每 tick 所有 d 同步减去当前速度，渲染时按 `y = 车道 y - d` 画出即可。
 */
import { Rng } from '../../core/rng'

// ---------------- 赛道参数 ----------------
/** 车道数（规格要求 3-4 条） */
export const LANES = 4
/** 车道下标，生成时用打乱取用 */
const LANE_IDS: readonly number[] = Array.from({ length: LANES }, (_, i) => i)

/** 一个 tick 的毫秒数，取一帧（60Hz） */
export const TICK_MS = 16

/** 起步速度与速度上限，单位为「距离/tick」 */
export const SPEED_MIN = 3
export const SPEED_MAX = 7
/** 速度爬到上限所需的 tick 数：3750 × 16ms = 60s，正好对齐规格「一局 60-90 秒」的下限 */
export const RAMP_TICKS = 3750

/** 相邻两排（障碍行 / 金币行）的时间间隔（tick），随难度从 1.02 秒收到 0.61 秒 */
export const GAP_TICKS_START = 64
export const GAP_TICKS_MIN = 38

/** 一排里最多堵住的车道数，保证任何时刻至少有 2 条道可以通过 */
export const MAX_BLOCKED = 2

/** 车头前沿：实体中心越过这条线即算与车相撞 / 被拾取 */
export const NOSE = 48

/** 生成距离：车头上方这么远开始放新的一排（约在画面上方之外一点，不会有凭空冒出的观感） */
export const SPAWN_AHEAD = 1500
/** 开局第一排的绝对世界距离，按起步速度约 3.9 秒后才遇到 */
export const FIRST_SPAWN = 700
/** 甩到车尾以下这么多就移除 */
export const DROP_BEHIND = 200

// ---------------- 计分 ----------------
/** 每枚金币的分值 */
export const COIN_SCORE = 10
/** 每前进多少距离记 1 分 */
export const DIST_PER_POINT = 120

// ---------------- 速度曲线 ----------------
/** 难度进度 0..1（随 tick 单调不减，到 RAMP_TICKS 后恒为 1） */
export function rampRatio(tick: number): number {
  if (!(tick > 0)) return 0
  return tick >= RAMP_TICKS ? 1 : tick / RAMP_TICKS
}

/** 当前速度：单调不减，且恒在 [SPEED_MIN, SPEED_MAX] 区间内 */
export function speedAtTick(tick: number): number {
  return Math.round(SPEED_MIN + (SPEED_MAX - SPEED_MIN) * rampRatio(tick))
}

/** 排与排之间的间隔（tick）：单调不增，保证反应时间随难度收紧而不是靠瞬移补难度 */
export function gapTicksAtTick(tick: number): number {
  return Math.round(GAP_TICKS_START + (GAP_TICKS_MIN - GAP_TICKS_START) * rampRatio(tick))
}

// ---------------- 状态 ----------------
export type Phase = 'ready' | 'run' | 'over'
export type ItemKind = 'obstacle' | 'coin'

/** 场上实体：d 为「距车头的世界距离」，车前进时同步减小 */
export interface Item {
  d: number
  lane: number
  kind: ItemKind
}

export interface State {
  phase: Phase
  /** 车所在车道（整数下标） */
  lane: number
  /** 车头已前进的世界距离，只增不减 */
  dist: number
  /** 已推进的 tick 数，速度曲线的自变量 */
  ticks: number
  score: number
  coins: number
  /** 场上实体，d 相同者即同一排 */
  items: Item[]
  /** 下一排生成时的绝对世界距离 */
  spawnAt: number
  /** 已生成的排数，奇偶交替「障碍行 / 金币行」 */
  rows: number
  /** 最近拾取的金币位置，供渲染层放粒子 */
  lastPick: { lane: number; d: number } | null
  /** 自增序号，仅供渲染旁路的动画签名 */
  seq: number
  /** 随机游标（生成障碍与金币时推进） */
  rng: number
}

export type Action =
  /** 发车：ready → run */
  | { type: 'start' }
  /** 左右换道，只能落到相邻的合法车道 */
  | { type: 'shift'; dir: -1 | 1 }
  /** 时间推进，由渲染层按帧派发 */
  | { type: 'advance'; ticks: number }

export function create(seed: number): State {
  return {
    phase: 'ready',
    // 从中间车道发车，左右都留出余地
    lane: Math.floor(LANES / 2),
    dist: 0,
    ticks: 0,
    score: 0,
    coins: 0,
    items: [],
    spawnAt: FIRST_SPAWN,
    rows: 0,
    lastPick: null,
    seq: 0,
    rng: seed | 0,
  }
}

/**
 * 生成一排。
 * 偶数排是「障碍行」：堵住 1~2 条道（绝不堵满），金币只放在剩下的空道上，
 * 保证同一排里障碍与金币永不落在同一条车道（视觉与判定都不会重叠）；
 * 奇数排是「金币行」：连续 2~3 枚，不带障碍，作为喘息与收益段。
 */
function spawnRow(items: Item[], d: number, rowIndex: number, r: Rng): void {
  if (rowIndex % 2 === 0) {
    const order = r.shuffle(LANE_IDS)
    const blocked = r.chance(0.4) ? MAX_BLOCKED : 1
    for (let i = 0; i < blocked; i++) items.push({ d, lane: order[i], kind: 'obstacle' })
    const free = order.slice(blocked)
    const coins = Math.min(free.length, r.chance(0.5) ? 2 : 1)
    for (let i = 0; i < coins; i++) items.push({ d, lane: free[i], kind: 'coin' })
  } else {
    const len = r.range(2, LANES - 1)
    const start = r.int(LANES - len + 1)
    for (let i = 0; i < len; i++) items.push({ d, lane: start + i, kind: 'coin' })
  }
}

/** 推进过程中的可变中间量（局部对象，不属于对外的 state） */
interface Run {
  ticks: number
  dist: number
  items: Item[]
  rows: number
  spawnAt: number
  coins: number
  score: number
  lastPick: State['lastPick']
  over: boolean
}

/** 推进一个 tick：生成 → 位移 → 拾取 / 碰撞 */
function stepTick(run: Run, lane: number, rng: Rng): void {
  run.ticks += 1
  const speed = speedAtTick(run.ticks)
  const prevDist = run.dist
  run.dist += speed
  run.score += Math.floor(run.dist / DIST_PER_POINT) - Math.floor(prevDist / DIST_PER_POINT)

  // 生成：把视野补满，间隔按当前速度换算成距离，保证反应时间是恒定的
  let guard = 0
  while (run.spawnAt < run.dist + SPAWN_AHEAD && guard++ < 64) {
    spawnRow(run.items, run.spawnAt - run.dist, run.rows, rng)
    run.rows += 1
    run.spawnAt += speed * gapTicksAtTick(run.ticks)
  }

  const kept: Item[] = []
  for (const it of run.items) {
    const d = it.d - speed
    if (d <= -DROP_BEHIND) continue // 甩在身后
    if (d <= NOSE && it.lane === lane) {
      if (it.kind === 'coin') {
        run.coins += 1
        run.score += COIN_SCORE
        run.lastPick = { lane: it.lane, d }
        continue // 金币直接吃掉，视觉反馈交给粒子
      }
      run.over = true
      // 障碍停在车头前，配合震屏与红闪表现撞车
      kept.push({ d: NOSE, lane: it.lane, kind: 'obstacle' })
      continue
    }
    kept.push({ d, lane: it.lane, kind: it.kind })
  }
  run.items = kept
}

/** 纯函数状态迁移：不读时间、不读全局随机数、不修改入参 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'start': {
      if (state.phase !== 'ready') return state
      return { ...state, phase: 'run', seq: state.seq + 1 }
    }

    case 'shift': {
      if (state.phase !== 'run') return state
      if (action.dir !== -1 && action.dir !== 1) return state
      const lane = state.lane + action.dir
      // 只能换到相邻车道，且不得越出赛道
      if (lane < 0 || lane >= LANES) return state
      return { ...state, lane, seq: state.seq + 1 }
    }

    case 'advance': {
      // 只有行驶中才推进时间；终局后世界冻结
      if (state.phase !== 'run') return state
      const n = action.ticks
      if (!Number.isInteger(n) || n <= 0) return state
      const rng = new Rng(state.rng)
      const run: Run = {
        ticks: state.ticks,
        dist: state.dist,
        items: state.items.slice(),
        rows: state.rows,
        spawnAt: state.spawnAt,
        coins: state.coins,
        score: state.score,
        lastPick: state.lastPick,
        over: false,
      }
      for (let i = 0; i < n && !run.over; i++) stepTick(run, state.lane, rng)
      return {
        ...state,
        phase: run.over ? 'over' : state.phase,
        dist: run.dist,
        ticks: run.ticks,
        score: run.score,
        coins: run.coins,
        items: run.items,
        spawnAt: run.spawnAt,
        rows: run.rows,
        lastPick: run.lastPick,
        rng: rng.s,
      }
    }
  }
}

/** 目标车道是否合法（供输入层判断要不要给反馈） */
export function canShift(state: State, dir: number): boolean {
  if (dir !== -1 && dir !== 1) return false
  const lane = state.lane + dir
  return lane >= 0 && lane < LANES
}
