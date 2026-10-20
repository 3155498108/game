/**
 * 贪吃蛇规则（纯逻辑，零 DOM 依赖，可在 node 环境直接单测）。
 *
 * 三条分层约定（延续 rail-cart / memory-sequence）：
 * 1. **时间不进 state**：本文件没有任何时间源，也不出现 Date / performance / Math.random。
 *    渲染层把真实帧间隔折算成整数 tick，再以 `{ type: 'tick', ticks }` 推进本状态机。
 * 2. **随机全部走 Rng**：食物位置由 state.rng 播种，同种子 + 同操作序列必得同一局，可复盘。
 * 3. **动画不进 state**：画面上蛇在两格之间的滑行由渲染层补间完成，这里只记逻辑位置。
 */
import { Rng } from '../../core/rng'

// ---------------- 棋盘参数 ----------------
/** 棋盘列数 */
export const COLS = 18
/** 棋盘行数 */
export const ROWS = 18
/** 一个逻辑 tick 的毫秒数：渲染层按此把真实帧间隔折算成整数 tick */
export const TICK_MS = 50
/** 开局长度 */
export const START_LENGTH = 3
/** 每颗食物的分值（固定 10 分） */
export const SCORE_PER_FOOD = 10

// ---------------- 速度参数 ----------------
/** 长度为 START_LENGTH 时，每前进一格需要的 tick 数（2 × 50ms = 100ms/格） */
export const BASE_TICKS_PER_CELL = 2
/** 每格最少也要这么多 tick（再快就是这个速度了） */
export const MIN_TICKS_PER_CELL = 1
/** 每长这么多节，每格所需的 tick 数就减 1 */
export const LENGTH_PER_SPEED_UP = 4

// ---------------- 转向参数 ----------------
/** 转向队列最多缓存几条：玩家连按两下不会自杀，第三下直接丢掉 */
export const MAX_TURN_QUEUE = 2

/** 方向 */
export type Dir = 'up' | 'down' | 'left' | 'right'

/** 网格坐标 */
export interface Cell {
  col: number
  row: number
}

const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right']

/** 每个方向的位移 */
const VEC: Record<Dir, Cell> = {
  up: { col: 0, row: -1 },
  down: { col: 0, row: 1 },
  left: { col: -1, row: 0 },
  right: { col: 1, row: 0 },
}

/** 反方向（180° 掉头就是它） */
const OPPOSITE: Record<Dir, Dir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

// ---------------- 状态 ----------------
export interface State {
  /** 蛇身各节坐标，body[0] 是蛇头 */
  body: Cell[]
  /** 当前朝向：下一步要走的方向 */
  dir: Dir
  /** 转向队列：最多缓存 MAX_TURN_QUEUE 条，在下一次移动前依次生效 */
  queue: Dir[]
  /** 食物所在格 */
  food: Cell
  /** 已累计的 tick：每攒够「一格所需的 tick 数」就前进一格 */
  stepAcc: number
  /** 已吃到的食物数 */
  eaten: number
  /** 分数：每颗食物固定 SCORE_PER_FOOD 分 */
  score: number
  /** 还活着吗：false 表示本局已经结束 */
  alive: boolean
  /** 是否把整块棋盘填满了（理论满分） */
  won: boolean
  /** 本局的种子：渲染层拿它当动画命名空间，换局时蛇不会从旧位置滑过来 */
  seed: number
  /** 对局序号：重开时 +1 */
  seq: number
  /** 随机游标（放食物时推进） */
  rng: number
}

export type Action =
  /** 转向：先进队列，在下一次移动前生效 */
  | { type: 'turn'; dir: Dir }
  /** 推进若干个 tick，由渲染层按真实时间折算 */
  | { type: 'tick'; ticks: number }
  /** 重开一局：回到初始盘面，随机流继续往前走 */
  | { type: 'restart' }

/** 每前进一格需要多少个 tick：蛇越长越快（下限 1 个 tick，也就是 50ms/格） */
export function ticksPerCell(length: number): number {
  const faster = Math.floor((length - START_LENGTH) / LENGTH_PER_SPEED_UP)
  return Math.max(MIN_TICKS_PER_CELL, BASE_TICKS_PER_CELL - faster)
}

/** 开局的蛇：长度 START_LENGTH，摆在棋盘中央，朝右 */
function initialBody(): Cell[] {
  const col = Math.floor(COLS / 2)
  const row = Math.floor(ROWS / 2)
  // 朝右：蛇头在最右边，后面的节依次往左
  return Array.from({ length: START_LENGTH }, (_, i) => ({ col: col - i, row }))
}

/**
 * 在空格上放一颗食物。
 *
 * 先把空格列出来再随机取一个，保证「食物一定不在蛇身上」，而不是靠重试碰运气。
 * 棋盘被填满时返回 {-1,-1}，表示「已经没有地方放食物了」。
 */
function spawnFood(r: Rng, body: readonly Cell[]): Cell {
  const taken: boolean[] = new Array<boolean>(COLS * ROWS).fill(false)
  for (const c of body) taken[c.row * COLS + c.col] = true
  const free: Cell[] = []
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!taken[row * COLS + col]) free.push({ col, row })
    }
  }
  if (free.length === 0) return { col: -1, row: -1 }
  return free[r.int(free.length)]
}

export function create(seed: number): State {
  const r = new Rng(seed)
  const body = initialBody()
  return {
    body,
    dir: 'right',
    queue: [],
    food: spawnFood(r, body),
    stepAcc: 0,
    eaten: 0,
    score: 0,
    alive: true,
    won: false,
    seed: seed | 0,
    seq: 0,
    rng: r.s,
  }
}

// ---------------- 状态迁移 ----------------

/**
 * 转向：指令先进队列，等下一次移动前才生效。
 *
 * 掉头判定用的是「参考方向」= 队列里最后一条（队列空时就是当前朝向），
 * 所以玩家连按「上 → 左」不会被判成掉头，而直接按反向一定被拒。
 */
function turn(state: State, dir: Dir): State {
  if (!state.alive) return state
  if (!DIRS.includes(dir)) return state
  const ref = state.queue.length > 0 ? state.queue[state.queue.length - 1] : state.dir
  // 重复方向没有意义；180° 掉头会直接撞上自己的身体，一律拒绝
  if (dir === ref) return state
  if (dir === OPPOSITE[ref]) return state
  // 队列满了就丢掉这条指令：宁可少转一次，也不要自杀
  if (state.queue.length >= MAX_TURN_QUEUE) return state
  return { ...state, queue: [...state.queue, dir] }
}

/** 推进若干个 tick：每个 tick 累计一步，累计够一格就移动一次 */
function advance(state: State, ticks: number): State {
  if (!state.alive) return state
  if (!Number.isInteger(ticks) || ticks <= 0) return state
  let cur = state
  for (let i = 0; i < ticks && cur.alive; i++) cur = stepTick(cur)
  return cur
}

/** 一个 tick：累计计数，够一格就移动一次 */
function stepTick(state: State): State {
  const per = ticksPerCell(state.body.length)
  const acc = state.stepAcc + 1
  if (acc < per) return { ...state, stepAcc: acc }
  return move(state)
}

/** 前进一格：转向、判死、吃食物 */
function move(state: State): State {
  // 队列里的第一条在移动前生效
  const dir = state.queue.length > 0 ? state.queue[0] : state.dir
  const queue = state.queue.length > 0 ? state.queue.slice(1) : state.queue
  const head = state.body[0]
  const v = VEC[dir]
  const next: Cell = { col: head.col + v.col, row: head.row + v.row }

  // 撞墙：身体停在原地，只是这一局结束了
  if (next.col < 0 || next.col >= COLS || next.row < 0 || next.row >= ROWS) {
    return { ...state, dir, queue, alive: false }
  }

  const ate = next.col === state.food.col && next.row === state.food.row
  // 咬到自己：尾巴格在「这一格不长身体」时会让开，所以那一格不算撞到；
  // 吃食物时尾巴不动，这一格仍然算撞到。
  const solid = ate ? state.body : state.body.slice(0, -1)
  for (const seg of solid) {
    if (seg.col === next.col && seg.row === next.row) {
      return { ...state, dir, queue, alive: false }
    }
  }

  const body = [next, ...state.body]
  if (!ate) {
    // 没吃到东西：尾巴让出来，身长不变
    return { ...state, body: body.slice(0, state.body.length), dir, queue, stepAcc: 0 }
  }

  // 吃到食物：身体留一节（尾巴不动），分数 +10，并放一颗新的食物
  const r = new Rng(state.rng)
  const food = spawnFood(r, body)
  const full = body.length >= COLS * ROWS
  return {
    ...state,
    body,
    dir,
    queue,
    food,
    eaten: state.eaten + 1,
    score: state.score + SCORE_PER_FOOD,
    stepAcc: 0,
    // 棋盘被填满就是满分通关，本局到此为止
    alive: !full,
    won: full,
    rng: r.s,
  }
}

/** 重开一局：回到初始盘面，随机流接着往前走（所以食物位置和开局不同，但照样可复盘） */
function restart(state: State): State {
  const r = new Rng(state.rng)
  const body = initialBody()
  return {
    body,
    dir: 'right',
    queue: [],
    food: spawnFood(r, body),
    stepAcc: 0,
    eaten: 0,
    score: 0,
    alive: true,
    won: false,
    seed: state.seed,
    seq: state.seq + 1,
    rng: r.s,
  }
}

/** 纯函数状态迁移：不读时间、不读全局随机数、不修改入参 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'turn':
      return turn(state, action.dir)
    case 'tick':
      return advance(state, action.ticks)
    case 'restart':
      return restart(state)
  }
}
