/**
 * 玩具足球规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 一脚 = 「准备（调滑条）→ 出脚 → 结果」三个阶段。
 * 球不使用任何物理引擎：固定步长逐 tick 匀速直线推进，撞到边墙按符号翻转速度分量反弹。
 * 守门员的横移与扑救噪声全部来自可播种的 Rng，同种子必然复现。
 */
import { clamp } from '../../core/geom'
import type { Rect } from '../../core/geom'
import { Rng } from '../../core/rng'

// ---------------- 场地常量（逻辑坐标） ----------------

export const VIEW_W = 720
export const VIEW_H = 1280

/** 一局的总机会数 */
export const CHANCES = 10
/** 固定步长：1 tick = 1/60 秒 */
export const TICK_MS = 1000 / 60

/** 球场外框（仅左右边墙与下底线参与物理） */
export const FIELD = { left: 30, right: 690, top: 330, bottom: 1090 }
/** 球门线（上边界），球越过此线即判定结果 */
export const GOAL_Y = 420
/** 球门口左右立柱（球门刻意开窄，保证能进的球都够得着守门员） */
export const GOAL_LEFT = 200
export const GOAL_RIGHT = 520
/** 球网进深 */
export const GOAL_DEPTH = 56
/** 判定进球时球心需离门柱的最小距离 */
export const GOAL_EDGE = 6
/** 踢球点 */
export const KICK = { x: 360, y: 960 }

export const BALL_R = 15

/** 守门员站位与活动范围 */
export const KEEPER_Y = GOAL_Y + 52
export const KEEPER_MIN = GOAL_LEFT + 20
export const KEEPER_MAX = GOAL_RIGHT - 20
/** 扑救判定：球心与守门员的横向距离阈值 */
export const KEEPER_REACH = 24
/** 每隔多少 tick 重新掷一次扑救落点 */
export const KEEPER_REACT = 4
export const KEEPER_SPEED_MIN = 1.2
export const KEEPER_SPEED_MAX = 2.8
/** 预判噪声的最大幅度（难度越低越离谱） */
export const KEEPER_NOISE = 80

/** 出球速度区间（逻辑像素 / tick） */
export const SPEED_MIN = 7
export const SPEED_MAX = 17
/** 单脚最长 tick 数，超时判出界 */
export const MAX_TICKS = 320

/** 力度滑条范围 */
export const POWER_MIN = 20
export const POWER_MAX = 100
export const POWER_DEFAULT = 60
/** 角度滑条范围（度，0 为正对球门，正为向右） */
export const ANGLE_MIN = -25
export const ANGLE_MAX = 25
export const ANGLE_DEFAULT = 0

/** 两条滑条的矩形，供输入映射与渲染共用 */
export const ANGLE_SLIDER: Rect = { x: 70, y: 1116, w: 580, h: 42 }
export const POWER_SLIDER: Rect = { x: 70, y: 1180, w: 580, h: 42 }

// ---------------- 状态与动作 ----------------

export type Phase = 'aim' | 'flight' | 'result' | 'over'

/** 单脚结果：进球 / 被扑出 / 出界打偏 */
export type ShotResult = 'goal' | 'saved' | 'out'

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
}

export interface Keeper {
  x: number
  y: number
  /** 当前横移落点 */
  targetX: number
  /** 本脚是否已做出扑救动作（仅供渲染画扑救姿态） */
  dive: boolean
}

export interface State {
  phase: Phase
  /** 已用掉的机会数 */
  attempt: number
  goals: number
  saves: number
  misses: number
  power: number
  angle: number
  ball: Ball
  keeper: Keeper
  lastResult: ShotResult | null
  /** 本脚是否已被守门员扑出（球还在往回飞，等落地才算结算） */
  pendingSave: boolean
  /** 本脚已推进的 tick 数 */
  ticks: number
  rng: number
}

export type Action =
  | { type: 'setPower'; value: number }
  | { type: 'setAngle'; value: number }
  | { type: 'kick' }
  | { type: 'advance'; ticks: number }
  | { type: 'next' }

// ---------------- 纯工具 ----------------

/** 第 n 脚的难度：0..1，影响守门员横移速度与扑救命中率 */
export function difficultyOf(attempt: number): number {
  return clamp(0.18 + attempt * 0.07, 0, 0.92)
}

export function keeperSpeedOf(difficulty: number): number {
  return KEEPER_SPEED_MIN + difficulty * (KEEPER_SPEED_MAX - KEEPER_SPEED_MIN)
}

/** 力度换算出球速 */
export function speedOf(power: number): number {
  const t = (clamp(power, POWER_MIN, POWER_MAX) - POWER_MIN) / (POWER_MAX - POWER_MIN)
  return SPEED_MIN + t * (SPEED_MAX - SPEED_MIN)
}

/** 角度换算出球方向单位向量（y 向上为负） */
export function directionOf(angle: number): { vx: number; vy: number } {
  const rad = (clamp(angle, ANGLE_MIN, ANGLE_MAX) * Math.PI) / 180
  return { vx: Math.sin(rad), vy: -Math.cos(rad) }
}

/**
 * 球越过门线那一刻的判定（纯函数，便于测试直接覆盖三种结果）。
 * 门柱之外 → 出界打偏；门柱之内且被守门员够到并掷中 → 被扑出；否则进球。
 */
export function resolveCrossing(
  ballX: number,
  keeperX: number,
  difficulty: number,
  roll: number,
): 'goal' | 'saved' | 'out' {
  if (ballX < GOAL_LEFT + GOAL_EDGE || ballX > GOAL_RIGHT - GOAL_EDGE) return 'out'
  if (Math.abs(ballX - keeperX) <= KEEPER_REACH && roll < difficulty) return 'saved'
  return 'goal'
}

/** 滑条横坐标 → 数值（自动钳制到 [min,max]） */
export function valueFromX(r: Rect, x: number, min: number, max: number): number {
  return clamp(min + ((x - r.x) / r.w) * (max - min), min, max)
}

function keeperHome(): Keeper {
  const mid = (KEEPER_MIN + KEEPER_MAX) / 2
  return { x: mid, y: KEEPER_Y, targetX: mid, dive: false }
}

function ballHome(): Ball {
  return { x: KICK.x, y: KICK.y, vx: 0, vy: 0 }
}

// ---------------- 初始状态 ----------------

export function create(seed: number): State {
  return {
    phase: 'aim',
    attempt: 0,
    goals: 0,
    saves: 0,
    misses: 0,
    power: POWER_DEFAULT,
    angle: ANGLE_DEFAULT,
    ball: ballHome(),
    keeper: keeperHome(),
    lastResult: null,
    pendingSave: false,
    ticks: 0,
    rng: seed | 0,
  }
}

// ---------------- 内部推进 ----------------

/**
 * 守门员单 tick 横移：每隔 KEEPER_REACT 个 tick 重掷一次扑救落点。
 * 落点 = 球越过门线时的预估横坐标 + 难度噪声，难度越低偏得越离谱；
 * 守门员随后朝该落点移动，所以前期「反应慢又看错方向」，后期又快又准。
 */
function moveKeeper(k: Keeper, ball: Ball, difficulty: number, r: Rng, ticks: number): Keeper {
  let targetX = k.targetX
  if (ticks % KEEPER_REACT === 0) {
    // 飞行中 vy < 0 且球在门线下方，故预估横坐标 = ball.x + vx * 剩余飞行时间
    const vy = ball.vy === 0 ? -1 : ball.vy
    const predicted = ball.x - (ball.vx / vy) * (ball.y - (GOAL_Y - BALL_R))
    const noise = (r.next() * 2 - 1) * (1 - difficulty) * KEEPER_NOISE
    targetX = clamp(predicted + noise, KEEPER_MIN, KEEPER_MAX)
  }
  const speed = keeperSpeedOf(difficulty)
  const dx = targetX - k.x
  const x = Math.abs(dx) <= speed ? targetX : k.x + Math.sign(dx) * speed
  return { ...k, x: clamp(x, KEEPER_MIN, KEEPER_MAX), targetX }
}

/** 结束本脚：结算进球/扑救/失误，机会用尽直接终局 */
function settle(s: State, r: Rng, result: ShotResult, ball: Ball): State {
  const attempt = s.attempt + 1
  const goals = s.goals + (result === 'goal' ? 1 : 0)
  const saves = s.saves + (result === 'saved' ? 1 : 0)
  return {
    ...s,
    phase: attempt >= CHANCES ? 'over' : 'result',
    attempt,
    goals,
    saves,
    misses: attempt - goals,
    ball,
    keeper: { ...s.keeper, dive: result !== 'goal' },
    lastResult: result,
    pendingSave: false,
    ticks: s.ticks + 1,
    rng: r.s,
  }
}

/** 单 tick 推进：不修改入参 */
function step(s: State): State {
  const r = new Rng(s.rng)
  const difficulty = difficultyOf(s.attempt)
  const b: Ball = {
    x: s.ball.x + s.ball.vx,
    y: s.ball.y + s.ball.vy,
    vx: s.ball.vx,
    vy: s.ball.vy,
  }

  // 侧边墙反弹（速率不变，只翻符号）
  if (b.x - BALL_R <= FIELD.left) {
    b.x = FIELD.left + BALL_R
    b.vx = Math.abs(b.vx)
  } else if (b.x + BALL_R >= FIELD.right) {
    b.x = FIELD.right - BALL_R
    b.vx = -Math.abs(b.vx)
  }

  // 越过下底线：往后踢飞 → 出界；此前已被扑出则记为被扑出
  if (b.y + BALL_R >= FIELD.bottom) return settle(s, r, s.pendingSave ? 'saved' : 'out', b)

  // 越过门线：只在球向上飞时结算（扑出后球往回飞，不再重复判定）
  if (b.vy < 0 && b.y - BALL_R <= GOAL_Y) {
    const outcome = resolveCrossing(b.x, s.keeper.x, difficulty, r.next())
    if (outcome === 'goal') return settle(s, r, 'goal', { ...b, y: GOAL_Y - GOAL_DEPTH * 0.45 })
    if (outcome === 'out') return settle(s, r, 'out', { ...b, y: GOAL_Y - 4 })
    // 被扑出：球被拍回，弹向下半场飞走，等落地才结算
    return {
      ...s,
      ball: { ...b, y: GOAL_Y + BALL_R, vy: Math.abs(b.vy) * 0.85 },
      keeper: { ...s.keeper, dive: true },
      pendingSave: true,
      ticks: s.ticks + 1,
      rng: r.s,
    }
  }

  // 超时保护
  if (s.ticks + 1 >= MAX_TICKS) return settle(s, r, s.pendingSave ? 'saved' : 'out', b)

  return {
    ...s,
    ball: b,
    keeper: moveKeeper(s.keeper, b, difficulty, r, s.ticks),
    ticks: s.ticks + 1,
    rng: r.s,
  }
}

function kick(s: State): State {
  const r = new Rng(s.rng)
  const dir = directionOf(s.angle)
  const speed = speedOf(s.power)
  return {
    ...s,
    phase: 'flight',
    ball: { x: KICK.x, y: KICK.y, vx: dir.vx * speed, vy: dir.vy * speed },
    keeper: keeperHome(),
    lastResult: null,
    pendingSave: false,
    ticks: 0,
    rng: r.s,
  }
}

// ---------------- 状态迁移 ----------------

/** 纯函数状态迁移：不读时间、不读全局随机数、不修改入参 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'setPower': {
      if (state.phase !== 'aim') return state
      const v = clamp(Math.round(action.value), POWER_MIN, POWER_MAX)
      return v === state.power ? state : { ...state, power: v }
    }
    case 'setAngle': {
      if (state.phase !== 'aim') return state
      const v = clamp(Math.round(action.value), ANGLE_MIN, ANGLE_MAX)
      return v === state.angle ? state : { ...state, angle: v }
    }
    case 'kick':
      return kick(state)
    case 'advance': {
      if (state.phase !== 'flight') return state
      const n = clamp(Math.round(action.ticks), 0, 8)
      let s = state
      for (let i = 0; i < n; i++) {
        s = step(s)
        if (s.phase !== 'flight') break
      }
      return s
    }
    case 'next': {
      if (state.phase !== 'result') return state
      return {
        ...state,
        phase: 'aim',
        ball: ballHome(),
        keeper: keeperHome(),
        lastResult: null,
        pendingSave: false,
        ticks: 0,
      }
    }
  }
}

/** 便捷入口：直接踢一脚 */
export function kickShot(s: State): State {
  return reduce(s, { type: 'kick' })
}

/** 便捷入口：推进 n 个 tick */
export function advance(s: State, ticks: number): State {
  return reduce(s, { type: 'advance', ticks })
}
