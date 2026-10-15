/**
 * 高尔夫球规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 设计要点：
 * - 球场是一张 COLS×ROWS 的地形网格：平地 / 草地 / 沙坑 / 水障碍，每格摩擦系数不同。
 * - 击球两段式：chargeStart 开始蓄力 → charge 增长力度 → shoot 击球；
 *   方向由滑条 aim ∈ [0,1] 控制，映射到击球角度 -π..π。
 * - 球按固定步长（整数 tick）推进：受所在格的摩擦系数减速、撞边反弹、进洞或静止即结束本杆。
 * - 水障碍罚则：球落水即判定，本杆再加 WATER_PENALTY 杆罚杆，球退回本杆击球前的位置，
 *   仍由同一方继续击球 —— 即这一杆实际计 2 杆（击球杆 + 罚杆）。
 * - 每洞双方杆数都打满 MAX_HOLE_STROKES 时，本洞直接结束并记录，保证任意分支都能终局。
 * - AI 不维护第二套规则：遍历候选 (方向, 力度)，把候选喂给同一个 reduce 跑完整段滚动后打分。
 */
import { clamp } from '../../core/geom'
import { Rng } from '../../core/rng'
import type { Control, Outcome } from '../../core/types'

// ---------------------------------------------------------------- 常量

/** 逻辑像素 / 逻辑帧 */
export const TICK_MS = 16
/** 单个 tick 内最多推进的物理步数，防止一次动作跳太多 */
export const MAX_TICKS = 400

/** 球场矩形（逻辑坐标，720×1280 视图内居中偏上） */
export const FIELD_X = 20
export const FIELD_Y = 100
export const COLS = 20
export const ROWS = 22
export const CELL_W = 34
export const CELL_H = 32
export const FIELD_W = COLS * CELL_W
export const FIELD_H = ROWS * CELL_H

export const BALL_R = 7
export const CUP_R = 11
/** 撞墙速度保留系数 */
export const RESTITUTION = 0.72
/** 满蓄力的初速度（逻辑像素 / tick） */
export const SPEED_MAX = 26
/** 速度低于该值判定球停 */
export const STOP_SPEED = 0.35
/** 低于该力度视为空杆，不计杆数 */
export const MIN_POWER = 0.12
/** 每 tick 蓄力增量，约 0.8 秒拉满 */
export const CHARGE_STEP = 0.02

export const HOLE_COUNT = 3
/** 单洞双方杆数封顶值，用作终局保底 */
export const MAX_HOLE_STROKES = 12
/** 落水罚杆数 */
export const WATER_PENALTY = 1

/** 击球收杆后自动推进回合所需的等待 tick */
const WAIT_AFTER_STOP = 10
/** 落水后给玩家看清楚罚则的等待 tick */
const WAIT_AFTER_WATER = 22
/** 进洞到切下一洞的等待 tick */
const WAIT_AFTER_HOLE = 30

// ---------------------------------------------------------------- 地形

export type Terrain = 'fair' | 'grass' | 'sand' | 'water'

export const TERRAINS: readonly Terrain[] = ['fair', 'grass', 'sand', 'water']

/** 每 tick 的速度保留系数：越小摩擦越大、停得越快（沙坑明显慢于平地） */
export const DRAG: Record<Terrain, number> = {
  fair: 0.96,
  grass: 0.92,
  sand: 0.86,
  water: 0.8,
}

export const TERRAIN_LABEL: Record<Terrain, string> = {
  fair: '平地',
  grass: '草地',
  sand: '沙坑',
  water: '水障碍',
}

// ---------------------------------------------------------------- 类型

export type Side = 'player' | 'ai'
export const PLAYER: Side = 'player'
export const AI: Side = 'ai'

export function flip(side: Side): Side {
  return side === PLAYER ? AI : PLAYER
}

export function sideIndex(side: Side): number {
  return side === PLAYER ? 0 : 1
}

export function sideLabel(side: Side): string {
  return side === PLAYER ? '你' : 'AI'
}

export interface Vec {
  x: number
  y: number
}

export interface Hole {
  par: number
  /** 发球点（球心） */
  tee: Vec
  /** 球洞（球心） */
  cup: Vec
  /** 行主序地形，长度 COLS*ROWS */
  tiles: Terrain[]
}

/** aim / charging / rolling / holed / over */
export type Phase = 'aim' | 'charging' | 'rolling' | 'holed' | 'over'

export interface State {
  rng: number
  holes: Hole[]
  holeIndex: number
  turn: Side
  phase: Phase
  /** 当前洞双方杆数（罚杆也计入） */
  strokes: [number, number]
  /** 已完结洞的杆数 */
  results: [number, number][]
  ball: Vec
  vel: Vec
  /** 本杆击球前的球位，落水时退回这里 */
  teeMark: Vec
  /** 方向滑条 0..1 */
  aim: number
  /** 蓄力 0..1 */
  power: number
  /** 收杆等待结束后是否轮到对方 */
  pass: boolean
  /** 收杆后的等待 tick，>0 时由 tick 倒计时自动推进 */
  wait: number
  /** 最近一条事件说明 */
  note: string
  /** 累计罚杆（展示用） */
  penalties: number
}

export type Action =
  /** 方向滑条：value 会被钳制到 0..1 */
  | { type: 'aim'; value: number }
  /** 第一段：开始蓄力 */
  | { type: 'chargeStart' }
  /** 蓄力增长 / 回落（第二段之前也可增长） */
  | { type: 'charge'; delta: number }
  /** 放弃蓄力 */
  | { type: 'cancelCharge' }
  /** 第二段：击球；power 省略时用当前蓄力量 */
  | { type: 'shoot'; power?: number }
  /** 按固定步长推进物理与自动收尾 */
  | { type: 'tick'; ticks: number }

// ---------------------------------------------------------------- 坐标工具

export function cellIndex(col: number, row: number): number {
  return row * COLS + col
}

export function cellCenter(col: number, row: number): Vec {
  return { x: FIELD_X + col * CELL_W + CELL_W / 2, y: FIELD_Y + row * CELL_H + CELL_H / 2 }
}

export function terrainAt(hole: Hole, x: number, y: number): Terrain {
  const col = clamp(Math.floor((x - FIELD_X) / CELL_W), 0, COLS - 1)
  const row = clamp(Math.floor((y - FIELD_Y) / CELL_H), 0, ROWS - 1)
  return hole.tiles[cellIndex(col, row)]
}

/** 滑条值 → 击球角度（-π..π） */
export function aimAngle(aim: number): number {
  return Math.PI * (clamp(aim, 0, 1) * 2 - 1)
}

/** 指向球洞的建议滑条值 */
export function aimToCup(hole: Hole): number {
  const angle = Math.atan2(hole.cup.y - hole.tee.y, hole.cup.x - hole.tee.x)
  return clamp(angle / (2 * Math.PI) + 0.5, 0, 1)
}

/** 点到线段的距离，用于高速时不漏判进洞 */
function segDist(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1)
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

// ---------------------------------------------------------------- 建局

function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS
}

function makeHole(r: Rng, index: number): Hole {
  const tiles = new Array<Terrain>(COLS * ROWS).fill('fair')
  const stamp = (t: Terrain, cx: number, cy: number, hw: number, hh: number): void => {
    for (let row = cy - hh; row <= cy + hh; row++) {
      if (!inBounds(clamp(cx, 0, COLS - 1), row)) continue
      for (let col = cx - hw; col <= cx + hw; col++) {
        if (!inBounds(col, clamp(row, 0, ROWS - 1))) continue
        tiles[cellIndex(col, row)] = t
      }
    }
  }

  const teeCol = r.int(2)
  const teeRow = r.range(3, ROWS - 4)
  let cupCol = COLS - 1 - r.int(3)
  let cupRow = r.range(3, ROWS - 4)
  // 保证发球点与球洞有足够横向 / 纵向落差
  if (Math.abs(cupRow - teeRow) < 3) {
    cupRow = cupRow >= teeRow ? teeRow + 3 : teeRow - 3
    cupRow = clamp(cupRow, 3, ROWS - 4)
  }

  // 草地斑块
  const grassBlobs = 3 + index
  for (let i = 0; i < grassBlobs; i++) stamp('grass', r.range(3, COLS - 4), r.range(1, ROWS - 2), r.int(1), r.int(2))
  // 球洞附近的沙坑
  stamp('sand', cupCol, cupRow, r.int(1), r.int(1))
  stamp('sand', clamp(cupCol - r.range(1, 3), 0, COLS - 1), clamp(cupRow + r.range(-3, 3), 0, ROWS - 1), r.int(1), 0)
  // 中场水障碍带
  const waterBlobs = 2 + index
  for (let i = 0; i < waterBlobs; i++) stamp('water', COLS / 2 - 1 + r.int(3), r.range(2, ROWS - 3), r.int(1), r.range(1, 2))

  // 发球点与球洞周围留出安全区，避免开局即落水 / 球洞被水包住
  const clear = (cx: number, cy: number, rad: number): void => {
    for (let row = cy - rad; row <= cy + rad; row++) {
      for (let col = cx - rad; col <= cx + rad; col++) {
        if (inBounds(col, row)) tiles[cellIndex(col, row)] = 'fair'
      }
    }
  }
  clear(teeCol, teeRow, 1)
  clear(cupCol, cupRow, 1)

  const tee = cellCenter(teeCol, teeRow)
  const cup = cellCenter(cupCol, cupRow)
  const par = clamp(Math.round(Math.hypot(cup.x - tee.x, cup.y - tee.y) / 170) + 2, 2, 5)
  return { par, tee, cup, tiles }
}

export function create(seed: number): State {
  const r = new Rng(seed | 0)
  const holes: Hole[] = []
  for (let i = 0; i < HOLE_COUNT; i++) holes.push(makeHole(r, i))
  const first = holes[0]
  return {
    rng: r.s,
    holes,
    holeIndex: 0,
    turn: PLAYER,
    phase: 'aim',
    strokes: [0, 0],
    results: [],
    ball: { x: first.tee.x, y: first.tee.y },
    vel: { x: 0, y: 0 },
    teeMark: { x: first.tee.x, y: first.tee.y },
    aim: aimToCup(first),
    power: 0,
    pass: false,
    wait: 0,
    note: `第 1 洞 开球，标准杆 ${first.par}`,
    penalties: 0,
  }
}

export function currentHole(state: State): Hole {
  return state.holes[clamp(state.holeIndex, 0, state.holes.length - 1)]
}

/** 累计杆数（已完结洞 + 当前洞） */
export function totalStrokes(state: State, side: Side): number {
  const i = sideIndex(side)
  let sum = state.strokes[i]
  for (const res of state.results) sum += res[i]
  return sum
}

/** 本洞是否可以收杆 */
export function canPlay(state: State): boolean {
  return state.phase === 'aim' && state.turn === PLAYER && state.wait === 0
}

// ---------------------------------------------------------------- 物理与收尾

function bumpStrokes(state: State, delta: number): [number, number] {
  const strokes: [number, number] = [state.strokes[0], state.strokes[1]]
  strokes[sideIndex(state.turn)] += delta
  return strokes
}

/** 单个 tick 的滚动推进 */
function stepRolling(state: State): State {
  const hole = currentHole(state)
  const drag = DRAG[terrainAt(hole, state.ball.x, state.ball.y)]
  const vx = state.vel.x * drag
  const vy = state.vel.y * drag
  let x = state.ball.x + vx
  let y = state.ball.y + vy

  const minX = FIELD_X + BALL_R
  const maxX = FIELD_X + FIELD_W - BALL_R
  const minY = FIELD_Y + BALL_R
  const maxY = FIELD_Y + FIELD_H - BALL_R
  let nx = vx
  let ny = vy
  if (x < minX) {
    x = minX + (minX - x) * RESTITUTION
    nx = Math.abs(vx) * RESTITUTION
  } else if (x > maxX) {
    x = maxX - (x - maxX) * RESTITUTION
    nx = -Math.abs(vx) * RESTITUTION
  }
  if (y < minY) {
    y = minY + (minY - y) * RESTITUTION
    ny = Math.abs(vy) * RESTITUTION
  } else if (y > maxY) {
    y = maxY - (y - maxY) * RESTITUTION
    ny = -Math.abs(vy) * RESTITUTION
  }

  // 落水：判罚、球退回本杆击球点，仍由同一方继续
  if (terrainAt(hole, x, y) === 'water') {
    return maybeCap({
      ...state,
      ball: { x: state.teeMark.x, y: state.teeMark.y },
      vel: { x: 0, y: 0 },
      phase: 'aim',
      strokes: bumpStrokes(state, WATER_PENALTY),
      penalties: state.penalties + WATER_PENALTY,
      pass: false,
      wait: WAIT_AFTER_WATER,
      note: `落水！罚 ${WATER_PENALTY} 杆，球退回本杆击球点`,
    })
  }

  // 进洞：用线段距离判定，避免高速穿洞
  if (segDist(state.ball.x, state.ball.y, x, y, hole.cup.x, hole.cup.y) <= CUP_R) {
    return maybeCap({
      ...state,
      ball: { x: hole.cup.x, y: hole.cup.y },
      vel: { x: 0, y: 0 },
      phase: 'holed',
      pass: false,
      wait: WAIT_AFTER_HOLE,
      note: `${sideLabel(state.turn)} 进洞！本洞 ${state.strokes[sideIndex(state.turn)]} 杆（标准杆 ${hole.par}）`,
    })
  }

  // 静止：本杆结束，等待后把回合交给对方
  if (Math.hypot(nx, ny) < STOP_SPEED) {
    return maybeCap({
      ...state,
      ball: { x, y },
      vel: { x: 0, y: 0 },
      phase: 'aim',
      pass: true,
      wait: WAIT_AFTER_STOP,
      note: `${sideLabel(state.turn)} 本杆结束，共 ${state.strokes[sideIndex(state.turn)]} 杆`,
    })
  }
  return { ...state, ball: { x, y }, vel: { x: nx, y: ny } }
}

/**
 * 终局保底：双方杆数都打满 MAX_HOLE_STROKES 时本洞直接结束。
 * 进洞 / 落水 / 静止三条收尾分支都会经过这里，因此不存在永不分胜负的分支。
 */
function maybeCap(state: State): State {
  if (state.strokes[0] < MAX_HOLE_STROKES && state.strokes[1] < MAX_HOLE_STROKES) return state
  return {
    ...state,
    phase: 'holed',
    pass: false,
    wait: WAIT_AFTER_HOLE,
    note: `本洞杆数已达上限（${MAX_HOLE_STROKES} 杆），本洞结束`,
  }
}

/** 等待倒计时结束后推进：切洞 / 换边 */
function autoAdvance(state: State): State {
  if (state.phase === 'holed') {
    const results: [number, number][] = state.results.concat([[state.strokes[0], state.strokes[1]]])
    const index = state.holeIndex + 1
    if (index >= state.holes.length) {
      const p = totalStrokes({ ...state, results, strokes: [0, 0] }, PLAYER)
      const a = totalStrokes({ ...state, results, strokes: [0, 0] }, AI)
      const text = p < a ? `全部洞打完，你赢了！总杆 ${p} : ${a}` : p > a ? `全部洞打完，AI 获胜。总杆 ${p} : ${a}` : `全部洞打完，平局，总杆 ${p}`
      return { ...state, results, strokes: [0, 0], phase: 'over', pass: false, wait: 0, note: text }
    }
    const hole = state.holes[index]
    return {
      ...state,
      results,
      strokes: [0, 0],
      holeIndex: index,
      phase: 'aim',
      pass: false,
      wait: 0,
      power: 0,
      ball: { x: hole.tee.x, y: hole.tee.y },
      vel: { x: 0, y: 0 },
      teeMark: { x: hole.tee.x, y: hole.tee.y },
      aim: aimToCup(hole),
      note: `第 ${index + 1} 洞 开球，标准杆 ${hole.par}`,
    }
  }
  if (state.pass) {
    const turn = flip(state.turn)
    return { ...state, turn, pass: false, power: 0, note: `${sideLabel(turn)} 的回合` }
  }
  return state.power === 0 ? state : { ...state, power: 0 }
}

/**
 * 推进 n 个 tick：玩家蓄力时按 CHARGE_STEP 增长力度，滚动中走物理，
 * 等待中倒计时；三种状态都不满足时原样返回。
 */
function advanceTicks(state: State, ticks: number): State {
  const n = clamp(Math.round(Number.isFinite(ticks) ? ticks : 0), 0, MAX_TICKS)
  let cur = state
  for (let i = 0; i < n; i++) {
    // 玩家按住不放时，力度随 tick 自动增长（AI 由 charge action 自己驱动）
    if (cur.phase === 'charging') {
      if (cur.turn !== PLAYER || cur.power >= 1) break
      cur = { ...cur, power: clamp(cur.power + CHARGE_STEP, 0, 1) }
      continue
    }
    if (cur.phase === 'rolling') {
      cur = stepRolling(cur)
      continue
    }
    if ((cur.phase === 'aim' || cur.phase === 'holed') && cur.wait > 0) {
      cur = { ...cur, wait: cur.wait - 1 }
      if (cur.wait === 0) cur = autoAdvance(cur)
      continue
    }
    break
  }
  return cur
}

// ---------------------------------------------------------------- 纯状态迁移

/** 纯函数状态迁移：不修改入参，不读时间与全局随机数 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'aim': {
      if (state.phase === 'over' || state.phase === 'rolling' || state.phase === 'holed') return state
      const value = clamp(Number.isFinite(action.value) ? action.value : state.aim, 0, 1)
      if (value === state.aim) return state
      return { ...state, aim: value }
    }

    case 'chargeStart': {
      if (state.phase === 'over' || state.phase === 'rolling' || state.phase === 'holed') return state
      if (state.wait > 0 || state.phase === 'charging') return state
      return { ...state, phase: 'charging', power: 0 }
    }

    case 'charge': {
      if (state.phase === 'over' || state.phase === 'rolling' || state.phase === 'holed') return state
      if (state.wait > 0) return state
      const delta = Number.isFinite(action.delta) ? action.delta : 0
      const power = clamp(state.power + delta, 0, 1)
      if (state.phase === 'charging' && power === state.power) return state
      return { ...state, phase: 'charging', power }
    }

    case 'cancelCharge': {
      if (state.phase !== 'charging') return state
      return { ...state, phase: 'aim', power: 0 }
    }

    case 'shoot': {
      if (state.phase !== 'charging' && state.phase !== 'aim') return state
      if (state.wait > 0) return state
      const raw = action.power === undefined ? state.power : action.power
      const power = clamp(Number.isFinite(raw) ? raw : 0, 0, 1)
      if (power < MIN_POWER) return { ...state, phase: 'aim', power: 0, note: '蓄力太轻，放弃击球' }
      const angle = aimAngle(state.aim)
      const speed = power * SPEED_MAX
      const strokes = bumpStrokes(state, 1)
      return {
        ...state,
        phase: 'rolling',
        power,
        ball: { x: state.ball.x, y: state.ball.y },
        teeMark: { x: state.ball.x, y: state.ball.y },
        vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        strokes,
        pass: false,
        wait: 0,
        note: `${sideLabel(state.turn)} 击球，力度 ${Math.round(power * 100)}%`,
      }
    }

    case 'tick': {
      if (state.phase === 'over') return state
      const next = advanceTicks(state, action.ticks)
      return next === state ? state : next
    }

    default:
      return state
  }
}

// ---------------------------------------------------------------- 胜负与提示

export function outcome(state: State): Outcome | null {
  if (state.phase !== 'over') return null
  const p = totalStrokes(state, PLAYER)
  const a = totalStrokes(state, AI)
  return { score: p, better: 'lower', unit: '杆', win: p < a }
}

export function hint(state: State): string {
  const hole = currentHole(state)
  const head = `第 ${state.holeIndex + 1}/${state.holes.length} 洞 · 标准杆 ${hole.par} · 总杆 你 ${totalStrokes(state, PLAYER)} : AI ${totalStrokes(state, AI)}`
  if (state.phase === 'over') return `${head}｜${state.note}`
  if (state.phase === 'charging') return `${head}｜${sideLabel(state.turn)} 蓄力 ${Math.round(state.power * 100)}%，松开击球`
  if (state.phase === 'holed') return `${head}｜${state.note}`
  return `${head}｜${state.note}`
}

/** 提示区按钮（画布上不再自绘，避免与壳重复） */
export function controls(state: State): Control<Action>[] {
  const playable = canPlay(state)
  return [
    { label: '对准球洞', action: { type: 'aim', value: aimToCup(currentHole(state)) }, primary: playable, disabled: !playable },
    { label: '轻推一杆', action: { type: 'shoot', power: 0.3 }, disabled: !playable },
    { label: '大力一击', action: { type: 'shoot', power: 1 }, disabled: !playable },
  ]
}

// ---------------------------------------------------------------- AI

/** AI 遍历的候选方向（滑条值） */
const AIM_CANDIDATES: readonly number[] = [0.2, 0.3, 0.38, 0.45, 0.5, 0.55, 0.62, 0.7, 0.8]
/** AI 遍历的候选力度 */
const POWER_CANDIDATES: readonly number[] = [0.25, 0.4, 0.55, 0.7, 0.85, 1]
/** AI 每 tick 蓄力步长 */
const AI_CHARGE_STEP = 0.04

/**
 * 候选评分（越小越好）：进洞远优于任何位置；
 * 否则看落点离洞的距离、落水罚杆、这一杆多花的杆数。
 */
function evaluate(before: State, after: State): number {
  const hole = currentHole(before)
  const used = after.strokes[1] - before.strokes[1]
  const pen = after.penalties - before.penalties
  if (after.phase === 'holed') return -10_000 + used * 10 + pen * 200
  const d = Math.hypot(after.ball.x - hole.cup.x, after.ball.y - hole.cup.y)
  return d + pen * 150 + used * 6
}

/** 用同一个 reduce 跑完一杆，返回候选的真实结果 */
function simulate(state: State, aim: number, power: number): State {
  let s = reduce(state, { type: 'aim', value: aim })
  s = reduce(s, { type: 'chargeStart' })
  s = reduce(s, { type: 'shoot', power })
  return reduce(s, { type: 'tick', ticks: MAX_TICKS })
}

/** 遍历候选（方向 × 力度），全部交给 reduce 试算，返回最优的一杆 */
export function bestPlan(state: State): { aim: number; power: number } {
  const toCup = aimToCup(currentHole(state))
  let best = { aim: toCup, power: 0.5 }
  let bestScore = Infinity
  // 先把「对准球洞」这一手算进去，候选全灭时也有兜底
  const seedPlan = simulate(state, toCup, 0.5)
  bestScore = evaluate(state, seedPlan)
  for (const aim of AIM_CANDIDATES) {
    for (const power of POWER_CANDIDATES) {
      const score = evaluate(state, simulate(state, aim, power))
      if (score < bestScore) {
        bestScore = score
        best = { aim, power }
      }
    }
  }
  return best
}

/** 单条 AI 杆路的记忆：同一杆内 aim / 球位不变，因此只算一次 */
let planCache: { key: string; aim: number; power: number } | null = null

function planKey(state: State): string {
  return `${state.holeIndex}|${state.turn}|${Math.round(state.ball.x * 10)}|${Math.round(state.ball.y * 10)}|${state.strokes[0]}|${state.strokes[1]}`
}

/** 轮到 AI 时返回动作，否则返回 null */
export function aiAction(state: State): Action | null {
  if (state.phase === 'over' || state.turn !== AI || state.wait > 0) return null
  if (state.phase !== 'aim' && state.phase !== 'charging') return null
  const key = planKey(state)
  if (!planCache || planCache.key !== key) {
    const plan = bestPlan(state)
    planCache = { key, aim: plan.aim, power: plan.power }
  }
  if (state.phase === 'aim') return { type: 'chargeStart' }
  if (state.power + 1e-9 < planCache.power) return { type: 'charge', delta: AI_CHARGE_STEP }
  return { type: 'shoot' }
}
