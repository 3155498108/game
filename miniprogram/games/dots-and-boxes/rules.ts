/**
 * 点格棋规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 棋盘用「边」建模，而不是格子：
 * - 5×5 点阵 → 20 条横边 H[r][c]（r 0..4、c 0..3，连接点 (r,c) 与 (r,c+1)）
 * -          → 20 条竖边 V[r][c]（r 0..3、c 0..4，连接点 (r,c) 与 (r+1,c)）
 * - 共 40 条边；点阵围出 4×4 = 16 个盒子，每个盒子由 4 条边围成
 * - 第 r 行第 c 列的盒子 = H[r][c] + H[r+1][c] + V[r][c] + V[r][c+1]
 *
 * 边索引函数（hIndex / vIndex / edgeIndex / edgeAt）是渲染与输入命中的唯一坐标系，
 * 二者必须共用同一套函数，否则点击会错位。
 *
 * 计分与「再走一步」：盒子归最后画出第 4 条边的人；本步得分 > 0 时 turn 不翻转，
 * 因此「收盒」与「收尾阶段的连吃」用同一行代码表达。
 */
import { Rng } from '../../core/rng'

/** 点阵边长：5×5 个点 */
export const DOTS = 5
/** 盒子阵列：4×4 个格子 */
export const BOXES = 4
/** 横边条数：5 行 × 4 列 */
export const H_COUNT = DOTS * (DOTS - 1)
/** 竖边条数：4 行 × 5 列 */
export const V_COUNT = (DOTS - 1) * DOTS
/** 全盘共 40 条边 */
export const EDGE_COUNT = H_COUNT + V_COUNT
/** 全盘共 16 个盒子 */
export const BOX_COUNT = BOXES * BOXES

export type Player = 1 | 2
/** 'h' = 横边，'v' = 竖边 */
export type Dir = 'h' | 'v'

// ---------------- 边索引（渲染与输入共用） ----------------

/** 横边索引 H[r][c]，越界或非整数返回 -1 */
export function hIndex(r: number, c: number): number {
  if (!Number.isInteger(r) || !Number.isInteger(c)) return -1
  if (r < 0 || r >= DOTS || c < 0 || c >= DOTS - 1) return -1
  return r * (DOTS - 1) + c
}

/** 竖边索引 V[r][c]，越界或非整数返回 -1 */
export function vIndex(r: number, c: number): number {
  if (!Number.isInteger(r) || !Number.isInteger(c)) return -1
  if (r < 0 || r >= DOTS - 1 || c < 0 || c >= DOTS) return -1
  return H_COUNT + r * DOTS + c
}

/** 统一入口：按方向取边索引，越界返回 -1 */
export function edgeIndex(r: number, c: number, dir: Dir): number {
  return dir === 'h' ? hIndex(r, c) : vIndex(r, c)
}

/** 反查：边索引 → 位置与方向（渲染按此连线），越界返回 null */
export function edgeAt(i: number): { r: number; c: number; dir: Dir } | null {
  if (!Number.isInteger(i) || i < 0 || i >= EDGE_COUNT) return null
  if (i < H_COUNT) return { r: Math.floor(i / (DOTS - 1)), c: i % (DOTS - 1), dir: 'h' }
  const k = i - H_COUNT
  return { r: Math.floor(k / DOTS), c: k % DOTS, dir: 'v' }
}

// ---------------- 盒子 ----------------

/** 盒子索引：第 r 行第 c 列（r 0..3、c 0..3） */
export const boxIndex = (r: number, c: number): number => r * BOXES + c

/** 一个盒子的 4 条边：[上, 下, 左, 右] */
export function boxEdges(r: number, c: number): number[] {
  return [hIndex(r, c), hIndex(r + 1, c), vIndex(r, c), vIndex(r, c + 1)]
}

/** 与某条边相邻的盒子（内部边 2 个、最外侧 1 个） */
export function boxesOfEdge(i: number): number[] {
  const at = edgeAt(i)
  if (!at) return []
  const { r, c, dir } = at
  const out: number[] = []
  if (dir === 'h') {
    if (r - 1 >= 0) out.push(boxIndex(r - 1, c))
    if (r <= BOXES - 1) out.push(boxIndex(r, c))
  } else {
    if (c - 1 >= 0) out.push(boxIndex(r, c - 1))
    if (c <= BOXES - 1) out.push(boxIndex(r, c))
  }
  return out
}

/** 该盒子已有几条边被占（0..4） */
export function boxEdgeCount(edges: readonly number[], b: number): number {
  const r = Math.floor(b / BOXES)
  const c = b % BOXES
  let n = 0
  for (const e of boxEdges(r, c)) if (edges[e] !== 0) n++
  return n
}

// ---------------- 状态 ----------------

export interface State {
  /** 40 条边：0 = 空，1 = 玩家，2 = 电脑 */
  edges: number[]
  /** 16 个盒子的归属：0 = 未完成，1 / 2 = 归谁 */
  owners: number[]
  /** 比分：[玩家, 电脑] */
  scores: [number, number]
  turn: Player
  over: boolean
  /** 0 = 平局或未结束 */
  winner: Player | 0
  /** 最后画的那条边，-1 表示还没走过 */
  lastEdge: number
  /** 最后一步围成的盒子（用于高亮动画） */
  lastBoxes: number[]
  moves: number
  /** 悬停的边索引，-1 表示无 */
  hover: number
  rng: number
}

export type Action =
  /** 画一条边 */
  | { type: 'draw'; edge: number }
  /** 移动悬停高亮 */
  | { type: 'hover'; edge: number }
  | { type: 'leave' }

export function create(seed: number): State {
  return {
    edges: new Array<number>(EDGE_COUNT).fill(0),
    owners: new Array<number>(BOX_COUNT).fill(0),
    scores: [0, 0],
    turn: 1,
    over: false,
    winner: 0,
    lastEdge: -1,
    lastBoxes: [],
    moves: 0,
    hover: -1,
    rng: seed | 0,
  }
}

/** 所有还没被占的边索引 */
export function freeEdges(edges: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < EDGE_COUNT; i++) if (edges[i] === 0) out.push(i)
  return out
}

/** 当前可执行的动作（= 全部未占边） */
export function legalActions(state: State): Action[] {
  if (state.over) return []
  return freeEdges(state.edges).map<Action>((edge) => ({ type: 'draw', edge }))
}

/** 「只剩 1 条边」的未完成盒子数：谁先动到谁就能连吃 */
export function chainBoxes(state: State): number {
  let n = 0
  for (let b = 0; b < BOX_COUNT; b++) {
    if (state.owners[b] !== 0) continue
    if (boxEdgeCount(state.edges, b) === 3) n++
  }
  return n
}

/** 按盒子数定胜负，相同判平局 */
export function winnerOf(scores: readonly [number, number]): Player | 0 {
  if (scores[0] > scores[1]) return 1
  if (scores[1] > scores[0]) return 2
  return 0
}

/** 纯函数状态迁移：不修改入参 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'leave':
      return state.hover === -1 ? state : { ...state, hover: -1 }

    case 'hover': {
      if (state.over) return state
      const e = action.edge
      const ok = Number.isInteger(e) && e >= 0 && e < EDGE_COUNT && state.edges[e] === 0
      const hover = ok ? e : -1
      if (state.hover === hover) return state
      return { ...state, hover }
    }

    case 'draw': {
      if (state.over) return state
      const e = action.edge
      // 越界 / 非整数 / 已被占：拒绝，状态原样返回
      if (!Number.isInteger(e) || e < 0 || e >= EDGE_COUNT) return state
      if (state.edges[e] !== 0) return state

      const edges = state.edges.slice()
      edges[e] = state.turn

      const owners = state.owners.slice()
      const scores: [number, number] = [state.scores[0], state.scores[1]]
      const got: number[] = []
      for (const b of boxesOfEdge(e)) {
        if (owners[b] !== 0) continue
        if (boxEdgeCount(edges, b) === 4) {
          owners[b] = state.turn
          scores[state.turn - 1] += 1
          got.push(b)
        }
      }

      // 40 条边全占即终局
      const moves = state.moves + 1
      const over = moves >= EDGE_COUNT
      // 本步得分 > 0（含围成新盒）就连走一步，否则换人
      const gained = scores[state.turn - 1] - state.scores[state.turn - 1]
      const keepTurn = gained > 0 || over

      return {
        ...state,
        edges,
        owners,
        scores,
        turn: keepTurn ? state.turn : state.turn === 1 ? 2 : 1,
        over,
        winner: over ? winnerOf(scores) : 0,
        lastEdge: e,
        lastBoxes: got,
        moves,
        hover: state.hover === e ? -1 : state.hover,
      }
    }
  }
}

/** 画一条边的直观别名，便于测试与 AI 复用同一入口 */
export function draw(state: State, edge: number): State {
  return reduce(state, { type: 'draw', edge })
}

// ---------------- AI ----------------

/** 收一个盒子的权重，必须压过其他所有因素 */
const W_TAKE = 1_000_000
/** 「只剩 1 条边」的盒子（长链）权重 */
const W_CHAIN = 20_000

/**
 * AI：与规则共享同一个 reduce —— 每个候选动作都真正试算一遍，不维护第二套规则逻辑。
 * 分支因子 40 太大，不做深度 minimax，用三层启发式：
 *   1) 自己能收盒 → 收（连走一步，还能顺手把剩下的 3 边盒子吃掉）
 *   2) 收不到却会留下「只剩 1 条边」的盒子 → 尽量少暴露，把最长的链留给自己
 *   3) 安全手 → 中心优先，同分用可播种随机打散
 */
export function aiAction(state: State): Action | null {
  if (state.over || state.turn !== 2) return null
  const cands = legalActions(state)
  if (cands.length === 0) return null

  const rng = new Rng(state.rng)
  let best = cands[0]
  let bestScore = -Infinity
  for (const a of cands) {
    const v = scoreMove(state, reduce(state, a), rng)
    if (v > bestScore) {
      bestScore = v
      best = a
    }
  }
  return best
}

function scoreMove(prev: State, next: State, rng: Rng): number {
  const me = prev.turn
  const gained = next.scores[me - 1] - prev.scores[me - 1]
  const chain = chainBoxes(next)
  if (gained > 0) return W_TAKE * gained + W_CHAIN * chain
  if (chain > 0) return -W_TAKE - W_CHAIN * chain
  return centerBonus(next.lastEdge) + rng.next() * 8
}

/** 安全手的中心偏好：离盘面中心越近越高（0..16） */
function centerBonus(i: number): number {
  const at = edgeAt(i)
  if (!at) return 0
  const mid = (DOTS - 1) / 2
  const mr = at.dir === 'h' ? at.r : at.r + 0.5
  const mc = at.dir === 'h' ? at.c + 0.5 : at.c
  return (DOTS - 1 - (Math.abs(mr - mid) + Math.abs(mc - mid))) * 4
}