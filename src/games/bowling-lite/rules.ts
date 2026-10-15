/**
 * 保龄球简化版 bowling-lite —— 定步圆碰撞的投球玩法（纯逻辑，零 DOM 依赖）。
 *
 * 硬约束：本玩法**不是物理引擎**。采用「固定步长 + 单次解算」的极简近似：
 *   1. 每 tick 固定积分一次（DT = 1/60 秒），重力恒定、恢复系数固定；
 *   2. 球与瓶都按**圆形**判定：中心距 < 半径和即视为接触；
 *   3. 球-瓶接触逐个解算（只解一次穿透），瓶-瓶接触做等质量冲量交换 + 位置分离；
 *   4. 不做刚体、不做旋转惯量、不做连续碰撞检测。
 *   5. 站瓶锚定：速度为 0 的瓶不参与积分（重力只作用在被撞动 / 被晃动的瓶上），
 *      否则整排瓶会自己沿球道滑向玩家，「弱球够不到瓶阵」这条前提就不成立。
 *
 * ★ 倒瓶判定（本文件唯一的四条规则，代码与测试一一对应）：
 *   R1 直接命中：球速 ≥ BALL_HIT_MIN_SPEED 时，球与瓶的圆接触 ⇒ 该瓶立即倒下，
 *      并**从物理世界移除**（移出 pins，只进 fallen），不再参与任何后续碰撞。
 *      球速低于阈值时视为「擦碰」：瓶不动，只是被给一个法向冲量晃一下。
 *   R2 带倒：R1 中被撞倒的球速 ≥ CHAIN_MIN_SPEED 时倒瓶会扩散出一道「倒瓶波」，
 *      距离 ≤ PIN_CHAIN_R 的站瓶同波倒下并移出物理世界；否则该范围内站瓶只是被晃一下。
 *   R3 瓶撞瓶：两瓶相对法向速度 ≥ PIN_PAIR_FALL_SPEED 时双方都倒下并移出物理世界；
 *      否则按等质量 + 固定恢复系数交换法向分量，两瓶都继续参与物理。
 *   R4 进坑：瓶心越过坑线 PIT_Y（被撞进后坑）即倒下并移出物理世界，计入本球倒瓶数。
 *   —— 一旦判定倒瓶，该瓶就从 `pins` 中删除：既不参与球-瓶解算，也不参与瓶-瓶解算。
 *
 * ★ 计分（简化版连击规则，不做标准保龄球的「向后取样」）：
 *   基础分 = 本局所有球倒下的瓶数之和（每瓶 1 分）；
 *   额外奖励 = 全中次数 × STRIKE_BONUS（一球打倒 10 瓶）+ 补中次数 × SPARE_BONUS（多球凑满 10 瓶）；
 *   单局得分 = 基础分 + 该局额外奖励；总分 = 10 局得分之和。
 *
 * 渲染层用 performance.now() 算真实 dt，再折算成整数 tick 数发 `step` action；
 * 本文件内不存在 performance / Date / Math.random，随机一律走 Rng（存在 State 里）。
 */
import { Rng, hashSeed } from '../../core/rng'
import { clamp } from '../../core/geom'

// ---------------------------------------------------------------- 场地尺寸
export const VW = 720
export const VH = 1280

// ---------------------------------------------------------------- 定步参数
/** 固定步长（秒）：所有积分都按此步长推进 */
export const DT = 1 / 60
/** 重力加速度（逻辑像素 / 秒²），正方向为「朝向玩家」 */
export const GRAVITY = 1500
/** 全局限速：单 tick 位移 ≈ 27px < 球瓶半径和 30px，不会穿模 */
export const MAX_SPEED = 1600

// ---------------------------------------------------------------- 球
export const BALL_R = 16
export const BALL_START_X = 360
export const BALL_START_Y = 1180
/** 球越过这条线即判本球结束（回球道） */
export const BALL_EXIT_Y = VH - 44
export const BALL_AIR = 0.9992
export const BALL_ROLL = 0.9935
/** 撞到每个瓶子后球的速度保留系数 */
export const BALL_KEEP = 0.98
/** 撞瓶时球获得的法向偏折（像素 / 秒） */
export const BALL_DEFLECT = 18
export const WALL_RESTITUTION = 0.45

// ---------------------------------------------------------------- 瓶
export const FRAME_PINS = 10
export const PIN_R = 14
/** 同排瓶中心距 */
export const PIN_GAP = 58
/** 排与排的纵向间距 */
export const PIN_ROW_GAP = 56
/** 头瓶（第一排最靠玩家的一瓶）的 y */
export const HEADPIN_Y = 540
/** 坑线：越过此线的球被回收，越过此线的瓶算倒下 */
export const PIT_Y = 300
/** R1：球速低于此值碰到瓶只算擦碰 */
export const BALL_HIT_MIN_SPEED = 300
/** R2：倒瓶波触发所需速度 */
export const CHAIN_MIN_SPEED = 700
/** R2：倒瓶波 / 晃动波及半径 */
export const PIN_CHAIN_R = 78
/** R3：瓶撞瓶导致双方倒下的相对法向速度 */
export const PIN_PAIR_FALL_SPEED = 430
/** R3：瓶撞瓶的固定恢复系数 */
export const PIN_PAIR_RESTITUTION = 0.6
/** 擦碰 / 低速波给站瓶的法向冲量（像素 / 秒） */
export const JOSTLE_SPEED = 150
export const PIN_AIR = 0.995
export const PIN_ROLL = 0.99

// ---------------------------------------------------------------- 投球参数
export const MIN_THROW = 1120
export const MAX_THROW = 1600
/** 角度钳制范围（弧度，0 = 正对瓶阵） */
export const ANGLE_MAX = 0.16
/** 拖拽满力所需的像素长度 */
export const DRAG_FULL = 260

// ---------------------------------------------------------------- 赛制与计分
export const FRAMES = 10
export const STRIKE_BONUS = 10
export const SPARE_BONUS = 5

// ---------------------------------------------------------------- 收尾保护
/** 单球最长 tick 数：即使异常也一定在本球内结束 */
export const MAX_ROLL_TICKS = 420
/** 球速低于此值视为停住 */
export const STALL_SPEED = 40
/** 连续停住多少 tick 后本球结束 */
export const STALL_TICKS = 45
/** 场地左右/上下内缩：任何在场的球与瓶心都不会越过 WALL_MARGIN + 半径 */
export const WALL_MARGIN = 8
/** fallen 只保留最近若干条（纯渲染用，防止无限增长） */
export const FALLEN_KEEP = 48

// ---------------------------------------------------------------- 状态类型
export type Phase = 'aim' | 'rolling' | 'done'

/** 站立的瓶 —— 物理世界成员，倒瓶后立即移出 */
export interface Pin {
  id: number
  /** 排号 1..4（第 1 排是头瓶） */
  row: number
  /** 排内序号 1..row */
  col: number
  x: number
  y: number
  vx: number
  vy: number
}

/** 倒下的瓶 —— 仅供渲染记录，**不参与任何碰撞与积分** */
export interface FallenPin {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  /** 已倒下多少 tick（渲染做淡出） */
  life: number
}

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
}

export interface FrameRecord {
  /** 本局每一球倒下的瓶数 */
  balls: number[]
  /** 本局得分 = 基础分 + 额外奖励 */
  score: number
  strike: boolean
  spare: boolean
}

export interface State {
  seed: number
  /** mulberry32 的 32 位游标 */
  rng: number
  phase: Phase
  /** 第几局（0 起，共 FRAMES 局） */
  frame: number
  /** 当前局已投出的每一球的倒瓶数 */
  balls: number[]
  /** 已结算的每局成绩 */
  frames: FrameRecord[]
  /** 站立的瓶（物理世界成员） */
  pins: Pin[]
  /** 倒下的瓶（只渲染） */
  fallen: FallenPin[]
  /** 下一球是否需要重新摆满 10 瓶 */
  rackUp: boolean
  ball: Ball | null
  angle: number
  power: number
  /** 本球已推进的 tick 数 */
  ticks: number
  /** 球连续低速的 tick 数 */
  slow: number
  /** 拖拽起点（输入辅助） */
  drag: { x: number; y: number } | null
}

export type Action =
  | { type: 'aim'; angle: number }
  | { type: 'power'; power: number }
  | { type: 'dragStart'; x: number; y: number }
  | { type: 'dragMove'; x: number; y: number }
  | { type: 'swing' }
  | { type: 'step'; n: number }

// ---------------------------------------------------------------- 纯工具
export function clampAngle(a: number): number {
  return clamp(a, -ANGLE_MAX, ANGLE_MAX)
}

export function clampPower(p: number): number {
  return clamp(p, 0, 1)
}

/** 力度 0..1 → 出球初速 */
export function throwSpeed(power: number): number {
  return MIN_THROW + clampPower(power) * (MAX_THROW - MIN_THROW)
}

function speed(b: Ball): number {
  return Math.hypot(b.vx, b.vy)
}

/** 标准三角排列：1 + 2 + 3 + 4 = 10 瓶，头瓶朝下（y 大），后排 y 更小 */
export function setupPins(): Pin[] {
  const out: Pin[] = []
  let id = 0
  for (let row = 1; row <= 4; row++) {
    for (let col = 1; col <= row; col++) {
      out.push({
        id: id++,
        row,
        col,
        x: VW / 2 + (col - 1 - (row - 1) / 2) * PIN_GAP,
        y: HEADPIN_Y - (row - 1) * PIN_ROW_GAP,
        vx: 0,
        vy: 0,
      })
    }
  }
  return out
}

/** 摆瓶：只给 y 加 ±2 的可播种抖动（同种子同摆瓶，故可复现） */
export function rack(rng: Rng): Pin[] {
  return setupPins().map((p) => ({ ...p, y: p.y + rng.float(-2, 2) }))
}

/**
 * 单局结算：基础分 = 倒瓶总数；全中每次 +STRIKE_BONUS，补中 +SPARE_BONUS。
 * 不做标准保龄球「strike 加后两球 / spare 加后一球」的向后取样，见文件头注释。
 */
export function resolveFrame(balls: number[]): FrameRecord {
  let strike = false
  let bonus = 0
  let total = 0
  for (const b of balls) {
    total += b
    if (b >= FRAME_PINS) {
      strike = true
      bonus += STRIKE_BONUS
    }
  }
  const spare = !strike && total === FRAME_PINS
  if (spare) bonus += SPARE_BONUS
  return { balls: balls.slice(), score: total + bonus, strike, spare }
}

export function totalScore(state: State): number {
  let s = 0
  for (const f of state.frames) s += f.score
  return s
}

/** 含当前未结算局的即时总分 */
export function currentScore(state: State): number {
  return totalScore(state) + resolveFrame(state.balls).score
}

// ---------------------------------------------------------------- 初始状态
export function create(seed: number): State {
  const rng = new Rng(hashSeed(seed))
  return {
    seed,
    rng: rng.s,
    phase: 'aim',
    frame: 0,
    balls: [],
    frames: [],
    pins: rack(rng),
    fallen: [],
    rackUp: false,
    ball: null,
    angle: 0,
    power: 0.6,
    ticks: 0,
    slow: 0,
    drag: null,
  }
}

// ---------------------------------------------------------------- 单步物理
/** 边界反射 + 位置钳制：保证球与瓶永远不出界 */
function confine(b: { x: number; y: number; vx: number; vy: number }, r: number): void {
  const lo = WALL_MARGIN + r
  const hi = VW - WALL_MARGIN - r
  if (b.x < lo) {
    b.x = lo
    if (b.vx < 0) b.vx = -b.vx * WALL_RESTITUTION
  } else if (b.x > hi) {
    b.x = hi
    if (b.vx > 0) b.vx = -b.vx * WALL_RESTITUTION
  }
  const top = WALL_MARGIN + r
  const bot = VH - WALL_MARGIN - r
  if (b.y < top) {
    b.y = top
    if (b.vy < 0) b.vy = -b.vy * WALL_RESTITUTION
  } else if (b.y > bot) {
    b.y = bot
    if (b.vy > 0) b.vy = -b.vy * WALL_RESTITUTION
  }
}

/**
 * R1 + R2：球与瓶的圆接触。
 * 返回本 tick 被判定倒下的瓶集合（调用方负责把它们移出物理世界）。
 */
function ballPinHit(pins: Pin[], ball: Ball, down: Set<number>): void {
  const v = speed(ball)
  const contact = BALL_R + PIN_R
  const knocked: Pin[] = []
  for (const p of pins) {
    if (down.has(p.id)) continue
    const dx = p.x - ball.x
    let dy = p.y - ball.y
    let d = Math.hypot(dx, dy)
    if (d >= contact) continue
    if (d < 1e-4) {
      dy = -1
      d = 1
    }
    const nx = dx / d
    const ny = dy / d
    if (v >= BALL_HIT_MIN_SPEED) {
      // R1：直接命中 → 立即倒下
      down.add(p.id)
      knocked.push(p)
      ball.vx *= BALL_KEEP
      ball.vy *= BALL_KEEP
      ball.vx += nx * BALL_DEFLECT
    } else {
      // 擦碰：只晃，不倒
      p.vx += nx * JOSTLE_SPEED
      p.vy += ny * JOSTLE_SPEED
    }
  }
  if (knocked.length === 0) return

  // R2：倒瓶波
  const chain = v >= CHAIN_MIN_SPEED
  const seen = new Set<number>(knocked.map((p) => p.id))
  const queue = knocked.slice()
  while (queue.length > 0) {
    const cur = queue.shift()
    if (!cur) break
    for (const p of pins) {
      if (down.has(p.id) || seen.has(p.id)) continue
      const dx = p.x - cur.x
      const dy = p.y - cur.y
      const d = Math.hypot(dx, dy)
      if (d > PIN_CHAIN_R) continue
      seen.add(p.id)
      if (chain) {
        down.add(p.id)
        queue.push(p)
      } else {
        const inv = d > 1e-4 ? 1 / d : 0
        p.vx += dx * inv * JOSTLE_SPEED
        p.vy += dy * inv * JOSTLE_SPEED
      }
    }
  }
}

/** R3：瓶-瓶圆碰撞：位置分离 + 等质量法向冲量；冲量够大则双方都倒下 */
function pinPairs(pins: Pin[], down: Set<number>): void {
  const minD = PIN_R * 2
  for (let i = 0; i < pins.length; i++) {
    const a = pins[i]
    if (down.has(a.id)) continue
    for (let j = i + 1; j < pins.length; j++) {
      const b = pins[j]
      if (down.has(b.id)) continue
      let dx = b.x - a.x
      let dy = b.y - a.y
      let d = Math.hypot(dx, dy)
      if (d >= minD) continue
      if (d < 1e-4) {
        dx = 1
        dy = 0
        d = 1
      }
      const nx = dx / d
      const ny = dy / d
      const push = (minD - d) / 2 + 1e-3
      a.x -= nx * push
      a.y -= ny * push
      b.x += nx * push
      b.y += ny * push
      // 接近速度：rel < 0 表示 b 正朝 a 靠拢
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
      if (rel >= 0) continue
      const imp = -rel
      const j2 = (imp * (1 + PIN_PAIR_RESTITUTION)) / 2
      a.vx -= nx * j2
      a.vy -= ny * j2
      b.vx += nx * j2
      b.vy += ny * j2
      if (imp >= PIN_PAIR_FALL_SPEED) {
        down.add(a.id)
        down.add(b.id)
      }
    }
  }
}

/** 球与仍站立的瓶做一次穿透解算，保证任何时刻两圆不重叠 */
function separateBallPin(pins: Pin[], ball: Ball, down: Set<number>): void {
  const contact = BALL_R + PIN_R
  for (const p of pins) {
    if (down.has(p.id)) continue
    const dx = p.x - ball.x
    let dy = p.y - ball.y
    let d = Math.hypot(dx, dy)
    if (d >= contact) continue
    if (d < 1e-4) {
      dy = -1
      d = 1
    }
    const push = contact - d + 1e-3
    p.x += (dx / d) * push
    p.y += (dy / d) * push
  }
}

/** 推进一个 tick。所有会改到的东西都先拷贝，函数不触碰入参。 */
export function stepOnce(state: State): State {
  if (state.phase !== 'rolling' || !state.ball) return state
  const ball: Ball = { ...state.ball }
  const pins: Pin[] = state.pins.map((p) => ({ ...p }))
  const fallen: FallenPin[] = state.fallen.map((f) => ({ ...f, life: f.life + 1 }))
  const down = new Set<number>()
  let gone = false

  // 1) 积分
  ball.vy += GRAVITY * DT
  ball.vx *= BALL_ROLL
  ball.vy *= BALL_AIR
  const bs = speed(ball)
  if (bs > MAX_SPEED) {
    const k = MAX_SPEED / bs
    ball.vx *= k
    ball.vy *= k
  }
  ball.x += ball.vx * DT
  ball.y += ball.vy * DT

  for (const p of pins) {
    // 瓶脚钉在球道上：静止的站瓶跳过积分，不会被重力拖向玩家
    if (p.vx === 0 && p.vy === 0) continue
    p.vy += GRAVITY * DT
    p.vx *= PIN_ROLL
    p.vy *= PIN_AIR
    p.x += p.vx * DT
    p.y += p.vy * DT
  }

  // 2) R1 + R2
  ballPinHit(pins, ball, down)
  // 3) R3
  pinPairs(pins, down)
  // 4) 穿透解算（保证不重叠）
  separateBallPin(pins, ball, down)
  pinPairs(pins, down)

  // 5) 边界
  confine(ball, BALL_R)
  for (const p of pins) confine(p, PIN_R)

  // 6) 坑线
  if (ball.y < PIT_Y) gone = true
  for (const p of pins) if (p.y < PIT_Y) down.add(p.id) // R4

  // 7) 倒瓶移出物理世界
  const standing: Pin[] = []
  for (const p of pins) {
    if (down.has(p.id)) {
      fallen.push({ id: p.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy, life: 0 })
    } else {
      standing.push(p)
    }
  }
  if (fallen.length > FALLEN_KEEP) fallen.splice(0, fallen.length - FALLEN_KEEP)

  // 8) 本球是否结束
  const ticks = state.ticks + 1
  const slow = state.slow + (speed(ball) < STALL_SPEED ? 1 : 0)
  const next: State = { ...state, pins: standing, fallen, ball, ticks, slow }
  const finished = gone || standing.length === 0 || slow >= STALL_TICKS || ticks >= MAX_ROLL_TICKS
  return finished ? endRoll(next) : next
}

/**
 * 本球结束 → 结算倒瓶数 → 推进赛制。
 * 每一分支都显式设置 phase / frame / rackUp，局数用尽必定进入 'done'。
 */
function endRoll(s: State): State {
  const knocked = clamp(FRAME_PINS - s.pins.length, 0, FRAME_PINS)
  const balls = s.balls.concat([knocked])
  const last = s.frame === FRAMES - 1
  let finished: boolean
  if (!last) {
    // 普通局：全中一球结束，否则两球结束
    finished = balls.length >= 2 || knocked >= FRAME_PINS
  } else if (balls.length >= 3) {
    // 第 10 局第三球
    finished = true
  } else if (balls.length === 2) {
    // 第 10 局第二球后：全中或补中才有第三球
    finished = !(balls[0] >= FRAME_PINS || balls[0] + balls[1] >= FRAME_PINS)
  } else {
    finished = false
  }

  const next: State = { ...s, ball: null, balls, ticks: 0, slow: 0 }
  if (finished) {
    const frames = s.frames.slice()
    frames.push(resolveFrame(balls))
    next.frames = frames
    next.frame = s.frame + 1
    next.balls = []
    next.rackUp = true
    next.phase = next.frame >= FRAMES ? 'done' : 'aim'
  } else {
    next.phase = 'aim'
    next.rackUp = (last && balls.length >= 2) || knocked >= FRAME_PINS
  }
  return next
}

// ---------------------------------------------------------------- 出球
function swing(state: State): State {
  if (state.phase !== 'aim') return state
  const rng = new Rng(state.rng)
  const pins = state.rackUp ? rack(rng) : state.pins
  const s = throwSpeed(state.power)
  const a = clampAngle(state.angle)
  return {
    ...state,
    rng: rng.s,
    pins,
    rackUp: false,
    ball: { x: BALL_START_X, y: BALL_START_Y, vx: s * Math.sin(a), vy: -s * Math.cos(a) },
    phase: 'rolling',
    ticks: 0,
    slow: 0,
  }
}

// ---------------------------------------------------------------- 主 reducer
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'aim':
      if (state.phase === 'done') return state
      return { ...state, angle: clampAngle(action.angle) }
    case 'power':
      if (state.phase === 'done') return state
      return { ...state, power: clampPower(action.power) }
    case 'dragStart':
      if (state.phase === 'done') return state
      return { ...state, drag: { x: action.x, y: action.y } }
    case 'dragMove': {
      if (state.phase === 'done' || !state.drag) return state
      const dx = action.x - state.drag.x
      const dy = action.y - state.drag.y
      const len = Math.hypot(dx, dy)
      if (len < 1) return state
      return {
        ...state,
        power: clampPower(Math.min(1, len / DRAG_FULL)),
        angle: clampAngle(Math.atan2(dx, -dy)),
      }
    }
    case 'swing':
      return swing(state)
    case 'step': {
      if (state.phase !== 'rolling') return state
      const n = clamp(Math.floor(action.n), 0, 8)
      let s = state
      for (let i = 0; i < n && s.phase === 'rolling'; i++) s = stepOnce(s)
      return s
    }
    default:
      return state
  }
}

/** 连续推进 n 个 tick（测试与调试用） */
export function run(state: State, n: number): State {
  return reduce(state, { type: 'step', n })
}
