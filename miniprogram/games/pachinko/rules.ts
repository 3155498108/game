/**
 * 弹戏 pachinko —— 简化重力 + 圆碰撞的弹珠落区玩法（纯逻辑，零 DOM 依赖）。
 *
 * 硬约束（与 DECISIONS.md 的命名裁决一致）：本玩法**不是完整物理引擎**。
 * 采用「固定步长 + 单次穿透解算 + 固定恢复系数」的极简近似：
 *   1. 每 tick 只积分一次位置（dt 固定 1/60 秒）；
 *   2. 每 tick 只解算**一次**穿透 —— 在所有碰撞体（左右墙 / 钉子 / 左右挡板）中
 *      取「穿透最深」的那一个推开，其余留给下一 tick，避免抖动与死循环；
 *   3. 恢复系数固定，不做能量守恒、不做刚体、不做旋转惯量。
 *
 * 渲染层用 performance.now() 算真实 dt，再折算成整数 tick 数发 `step` action；
 * 本文件内不存在 performance / Date / Math.random，随机一律走 Rng。
 */
import { Rng } from '../../core/rng'
import { clamp } from '../../core/geom'

// ---------------------------------------------------------------- 场地尺寸
export const VW = 720
export const VH = 1280

// ---------------------------------------------------------------- 定步参数
/** 固定步长（秒）：逻辑内所有积分都按此步长推进 */
export const DT = 1 / 60
/** 重力加速度（逻辑像素 / 秒²） */
export const GRAVITY = 1400
/** 空气阻尼（每 tick 乘一次） */
export const AIR_DRAG = 0.9995
/** 限速：单 tick 位移 ≈ 13px < 钉子捕获带 40px，避免高速穿钉 */
export const MAX_SPEED = 820
/** 固定恢复系数 */
export const RESTITUTION = 0.45

// ---------------------------------------------------------------- 几何常量
export const BALL_R = 13
export const PEG_R = 7
/** 左右墙内缩量（球心不得越过 WALL_MARGIN + BALL_R） */
export const WALL_MARGIN = 12

/** 钉阵：7 行交错排布 */
export const PEG_TOP = 250
export const PEG_ROWS = 7
export const PEG_ROW_GAP = 96
export const PEG_COL_GAP = 86
export const PEG_COL0_X = 360
export const PEG_MARGIN = 42

/** 投放区 */
export const CHUTE_TOP = 104
export const LAUNCH_Y = 150
export const LAUNCH_MIN_X = WALL_MARGIN + BALL_R
export const LAUNCH_MAX_X = VW - WALL_MARGIN - BALL_R

/** 底部分值区 */
export const SLOT_TOP = 1000
export const SLOT_H = 180
export const SLOT_COUNT = 7
export const SLOT_W = VW / SLOT_COUNT
/** 弹珠 y 越过这条线即判定落区 */
export const SLOT_TRIGGER_Y = SLOT_TOP + SLOT_H * 0.35

/** 左右挡板 */
export const FLIPPER_Y = 946
export const FLIPPER_LEN = 100
export const FLIPPER_R = 8
export const FLIPPER_MIN = -1.15
export const FLIPPER_MAX = 1.15
export const FLIPPER_STEP = 0.16
export const LEFT_PIVOT_X = 230
export const RIGHT_PIVOT_X = 490
/** 挡板操控区：指针落在这条线以下视为拖挡板，不视为投放 */
export const FLIPPER_ZONE_TOP = 840
/** 挡板击球附加的水平冲量（像素 / 秒）：左板向右打，右板向左打 */
export const FLIPPER_KICK = 190

/** 限定弹珠数量 */
export const BALL_LIMIT = 8
/** 单珠存活上限（tick）：防止球永久卡在挡板上导致对局无法结束 */
export const BALL_MAX_LIFE = 900

export type Side = 'left' | 'right'
const SIDES: readonly Side[] = ['left', 'right']

export interface Peg {
  x: number
  y: number
  r: number
}

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  /** 已存活 tick 数 */
  life: number
  /** 是否已进入分值区（结算后不再模拟） */
  scored: boolean
  /** 本珠结算到的分数；超时回收为 0 */
  gain: number
}

export interface State {
  /** 钉阵（由 seed 决定布局变体，可复盘） */
  pegs: Peg[]
  /** 底部分值区的分值（由 seed 选定的梯度，可复盘） */
  slotValues: number[]
  /** 左挡板角度（弧度，正数 = 梢部抬高） */
  leftAngle: number
  /** 右挡板角度 */
  rightAngle: number
  /** 挡板是否处于刚被操作的激活态（仅供渲染高亮） */
  leftActive: boolean
  rightActive: boolean
  /** 场上所有弹珠（含已结算、停在分值区里的） */
  balls: Ball[]
  /** 剩余可投放弹珠 */
  ballsLeft: number
  /** 投放口当前 x（渲染用） */
  launchX: number
  /** 总分 */
  score: number
  /** 最近一次落区结算（供渲染闪光与特效） */
  lastScore: { index: number; value: number } | null
  over: boolean
  /** 自增序号，供渲染做动画脉冲 */
  seq: number
  /** 随机游标（只在 create 时推进） */
  rng: number
}

export type Action =
  /** 投放一颗弹珠（x 会被夹到投放区内） */
  | { type: 'launch'; x: number }
  /** 推进固定步长：n 个 tick */
  | { type: 'step'; n: number }
  /** 键盘式微调左挡板 */
  | { type: 'flipLeft'; delta: number }
  | { type: 'flipRight'; delta: number }
  /** 指针拖动：直接设定左挡板角度 */
  | { type: 'setLeft'; angle: number }
  | { type: 'setRight'; angle: number }

// ---------------------------------------------------------------- 分值梯度
/** 三套分值梯度，由 Rng 选定其一，保证不同种子布局不同但完全可复盘 */
const SLOT_LADDERS: readonly (readonly number[])[] = [
  [10, 25, 50, 100, 50, 25, 10],
  [5, 20, 60, 140, 60, 20, 5],
  [20, 40, 90, 200, 90, 40, 20],
]

// ---------------------------------------------------------------- 纯工具
export function slotCenterX(i: number): number {
  return i * SLOT_W + SLOT_W / 2
}

/** 该 x 属于哪个分值区（0..SLOT_COUNT-1） */
export function slotIndexAt(x: number): number {
  return clamp(Math.floor(x / SLOT_W), 0, SLOT_COUNT - 1)
}

function pivotX(side: Side): number {
  return side === 'left' ? LEFT_PIVOT_X : RIGHT_PIVOT_X
}

/** 挡板梢部坐标。约定：角度为正 = 梢部抬高（两板一致）。 */
export function flipperTip(side: Side, angle: number): { x: number; y: number } {
  const ux = side === 'left' ? Math.cos(angle) : -Math.cos(angle)
  const uy = -Math.sin(angle)
  return { x: pivotX(side) + ux * FLIPPER_LEN, y: FLIPPER_Y + uy * FLIPPER_LEN }
}

/** 指针位置 → 挡板角度（拖梢部的直观映射） */
export function flipperAngleFromPointer(side: Side, x: number, y: number): number {
  const dx = x - pivotX(side)
  const dy = y - FLIPPER_Y
  const a = side === 'left' ? Math.atan2(-dy, dx) : Math.atan2(-dy, -dx)
  return clamp(a, FLIPPER_MIN, FLIPPER_MAX)
}

/** 线段上距给定点最近的点（用于挡板按线段近似为胶囊） */
function closestOnSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): { x: number; y: number } {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = 0
  if (len2 > 0) t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1)
  return { x: ax + dx * t, y: ay + dy * t }
}

// ---------------------------------------------------------------- 布局生成
function buildPegs(variant: number): Peg[] {
  const base = variant === 1 ? PEG_COL_GAP / 2 : variant === 2 ? -PEG_COL_GAP / 2 : 0
  const out: Peg[] = []
  for (let r = 0; r < PEG_ROWS; r++) {
    const y = PEG_TOP + r * PEG_ROW_GAP
    const off = base + (r % 2 === 0 ? 0 : PEG_COL_GAP / 2)
    for (let k = -8; k <= 8; k++) {
      const x = PEG_COL0_X + off + k * PEG_COL_GAP
      if (x < PEG_MARGIN || x > VW - PEG_MARGIN) continue
      out.push({ x, y, r: PEG_R })
    }
  }
  return out
}

// ---------------------------------------------------------------- 构造
export function create(seed: number): State {
  const r = new Rng(seed)
  const variant = r.int(3)
  const slotValues = [...r.pick(SLOT_LADDERS)]
  return {
    pegs: buildPegs(variant),
    slotValues,
    // 挡板默认梢部略低（负角）：静置的球会自然滑落到分值区；
    // 玩家主动把板打上去才是「救球」，避免球长时间悬在板上。
    leftAngle: -0.12,
    rightAngle: -0.12,
    leftActive: false,
    rightActive: false,
    balls: [],
    ballsLeft: BALL_LIMIT,
    launchX: VW / 2,
    score: 0,
    lastScore: null,
    over: false,
    seq: 0,
    rng: r.s,
  }
}

// ---------------------------------------------------------------- 碰撞解算
/**
 * 每 tick 只解算一次穿透：扫描所有碰撞体，挑穿透最深的一个推开。
 * 钉阵间距 104px 远大于两倍捕获半径（40px），球不可能同时嵌进两颗钉子，
 * 因此「只解最深」既能消除重叠，又不会把球推回另一个碰撞体里。
 */
function resolveDeepest(b: Ball, s: State): void {
  let pen = 0
  let nx = 0
  let ny = 0
  let kick = 0

  // 左右墙
  const lp = BALL_R + WALL_MARGIN - b.x
  if (lp > pen) {
    pen = lp
    nx = 1
    ny = 0
  }
  const rp = b.x + BALL_R + WALL_MARGIN - VW
  if (rp > pen) {
    pen = rp
    nx = -1
    ny = 0
  }

  // 钉子（圆）
  for (let i = 0; i < s.pegs.length; i++) {
    const p = s.pegs[i]
    const dx = b.x - p.x
    const dy = b.y - p.y
    const rr = BALL_R + p.r
    const d2 = dx * dx + dy * dy
    if (d2 >= rr * rr) continue
    const d = Math.sqrt(d2)
    const p2 = rr - d
    if (p2 > pen) {
      pen = p2
      if (d > 1e-6) {
        nx = dx / d
        ny = dy / d
      } else {
        nx = 0
        ny = -1
      }
      kick = 0
    }
  }

  // 挡板（线段近似为胶囊）
  for (let i = 0; i < SIDES.length; i++) {
    const side = SIDES[i]
    const angle = side === 'left' ? s.leftAngle : s.rightAngle
    const tip = flipperTip(side, angle)
    const c = closestOnSeg(b.x, b.y, pivotX(side), FLIPPER_Y, tip.x, tip.y)
    const dx = b.x - c.x
    const dy = b.y - c.y
    const rr = BALL_R + FLIPPER_R
    const d2 = dx * dx + dy * dy
    if (d2 >= rr * rr) continue
    const d = Math.sqrt(d2)
    const p2 = rr - d
    if (p2 > pen) {
      pen = p2
      if (d > 1e-6) {
        nx = dx / d
        ny = dy / d
      } else {
        nx = 0
        ny = -1
      }
      kick = side === 'left' ? FLIPPER_KICK : -FLIPPER_KICK
    }
  }

  if (pen <= 0) return

  b.x += nx * pen
  b.y += ny * pen
  const vn = b.vx * nx + b.vy * ny
  if (vn < 0) {
    b.vx -= (1 + RESTITUTION) * vn * nx
    b.vy -= (1 + RESTITUTION) * vn * ny
  }
  if (kick !== 0) {
    b.vx += kick
    if (b.vy > -100) b.vy = -100
  }
}

/** 单个 tick 的推进（纯函数：只读入参，返回全新状态） */
function stepOnce(state: State): State {
  const next: Ball[] = []
  let score = state.score
  let lastScore = state.lastScore

  for (let i = 0; i < state.balls.length; i++) {
    const ball = state.balls[i]
    // 已结算的球不再模拟，保持停在分值区里作为展示
    if (ball.scored) {
      next.push({ ...ball })
      continue
    }

    const b: Ball = { ...ball }
    b.vy += GRAVITY * DT
    b.vx *= AIR_DRAG
    const sp = Math.hypot(b.vx, b.vy)
    if (sp > MAX_SPEED) {
      b.vx = (b.vx / sp) * MAX_SPEED
      b.vy = (b.vy / sp) * MAX_SPEED
    }
    b.x += b.vx * DT
    b.y += b.vy * DT
    b.life += 1

    resolveDeepest(b, state)

    // 进入分值区 → 结算（把球摆到该格中心停住，供渲染展示）
    if (b.y >= SLOT_TRIGGER_Y) {
      const si = slotIndexAt(b.x)
      const value = state.slotValues[si]
      b.scored = true
      b.gain = value
      b.x = slotCenterX(si)
      b.y = SLOT_TRIGGER_Y
      score += value
      lastScore = { index: si, value }
      next.push(b)
      continue
    }

    // 超时或落到画布外 → 回收，0 分（保证对局一定收敛）
    if (b.life > BALL_MAX_LIFE || b.y + BALL_R > VH) continue
    next.push(b)
  }

  let pending = 0
  for (let i = 0; i < next.length; i++) if (!next[i].scored) pending++

  return {
    ...state,
    balls: next,
    score,
    lastScore,
    leftActive: false,
    rightActive: false,
    over: state.ballsLeft <= 0 && pending === 0,
    seq: state.seq + 1,
  }
}

// ---------------------------------------------------------------- 状态迁移
/** 纯函数状态迁移：不读时间、不读全局随机数、不修改入参 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'launch': {
      if (state.over || state.ballsLeft <= 0) return state
      const raw = Number.isFinite(action.x) ? action.x : VW / 2
      const x = clamp(raw, LAUNCH_MIN_X, LAUNCH_MAX_X)
      const ball: Ball = { x, y: LAUNCH_Y, vx: 0, vy: 0, life: 0, scored: false, gain: 0 }
      return {
        ...state,
        balls: [...state.balls, ball],
        ballsLeft: state.ballsLeft - 1,
        launchX: x,
        leftActive: false,
        rightActive: false,
      }
    }

    case 'step': {
      if (state.over) return state
      const raw = Math.floor(action.n)
      const n = clamp(Number.isFinite(raw) ? raw : 1, 1, 8)
      let s = state
      for (let i = 0; i < n && !s.over; i++) s = stepOnce(s)
      return s
    }

    case 'flipLeft': {
      if (state.over) return state
      const d = Number.isFinite(action.delta) ? action.delta : 0
      const a = clamp(state.leftAngle + d, FLIPPER_MIN, FLIPPER_MAX)
      if (a === state.leftAngle) return state
      return { ...state, leftAngle: a, leftActive: true, rightActive: false }
    }

    case 'flipRight': {
      if (state.over) return state
      const d = Number.isFinite(action.delta) ? action.delta : 0
      const a = clamp(state.rightAngle + d, FLIPPER_MIN, FLIPPER_MAX)
      if (a === state.rightAngle) return state
      return { ...state, rightAngle: a, rightActive: true, leftActive: false }
    }

    case 'setLeft': {
      if (state.over) return state
      const a = Number.isFinite(action.angle) ? clamp(action.angle, FLIPPER_MIN, FLIPPER_MAX) : state.leftAngle
      if (a === state.leftAngle) return state
      return { ...state, leftAngle: a, leftActive: true, rightActive: false }
    }

    case 'setRight': {
      if (state.over) return state
      const a = Number.isFinite(action.angle) ? clamp(action.angle, FLIPPER_MIN, FLIPPER_MAX) : state.rightAngle
      if (a === state.rightAngle) return state
      return { ...state, rightAngle: a, rightActive: true, leftActive: false }
    }
  }
}

/** 一次跑 n 个固定 tick（测试与演示用的便捷入口） */
export function run(state: State, n: number): State {
  return reduce(state, { type: 'step', n })
}

/** 场上尚未结算的弹珠数 */
export function pendingBalls(state: State): number {
  let n = 0
  for (let i = 0; i < state.balls.length; i++) if (!state.balls[i].scored) n++
  return n
}
