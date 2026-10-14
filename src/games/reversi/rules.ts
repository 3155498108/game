/**
 * 黑白棋（Reversi / Othello）规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）
 *
 * 设计要点：
 * - 棋盘为一维数组，索引 = row * SIZE + col，row 0 在最上方；
 * - `reduce` 是纯函数且不修改入参：所有翻转都写进新数组 `board.slice()`；
 * - 当前方无合法落子时由 `reduce` 自动跳过（passes 递增），连续两次跳过即终局；
 * - AI 与规则共享同一套扫描逻辑（flipsInto）：不维护第二套规则。
 */
import { Rng } from '../../core/rng'

export const SIZE = 8

export type Player = 1 | 2
/** 0 = 空，1 = 黑（玩家），2 = 白（电脑） */
export type Cell = 0 | Player

/** 电脑执白（玩家 2） */
export const AI: Player = 2

export interface State {
  /** 一维棋盘，索引 = row * SIZE + col，row 0 在最上方 */
  board: Cell[]
  turn: Player
  over: boolean
  /** 0 = 平局或未结束 */
  winner: Player | 0
  black: number
  white: number
  /** 最近一次落子的格索引，-1 表示还没落过 */
  lastMove: number
  /** 最近一次落子被翻转的格索引（按扫描顺序，供渲染做错峰动画） */
  flipped: number[]
  /** 实际落子次数（不含跳过） */
  moves: number
  /** 连续无法落子的次数，达到 2 即终局 */
  passes: number
  /** 指针悬停的格索引，-1 表示无 */
  hover: number
  rng: number
}

export type Action =
  | { type: 'place'; index: number }
  | { type: 'hover'; index: number }
  | { type: 'leave' }

export const idx = (col: number, row: number): number => row * SIZE + col
export const colOf = (i: number): number => i % SIZE
export const rowOf = (i: number): number => Math.floor(i / SIZE)

export function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < SIZE && row >= 0 && row < SIZE
}

export function opponent(p: Player): Player {
  return p === 1 ? 2 : 1
}

export function isCorner(col: number, row: number): boolean {
  return (col === 0 || col === SIZE - 1) && (row === 0 || row === SIZE - 1)
}

/** 八个方向：横 / 竖 / 主对角 / 副对角 */
export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
]

/** 开局：中央 2×2 沿主对角线为黑、沿副对角线为白 */
const START: ReadonlyArray<readonly [number, number, Cell]> = [
  [3, 3, 1],
  [3, 4, 2],
  [4, 3, 2],
  [4, 4, 1],
]

export function create(seed: number): State {
  const board = new Array<Cell>(SIZE * SIZE).fill(0)
  for (const [c, r, v] of START) board[idx(c, r)] = v
  return {
    board,
    turn: 1,
    over: false,
    winner: 0,
    black: 2,
    white: 2,
    lastMove: -1,
    flipped: [],
    moves: 0,
    passes: 0,
    hover: -1,
    rng: seed | 0,
  }
}

/**
 * 把 player 在 index 落子后会被翻转的格子追加到 out，返回追加的数量。
 * 只夹「连续」的敌子，中间有空格或末端不是己方棋子都不算翻转。
 * 空数组 out 可以复用，搜索热路径里零分配。
 */
export function flipsInto(board: ArrayLike<number>, index: number, player: Player, out: number[]): number {
  if (!Number.isInteger(index) || index < 0 || index >= SIZE * SIZE) return 0
  if (board[index] !== 0) return 0
  const opp = opponent(player)
  const c0 = colOf(index)
  const r0 = rowOf(index)
  const base = out.length
  for (const [dc, dr] of DIRS) {
    let c = c0 + dc
    let r = r0 + dr
    const mark = out.length
    while (inBounds(c, r) && board[idx(c, r)] === opp) {
      out.push(idx(c, r))
      c += dc
      r += dr
    }
    // 必须是「敌子连续段 + 末端己方棋子」才成立，否则撤销本方向的追加
    if (out.length === mark || !inBounds(c, r) || board[idx(c, r)] !== player) out.length = mark
  }
  return out.length - base
}

/** flipsInto 的数组版便捷入口 */
export function flipsFor(board: ArrayLike<number>, index: number, player: Player): number[] {
  const out: number[] = []
  flipsInto(board, index, player, out)
  return out
}

/** player 当前所有合法落点 */
export function legalActions(board: ArrayLike<number>, player: Player): number[] {
  const out: number[] = []
  const scratch: number[] = []
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (board[i] !== 0) continue
    scratch.length = 0
    if (flipsInto(board, i, player, scratch) > 0) out.push(i)
  }
  return out
}

/** 统计黑白棋子数 */
export function countDiscs(board: ArrayLike<number>): [number, number] {
  let black = 0
  let white = 0
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (board[i] === 1) black++
    else if (board[i] === 2) white++
  }
  return [black, white]
}

/** 纯函数状态迁移 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'leave':
      return state.hover === -1 ? state : { ...state, hover: -1 }

    case 'hover': {
      if (state.over || state.hover === action.index) return state
      return { ...state, hover: action.index }
    }

    case 'place': {
      if (state.over) return state
      const at = action.index
      if (!Number.isInteger(at) || at < 0 || at >= SIZE * SIZE) return state
      // 非空格 / 夹不住任何敌子 → 非法，原样返回（调用方据此忽略）
      const flips = flipsFor(state.board, at, state.turn)
      if (flips.length === 0) return state

      // 关键：写进新数组，绝不就地改 state.board
      const board = state.board.slice()
      board[at] = state.turn
      for (const f of flips) board[f] = state.turn

      // 自动跳过：换手方没地方下就切回去；连着两方都没地方下则终局
      let turn: Player = opponent(state.turn)
      let passes = 0
      let over = false
      if (legalActions(board, turn).length === 0) {
        passes = 1
        turn = state.turn
        if (legalActions(board, turn).length === 0) {
          passes = 2
          over = true
        }
      }

      const [black, white] = countDiscs(board)
      const winner: Player | 0 = !over ? 0 : black === white ? 0 : black > white ? 1 : 2
      return {
        ...state,
        board,
        turn,
        passes,
        over,
        winner,
        black,
        white,
        lastMove: at,
        flipped: flips,
        moves: state.moves + 1,
      }
    }
  }
}

/** 落子的直观别名，便于测试与 AI 复用同一入口 */
export function place(state: State, index: number): State {
  return reduce(state, { type: 'place', index })
}

// ------------------------------------------------------------------
// AI：negamax + alpha-beta（PVS）+ 走法排序（角与边优先）+ 置换表 + 硬节点上限兜底
//
// 纯逻辑约束：这里不读 Date / performance，搜索预算用「节点数」兜底，
// 因此同一步棋在任何机器上都给出完全相同的结果（可复盘）。
// ------------------------------------------------------------------

const INF = 1e9
/**
 * 单步搜索的节点上限（硬兜底：纯逻辑不能读时间，用节点数封顶）。
 * 黑白棋开局分支因子小、alpha-beta 剪枝强，配合 PVS + 置换表，
 * 1500 节点已经能稳定看到 4~5 层；再往上加节点收益递减而单步耗时线性上涨。
 */
const NODE_LIMIT = 1500
/** 中局最大搜索深度 */
const MAX_DEPTH = 6
/** ply 上限：跳过会消耗 ply 但不消耗 depth，留足余量防递归过深 */
const MAX_PLY = MAX_DEPTH + 14
/** 剩余空格 ≤ 该值时直接精确求解（终局分支极少，这一手几乎不花钱） */
const EXACT_EMPTIES = 6

/** 每层搜索复用的临时缓冲，避免在递归热路径里分配数组 */
interface Level {
  ms: number[]
  off: number[]
  cnt: number[]
  ord: number[]
  /** 走法排序用的打分行，避免每次排序都新建闭包 */
  sc: number[]
  flat: number[]
  cands: number[]
}

function newLevel(): Level {
  return { ms: [], off: [], cnt: [], ord: [], sc: [], flat: [], cands: [] }
}

/**
 * 经典黑白棋位置权重表：角 120 最高，X 方（紧贴角的斜位）负权重。
 * 行 = row 0（最上方），列 = col 0（最左）。
 */
const WEIGHT: readonly number[] = [
  120, -25, -5, -5, -5, -5, -25, 120,
  -25, -50, -1, -1, -1, -1, -50, -25,
  -5, -1, 15, 3, 3, 15, -1, -5,
  -5, -1, 3, 3, 3, 3, -1, -5,
  -5, -1, 3, 3, 3, 3, -1, -5,
  -5, -1, 15, 3, 3, 15, -1, -5,
  -25, -50, -1, -1, -1, -1, -50, -25,
  120, -25, -5, -5, -5, -5, -25, 120,
]

const CORNER_IDX: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [SIZE - 1, 0],
  [0, SIZE - 1],
  [SIZE - 1, SIZE - 1],
]

/**
 * 「跟角走」的 5 个格子（相对角的偏移）：X 方 (1,1)、两个 A 方 (0,1)/(1,0)、两个 C 方 (1,2)/(2,1)。
 * B 方与更远的格子不跟角走，故不在此列。
 */
const CORNER_DEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [0, 1],
  [1, 0],
  [1, 2],
  [2, 1],
]

/**
 * 陷坑补偿：角还空着（或被对方拿走）时这些格子是送死位；角一旦归自己，它们立刻变成安全区，
 * 所以评估时要按「这个角归谁」动态修正 —— 这是 AI 敢抢角的根本原因。
 * 值 = 评估时按归属角动态加回的权重。
 */
const TRAP: readonly number[] = (() => {
  const t = new Array<number>(SIZE * SIZE).fill(0)
  for (const [cc, cr] of CORNER_IDX) {
    const sx = cc === 0 ? 1 : -1
    const sy = cr === 0 ? 1 : -1
    for (const [d, e] of CORNER_DEPS) {
      const c = cc + sx * d
      const r = cr + sy * e
      if (!inBounds(c, r)) continue
      t[idx(c, r)] = d === 1 && e === 1 ? 36 : 6 // X 方补偿更多，A / C 方次之
    }
  }
  return t
})()

/** 跟角格所属的角索引，-1 表示该格不依附任何角 */
const CORNER_OF: readonly number[] = (() => {
  const o = new Array<number>(SIZE * SIZE).fill(-1)
  for (const [cc, cr] of CORNER_IDX) {
    const sx = cc === 0 ? 1 : -1
    const sy = cr === 0 ? 1 : -1
    for (const [d, e] of CORNER_DEPS) {
      const c = cc + sx * d
      const r = cr + sy * e
      if (!inBounds(c, r)) continue
      o[idx(c, r)] = idx(cc, cr)
    }
  }
  return o
})()

/** 每个格子的八邻格索引，搜索热路径用它省掉逐次坐标换算 */
const NB: readonly (readonly number[])[] = Array.from({ length: SIZE * SIZE }, (_, i) => {
  const r = rowOf(i)
  const c = colOf(i)
  const out: number[] = []
  for (const [dc, dr] of DIRS) {
    const cc = c + dc
    const rr = r + dr
    if (inBounds(cc, rr)) out.push(idx(cc, rr))
  }
  return out
})

/** 该格是否四角之一 */
const CORNER: readonly boolean[] = Array.from({ length: SIZE * SIZE }, (_, i) => isCorner(colOf(i), rowOf(i)))

/** 走法排序分层：角 > 边 > 普通 > X/C 方（黑先手时 X 方最危险） */
const TIER: readonly number[] = (() => {
  const t = new Array<number>(SIZE * SIZE).fill(1)
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (CORNER[i]) t[i] = 3
    else {
      const c = colOf(i)
      const r = rowOf(i)
      t[i] = c === 0 || c === SIZE - 1 || r === 0 || r === SIZE - 1 ? 2 : TRAP[i] > 0 ? 0 : 1
    }
  }
  return t
})()

// ---- 置换表：用局面散列做 key（比 64 字符串 key 快一个数量级） ----
const TT_BITS = 14
const TT_SIZE = 1 << TT_BITS
const TT_MASK = TT_SIZE - 1
const FLAG_EXACT = 1
const FLAG_LOWER = 2
const FLAG_UPPER = 3

/**
 * Zobrist 随机表（固定种子，模块加载时生成一次）：
 * 落子/撤销时只对「变化的格子」异或，整棵搜索共用一个 32 位散列，
 * 比每个节点重扫 64 格快得多。随机数一律走 core/rng 的 Rng。
 */
const ZOBRIST: Int32Array = (() => {
  const z = new Int32Array(SIZE * SIZE * 3)
  const r = new Rng(0x5eed)
  for (let i = 0; i < z.length; i++) z[i] = (r.next() * 2147483648) | 0
  return z
})()

// ---- 搜索用的模块级私有暂存（每次 aiAction 开头重置，不对外可见，不影响纯性） ----
let levels: Level[] = []
const marks = new Uint8Array(SIZE * SIZE)
const ttKey = new Int32Array(TT_SIZE)
const ttGen = new Int32Array(TT_SIZE)
const ttDepth = new Int8Array(TT_SIZE)
const ttFlag = new Int8Array(TT_SIZE)
const ttValue = new Int32Array(TT_SIZE)
let ttGenNow = 0
/** 当前局面的增量散列（make/unmake 维护） */
let boardHash = 0
let nodes = 0
let aborted = false

/** 行棋方掺进散列，保证同一个盘面黑白先手不会互相串味 */
function probeHash(player: Player): number {
  return (Math.imul(boardHash ^ (player * 0x27d4eb2f), 0x85ebca6b) | 0) & TT_MASK
}

function hashFull(b: Uint8Array): number {
  let h = 0
  for (let i = 0; i < SIZE * SIZE; i++) if (b[i] !== 0) h ^= ZOBRIST[i * 3 + b[i]]
  return h | 0
}

/**
 * 候选生成：空格子只要与某颗敌子相邻就可能合法（再由 flipsInto 精确过滤）。
 * 复杂度约 8 × 敌子数，比逐格八方向全扫描快一个数量级。
 */
function collectCandidates(b: Uint8Array, player: Player, out: number[]): void {
  out.length = 0
  marks.fill(0)
  const opp = opponent(player)
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (b[i] !== opp) continue
    const nb = NB[i]
    for (let k = 0; k < nb.length; k++) {
      const j = nb[k]
      if (b[j] === 0 && marks[j] === 0) {
        marks[j] = 1
        out.push(j)
      }
    }
  }
}

/** 粗略数一下 player 有多少候选点（只判「能不能下」，不判是否真夹得住） */
function countMoves(b: Uint8Array, player: Player): number {
  marks.fill(0)
  let n = 0
  const opp = opponent(player)
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (b[i] !== opp) continue
    const nb = NB[i]
    for (let k = 0; k < nb.length; k++) {
      const j = nb[k]
      if (b[j] === 0 && marks[j] === 0) {
        marks[j] = 1
        n++
      }
    }
  }
  return n
}

/** 在 L 里准备本层全部合法走法及其翻转列表，返回合法走法个数 */
function buildLevel(b: Uint8Array, player: Player, L: Level): number {
  const cands = L.cands
  collectCandidates(b, player, cands)
  L.flat.length = 0
  let n = 0
  for (let k = 0; k < cands.length; k++) {
    const m = cands[k]
    const off = L.flat.length
    if (flipsInto(b, m, player, L.flat) > 0) {
      L.ms[n] = m
      L.off[n] = off
      L.cnt[n] = L.flat.length - off
      n++
    }
  }
  return n
}

/**
 * 走法排序：先试角与边（黑白棋的定式），同层再按翻转数、位置分排。
 * 走法数 ≤ 20，插入排序最快；打分写进 L.sc，避免每次比较都闭包调用。
 */
function orderMoves(L: Level, n: number): number[] {
  const ord = L.ord
  const sc = L.sc
  for (let i = 0; i < n; i++) {
    ord[i] = i
    sc[i] = TIER[L.ms[i]] * 10000 + L.cnt[i] * 40 + WEIGHT[L.ms[i]]
  }
  for (let i = 1; i < n; i++) {
    const v = ord[i]
    const s = sc[v]
    let j = i - 1
    while (j >= 0 && sc[ord[j]] < s) {
      ord[j + 1] = ord[j]
      j--
    }
    ord[j + 1] = v
  }
  return ord
}

function make(b: Uint8Array, m: number, L: Level, i: number, player: Player): void {
  b[m] = player
  boardHash ^= ZOBRIST[m * 3] ^ ZOBRIST[m * 3 + player]
  const opp = opponent(player)
  const off = L.off[i]
  const n = L.cnt[i]
  for (let k = 0; k < n; k++) {
    const f = L.flat[off + k]
    b[f] = player
    boardHash ^= ZOBRIST[f * 3 + opp] ^ ZOBRIST[f * 3 + player]
  }
}

function unmake(b: Uint8Array, m: number, L: Level, i: number, player: Player): void {
  b[m] = 0
  boardHash ^= ZOBRIST[m * 3] ^ ZOBRIST[m * 3 + player]
  const opp = opponent(player)
  const off = L.off[i]
  const n = L.cnt[i]
  for (let k = 0; k < n; k++) {
    const f = L.flat[off + k]
    b[f] = opp
    boardHash ^= ZOBRIST[f * 3 + opp] ^ ZOBRIST[f * 3 + player]
  }
}

/** 单格位置分：角归自己时把 X / C 方的陷坑负权重补回来 */
function cellWeight(b: Uint8Array, i: number, me: Player): number {
  const co = CORNER_OF[i]
  return WEIGHT[i] + (co >= 0 && b[co] === me ? TRAP[i] : 0)
}

/**
 * 从 me 视角的局面分：位置表 + 行动力 + 前沿子 + 棋子数（越接近终局越看重子数）。
 *
 * 叶子节点是搜索里出现最频繁的函数，这里把「前沿子扫描」和「对方行动力统计」
 * 融进同一趟 64 格循环（敌子旁边的空格即对方的候选点），比拆成两个函数省一半扫描。
 */
function evaluate(b: Uint8Array, me: Player, myMob: number): number {
  let score = 0
  let mine = 0
  let theirs = 0
  let empties = 0
  marks.fill(0)
  const opp = opponent(me)
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = b[i]
    if (v === 0) {
      empties++
      continue
    }
    const sign = v === me ? 1 : -1
    if (sign > 0) mine++
    else theirs++
    score += sign * cellWeight(b, i, me)
    const nb = NB[i]
    let frontier = false
    for (let k = 0; k < nb.length; k++) {
      if (b[nb[k]] !== 0) continue
      frontier = true
      // 敌子旁边的空格 = 对方的候选点（只有空格才作数）
      if (v === opp) marks[nb[k]] = 1
    }
    // 前沿子：贴着空格的子会送给对方行动力，浅搜时应尽量少留
    if (frontier) score -= sign * 3
  }
  let oppMob = 0
  for (let i = 0; i < SIZE * SIZE; i++) if (marks[i]) oppMob++
  score += 8 * (myMob - oppMob)
  // 棋子数权重：空格越少越接近终局，子数越重要
  score += (1 + Math.floor((empties - EXACT_EMPTIES) / 3)) * (mine - theirs)
  return score
}

function terminalScore(b: Uint8Array, me: Player): number {
  const [black, white] = countDiscs(b)
  const mine = me === 1 ? black : white
  const theirs = me === 1 ? white : black
  return (mine - theirs) * 10000
}

function negamax(b: Uint8Array, player: Player, depth: number, alpha: number, beta: number, ply: number): number {
  if (nodes >= NODE_LIMIT) {
    aborted = true
    return 0
  }
  nodes++
  const L = levels[ply]
  const n = buildLevel(b, player, L)
  const opp = opponent(player)
  if (n === 0) {
    if (countMoves(b, opp) === 0) return terminalScore(b, player) // 双方都没地方下 = 终局
    if (ply + 1 >= MAX_PLY) return evaluate(b, player, countMoves(b, player))
    // 自己无处可下 → 跳过一手（等价于把回合让出去，深度不减）
    return -negamax(b, opp, depth, -beta, -alpha, ply + 1)
  }
  if (depth <= 0) return evaluate(b, player, n)

  // 置换表：同一局面在同一遍搜索里会被反复到达，能直接复用就省掉整棵子树
  const ti = probeHash(player)
  const alphaOrig = alpha
  if (ttGen[ti] === ttGenNow && ttKey[ti] === boardHash && ttDepth[ti] >= depth) {
    const f = ttFlag[ti]
    const v = ttValue[ti]
    if (f === FLAG_EXACT) return v
    if (f === FLAG_LOWER) alpha = Math.max(alpha, v)
    else if (f === FLAG_UPPER) alpha = Math.min(alpha, v)
    if (alpha >= beta) return v
  }

  const order = orderMoves(L, n)
  let best = -INF
  for (let k = 0; k < n; k++) {
    const i = order[k]
    const m = L.ms[i]
    make(b, m, L, i, player)
    const v = -negamax(b, opp, depth - 1, -beta, -alpha, ply + 1)
    unmake(b, m, L, i, player)
    if (v > best) best = v
    if (v > alpha) alpha = v
    if (aborted || alpha >= beta) break
  }

  // 被打断的那一遍结果不完整，绝不能写进置换表
  if (!aborted) {
    const flag = best <= alphaOrig ? FLAG_UPPER : best >= beta ? FLAG_LOWER : FLAG_EXACT
    ttGen[ti] = ttGenNow
    ttKey[ti] = boardHash
    ttDepth[ti] = depth > 127 ? 127 : depth
    ttFlag[ti] = flag
    ttValue[ti] = best
  }
  return best
}

function countEmpty(b: Uint8Array): number {
  let n = 0
  for (let i = 0; i < SIZE * SIZE; i++) if (b[i] === 0) n++
  return n
}

/**
 * AI：与规则共享同一套翻转扫描（flipsInto），绝不维护第二套规则逻辑。
 * 迭代加深 + alpha-beta（PVS）+ 置换表 + 走法排序，节点数封顶保证单步耗时稳定。
 */
export function aiAction(state: State): Action | null {
  if (state.over || state.turn !== AI) return null
  const me = state.turn

  const b = new Uint8Array(SIZE * SIZE)
  for (let i = 0; i < SIZE * SIZE; i++) b[i] = state.board[i]
  if (countMoves(b, me) === 0) return null

  boardHash = hashFull(b)
  // 每一层的缓冲只分配一次并复用：aiAction 会被整局模拟调用上百次
  if (levels.length < MAX_PLY) levels = Array.from({ length: MAX_PLY }, newLevel)
  ttGenNow = (ttGenNow + 1) | 0
  if (ttGenNow === 0) {
    ttGen.fill(0)
    ttGenNow = 1
  }
  nodes = 0
  aborted = false

  const root = levels[0]
  const rn = buildLevel(b, me, root)
  if (rn === 0) return null
  const order = orderMoves(root, rn)
  const opp = opponent(me)

  // 保底答案：排序里第一个（角/边优先），搜索被节点上限打断时也不会返回非法落点
  let best = root.ms[order[0]]
  const empties = countEmpty(b)
  const lastDepth = empties <= EXACT_EMPTIES ? empties : MAX_DEPTH

  for (let depth = 1; depth <= lastDepth; depth++) {
    aborted = false
    let alpha = -INF
    let localBest = -1
    let localScore = -INF
    for (let k = 0; k < rn; k++) {
      const i = order[k]
      const m = root.ms[i]
      make(b, m, root, i, me)
      // 主变例搜索：首手给全窗口，其余先零窗口试探、真的更优才扩窗复算
      let v = -negamax(b, opp, depth - 1, -INF, k === 0 ? -alpha : -alpha - 1, 1)
      if (k > 0 && v > alpha && !aborted) v = -negamax(b, opp, depth - 1, -INF, -alpha, 1)
      unmake(b, m, root, i, me)
      if (v > localScore) {
        localScore = v
        localBest = m
      }
      if (v > alpha) alpha = v
      if (aborted) break
    }
    if (!aborted && localBest >= 0) {
      best = localBest
      // 把本层最优根走法提到队首：下一层迭代加深时先试它，剪枝最省
      for (let k = 1; k < rn; k++) {
        if (root.ms[order[k]] !== best) continue
        for (let j = k; j > 0; j--) order[j] = order[j - 1]
        order[0] = k
        break
      }
    }
    // 这一遍已用掉大半预算就不再开新的一层，保证单步耗时封顶
    if (aborted || nodes > NODE_LIMIT * 0.6) break
  }
  return { type: 'place', index: best }
}