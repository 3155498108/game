/**
 * 玩具冰壶（toy-curling）· 规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 玩法：顶部视角冰道，720×1280 竖向逻辑坐标。
 *   - 按住中央蓄力（power 0..1），左右调整方向（angle，单位弧度，0 为正下方）；
 *   - 松手出壶，冰壶沿直线匀速滑行，受冰面摩擦逐 tick 减速；
 *   - 撞到已有冰壶时沿连心线做分离、并沿法线交换法向速度分量（等质量冲量 = 传递动量）；
 *   - 所有冰壶停下后结算本局：距圆心最近的壶所属一方得分，越近单壶分越高；
 *   - 每方每局投 STONES_PER_SIDE 只，共 ROUNDS 局，累计总分高者胜。
 *
 * 物理全部手写（匀速直线 + 固定 dt 逐 tick 推进），不使用任何物理引擎。
 * 本文件不读时间、不用全局随机、不碰 DOM；AI 的候选评估也通过同一个 reduce 试算。
 */
import { clamp, dist } from '../../core/geom'
import { Rng } from '../../core/rng'

// ---------------- 场地常量 ----------------
/** 逻辑视口宽高（与 meta.viewport 一致） */
export const VW = 720
export const VH = 1280

/** 冰道边界（矩形，玩家与 AI 共用） */
export const SHEET = { left: 70, right: 650, top: 180, bottom: 1160 } as const
/** 圆心（house 中心 / button） */
export const BUTTON = { x: 360, y: 880 } as const
/** 圆心半径（house 半径） */
export const HOUSE_R = 110
/** 五环半径：圆心 / 4 分 / 3 分 / 2 分 / 1 分 */
export const RING_CORE = 22
export const RING_1 = 48
export const RING_2 = 74
export const RING_3 = 100
/** 冰壶半径 */
export const STONE_R = 24
/** 出壶点（发球线） */
export const THROW_X = 360
export const THROW_Y = 232
/** 方向可调范围（弧度） */
export const MAX_ANGLE = 0.42

// ---------------- 物理常量 ----------------
/** 满蓄力初速度（逻辑像素 / tick） */
export const MAX_SPEED = 17
/** 最小有效蓄力量：低于此值不再视为有效出壶 */
export const MIN_POWER = 0.08
/** 每 tick 摩擦系数（乘性减速） */
export const FRICTION = 0.978
/** 低于该速度即视为停止 */
export const STOP_SPEED = 0.05
/** 碰撞恢复系数（<1 表示损失动能，但动量守恒） */
export const RESTITUTION = 0.92
/** 规格上限：单 tick 内分离 + 动量交换的迭代次数 */
export const MAX_SEPARATION_ITERS = 4
/** 单次出壶的滑行硬上限（防止极端参数下永不停） */
export const MAX_SLIDE_TICKS = 900

// ---------------- 玩法常量 ----------------
/** 总局数 */
export const ROUNDS = 3
/** 每方每局投壶数 */
export const STONES_PER_SIDE = 2
/** 每局双方合计投壶数 */
export const THROWS_PER_END = STONES_PER_SIDE * 2
/** 一局结算后的停顿 tick 数（给渲染层展示时间） */
export const SETTLE_TICKS = 45
/** 每 tick 蓄力增量：满蓄力约 63 tick ≈ 1.05 秒 */
export const CHARGE_RATE = 0.016
/** 每 tick 调向增量（弧度），按住约 1.1 秒打满一整幅 */
export const AIM_RATE = 0.015
/** 一次 action 最多推进的 tick 数（防止长帧瞬移） */
export const MAX_TICK_STEPS = 8
/** AI 试算的滑行 tick 上限 */
export const MAX_SIM_TICKS = 1400

/** 0 = 玩家，1 = AI */
export type Owner = 0 | 1

export interface Stone {
  id: number
  owner: Owner
  x: number
  y: number
  vx: number
  vy: number
}

/** aim：瞄准（可蓄力 / 调向）；sliding：滑行中；settle：本局已结算的停顿；over：终局 */
export type Phase = 'aim' | 'sliding' | 'settle' | 'over'

export interface State {
  /** 场上冰壶（本局内累积，跨局清空） */
  stones: Stone[]
  /** 当前出手方 */
  turn: Owner
  /** 第几局 1..ROUNDS */
  round: number
  /** 本局双方合计已投壶数 */
  throws: number
  /** 蓄力量 0..1 */
  power: number
  /** 方向角（弧度），0 为正下方，正值向右 */
  angle: number
  /** 是否正在蓄力 */
  charging: boolean
  /** 按住调向：-1 左、1 右、0 不按 */
  aimDir: -1 | 0 | 1
  phase: Phase
  /** settle 阶段剩余 tick */
  settle: number
  /** 本次滑行已推进的 tick 数 */
  slideTicks: number
  /** 累计碰撞次数（effects 用） */
  hits: number
  /** 玩家 / AI 累计总分 */
  total: [number, number]
  /** 本局得分（未结算为 0） */
  roundScore: [number, number]
  /** 最近一次结算的得分（渲染提示用） */
  lastEnd: [number, number]
  /** 最近投出的壶 id，-1 表示本局还没投 */
  lastStone: number
  /** 下一个壶 id */
  nextId: number
  /** 可播种随机游标（AI 用） */
  rng: number
  over: boolean
  /** 胜者：0 玩家 / 1 AI / -1 平局或未结束 */
  winner: -1 | Owner
}

export type Action =
  /** 推进固定步长（steps 默认 1，由渲染层按真实 dt 折算） */
  | { type: 'tick'; steps?: number }
  /** 调向：hold=true 为按住（每 tick 持续生效），否则为单次微调 */
  | { type: 'aim'; dir: -1 | 0 | 1; hold?: boolean }
  /** 蓄力开关：开始蓄力 / 已在蓄力则出壶 */
  | { type: 'charge' }
  /** 松手出壶（用当前 power 与 angle） */
  | { type: 'release' }
  /** 一次出壶（AI 直接使用，也用于测试） */
  | { type: 'shoot'; power: number; angle: number; rng?: number }
  /** 跳过结算停顿，立即进入下一局或终局 */
  | { type: 'next' }

export function create(seed: number): State {
  const r = new Rng(seed)
  return {
    stones: [],
    turn: 0,
    round: 1,
    throws: 0,
    power: 0,
    angle: 0,
    charging: false,
    aimDir: 0,
    phase: 'aim',
    settle: 0,
    slideTicks: 0,
    hits: 0,
    total: [0, 0],
    roundScore: [0, 0],
    lastEnd: [0, 0],
    lastStone: -1,
    nextId: 0,
    rng: r.s,
    over: false,
    winner: -1,
  }
}

// ---------------- 计分 ----------------

/** 单壶按距圆心距离得分：越近越高，圆心 5 分，出 house 为 0 分 */
export function stonePoints(d: number): number {
  if (d <= RING_CORE) return 5
  if (d <= RING_1) return 4
  if (d <= RING_2) return 3
  if (d <= RING_3) return 2
  if (d <= HOUSE_R) return 1
  return 0
}

/**
 * 本局结算：距圆心最近的壶（必须在 house 内）所属一方得分，
 * 得分 = 该方所有「在 house 内且比对方最近壶更近」的壶的分数之和。
 * 没有壶或最近壶出界时返回 { team: -1, points: 0 }（空局）。
 */
export function endScore(stones: readonly Stone[]): { team: -1 | Owner; points: number } {
  let bestId = -1
  let bestD = Number.POSITIVE_INFINITY
  for (const s of stones) {
    const d = dist(s.x, s.y, BUTTON.x, BUTTON.y)
    if (d < bestD) {
      bestD = d
      bestId = s.id
    }
  }
  if (bestId < 0 || bestD > HOUSE_R) return { team: -1, points: 0 }
  const lead = stones.find((s) => s.id === bestId)
  if (!lead) return { team: -1, points: 0 }
  const team = lead.owner
  let oppD = Number.POSITIVE_INFINITY
  for (const s of stones) {
    if (s.owner === team) continue
    const d = dist(s.x, s.y, BUTTON.x, BUTTON.y)
    if (d < oppD) oppD = d
  }
  let points = 0
  for (const s of stones) {
    if (s.owner !== team) continue
    const d = dist(s.x, s.y, BUTTON.x, BUTTON.y)
    if (d <= HOUSE_R && d < oppD) points += stonePoints(d)
  }
  return { team, points }
}

/** 累计总分（玩家 / AI） */
export function totalScore(state: State): [number, number] {
  return [state.total[0], state.total[1]]
}

/** 胜者：0 玩家 / 1 AI / -1 平局或未结束 */
export function winnerOf(state: State): -1 | Owner {
  if (!state.over) return -1
  if (state.total[0] === state.total[1]) return -1
  return state.total[0] > state.total[1] ? 0 : 1
}

// ---------------- 物理（手写刚体，不依赖任何引擎） ----------------

/** 摩擦减速；返回是否还有冰壶在移动 */
export function applyFriction(stones: Stone[]): boolean {
  let moving = false
  for (const s of stones) {
    const sp = Math.hypot(s.vx, s.vy)
    if (sp <= 0) continue
    const next = sp * FRICTION
    if (next < STOP_SPEED) {
      s.vx = 0
      s.vy = 0
      continue
    }
    const k = next / sp
    s.vx *= k
    s.vy *= k
    moving = true
  }
  return moving
}

/** 边界约束：把冰壶夹回冰道内并吸收法向速度，保证不出界 */
export function clampWalls(stones: Stone[]): void {
  const minX = SHEET.left + STONE_R
  const maxX = SHEET.right - STONE_R
  const minY = SHEET.top + STONE_R
  const maxY = SHEET.bottom - STONE_R
  for (const s of stones) {
    if (s.x < minX) {
      s.x = minX
      if (s.vx < 0) s.vx = -s.vx * 0.35
    } else if (s.x > maxX) {
      s.x = maxX
      if (s.vx > 0) s.vx = -s.vx * 0.35
    }
    if (s.y < minY) {
      s.y = minY
      if (s.vy < 0) s.vy = -s.vy * 0.3
    } else if (s.y > maxY) {
      s.y = maxY
      if (s.vy > 0) s.vy = 0
    }
  }
}

/**
 * 圆-圆碰撞解算（会就地修改传入的冰壶，仅供内部与单测使用）：
 *   1) 沿连心线把两壶各推开一半重叠量（位置分离）；
 *   2) 沿法线交换法向速度分量（等质量冲量，动量守恒，恢复系数 RESTITUTION 损失动能）。
 * 迭代次数上限 MAX_SEPARATION_ITERS（传入更大值会被钳到上限）。
 * 返回第一次迭代中发生碰撞的「对数」。
 */
export function resolveCollisions(stones: Stone[], iters: number): number {
  const n = stones.length
  const rounds = clamp(Math.floor(iters), 0, MAX_SEPARATION_ITERS)
  const minD = STONE_R * 2
  let hits = 0
  for (let it = 0; it < rounds; it++) {
    let any = false
    for (let i = 0; i < n; i++) {
      const a = stones[i]
      if (!a) continue
      for (let j = i + 1; j < n; j++) {
        const b = stones[j]
        if (!b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d2 = dx * dx + dy * dy
        if (d2 >= minD * minD) continue
        const d = Math.sqrt(d2)
        let nx = 0
        let ny = 1
        if (d > 1e-6) {
          nx = dx / d
          ny = dy / d
        }
        // 1) 位置分离
        const push = (minD - d) / 2
        a.x -= nx * push
        a.y -= ny * push
        b.x += nx * push
        b.y += ny * push
        // 2) 动量传递：沿法线交换法向速度分量
        const rvx = b.vx - a.vx
        const rvy = b.vy - a.vy
        const vn = rvx * nx + rvy * ny
        if (vn < 0) {
          const imp = (-(1 + RESTITUTION) * vn) / 2
          a.vx -= imp * nx
          a.vy -= imp * ny
          b.vx += imp * nx
          b.vy += imp * ny
        }
        if (it === 0) {
          hits += 1
          any = true
        }
      }
    }
    if (!any && it > 0) break
  }
  return hits
}

/** 推进一个固定 tick 的物理，返回新数组（不修改入参） */
export function stepStones(
  stones: readonly Stone[],
  slideTicks: number,
): { stones: Stone[]; moving: boolean; hits: number } {
  const arr = stones.map((s) => ({ ...s }))
  for (const s of arr) {
    s.x += s.vx
    s.y += s.vy
  }
  clampWalls(arr)
  const hits = resolveCollisions(arr, MAX_SEPARATION_ITERS)
  clampWalls(arr)
  let moving = applyFriction(arr)
  // 滑行硬上限：极端参数下也必须停下来，绝不允许永不分胜负
  if (slideTicks + 1 >= MAX_SLIDE_TICKS) {
    for (const s of arr) {
      s.vx = 0
      s.vy = 0
    }
    moving = false
  }
  return { stones: arr, moving, hits }
}

// ---------------- 状态迁移（纯函数） ----------------

function doShoot(state: State, power: number, angle: number, rngNext: number | undefined): State {
  if (state.phase !== 'aim' || state.over) return state
  const p = clamp(power, MIN_POWER, 1)
  const a = clamp(angle, -MAX_ANGLE, MAX_ANGLE)
  const sp = MAX_SPEED * p
  const stone: Stone = {
    id: state.nextId,
    owner: state.turn,
    x: THROW_X,
    y: THROW_Y,
    vx: Math.sin(a) * sp,
    vy: Math.cos(a) * sp,
  }
  return {
    ...state,
    stones: [...state.stones, stone],
    nextId: state.nextId + 1,
    lastStone: stone.id,
    throws: state.throws + 1,
    power: 0,
    charging: false,
    aimDir: 0,
    phase: 'sliding',
    slideTicks: 0,
    rng: rngNext ?? state.rng,
  }
}

/** 所有冰壶停下后结算本局，并决定「下一投」或「进入结算停顿」 */
function settleEnd(state: State): State {
  const res = endScore(state.stones)
  const total: [number, number] = [state.total[0], state.total[1]]
  const roundScore: [number, number] = [0, 0]
  const lastEnd: [number, number] = [0, 0]
  // res.team 是 -1 | 0 | 1：元组下标必须先收窄到 0 | 1 才能安全索引（>= 不能收窄字面量联合）
  const team = res.team === 1 ? 1 : res.team === 0 ? 0 : null
  if (res.points > 0 && team !== null) {
    total[team] += res.points
    roundScore[team] = res.points
    lastEnd[team] = res.points
  }
  if (state.throws >= THROWS_PER_END) {
    // 本局投满：进入结算停顿，随后（advanceAfterSettle）开下一局或终局
    return { ...state, total, roundScore, lastEnd, phase: 'settle', settle: SETTLE_TICKS, charging: false, aimDir: 0 }
  }
  const turn: Owner = state.turn === 0 ? 1 : 0
  return {
    ...state,
    total,
    roundScore,
    lastEnd,
    turn,
    power: 0,
    charging: false,
    aimDir: 0,
    phase: 'aim',
    slideTicks: 0,
  }
}

/** 结算停顿结束：开下一局，或判定终局 */
function advanceAfterSettle(state: State): State {
  if (state.over) return state
  if (state.round >= ROUNDS) {
    const total: [number, number] = [state.total[0], state.total[1]]
    const winner: -1 | Owner = total[0] === total[1] ? -1 : total[0] > total[1] ? 0 : 1
    return { ...state, over: true, phase: 'over', winner, settle: 0, power: 0, charging: false, aimDir: 0 }
  }
  return {
    ...state,
    round: state.round + 1,
    throws: 0,
    stones: [],
    turn: 0,
    phase: 'aim',
    settle: 0,
    slideTicks: 0,
    hits: 0,
    power: 0,
    charging: false,
    aimDir: 0,
    roundScore: [0, 0],
    lastEnd: [0, 0],
    lastStone: -1,
  }
}

/** 单个固定 tick：先处理蓄力 / 调向，再推进物理，最后检查终局条件 */
function tickOnce(state: State): State {
  let power = state.power
  let angle = state.angle
  let charging = state.charging
  const aimDir = state.aimDir
  if (state.phase === 'aim') {
    if (charging) power = clamp(power + CHARGE_RATE, 0, 1)
    if (aimDir !== 0) angle = clamp(angle + AIM_RATE * aimDir, -MAX_ANGLE, MAX_ANGLE)
  }

  if (state.phase === 'sliding') {
    const st = stepStones(state.stones, state.slideTicks)
    const base: State = { ...state, stones: st.stones, power, angle, charging, aimDir, slideTicks: state.slideTicks + 1 }
    // 停下来了就必须结算：要么换下一投，要么进结算停顿 / 终局（不会滞留在 sliding）
    if (!st.moving) return settleEnd({ ...base, slideTicks: 0 })
    return { ...base, hits: state.hits + st.hits }
  }

  if (state.phase === 'settle') {
    const settle = state.settle - 1
    const base: State = { ...state, settle, power, angle, charging, aimDir }
    if (settle > 0) return base
    return advanceAfterSettle(base)
  }

  return { ...state, power, angle, charging, aimDir }
}

function doTick(state: State, steps: number): State {
  const n = clamp(Math.floor(steps), 0, MAX_TICK_STEPS)
  let s = state
  for (let i = 0; i < n; i++) {
    if (s.over) break
    s = tickOnce(s)
  }
  return s
}

/** 纯函数状态迁移：非法 / 终局动作原样返回入参（引用相等） */
export function reduce(state: State, action: Action): State {
  if (state.over) return state
  switch (action.type) {
    case 'tick':
      return doTick(state, action.steps ?? 1)
    case 'aim': {
      if (state.phase !== 'aim') return state
      const dir: -1 | 0 | 1 = action.dir > 0 ? 1 : action.dir < 0 ? -1 : 0
      if (action.hold === true) return { ...state, aimDir: dir }
      if (dir === 0) return { ...state, aimDir: 0 }
      return { ...state, aimDir: 0, angle: clamp(state.angle + AIM_RATE * dir, -MAX_ANGLE, MAX_ANGLE) }
    }
    case 'charge': {
      if (state.phase !== 'aim') return state
      if (state.charging) return doShoot(state, state.power, state.angle, undefined)
      return { ...state, charging: true }
    }
    case 'release': {
      if (state.phase !== 'aim') return state
      return doShoot(state, state.power, state.angle, undefined)
    }
    case 'shoot':
      return doShoot(state, action.power, action.angle, action.rng)
    case 'next': {
      if (state.phase !== 'settle') return state
      return advanceAfterSettle({ ...state, settle: 0 })
    }
  }
}

// ---------------- AI（枚举候选 action，用同一个 reduce 试算） ----------------

/** 候选蓄力量 */
export const AI_POWERS: readonly number[] = (() => {
  const out: number[] = []
  for (let p = 0.56; p <= 1.0001; p += 0.06) out.push(Math.round(p * 1000) / 1000)
  return out
})()
/** 候选方向角（弧度） */
export const AI_ANGLES: readonly number[] = (() => {
  const out: number[] = []
  for (let a = -0.24; a <= 0.2401; a += 0.06) out.push(Math.round(a * 1000) / 1000)
  return out
})()

/** 空场上「无限远」的哨兵距离 */
const FAR = 10000
/** 近似并列的容差：在最优解附近随机取一个，避免每局手法完全一样 */
const AI_TIE_TOLERANCE = 0.5

/**
 * 用 reduce 试算一次出壶，直到滑行结束。
 * 只调用 reduce，不在本文件外维护第二套规则。
 */
export function simulate(state: State, power: number, angle: number): State {
  let s = reduce(state, { type: 'shoot', power, angle })
  let guard = 0
  while (s.phase === 'sliding' && guard < MAX_SIM_TICKS) {
    s = reduce(s, { type: 'tick' })
    guard += 1
  }
  if (s.phase === 'sliding') s = reduce(s, { type: 'next' })
  return s
}

/** 局面评估（越大越好）：自己的圆心得分 + 位置优势 - 对手的圆心得分 */
export function boardValue(state: State, owner: Owner): number {
  let ownBest = FAR
  let oppBest = FAR
  let ownPts = 0
  let oppPts = 0
  for (const s of state.stones) {
    const d = dist(s.x, s.y, BUTTON.x, BUTTON.y)
    if (s.owner === owner) {
      if (d < ownBest) ownBest = d
      if (d <= HOUSE_R) ownPts += stonePoints(d)
    } else {
      if (d < oppBest) oppBest = d
      if (d <= HOUSE_R) oppPts += stonePoints(d)
    }
  }
  return ownPts - 2 * oppPts + (oppBest - ownBest) * 0.5
}

/** 轮到 AI 且处于瞄准阶段时返回动作，否则 null */
export function aiAction(state: State): Action | null {
  if (state.over || state.phase !== 'aim' || state.turn !== 1) return null
  const r = new Rng(state.rng)
  const scored: { p: number; a: number; v: number }[] = []
  let bestV = Number.NEGATIVE_INFINITY
  for (const p of AI_POWERS) {
    for (const a of AI_ANGLES) {
      const v = boardValue(simulate(state, p, a), 1)
      scored.push({ p, a, v })
      if (v > bestV) bestV = v
    }
  }
  const pool = scored.filter((c) => c.v >= bestV - AI_TIE_TOLERANCE)
  const pick = pool[Math.min(pool.length - 1, r.int(pool.length))]
  if (!pick) return { type: 'shoot', power: 0.8, angle: 0 }
  return { type: 'shoot', power: pick.p, angle: pick.a, rng: r.s }
}
