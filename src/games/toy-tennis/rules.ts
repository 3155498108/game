/**
 * 玩具网球规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 设计要点：
 * - 上下两个半场：玩家球拍在下方（PLAYER_Y），电脑球拍在上方（AI_Y），中间的横线是「网」。
 * - 球按固定 dt 逐 tick 推进：匀速直线 + 侧边反弹，**不使用任何物理引擎**。
 * - 每接一次球，球速递增一级（有上限），落点角度由 Rng 随机化；初始发球与每次回球的随机数
 *   都来自 State.rng，因此同种子 + 同操作序列必然复现同一局。
 * - 球越过底线没被球拍接到 → 漏接；球飞出边线或底线 → 出界。两者都让对手得分，先得 7 分者胜。
 * - AI 只通过遍历 legalActions 并调用同一个 reduce 试算来评估，绝不维护第二套规则逻辑。
 */
import { Rng } from '../../core/rng'
import { clamp } from '../../core/geom'

// ---------------------------------------------------------------- 场地常量

export const FIELD_W = 720
export const FIELD_H = 1280
/** 球拍中心线（上下半场的底线，也是接球判定线） */
export const AI_Y = 150
export const PLAYER_Y = 1130
/** 中线：发球点与视觉分隔 */
export const NET_Y = 640
export const CENTER_X = FIELD_W / 2
/** 侧边围墙（只有中场区域有墙，后场没有 → 出界） */
export const SIDE_WALL = 30
export const BALL_R = 13

export const PADDLE_W = 172
export const PADDLE_H = 40
/** 每个 action 移动的逻辑像素 */
export const PADDLE_STEP = 10
/** 指针跟随时的单步上限 */
export const SEEK_STEP = 20
export const PADDLE_MIN = SIDE_WALL + PADDLE_W / 2
export const PADDLE_MAX = FIELD_W - SIDE_WALL - PADDLE_W / 2

/** 球速：每回合递增 STEP，递增到 MAX 就封顶，避免后期不可玩 */
export const BASE_SPEED = 7
export const SPEED_STEP = 0.55
export const MAX_SPEED = 15
/** 出球角度相对「垂直于底线」的最大偏移（弧度），限制 |vy| 保证球必然穿场 */
export const MAX_ANGLE = 1.0

export const SERVE_DELAY = 42
/** 先得这么多分者获胜，一局必然结束 */
export const TARGET_SCORE = 7
/** 单个回合最多几次击球，超过则最后击球方判失（防死循环兜底） */
export const MAX_RALLY_HITS = 16
/** 单个回合最多多少 tick，超过同上 */
export const MAX_PLAY_TICKS = 1200
/** 单个 tick action 最多推进的步数 */
export const MAX_STEPS = 120

/** 第 rally 次击球后的球速（rally 从 0 开始，发球即 BASE） */
export function speedOf(rally: number): number {
  return Math.min(MAX_SPEED, BASE_SPEED + rally * SPEED_STEP)
}

// ---------------------------------------------------------------- 状态与动作

/** 0 = 玩家（下方），1 = 电脑（上方） */
export type Side = 0 | 1
export type Phase = 'serve' | 'play' | 'over'
/** 得分原因：漏接 / 出界 / 回合超长 */
export type PointReason = 'miss' | 'out' | 'timeout'

export const flip = (s: Side): Side => (s === 0 ? 1 : 0)

export interface State {
  phase: Phase
  /** 玩家得分 / 电脑得分 */
  scoreP: number
  scoreA: number
  /** 终局赢家，未结束为 0 */
  winner: Side | 0
  /** 两个球拍的中心 x */
  px: number
  ax: number
  /** 球的位置与每 tick 位移 */
  bx: number
  by: number
  bvx: number
  bvy: number
  /** 本回合已击球次数 */
  rally: number
  /** 本局最长回合（击球数），用于成绩 */
  bestRally: number
  /** 最近一次击球方 */
  lastHitter: Side | 0
  /** 已经漏接的一方（null = 还没漏接）；球还在后场飞，飞出球场才算分 */
  missed: Side | null
  /** 本次发球飞向谁 */
  serveTo: Side
  serveTicks: number
  playTicks: number
  lastPoint: Side | 0
  lastReason: PointReason | 0
  /** 可播种随机数状态 */
  rng: number
}

export type Action =
  /** 推进 n 个逻辑 tick（渲染层按真实 dt 折算） */
  | { type: 'tick'; steps: number }
  /** 某一侧球拍左移 / 不动 / 右移 */
  | { type: 'move'; side: Side; dir: -1 | 0 | 1 }
  /** 玩家球拍向目标 x 靠拢一步（指针拖动） */
  | { type: 'seek'; x: number }
  /** 跳过发球倒计时，立刻开球 */
  | { type: 'serve' }

export function create(seed: number): State {
  return {
    phase: 'serve',
    scoreP: 0,
    scoreA: 0,
    winner: 0,
    px: CENTER_X,
    ax: CENTER_X,
    bx: CENTER_X,
    by: NET_Y,
    bvx: 0,
    bvy: 0,
    rally: 0,
    bestRally: 0,
    lastHitter: 0,
    missed: null,
    serveTo: 0,
    serveTicks: SERVE_DELAY,
    playTicks: 0,
    lastPoint: 0,
    lastReason: 0,
    rng: seed | 0,
  }
}

// ---------------------------------------------------------------- 合法动作

/** 某个 side 在当前状态下可以执行的动作（AI 只允许从这里选） */
export function legalActions(state: State, side: Side): Action[] {
  if (state.phase === 'over') return []
  return [
    { type: 'move', side, dir: -1 },
    { type: 'move', side, dir: 0 },
    { type: 'move', side, dir: 1 },
  ]
}

/** 动作是否合法（非法动作 reduce 后状态不变） */
export function isLegal(state: State, action: Action): boolean {
  switch (action.type) {
    case 'move':
      return (
        state.phase !== 'over' &&
        (action.side === 0 || action.side === 1) &&
        (action.dir === -1 || action.dir === 0 || action.dir === 1)
      )
    case 'seek':
      return state.phase !== 'over' && Number.isFinite(action.x)
    case 'serve':
      return state.phase === 'serve'
    case 'tick':
      return Number.isFinite(action.steps)
  }
}

// ---------------------------------------------------------------- 纯状态迁移

/** 纯函数状态迁移：不修改入参，不读时间与全局随机数 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'move': {
      if (!isLegal(state, action)) return state
      const { side, dir } = action
      if (dir === 0) return state
      const cur = side === 0 ? state.px : state.ax
      const next = clamp(cur + dir * PADDLE_STEP, PADDLE_MIN, PADDLE_MAX)
      if (next === cur) return state
      return side === 0 ? { ...state, px: next } : { ...state, ax: next }
    }

    case 'seek': {
      if (!isLegal(state, action)) return state
      const target = clamp(action.x, PADDLE_MIN, PADDLE_MAX)
      const cur = state.px
      if (target === cur) return state
      const next = cur + clamp(target - cur, -SEEK_STEP, SEEK_STEP)
      return { ...state, px: next }
    }

    case 'serve': {
      if (state.phase !== 'serve') return state
      return launchServe(state, new Rng(state.rng))
    }

    case 'tick': {
      if (!Number.isFinite(action.steps)) return state
      const steps = Math.max(0, Math.min(MAX_STEPS, Math.floor(action.steps)))
      let s = state
      for (let i = 0; i < steps && s.phase !== 'over'; i++) s = advance(s)
      return s
    }
  }
}

/** 推进一个逻辑 tick */
function advance(s: State): State {
  if (s.phase === 'over') return s
  if (s.phase === 'serve') {
    if (s.serveTicks > 0) return { ...s, serveTicks: s.serveTicks - 1 }
    return launchServe(s, new Rng(s.rng))
  }
  return moveBall(s, new Rng(s.rng))
}

/** 发球：球从中线开出，方向随机 */
function launchServe(s: State, r: Rng): State {
  const a = r.float(-MAX_ANGLE, MAX_ANGLE)
  const toPlayer = s.serveTo === 0
  const speed = BASE_SPEED
  return {
    ...s,
    phase: 'play',
    serveTicks: 0,
    playTicks: 0,
    rally: 0,
    missed: null,
    lastHitter: 0,
    bx: CENTER_X,
    by: NET_Y,
    bvx: speed * Math.sin(a),
    bvy: (toPlayer ? 1 : -1) * speed * Math.cos(a),
    rng: r.s,
  }
}

/** 球飞行一个 tick：侧边反弹 + 底线接球判定 */
function moveBall(s: State, r: Rng): State {
  const n: State = { ...s, playTicks: s.playTicks + 1 }
  let bx = s.bx + s.bvx
  let by = s.by + s.bvy
  let bvx = s.bvx
  let bvy = s.bvy

  // 飞出球场即结算：越过底线（漏接）或飞出边线（出界）都让对手得分
  if (bx < 0 || bx > FIELD_W || by < 0 || by > FIELD_H) {
    const reason: PointReason = bx < 0 || bx > FIELD_W ? 'out' : 'miss'
    const lost: Side = s.missed !== null ? s.missed : by < AI_Y ? 1 : 0
    return awardPoint({ ...n, bx, by, bvx, bvy }, flip(lost), reason)
  }

  // 回合超长兜底：球停在半空也算结束，保证一局不会无限进行
  if (s.playTicks + 1 > MAX_PLAY_TICKS) {
    return awardPoint({ ...n, bx, by, bvx, bvy }, s.lastHitter === 0 ? 1 : 0, 'timeout')
  }

  // 中场区域：侧边围墙反弹
  if (by >= AI_Y && by <= PLAYER_Y) {
    const minX = SIDE_WALL + BALL_R
    const maxX = FIELD_W - SIDE_WALL - BALL_R
    if (bx < minX) {
      bx = minX + (minX - bx)
      bvx = -bvx
    } else if (bx > maxX) {
      bx = maxX - (bx - maxX)
      bvx = -bvx
    }
  }

  // 越过下方底线：玩家接球
  if (bvy > 0 && s.by < PLAYER_Y && by >= PLAYER_Y) {
    if (Math.abs(bx - s.px) <= PADDLE_W / 2 + BALL_R) {
      return onPaddleHit({ ...n, bx, by: PLAYER_Y - BALL_R, bvx, bvy }, 0, r)
    }
    return { ...n, bx, by, bvx, bvy, missed: 0 }
  }

  // 越过上方底线：电脑接球
  if (bvy < 0 && s.by > AI_Y && by <= AI_Y) {
    if (Math.abs(bx - s.ax) <= PADDLE_W / 2 + BALL_R) {
      return onPaddleHit({ ...n, bx, by: AI_Y + BALL_R, bvx, bvy }, 1, r)
    }
    return { ...n, bx, by, bvx, bvy, missed: 1 }
  }

  return { ...n, bx, by, bvx, bvy }
}

/** 球拍接到球：球速递增一级，出球角度随机化 */
function onPaddleHit(s: State, side: Side, r: Rng): State {
  const rally = s.rally + 1
  if (rally > MAX_RALLY_HITS) {
    // 回合过长：最后击球方判失，对手得分
    return awardPoint({ ...s, rally, bestRally: Math.max(s.bestRally, rally), rng: r.s }, flip(side), 'timeout')
  }
  const speed = speedOf(rally)
  const a = r.float(-MAX_ANGLE, MAX_ANGLE)
  return {
    ...s,
    rally,
    bestRally: Math.max(s.bestRally, rally),
    lastHitter: side,
    missed: 0,
    bvx: speed * Math.sin(a),
    // 玩家在下方，向下发球；电脑在上方，向上发球
    bvy: (side === 0 ? -1 : 1) * speed * Math.cos(a),
    rng: r.s,
  }
}

/** 给 side 记一分：到 7 分终局，否则回到发球等待 */
function awardPoint(s: State, side: Side, reason: PointReason): State {
  const scoreP = side === 0 ? s.scoreP + 1 : s.scoreP
  const scoreA = side === 1 ? s.scoreA + 1 : s.scoreA
  const winP = scoreP >= TARGET_SCORE
  const winA = scoreA >= TARGET_SCORE
  const over = winP || winA
  return {
    ...s,
    phase: over ? 'over' : 'serve',
    scoreP,
    scoreA,
    winner: winP ? 0 : winA ? 1 : 0,
    rally: 0,
    playTicks: 0,
    missed: null,
    lastHitter: 0,
    lastPoint: side,
    lastReason: reason,
    serveTo: flip(s.serveTo),
    serveTicks: over ? 0 : SERVE_DELAY,
    bx: CENTER_X,
    by: NET_Y,
    bvx: 0,
    bvy: 0,
  }
}

// ---------------------------------------------------------------- AI

/** 预测球落到 side 那一侧底线时的 x（撞墙不预测，用移动过程去修正） */
function landingX(s: State, side: Side): number {
  const lineY = side === 1 ? AI_Y : PLAYER_Y
  const coming = side === 1 ? s.bvy < 0 && s.by > AI_Y : s.bvy > 0 && s.by < PLAYER_Y
  if (!coming || s.missed !== null) return CENTER_X
  const t = (lineY - s.by) / s.bvy
  return clamp(s.bx + s.bvx * t, PADDLE_MIN, PADDLE_MAX)
}

/**
 * 遍历候选 action，逐个用同一个 reduce 试算，取「球拍离预测落点最近」的那一手。
 * 全程不消耗随机数、不写第二套规则，因此完全可复现。
 */
export function bestActionFor(state: State, side: Side): Action | null {
  if (state.phase === 'over') return null
  const cands = legalActions(state, side)
  if (cands.length === 0) return null
  const target = landingX(state, side)
  let best: Action = cands[0]
  let bestScore = -Infinity
  for (const a of cands) {
    const next = reduce(state, a)
    const x = side === 0 ? next.px : next.ax
    const score = -Math.abs(x - target)
    if (score > bestScore) {
      bestScore = score
      best = a
    }
  }
  return best
}

/** 电脑（上方）行动 */
export function aiAction(state: State): Action | null {
  return bestActionFor(state, 1)
}

/** 人类玩家当前球拍 x */
export function paddleX(state: State, side: Side): number {
  return side === 0 ? state.px : state.ax
}
