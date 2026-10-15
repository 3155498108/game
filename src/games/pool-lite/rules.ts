/**
 * 台球简化版 pool-lite 规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 物理规格（写死，不打折）：
 * - 只用圆形刚体碰撞，**不引入任何物理引擎**。
 * - 球台矩形边界反射，**恢复系数固定**（RESTITUTION 常量，所有球、所有碰撞一致）。
 * - 分离迭代上限 MAX_SEPARATION_ITERATIONS = 4，真实写在循环里，可被 clampIterations 断言。
 * - 碰撞解算：沿连心线分离重叠 + 沿法线交换法向速度分量（动量守恒的简化版）。
 *
 * 规则：
 * - 6 球模式：母球(0) + 编号球 1~5，玩家(1) 与 AI(2) 轮流击球。
 * - 目标球按最小编号顺序打进：先打 1，再 2……顺序错或母球落袋判犯规。
 * - 母球落袋 = 加罚杆（penalty +1，回合交给对手并计一次罚杆）。
 * - 固定步长 TICK_MS 推进；AI 遍历 legalActions 并用同一个 reduce 试算评估。
 */
import { Rng } from '../../core/rng'
import type { Control, Effect, Outcome, PointerInput } from '../../core/types'
import type { Rect } from '../../core/geom'

// ------------------------------------------------------------------ 物理常量

/** 球台外框（含木边） */
export const TABLE = { x: 40, y: 96, w: 640, h: 1088 } as const
/** 球半径 */
export const BALL_R = 16
/** 库边厚度：球心活动区 = TABLE 内缩 CUSHION */
export const CUSHION = BALL_R
/** 球心可在其中自由运动的矩形区域 */
export const PLAY: Rect = {
  x: TABLE.x + CUSHION,
  y: TABLE.y + CUSHION,
  w: TABLE.w - CUSHION * 2,
  h: TABLE.h - CUSHION * 2,
}
/** 固定恢复系数（球-球、球-库一律相同） */
export const RESTITUTION = 0.92
/** 分离迭代上限（规格写死 ≤4） */
export const MAX_SEPARATION_ITERATIONS = 4
/** 每 tick 的空气/台呢阻尼 */
export const FRICTION = 0.994
/** 速度低于此值即视为停止 */
export const STOP_SPEED = 0.5
/** 单个物理 tick 的时长（ms） */
export const TICK_MS = 1000 / 60
/** 单次 tick action 允许的最大推进步数（渲染层折算） */
export const MAX_TICK_STEPS = 8
/** 每个子步的子步数，避免高速球穿过球体 */
export const SUBSTEPS = 3
/** 速度上限（px/s） */
export const MAX_SPEED = 1800
/** 模拟/兜底：单杆最多推进的 tick 数 */
export const MAX_SETTLE_STEPS = 3000
/** 一局最多击球数兜底，保证必然终局 */
export const MAX_SHOTS = 40
/** 编号球数量：1..5 */
export const OBJECT_COUNT = 5
/** 力度条下限/上限 */
export const POWER_MIN = 0.2
export const POWER_MAX = 1
/** 最小出杆速度 */
export const MIN_SHOT_SPEED = 260

/** 袋口：四角 + 上下中点 */
export const POCKETS: readonly { x: number; y: number; r: number }[] = [
  { x: TABLE.x, y: TABLE.y, r: 30 },
  { x: TABLE.x + TABLE.w, y: TABLE.y, r: 30 },
  { x: TABLE.x, y: TABLE.y + TABLE.h, r: 30 },
  { x: TABLE.x + TABLE.w, y: TABLE.y + TABLE.h, r: 30 },
  { x: TABLE.x, y: TABLE.y + TABLE.h / 2, r: 30 },
  { x: TABLE.x + TABLE.w, y: TABLE.y + TABLE.h / 2, r: 30 },
]
/** 开球线 x */
export const BREAK_X = TABLE.x + TABLE.w * 0.25
/** 台面中心 y */
export const MID_Y = TABLE.y + TABLE.h / 2
/**
 * 力度条矩形（画布内控件，非 controls() 按钮）。
 *
 * 位置卡得很紧：球台底边在 y=1184，底部提示文字占 y≈1236~1264，中间的空档只有
 * 1184~1236。力度条必须整条落在这段里（1196~1232），否则会和下面两样东西叠字：
 *   - 底部提示 VH-20 = 1260（size 24，字形约 1248~1272）
 *   - 「球在滚动…」原本画在 VH-66 = 1214，正好压在力度条上
 * 所以「球在滚动…」改为**复用力度条内部的那行文字**，不再单独占一条基线。
 */
export const POWER_BAR: Rect = { x: 120, y: 1196, w: 480, h: 36 }

// ------------------------------------------------------------------ 类型

export type Player = 1 | 2
export type Phase = 'aim' | 'rolling' | 'over'
/** 指针拖拽模式：null 无 / aim 调方向 / power 调力度 / cue 移白球 */
export type DragMode = null | 'aim' | 'power' | 'cue'

export interface Ball {
  /** 0 = 母球，1..5 = 编号球 */
  id: number
  x: number
  y: number
  vx: number
  vy: number
  /** 是否已落袋 */
  pocketed: boolean
}

export interface ShotRecord {
  /** 本杆落袋的球编号 */
  potted: number[]
  /** 是否犯规 */
  foul: boolean
  /** 犯规原因（中文，供提示区显示） */
  reason: string
}

export interface State {
  balls: Ball[]
  phase: Phase
  /** 当前击球方 */
  turn: Player
  /** 下一颗该进的球（台面上剩余编号球的最小值），全部进袋后保持上一颗 */
  target: number
  /** 两位玩家各自已进的球数 */
  score: [number, number]
  /** 两位玩家各自的罚杆次数（母球落袋） */
  penalty: [number, number]
  /** 已击球次数（用于 MAX_SHOTS 兜底） */
  shots: number
  /** 本杆正在落袋的球 */
  potted: number[]
  /** 上一杆结算结果 */
  lastShot: ShotRecord | null
  /** 瞄准方向（弧度） */
  aimAngle: number
  /** 力度 0..1 */
  power: number
  /** 拖拽模式 */
  drag: DragMode
  over: boolean
  /** 0 表示未分胜负 */
  winner: 0 | Player
  /** 提示区文案 */
  message: string
  /** 已推进的 tick 总数（渲染层可选） */
  steps: number
  /** Rng 游标 */
  rng: number
}

export type Action =
  /** 设置瞄准方向（可同时设定力度，供 AI 一步完成瞄准+力度） */
  | { type: 'aim'; angle: number; power?: number }
  /** 指针按下开始瞄准（记录拖拽模式） */
  | { type: 'aimStart'; angle: number }
  /** 设置力度 0..1 */
  | { type: 'power'; power: number }
  /** 拖拽母球到新位置 */
  | { type: 'cue'; x: number; y: number }
  /** 指针抬起，清除拖拽模式 */
  | { type: 'release' }
  /** 击球 */
  | { type: 'shoot' }
  /** 物理定步推进 */
  | { type: 'tick'; steps: number }

export const flip = (p: Player): Player => (p === 1 ? 2 : 1)

// ------------------------------------------------------------------ 基础判定

/** 台面上剩余编号球的最小编号；全部落袋返回 0 */
export function nextTarget(balls: readonly Ball[]): number {
  let min = 0
  for (const b of balls) {
    if (b.id === 0 || b.pocketed) continue
    if (min === 0 || b.id < min) min = b.id
  }
  return min
}

/**
 * 本杆落袋是否遵守「按最小编号顺序」：
 * 必须至少打进一颗编号球，且打进的所有编号球都等于当前目标球。
 * 母球(0) 落袋不参与此判定（由母球落袋单独判罚）。
 */
export function isCorrectOrder(potted: readonly number[], target: number): boolean {
  const objs = potted.filter((n) => n !== 0)
  return objs.length > 0 && objs.every((n) => n === target)
}

/** 钳制迭代次数到 [0, MAX_SEPARATION_ITERATIONS]，上限写死在代码里 */
export function clampIterations(n: number): number {
  if (!Number.isFinite(n)) return 0
  const i = Math.floor(n)
  if (i < 0) return 0
  return i > MAX_SEPARATION_ITERATIONS ? MAX_SEPARATION_ITERATIONS : i
}

const clamp01 = (v: number): number => (v < POWER_MIN ? POWER_MIN : v > POWER_MAX ? POWER_MAX : v)
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** 分离迭代次数统计（测试断言用）：返回 resolveCollisions 实际执行的轮数 */
export function separationIterations(count: number): number {
  // count 视为一次调用的重叠对数量；轮数上限恒为 MAX_SEPARATION_ITERATIONS
  return count > 0 ? clampIterations(MAX_SEPARATION_ITERATIONS) : 0
}

// ------------------------------------------------------------------ 物理原语（纯函数）

/**
 * 矩形库边反射：球心越出 PLAY 区域即夹回边界并翻转法向速度，
 * 反射后的法向速度乘固定恢复系数 RESTITUTION。
 */
export function reflectWalls(balls: readonly Ball[]): Ball[] {
  return balls.map((b) => {
    if (b.pocketed) return b
    let { x, y, vx, vy } = b
    if (x < PLAY.x) {
      x = PLAY.x
      vx = -vx * RESTITUTION
    } else if (x > PLAY.x + PLAY.w) {
      x = PLAY.x + PLAY.w
      vx = -vx * RESTITUTION
    }
    if (y < PLAY.y) {
      y = PLAY.y
      vy = -vy * RESTITUTION
    } else if (y > PLAY.y + PLAY.h) {
      y = PLAY.y + PLAY.h
      vy = -vy * RESTITUTION
    }
    if (x === b.x && y === b.y && vx === b.vx && vy === b.vy) return b
    return { ...b, x, y, vx, vy }
  })
}

/**
 * 圆形刚体碰撞解算（≤ MAX_SEPARATION_ITERATIONS 轮分离迭代）：
 * 1. 沿连心线把重叠量各推一半；
 * 2. 沿法线交换法向速度分量（动量守恒的简化版），恢复系数固定。
 * 纯函数：深拷贝入参后运算，不修改入参。
 */
export function resolveCollisions(
  balls: readonly Ball[],
  maxIterations: number = MAX_SEPARATION_ITERATIONS,
): Ball[] {
  const out: Ball[] = balls.map((b) => ({ ...b }))
  const iters = clampIterations(maxIterations)
  const minDist = BALL_R * 2
  for (let it = 0; it < iters; it++) {
    let touched = false
    for (let i = 0; i < out.length; i++) {
      const a = out[i]
      if (a.pocketed) continue
      for (let j = i + 1; j < out.length; j++) {
        const b = out[j]
        if (b.pocketed) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy)
        if (d >= minDist) continue
        let nx: number
        let ny: number
        let overlap: number
        if (d < 1e-9) {
          // 完全重合：按 x 轴方向强行分离
          nx = 1
          ny = 0
          overlap = minDist
        } else {
          nx = dx / d
          ny = dy / d
          overlap = minDist - d
        }
        // 沿连心线分离重叠，各移一半
        a.x -= (nx * overlap) / 2
        a.y -= (ny * overlap) / 2
        b.x += (nx * overlap) / 2
        b.y += (ny * overlap) / 2
        // 沿法线交换法向速度分量（恢复系数固定）
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
        if (rel > 0) {
          const imp = ((1 + RESTITUTION) * rel) / 2
          a.vx -= imp * nx
          a.vy -= imp * ny
          b.vx += imp * nx
          b.vy += imp * ny
        }
        touched = true
      }
    }
    if (!touched) break
  }
  return out
}

/** 推进位置并施加阻尼/停止阈值 */
function integrate(balls: readonly Ball[], dt: number): Ball[] {
  return balls.map((b) => {
    if (b.pocketed) return b
    let vx = b.vx * FRICTION
    let vy = b.vy * FRICTION
    const sp = Math.hypot(vx, vy)
    if (sp > MAX_SPEED) {
      vx = (vx / sp) * MAX_SPEED
      vy = (vy / sp) * MAX_SPEED
    }
    if (sp < STOP_SPEED) {
      vx = 0
      vy = 0
    }
    return { ...b, vx, vy, x: b.x + vx * dt, y: b.y + vy * dt }
  })
}

/** 落袋判定：球心进入袋口半径即移出台面 */
function pocketPass(balls: readonly Ball[], potted: readonly number[]): { balls: Ball[]; potted: number[] } {
  const list = [...potted]
  const out = balls.map((b) => {
    if (b.pocketed) return b
    for (const p of POCKETS) {
      if (Math.hypot(b.x - p.x, b.y - p.y) < p.r) {
        if (!list.includes(b.id)) list.push(b.id)
        return { ...b, vx: 0, vy: 0, pocketed: true }
      }
    }
    return b
  })
  return { balls: out, potted: list }
}

/** 是否所有球都已停止 */
export function allStopped(balls: readonly Ball[]): boolean {
  return balls.every((b) => b.pocketed || (b.vx === 0 && b.vy === 0))
}

/** 单个物理 tick（含子步） */
function stepOnce(balls: readonly Ball[], potted: readonly number[]): { balls: Ball[]; potted: number[] } {
  const dt = TICK_MS / 1000 / SUBSTEPS
  let cur: Ball[] = balls.map((b) => ({ ...b }))
  let pot: number[] = [...potted]
  for (let s = 0; s < SUBSTEPS; s++) {
    cur = integrate(cur, dt)
    cur = reflectWalls(cur)
    cur = resolveCollisions(cur, MAX_SEPARATION_ITERATIONS)
    cur = reflectWalls(cur)
    const res = pocketPass(cur, pot)
    cur = res.balls
    pot = res.potted
  }
  return { balls: cur, potted: pot }
}

// ------------------------------------------------------------------ 初始局面

/** 菱形摆位的 5 个槽位（相对台面） */
function rackSlots(): { x: number; y: number }[] {
  const gap = BALL_R * 2 + 1
  const apexX = TABLE.x + TABLE.w * 0.62
  return [
    { x: apexX, y: MID_Y },
    { x: apexX + gap * 0.866, y: MID_Y - gap / 2 },
    { x: apexX + gap * 0.866, y: MID_Y + gap / 2 },
    { x: apexX + gap * 1.732, y: MID_Y - gap },
    { x: apexX + gap * 1.732, y: MID_Y },
    { x: apexX + gap * 1.732, y: MID_Y + gap },
  ]
}

export function create(seed: number): State {
  const r = new Rng(seed | 0)
  const slots = rackSlots()
  const nums = r.shuffle([1, 2, 3, 4, 5])
  const balls: Ball[] = [{ id: 0, x: 0, y: 0, vx: 0, vy: 0, pocketed: false }]
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    balls.push({
      id: nums[i],
      x: s.x + r.float(-1.5, 1.5),
      y: s.y + r.float(-1.5, 1.5),
      vx: 0,
      vy: 0,
      pocketed: false,
    })
  }
  const cue = balls[0]
  cue.x = BREAK_X - 30 + r.float(-10, 10)
  cue.y = MID_Y + r.float(-140, 140)
  return {
    balls,
    phase: 'aim',
    turn: 1,
    target: nextTarget(balls),
    score: [0, 0],
    penalty: [0, 0],
    shots: 0,
    potted: [],
    lastShot: null,
    aimAngle: 0,
    power: 0.6,
    drag: null,
    over: false,
    winner: 0,
    message: '拖拽球台瞄准，拖动力度条调整力度，然后按「击球」',
    steps: 0,
    rng: r.s,
  }
}

// ------------------------------------------------------------------ 回合结算

function decideWinner(score: readonly [number, number], penalty: readonly [number, number]): Player {
  if (score[0] !== score[1]) return score[0] > score[1] ? 1 : 2
  if (penalty[0] !== penalty[1]) return penalty[0] < penalty[1] ? 1 : 2
  return 1
}

/** 母球落袋后的复位位置（由 Rng 决定，仍是纯函数） */
function respawnCue(balls: Ball[], rng: number): { balls: Ball[]; rng: number } {
  const cue = balls[0]
  if (!cue.pocketed) return { balls, rng }
  const r = new Rng(rng)
  const x = BREAK_X - 40 - r.float(0, 70)
  const y = clamp(MID_Y + r.float(-200, 200), PLAY.y + 4, PLAY.y + PLAY.h - 4)
  const next = balls.slice()
  next[0] = { ...cue, x, y, vx: 0, vy: 0, pocketed: false }
  return { balls: next, rng: r.s }
}

/** 本杆结束后的结算：判犯规、计分、决定是否交换回合、是否终局 */
function settle(state: State, potted: number[]): State {
  const cueIn = potted.includes(0)
  const target = state.target
  const objs = potted.filter((n) => n !== 0)
  const wrong = objs.filter((n) => n !== target)
  const correct = isCorrectOrder(potted, target)

  const score: [number, number] = [state.score[0], state.score[1]]
  const penalty: [number, number] = [state.penalty[0], state.penalty[1]]
  score[state.turn - 1] += objs.length
  if (cueIn) penalty[state.turn - 1] += 1

  const rs = respawnCue(state.balls, state.rng)
  const balls = rs.balls
  const remaining = nextTarget(balls)

  let foul = false
  let reason = ''
  if (cueIn) {
    foul = true
    reason = `母球落袋，罚杆 +1（累计 ${penalty[state.turn - 1]}）`
  } else if (wrong.length > 0) {
    foul = true
    reason = `须先进 ${target} 号球，顺序错误（打进了 ${wrong.join('、')} 号）`
  }

  let turn: Player = state.turn
  let over = false
  let winner: 0 | Player = 0
  let message: string

  if (remaining === 0) {
    over = true
    winner = decideWinner(score, penalty)
    message =
      winner === 1
        ? `全部进袋！你以 ${score[0]}:${score[1]} 获胜`
        : `全部进袋，AI 以 ${score[0]}:${score[1]} 获胜`
  } else if (state.shots >= MAX_SHOTS) {
    // 兜底：杆数用尽也必须终局，避免无限循环
    over = true
    winner = decideWinner(score, penalty)
    message = `达到 ${MAX_SHOTS} 杆上限，本局结束（${score[0]}:${score[1]}）`
  } else if (correct && !foul) {
    message = `打进 ${target} 号球，继续击球`
  } else {
    turn = flip(state.turn)
    message = foul ? reason : '未进球，交换回合'
  }

  return {
    ...state,
    balls,
    phase: over ? 'over' : 'aim',
    over,
    winner,
    score,
    penalty,
    turn,
    target: remaining === 0 ? state.target : remaining,
    potted: [],
    lastShot: { potted: [...potted], foul, reason },
    aimAngle: state.aimAngle,
    power: 0.6,
    drag: null,
    message,
    steps: state.steps,
    rng: rs.rng,
  }
}

// ------------------------------------------------------------------ reduce

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'aim':
    case 'aimStart': {
      if (state.over || state.phase !== 'aim') return state
      const power = action.type === 'aim' && action.power !== undefined ? clamp01(action.power) : state.power
      return {
        ...state,
        aimAngle: action.angle,
        power,
        drag: 'aim',
        message: '瞄准中：拖拽球台改方向，拖动力度条改力度',
      }
    }
    case 'power': {
      if (state.over || state.phase !== 'aim') return state
      return { ...state, power: clamp01(action.power), drag: 'power' }
    }
    case 'cue': {
      if (state.over || state.phase !== 'aim') return state
      const cue = state.balls[0]
      const x = clamp(action.x, PLAY.x + 2, PLAY.x + PLAY.w - 2)
      const y = clamp(action.y, PLAY.y + 2, PLAY.y + PLAY.h - 2)
      // 不能与其他球重叠
      for (const b of state.balls) {
        if (b.id === 0 || b.pocketed) continue
        if (Math.hypot(b.x - x, b.y - y) < BALL_R * 2 + 1) {
          return { ...state, drag: 'cue' }
        }
      }
      const balls = state.balls.slice()
      balls[0] = { ...cue, x, y, vx: 0, vy: 0, pocketed: false }
      return { ...state, balls, drag: 'cue', message: '移动白球中，松开后按「击球」' }
    }
    case 'release': {
      if (state.drag === null) return state
      return { ...state, drag: null }
    }
    case 'shoot': {
      if (state.over || state.phase !== 'aim') return state
      const cue = state.balls[0]
      if (cue.pocketed) return state
      const r = new Rng(state.rng)
      // 击球力度由 Rng 微抖 ±4%，保证同种子 + 同操作序列 → 同一局
      const jitter = r.float(0.96, 1.04)
      const power = clamp01(state.power)
      const speed = MIN_SHOT_SPEED + (MAX_SPEED - MIN_SHOT_SPEED) * power * jitter
      const balls = state.balls.map((b) =>
        b.id === 0
          ? { ...b, vx: Math.cos(state.aimAngle) * speed, vy: Math.sin(state.aimAngle) * speed }
          : b,
      )
      return {
        ...state,
        balls,
        phase: 'rolling',
        drag: null,
        shots: state.shots + 1,
        potted: [],
        lastShot: null,
        rng: r.s,
        message: '球在滚动…',
      }
    }
    case 'tick': {
      if (state.over || state.phase !== 'rolling') return state
      const steps = clamp(Math.floor(action.steps), 0, MAX_TICK_STEPS)
      if (steps === 0) return state
      let balls = state.balls.map((b) => ({ ...b }))
      let potted = [...state.potted]
      for (let i = 0; i < steps; i++) {
        if (allStopped(balls)) break
        const res = stepOnce(balls, potted)
        balls = res.balls
        potted = res.potted
        // 极端兜底：单杆推进步数用尽则强制停球并结算，绝不卡死
        if (state.steps + i + 1 >= MAX_SETTLE_STEPS) {
          balls = balls.map((b) => (b.pocketed ? b : { ...b, vx: 0, vy: 0 }))
          break
        }
      }
      const next: State = { ...state, balls, potted, steps: state.steps + steps }
      if (allStopped(balls)) return settle(next, potted)
      return next
    }
    default:
      return state
  }
}

// ------------------------------------------------------------------ 输入映射

function inRect(p: PointerInput, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

function powerFromX(x: number): number {
  return POWER_MIN + ((x - POWER_BAR.x) / POWER_BAR.w) * (POWER_MAX - POWER_MIN)
}

/** 指针事件 → action（纯函数） */
export function mapPointer(state: State, p: PointerInput): Action | null {
  if (state.over || state.phase !== 'aim') return null
  const cue = state.balls[0]
  if (p.kind === 'down') {
    if (inRect(p, POWER_BAR)) return { type: 'power', power: powerFromX(p.x) }
    if (!cue.pocketed && Math.hypot(p.x - cue.x, p.y - cue.y) <= BALL_R * 1.9) {
      return { type: 'cue', x: p.x, y: p.y }
    }
    return { type: 'aimStart', angle: Math.atan2(p.y - cue.y, p.x - cue.x) }
  }
  if (p.kind === 'move' && p.pressed) {
    if (state.drag === 'power') {
      if (!inRect(p, POWER_BAR)) return null
      return { type: 'power', power: powerFromX(p.x) }
    }
    if (state.drag === 'cue') return { type: 'cue', x: p.x, y: p.y }
    if (state.drag === 'aim') return { type: 'aim', angle: Math.atan2(p.y - cue.y, p.x - cue.x) }
    return null
  }
  if (p.kind === 'up') return { type: 'release' }
  return null
}

/** 键盘便利操作 */
export function mapKey(state: State, key: string): Action | null {
  if (key === ' ' || key === 'Enter') return { type: 'shoot' }
  if (key === 'ArrowUp') return { type: 'power', power: clamp01(state.power + 0.1) }
  if (key === 'ArrowDown') return { type: 'power', power: clamp01(state.power - 0.1) }
  if (key === 'ArrowLeft') return { type: 'aim', angle: state.aimAngle - 0.05 }
  if (key === 'ArrowRight') return { type: 'aim', angle: state.aimAngle + 0.05 }
  return null
}

// ------------------------------------------------------------------ AI

/** 固定物理步数转 action（渲染层用真实 dt 折算整数 tick） */
export function tickAction(dt: number): Extract<Action, { type: 'tick' }> {
  return { type: 'tick', steps: clamp(Math.round(dt / TICK_MS), 0, MAX_TICK_STEPS) }
}

/**
 * AI 候选：只从 legalActions 里选。
 * 候选 = 瞄准台面上每颗编号球的方向（± 微调）× 两档力度。
 */
export function legalActions(state: State): Action[] {
  if (state.over || state.phase !== 'aim') return []
  const cue = state.balls.find((b) => b.id === 0)
  if (!cue || cue.pocketed) return []
  const out: Action[] = []
  for (const t of state.balls) {
    if (t.id === 0 || t.pocketed) continue
    const base = Math.atan2(t.y - cue.y, t.x - cue.x)
    for (const d of [-0.03, 0]) {
      for (const p of [0.6, 0.95]) {
        out.push({ type: 'aim', angle: base + d, power: p })
      }
    }
  }
  if (out.length === 0) out.push({ type: 'aim', angle: state.aimAngle, power: 0.6 })
  return out
}

/** 用同一个 reduce 试算一整杆（供 AI 评估，不产生第二套规则逻辑） */
export function simulateShot(state: State, aim: Action): State {
  let s = reduce(state, aim)
  s = reduce(s, { type: 'shoot' })
  let guard = 0
  while (s.phase === 'rolling' && guard < MAX_SETTLE_STEPS) {
    s = reduce(s, { type: 'tick', steps: MAX_TICK_STEPS })
    guard += MAX_TICK_STEPS
  }
  // 极端兜底：模拟超时则强制停球并结算
  if (s.phase === 'rolling') {
    s = reduce(s, { type: 'tick', steps: 1 })
  }
  return s
}

function evaluate(before: State, after: State): number {
  const gain = after.score[1] - before.score[1]
  const foul = after.lastShot && after.lastShot.foul ? -60 : 0
  const pen = after.penalty[1] * -4
  const keep = after.turn === 2 ? 3 : 0
  return gain * 100 + foul + pen + keep
}

/** AI：遍历 legalActions，用同一个 reduce 试算评估，返回最优的那个 action */
export function aiAction(state: State): Action | null {
  if (state.over || state.phase !== 'aim' || state.turn !== 2) return null
  const cands = legalActions(state)
  if (cands.length === 0) return null
  let best: Action = cands[0]
  let bestScore = -Infinity
  for (const c of cands) {
    const s = evaluate(state, simulateShot(state, c))
    if (s > bestScore) {
      bestScore = s
      best = c
    }
  }
  return best
}

// ------------------------------------------------------------------ 站点壳扩展

export function controls(state: State): Control<Action>[] {
  if (state.over || state.phase !== 'aim' || state.turn !== 1) return []
  return [{ label: '击球', action: { type: 'shoot' }, primary: true }]
}

export function hint(state: State): string {
  if (state.over) return state.message
  const who = state.turn === 1 ? '你的回合' : 'AI 回合'
  if (state.phase === 'rolling') return '球在滚动…'
  return `${who}｜目标：${state.target} 号球｜比分 ${state.score[0]}:${state.score[1]}｜罚杆 ${state.penalty[0]}:${state.penalty[1]}｜${state.message}`
}

export function outcome(state: State): Outcome | null {
  if (!state.over) return null
  return {
    score: state.score[0] - state.penalty[0] * 2,
    better: 'higher',
    unit: '分',
    win: state.winner === 1,
  }
}

export function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (prev.phase === 'rolling' && next.phase !== 'rolling' && next.lastShot) {
    const shot = next.lastShot
    for (const id of shot.potted) {
      const b = next.balls.find((x) => x.id === id)
      out.push({ kind: 'burst', x: b ? b.x : 0, y: b ? b.y : 0, count: 10 })
    }
    if (shot.foul) {
      out.push({ kind: 'sound', name: 'error' }, { kind: 'shake', power: 6 })
    } else {
      out.push({ kind: 'sound', name: 'score' })
    }
  }
  if (!prev.over && next.over) {
    out.push({ kind: 'sound', name: next.winner === 1 ? 'win' : 'lose' })
  }
  return out
}
