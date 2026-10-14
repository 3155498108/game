/**
 * 西洋跳棋（美式 draughts / checkers）规则 —— 纯逻辑，零 DOM 依赖，可在 node 环境单测。
 *
 * 口径（与任务书的裁决一致，全部列在文件头，便于测试直接断言）：
 * - 8×8 棋盘，只有深色格 (col+row)%2===1 可落子；每方 12 子，玩家（黑）在下方 3 排先行。
 * - 普通子只向前斜走一格；吃子必须跳过紧邻的敌子，落到其后紧邻的空格。
 * - 有子可吃时必须吃：整盘只要有任意一颗子能吃，本方就只能走连吃链，
 *   整条链算**一个**走法（Move.path = 经过的所有格）。
 * - 同一条连吃链里同一颗敌子只能被吃一次；落点不能回到本步的起点格。
 * - 升变只在**连吃结束、停在对方底线**时发生（经过底线不中途升变）。
 * - 王（king）前后都可斜走一格、四个方向都能跳；没有国际跳棋的「飞吃一圈」。
 * - 轮到某方却无合法走法判负。
 */

import { Rng } from '../../core/rng'

export const SIZE = 8
/** 8×8 = 64 个格，其中 32 个深色格可用 */
export const CELL_COUNT = SIZE * SIZE
export const PIECES_EACH = 12
/** 玩家执黑先行 */
export const AI: Player = 2

export type Player = 1 | 2
/** 0 = 空；1 = 黑子；2 = 黑王；3 = 红子；4 = 红王 */
export type Cell = 0 | 1 | 2 | 3 | 4

const MAN: readonly [Cell, Cell] = [1, 3]
const KING: readonly [Cell, Cell] = [2, 4]

/** 四个斜向，[dc, dr] */
const DIAG: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
]
/** [黑的前进方向, 红的前进方向]：黑向上（行号减小），红向下 */
const FWD: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [-1, -1],
    [1, -1],
  ],
  [
    [-1, 1],
    [1, 1],
  ],
]

export function idx(col: number, row: number): number {
  return row * SIZE + col
}

export function colOf(i: number): number {
  return i % SIZE
}

export function rowOf(i: number): number {
  return Math.floor(i / SIZE)
}

/** 深色格判定：行 0 为最上一排，左下角 (7,0) 为深色 */
export function isDark(col: number, row: number): boolean {
  return (col + row) % 2 === 1
}

export function isDarkSquare(i: number): boolean {
  return isDark(colOf(i), rowOf(i))
}

function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < SIZE && row >= 0 && row < SIZE
}

export function ownerOf(c: Cell): Player | 0 {
  if (c === 0) return 0
  return c <= 2 ? 1 : 2
}

export function isKing(c: Cell): boolean {
  return c === 2 || c === 4
}

export function opponent(p: Player): Player {
  return p === 1 ? 2 : 1
}

/** 抵达对方底线即升变：黑方升变在 row 0，红方在 row 7 */
export function isBackRank(p: Player, square: number): boolean {
  const r = rowOf(square)
  return p === 1 ? r === 0 : r === SIZE - 1
}

function dirsOf(c: Cell, p: Player): ReadonlyArray<readonly [number, number]> {
  return isKing(c) ? DIAG : FWD[p - 1]
}

/** 一整条走法（连吃链整体算一个动作） */
export interface Move {
  from: number
  /** path[0] === from；相邻元素恒为一跳（差 2 行 2 列）；末元素为落点 */
  path: number[]
  /** 被吃掉的敌子所在格，顺序与跳跃顺序一致 */
  captures: number[]
  /** 连吃结束停在对方底线时为 true */
  promoted: boolean
}

/** 最近一手，供渲染层逐格播放动画（结果已由 state 定好，动画不参与状态） */
export interface LastMove {
  player: Player
  from: number
  path: number[]
  captures: number[]
  /** 与 captures 一一对应的被吃棋子类型，用于画消散动画 */
  victims: Cell[]
  promoted: boolean
}

export interface State {
  board: Cell[]
  turn: Player
  /** 玩家选中的己方棋子格号，-1 表示未选中 */
  selected: number
  last: LastMove | null
  over: boolean
  /** 0 表示未结束 */
  winner: Player | 0
  moves: number
  takenBy1: number
  takenBy2: number
  rng: number
}

export type Action =
  /** 选中己方棋子（第一段：挑出发起点） */
  | { type: 'select'; square: number }
  /** 走完整条链（第二段）：path 含起点与落点 */
  | { type: 'move'; from: number; path: number[] }
  /** 取消选中 */
  | { type: 'clear' }
  /** 提示：在所有可动子中随机挑一个（走 Rng，种子来自 state.rng） */
  | { type: 'hint' }

export function create(seed: number): State {
  const board = new Array<Cell>(CELL_COUNT).fill(0)
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (!isDark(col, row)) continue
      if (row >= SIZE - 3) board[idx(col, row)] = MAN[0]
      else if (row < 3) board[idx(col, row)] = MAN[1]
    }
  }
  return {
    board,
    turn: 1,
    selected: -1,
    last: null,
    over: false,
    winner: 0,
    moves: 0,
    takenBy1: 0,
    takenBy2: 0,
    rng: seed | 0,
  }
}

// ---------------- 走法生成 ----------------

/** 单个棋子的连吃路径上限：极端残局的失控保护，正常局面远达不到 */
const MAX_CHAINS = 200

function makeMove(from: number, path: number[], captures: number[], piece: Cell, player: Player): Move {
  const land = path[path.length - 1]
  // 升变只在连吃结束后判断：经过对方底线不升变，停在那里才升变
  const promoted = !isKing(piece) && isBackRank(player, land)
  return { from, path, captures, promoted }
}

/**
 * 枚举某棋子的全部连吃链。
 * 关键实现细节：
 * - 工作盘 b 是副本；b[from] 始终保留本子，因此落点永远不会是起点格
 *   （等价于「同一条链里不许落回原格」的口径）；
 * - taken[] 标记本条链已吃掉的敌子，保证同一颗子不会被吃两次；
 * - 每个方向都是「跳过紧邻敌子 → 落到其后紧邻空格」的一跳。
 */
function captureChains(board: readonly Cell[], from: number, player: Player): Move[] {
  const piece = board[from]
  const b = board.slice()
  const taken = new Array<boolean>(CELL_COUNT).fill(false)
  const dirs = dirsOf(piece, player)
  const out: Move[] = []

  const walk = (at: number, path: number[], caught: number[]): void => {
    if (out.length >= MAX_CHAINS) return
    let extended = false
    for (let k = 0; k < dirs.length; k++) {
      const mc = colOf(at) + dirs[k][0]
      const mr = rowOf(at) + dirs[k][1]
      const lc = mc + dirs[k][0]
      const lr = mr + dirs[k][1]
      if (!inBounds(mc, mr) || !inBounds(lc, lr)) continue
      if (!isDark(lc, lr)) continue
      const mid = idx(mc, mr)
      const land = idx(lc, lr)
      if (taken[mid]) continue
      const victim = b[mid]
      if (victim === 0 || ownerOf(victim) === player) continue
      if (b[land] !== 0) continue
      extended = true
      b[mid] = 0
      taken[mid] = true
      b[land] = piece
      path.push(land)
      caught.push(mid)
      walk(land, path, caught)
      caught.pop()
      path.pop()
      b[land] = 0
      b[mid] = victim
      taken[mid] = false
    }
    // 走到这里已经无子可吃：这条链合法（至少吃了一个）
    // 注意必须拷贝 path / caught —— 递归回溯时会 pop 掉同一个数组
    if (!extended && caught.length > 0) out.push(makeMove(from, path.slice(), caught.slice(), piece, player))
  }

  walk(from, [from], [])
  return out
}

/** 普通移动（不吃子）：斜走一格到空格 */
function simpleMoves(board: readonly Cell[], from: number, player: Player): Move[] {
  const piece = board[from]
  const dirs = dirsOf(piece, player)
  const out: Move[] = []
  for (let k = 0; k < dirs.length; k++) {
    const c = colOf(from) + dirs[k][0]
    const r = rowOf(from) + dirs[k][1]
    if (!inBounds(c, r) || !isDark(c, r)) continue
    const to = idx(c, r)
    if (board[to] !== 0) continue
    out.push(makeMove(from, [from, to], [], piece, player))
  }
  return out
}

/** 某个棋子的合法走法：有子可吃时只给连吃链，绝不给普通移动 */
export function legalMovesFrom(board: readonly Cell[], from: number, player: Player): Move[] {
  if (ownerOf(board[from]) !== player) return []
  const caps = captureChains(board, from, player)
  if (caps.length > 0) return caps
  return simpleMoves(board, from, player)
}

/** 走法排序权重：先试吃子步（吃得多更优先），再试升变步，最后按靠前与居中 */
function orderScore(board: readonly Cell[], player: Player, mv: Move): number {
  let s = mv.captures.length * 100
  if (mv.promoted) s += 60
  const land = mv.path[mv.path.length - 1]
  s += 30 - Math.abs(colOf(land) - 3.5) * 4
  if (!isKing(board[mv.from])) s += (player === 1 ? SIZE - 1 - rowOf(land) : rowOf(land)) * 3
  return s
}

/**
 * 全盘某个玩家的所有合法走法。
 * 「有子可吃时必须吃」是**全盘强制**的：只要盘上还有任意一颗子能吃，
 * 本方就只能走连吃链，其他子一律不许平移。
 * 排序：先试吃子步（吃得多的优先），再试升变步，最后按靠前与居中。
 */
export function orderedMoves(board: readonly Cell[], player: Player): Move[] {
  const caps: Move[] = []
  const quiet: Move[] = []
  for (let i = 0; i < CELL_COUNT; i++) {
    if (ownerOf(board[i]) !== player) continue
    const c = captureChains(board, i, player)
    if (c.length > 0) {
      for (let k = 0; k < c.length; k++) caps.push(c[k])
    } else {
      const q = simpleMoves(board, i, player)
      for (let k = 0; k < q.length; k++) quiet.push(q[k])
    }
  }
  const out = caps.length > 0 ? caps : quiet
  out.sort((a, b) => orderScore(board, player, b) - orderScore(board, player, a))
  return out
}

/** 当前回合玩家的全部合法走法 */
export function legalMoves(state: State): Move[] {
  return orderedMoves(state.board, state.turn)
}

export function moveToAction(mv: Move): Action {
  return { type: 'move', from: mv.from, path: mv.path.slice() }
}

/** 当前回合玩家的合法动作（UI 与 AI 共用同一份列表） */
export function legalActions(state: State): Action[] {
  if (state.over) return []
  return legalMoves(state).map(moveToAction)
}

function samePath(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** from → to 落点的最优走法（先比吃子数，再比是否升变），把一次点击落到具体 action */
export function bestMoveFrom(state: State, from: number, to: number): Move | null {
  let best: Move | null = null
  for (const mv of legalMoves(state)) {
    if (mv.from !== from) continue
    if (mv.path[mv.path.length - 1] !== to) continue
    if (best === null || mv.captures.length > best.captures.length || (mv.captures.length === best.captures.length && mv.promoted && !best.promoted)) {
      best = mv
    }
  }
  return best
}

/** 该玩家是否还有任何合法走法（无子可走判负的判据） */
export function hasLegalMove(board: readonly Cell[], player: Player): boolean {
  for (let i = 0; i < CELL_COUNT; i++) {
    if (ownerOf(board[i]) !== player) continue
    if (legalMovesFrom(board, i, player).length > 0) return true
  }
  return false
}

// ---------------- 结算 ----------------

/**
 * 按一条完整走法结算（连吃一次性算完，不拆成多个 action）。
 * path 相邻两格的中点就是这一步跳过的敌子。返回值全部是新对象，不改入参。
 */
export function applyChain(
  board: readonly Cell[],
  mv: Move,
  player: Player,
): { board: Cell[]; captures: number[]; victims: Cell[]; promoted: boolean } {
  const b = board.slice()
  const piece = b[mv.from]
  b[mv.from] = 0
  const captures: number[] = []
  const victims: Cell[] = []
  for (let k = 1; k < mv.path.length; k++) {
    const a = mv.path[k - 1]
    const c = mv.path[k]
    // 只有「跳 2 格」的那一步才有被吃掉的中间子；平移的那一步不存在中点
    if (Math.abs(colOf(c) - colOf(a)) === 2) {
      const mid = idx((colOf(a) + colOf(c)) >> 1, (rowOf(a) + rowOf(c)) >> 1)
      if (b[mid] !== 0) {
        captures.push(mid)
        victims.push(b[mid])
        b[mid] = 0
      }
    }
    // 上一段落点必须腾空，否则连吃会在每一跳都多留一个子
    b[a] = 0
    b[c] = piece
  }
  const land = mv.path[mv.path.length - 1]
  let promoted = false
  if (piece !== 0 && !isKing(piece) && isBackRank(player, land)) {
    b[land] = KING[player - 1]
    promoted = true
  }
  return { board: b, captures, victims, promoted }
}

/** 纯函数状态迁移 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'hint':
      return applyHint(state)

    case 'clear':
      return state.selected === -1 ? state : { ...state, selected: -1 }

    case 'select': {
      if (state.over) return state
      const sq = action.square
      if (!Number.isInteger(sq) || sq < 0 || sq >= CELL_COUNT) return state
      if (ownerOf(state.board[sq]) !== state.turn) return state
      const movable = legalMoves(state).some((m) => m.from === sq)
      if (!movable) return state
      return { ...state, selected: state.selected === sq ? -1 : sq }
    }

    case 'move': {
      if (state.over) return state
      const from = action.from
      const path = action.path
      if (!Number.isInteger(from) || from < 0 || from >= CELL_COUNT) return state
      if (!Array.isArray(path) || path.length < 2 || path[0] !== from) return state
      // 只认 legalActions 里存在的走法：非法走法一律忽略
      let hit: Move | null = null
      for (const mv of legalMoves(state)) {
        if (mv.from === from && samePath(mv.path, path)) {
          hit = mv
          break
        }
      }
      if (!hit) return state
      const player = state.turn
      const r = applyChain(state.board, hit, player)
      const next = opponent(player)
      const over = !hasLegalMove(r.board, next)
      const last: LastMove = {
        player,
        from: hit.from,
        path: hit.path.slice(),
        captures: r.captures.slice(),
        victims: r.victims.slice(),
        promoted: r.promoted,
      }
      return {
        ...state,
        board: r.board,
        turn: next,
        selected: -1,
        last,
        over,
        winner: over ? player : 0,
        moves: state.moves + 1,
        takenBy1: state.takenBy1 + (player === 1 ? r.captures.length : 0),
        takenBy2: state.takenBy2 + (player === 2 ? r.captures.length : 0),
      }
    }

    default:
      return state
  }
}

function applyHint(state: State): State {
  if (state.over || state.turn !== 1) return state
  const seen: number[] = []
  for (const mv of legalMoves(state)) {
    if (seen.indexOf(mv.from) < 0) seen.push(mv.from)
  }
  if (seen.length === 0) return state
  const r = new Rng(state.rng)
  return { ...state, selected: seen[r.int(seen.length)], rng: r.s }
}

// ---------------- 局面评估 ----------------

const MAN_VALUE = 100
const KING_VALUE = 190
const ADVANCE_STEP = 4
const BACK_GUARD = 14
const CENTER_BONUS = 8
const EDGE_PENALTY = 4

/** 单子位置权重（与所属方无关的对称项 + 各自视角的推进度） */
function squareValue(i: number, king: boolean, owner: Player): number {
  const row = rowOf(i)
  const col = colOf(i)
  if (king) return KING_VALUE + (col === 3 || col === 4 ? 6 : 0)
  // advanced：0 = 还在本方底线，7 = 即将升变
  const advanced = owner === 1 ? SIZE - 1 - row : row
  let v = MAN_VALUE + advanced * ADVANCE_STEP
  if (advanced === 0) v += BACK_GUARD
  if (col === 3 || col === 4) v += CENTER_BONUS
  if (col === 0 || col === SIZE - 1) v -= EDGE_PENALTY
  return v
}

/** 从 me 的视角评估，越大越好 */
export function evaluate(board: readonly Cell[], me: Player): number {
  let score = 0
  for (let i = 0; i < CELL_COUNT; i++) {
    const v = board[i]
    if (v === 0) continue
    const o = ownerOf(v)
    if (o === 0) continue
    const s = squareValue(i, isKing(v), o)
    score += o === me ? s : -s
  }
  return score
}

// ---------------- AI：alpha-beta + 置换表 + 走法排序 + 节点上限 ----------------

/** 迭代加深的层数表（规格建议 4 层，节点超限时退回上一层） */
export const SEARCH_DEPTHS: readonly number[] = [2, 3, 4]
/** 每层迭代的节点上限，超出即中断并保留当前最佳着法 */
export const NODE_BUDGET: readonly number[] = [8_000, 26_000, 60_000]
const MATE = 100_000
/** 节点上限触发的哨兵 */
const ABORT = Symbol('node-limit')

export interface SearchInfo {
  action: Action
  /** 实际完成搜索的层数 */
  depth: number
  score: number
  nodes: number
  /** true 表示这一层被节点上限截断（结果已退回上一层的最佳着法） */
  aborted: boolean
}

interface Ctx {
  tt: Map<string, { score: number; depth: number }>
  nodes: number
  limit: number
  ply: number
}

function boardKey(board: readonly Cell[], turn: Player): string {
  let s = ''
  for (let i = 0; i < CELL_COUNT; i++) s += String.fromCharCode(48 + board[i])
  return s + (turn === 1 ? 'a' : 'b')
}

function negamax(board: Cell[], player: Player, depth: number, alpha: number, beta: number, ctx: Ctx): number {
  ctx.ply++
  ctx.nodes++
  if (ctx.nodes > ctx.limit) throw ABORT
  if (depth <= 0) return evaluate(board, player)

  const key = boardKey(board, player)
  const hit = ctx.tt.get(key)
  // 只用「同深度或更深且完整搜过」的置换表项，避免误用剪枝边界值
  if (hit !== undefined && hit.depth >= depth) {
    ctx.ply--
    return hit.score
  }

  const moves = orderedMoves(board, player)
  if (moves.length === 0) {
    ctx.ply--
    return -MATE + ctx.ply
  }

  const you = opponent(player)
  let best = -Infinity
  let cut = false
  for (let k = 0; k < moves.length; k++) {
    const r = applyChain(board, moves[k], player)
    const sc = -negamax(r.board, you, depth - 1, -beta, -alpha, ctx)
    if (sc > best) best = sc
    if (sc > alpha) alpha = sc
    if (alpha >= beta) {
      cut = true
      break
    }
  }
  if (!cut) ctx.tt.set(key, { score: best, depth })
  ctx.ply--
  return best
}

/**
 * AI 决策：迭代加深（2 → 3 → 4 层），每层都有节点上限，
 * 触顶就丢弃该层的部分结果、退回上一层的最佳着法，保证一定能在毫秒级返回。
 * 走法完全来自 legalMoves（与规则同一份生成逻辑），不维护第二套规则。
 * budget 仅供测试注入小预算来验证兜底逻辑，正常调用用默认 NODE_BUDGET。
 */
export function aiSearch(state: State, maxDepth = 4, budget: readonly number[] = NODE_BUDGET): SearchInfo | null {
  if (state.over || state.turn !== AI) return null
  const root = legalMoves(state)
  if (root.length === 0) return null

  const ctx: Ctx = { tt: new Map(), nodes: 0, limit: NODE_BUDGET[0], ply: 0 }
  let best: SearchInfo | null = null
  let abortedAny = false

  for (let i = 0; i < SEARCH_DEPTHS.length; i++) {
    const depth = SEARCH_DEPTHS[i]
    if (depth > maxDepth) break
    ctx.nodes = 0
    ctx.ply = 0
    ctx.limit = budget[i] === undefined ? NODE_BUDGET[i] : budget[i]
    // 每层重建置换表：MATE 分值含 ply 信息，跨层复用会串味
    ctx.tt.clear()
    let alpha = -Infinity
    let local: SearchInfo | null = null
    try {
      for (let k = 0; k < root.length; k++) {
        const r = applyChain(state.board, root[k], AI)
        ctx.ply = 1
        const sc = -negamax(r.board, 1, depth - 1, -Infinity, -alpha, ctx)
        if (local === null || sc > local.score) {
          local = { action: moveToAction(root[k]), depth, score: sc, nodes: 0, aborted: false }
        }
        if (sc > alpha) alpha = sc
      }
    } catch (e) {
      if (e !== ABORT) throw e
      // 触顶：该层的部分结果作废，保留上一层已经完整搜完的最佳着法
      abortedAny = true
    }
    if (local !== null) {
      local.nodes = ctx.nodes
      best = local
    }
    if (abortedAny) break
  }

  if (best === null) {
    best = { action: moveToAction(root[0]), depth: 0, score: 0, nodes: 0, aborted: abortedAny }
  } else {
    best.aborted = abortedAny
  }
  return best
}

/** 与 GameModule 契约一致：轮到 AI 时返回一个合法 action，否则 null */
export function aiAction(state: State): Action | null {
  const info = aiSearch(state)
  return info === null ? null : info.action
}
