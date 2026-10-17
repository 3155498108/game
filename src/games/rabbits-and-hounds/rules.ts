/**
 * 兔子和猎犬（狐犬棋 / Fox and Hounds）规则 —— 纯逻辑，零 DOM 依赖，可在 node 环境单测。
 *
 * 坐标口径（渲染与输入共用）：
 * - 棋盘 7 行 × 9 列：COLS = 9（列，0..8，从左到右）、ROWS = 7（行，0..6，从上到下）
 * - idx(c, r) = r * COLS + c；狐狸起始格 = 第 3 行（中心行）第 4 列（中心列）= idx(4,3)
 * - 狐狸的胜利格（出口）：第 0 列或第 8 列（左右两侧边界）上的任意一格。
 *   判胜还要额外满足：该格与**任何一只猎犬**（狗或兔子）都不正交相邻。
 *
 * 移动口径（只有滑行，没有吃子）：
 * - 每个棋子沿 8 条射线（东西南北 4 条 + 两条 45° 对角线各 2 条）滑行，
 *   落点固定为该方向上的**第一个空格**。
 * - 路径上的棋子**只阻挡落点、不阻挡滑行穿过**：这就是规格里「狗可跳棋子」的口径，
 *   狗（以及兔子、狐狸）都能越过棋子滑到更远的空格；但谁都不能落在有子的格上，
 *   本游戏没有任何吃子行为。
 *
 * 胜负口径（唯一入口 winnerOf）：
 * - 狐狸走到出口格且不挨着任何猎犬 → 狐狸胜
 * - 狐狸任何一个方向都滑不出合法格（被封死）→ 兔子胜
 * - 走到 MOVE_LIMIT 步仍无人获胜 → 判平局（兜底，绝不让对局卡死）
 */
import { Rng } from '../../core/rng'

// ---------------- 棋盘常量 ----------------

/** 行数：7（0 在上，6 在下） */
export const ROWS = 7
/** 列数：9（0 在左，8 在右） */
export const COLS = 9
/** 总格数 */
export const CELLS = ROWS * COLS

/** 步数上限：达到即判平局，避免双方互相封死时对局卡死 */
export const MOVE_LIMIT = 200

// ---------------- 棋子 ----------------

/** 空 */
export const EMPTY = 0 as const
/** 兔子（玩家执子，共 4 只） */
export const RABBIT = 1 as const
/** 狐狸（电脑执子，共 1 只） */
export const FOX = 2 as const
/** 狗（与兔子同一方，共 1 只） */
export const DOG = 3 as const

export type Piece = typeof EMPTY | typeof RABBIT | typeof FOX | typeof DOG

/** 开局：狐狸在中心行中心列 */
export const FOX_START = idx(4, 3)
/** 开局：狗在狐狸正下方第 3 行的中心列（主要追击者） */
export const DOG_START = idx(4, 6)
/** 开局：4 只兔子分列狐狸的四条斜向邻格，狐狸开局只能正交滑行 */
export const RABBIT_STARTS: readonly number[] = [idx(3, 2), idx(5, 2), idx(3, 4), idx(5, 4)]

// ---------------- 方向 ----------------

/**
 * 8 条滑行射线（横 4 + 两条 45° 对角线 4）。
 * 只取「一条对角线」会让上下不对称（例如能走西北却不能走西南），
 * 因此横、竖、主斜、副斜四族全部开放，且三者（狐狸 / 狗 / 兔子）完全一致。
 */
export const DIRS: readonly (readonly [number, number])[] = [
  [1, 0], // 东
  [-1, 0], // 西
  [0, 1], // 南
  [0, -1], // 北
  [1, 1], // 东南
  [-1, -1], // 西北
  [1, -1], // 东北
  [-1, 1], // 西南
]

/** 正交四邻（判「挨着猎犬」用） */
export const ORTHO: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

// ---------------- 坐标换算 ----------------

export function idx(c: number, r: number): number {
  return r * COLS + c
}

export function colOf(cell: number): number {
  return ((cell % COLS) + COLS) % COLS
}

export function rowOf(cell: number): number {
  return Math.floor(cell / COLS)
}

export function inBoard(cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < CELLS
}

/** 该棋子属于哪一方（狗与兔子同一方） */
export function owns(piece: Piece, side: Side): boolean {
  return side === 'fox' ? piece === FOX : piece === RABBIT || piece === DOG
}

/** 该棋子是不是狐狸方的猎犬（兔子或狗） */
export function isHound(piece: Piece): boolean {
  return piece === RABBIT || piece === DOG
}

export function findPiece(board: readonly Piece[], piece: Piece): number {
  for (let i = 0; i < CELLS; i++) if (board[i] === piece) return i
  return -1
}

/** 某一方控制的所有棋子格（含狗） */
export function piecesOf(board: readonly Piece[], side: Side): number[] {
  const out: number[] = []
  for (let i = 0; i < CELLS; i++) if (board[i] !== EMPTY && owns(board[i], side)) out.push(i)
  return out
}

export function other(side: Side): Side {
  return side === 'fox' ? 'rabbit' : 'fox'
}

// ---------------- 滑行 ----------------

/**
 * 沿第 d 条射线滑行后的落点：该方向上的第一个空格；没有则返回 -1。
 * 遇到的棋子会被直接越过（只阻挡落点，不阻挡穿过），所以「越过棋子落到更远的空格」是允许的。
 */
export function slideTarget(board: readonly Piece[], from: number, d: number): number {
  if (!inBoard(from)) return -1
  const dir = DIRS[d]
  if (!dir) return -1
  const [dc, dr] = dir
  let c = colOf(from) + dc
  let r = rowOf(from) + dr
  while (c >= 0 && c < COLS && r >= 0 && r < ROWS) {
    const at = idx(c, r)
    if (board[at] === EMPTY) return at
    c += dc
    r += dr
  }
  return -1
}

/** from 出发的全部合法落点 */
export function slidesFrom(board: readonly Piece[], from: number): number[] {
  const out: number[] = []
  if (!inBoard(from) || board[from] === EMPTY) return out
  for (let d = 0; d < DIRS.length; d++) {
    const t = slideTarget(board, from, d)
    if (t >= 0) out.push(t)
  }
  return out
}

/** from → to 是不是一条合法滑行：同一条直线上的第一个空格 */
export function canSlide(board: readonly Piece[], from: number, to: number): boolean {
  if (!inBoard(from) || !inBoard(to) || from === to) return false
  if (board[from] === EMPTY || board[to] !== EMPTY) return false
  for (let d = 0; d < DIRS.length; d++) if (slideTarget(board, from, d) === to) return true
  return false
}

export interface Move {
  from: number
  to: number
}

/** 某一方当前的全部合法走法 */
export function movesOf(board: readonly Piece[], side: Side): Move[] {
  const out: Move[] = []
  for (const from of piecesOf(board, side)) {
    for (const to of slidesFrom(board, from)) out.push({ from, to })
  }
  return out
}

// ---------------- 胜负 ----------------

/** 是不是狐狸的胜利格（第 0 列或第 COLS-1 列） */
export function isExitCell(cell: number): boolean {
  if (!inBoard(cell)) return false
  const c = colOf(cell)
  return c === 0 || c === COLS - 1
}

/** cell 是否与任一猎犬（狗或兔子）上下左右相邻 */
export function adjacentToHound(board: readonly Piece[], cell: number): boolean {
  if (!inBoard(cell)) return false
  const c = colOf(cell)
  const r = rowOf(cell)
  for (const [dc, dr] of ORTHO) {
    const nc = c + dc
    const nr = r + dr
    if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue
    if (isHound(board[idx(nc, nr)])) return true
  }
  return false
}

/** 狐狸离最近出口格还有几列（0 = 已站在出口列上） */
export function exitDistance(cell: number): number {
  const c = colOf(cell)
  return Math.min(c, COLS - 1 - c)
}

/** 狐狸当前是否已经构成胜利（站在出口列且不挨着任何猎犬） */
export function foxEscaped(board: readonly Piece[]): boolean {
  const fox = findPiece(board, FOX)
  return fox >= 0 && isExitCell(fox) && !adjacentToHound(board, fox)
}

/** 狐狸是否已经被封死（任何方向都滑不出合法格） */
export function foxStuck(board: readonly Piece[]): boolean {
  const fox = findPiece(board, FOX)
  return fox >= 0 && slidesFrom(board, fox).length === 0
}

/**
 * 胜负判定的唯一入口（纯函数）：
 * - 'fox'    狐狸已到出口列且不挨着任何猎犬
 * - 'rabbit' 狐狸所有出口被封死
 * - 'draw'   走到 MOVE_LIMIT 仍无人分胜负
 * - 'none'   未结束
 */
export function winnerOf(state: State): Winner {
  if (foxEscaped(state.board)) return 'fox'
  if (foxStuck(state.board)) return 'rabbit'
  if (state.moves >= MOVE_LIMIT) return 'draw'
  return 'none'
}

// ---------------- 状态 ----------------

/** 行动方：兔子方（含狗）先走，电脑执狐狸 */
export type Side = 'rabbit' | 'fox'
/** 对局结果，'none' 表示未结束 */
export type Winner = 'rabbit' | 'fox' | 'draw' | 'none'

export interface State {
  /** 63 格：EMPTY / RABBIT / FOX / DOG */
  board: Piece[]
  turn: Side
  over: boolean
  winner: Winner
  /** 上一手滑行的起点 / 落点，-1 表示还没走过 */
  lastFrom: number
  lastTo: number
  /** 上一手移动的棋子（渲染滑行动画用） */
  lastPiece: Piece
  moves: number
  /** 已选中的己方棋子格，-1 表示未选中 */
  selected: number
  /** 悬停格，-1 表示无 */
  hover: number
  rng: number
}

export type Action =
  /** 滑行一步（一步 = 一个完整 action，AI 直接用它） */
  | { type: 'slide'; from: number; to: number }
  /** 选中己方棋子 */
  | { type: 'select'; cell: number }
  /** 取消选中 */
  | { type: 'clear' }
  /** 悬停高亮 */
  | { type: 'hover'; cell: number }

export function create(seed: number): State {
  const board: Piece[] = new Array<Piece>(CELLS).fill(EMPTY)
  board[FOX_START] = FOX
  board[DOG_START] = DOG
  for (const r of RABBIT_STARTS) board[r] = RABBIT
  return {
    board,
    turn: 'rabbit',
    over: false,
    winner: 'none',
    lastFrom: -1,
    lastTo: -1,
    lastPiece: EMPTY,
    moves: 0,
    selected: -1,
    hover: -1,
    rng: seed | 0,
  }
}

/** 当前可执行的走法（仅滑行；AI 必须从这里挑） */
export function legalActions(state: State): Action[] {
  if (state.over) return []
  return movesOf(state.board, state.turn).map<Action>((m) => ({ type: 'slide', from: m.from, to: m.to }))
}

/** 一步滑行的直观别名，便于测试与渲染复用同一入口 */
export function slide(state: State, from: number, to: number): State {
  return reduce(state, { type: 'slide', from, to })
}

/** 纯函数状态迁移：不修改入参（board 一律 slice 后再写） */
export function reduce(state: State, action: Action): State {
  if (state.over) return state

  switch (action.type) {
    case 'clear':
      return state.selected === -1 ? state : { ...state, selected: -1 }

    case 'hover': {
      if (!inBoard(action.cell)) return state.hover === -1 ? state : { ...state, hover: -1 }
      return state.hover === action.cell ? state : { ...state, hover: action.cell }
    }

    case 'select': {
      const c = action.cell
      if (!inBoard(c)) return state.selected === -1 ? state : { ...state, selected: -1 }
      if (!owns(state.board[c], state.turn)) return { ...state, selected: -1 }
      if (slidesFrom(state.board, c).length === 0) return { ...state, selected: -1 }
      return state.selected === c ? state : { ...state, selected: c }
    }

    case 'slide': {
      const { from, to } = action
      // 非法走法（越界 / 非本方棋子 / 落点有子 / 不是该方向的第一个空格）：原样返回
      if (!inBoard(from) || !inBoard(to)) return state
      if (!owns(state.board[from], state.turn)) return state
      if (!canSlide(state.board, from, to)) return state

      const board = state.board.slice()
      const piece = board[from]
      board[from] = EMPTY
      board[to] = piece

      const moves = state.moves + 1
      const next: State = {
        ...state,
        board,
        turn: other(state.turn),
        lastFrom: from,
        lastTo: to,
        lastPiece: piece,
        moves,
        selected: -1,
        hover: -1,
      }
      const winner = winnerOf(next)
      return winner === 'none' ? next : { ...next, over: true, winner }
    }
  }
}

// ---------------- AI ----------------

/** 迭代加深的层数表 */
export const SEARCH_DEPTHS: readonly number[] = [1, 2, 3, 4]
/** 每层的节点上限，超出即中断并退回上一层的最佳走法（保证毫秒级返回） */
export const NODE_BUDGET: readonly number[] = [1_200, 3_000, 7_000, 16_000]
/** 胜负分值，必须压过所有启发式项 */
export const MATE = 100_000
/** 节点上限触发的哨兵 */
const ABORT = Symbol('node-limit')

export interface SearchInfo {
  action: Action
  /** 实际完成搜索的层数 */
  depth: number
  score: number
  nodes: number
  /** true = 该层被节点上限截断（结果已退回上一层的最佳走法） */
  aborted: boolean
}

interface Ctx {
  nodes: number
  limit: number
}

/**
 * AI：与规则共享同一个 reduce —— 每个候选动作都真正试算一遍，不维护第二套规则逻辑。
 * 电脑执狐狸（state.turn === 'fox'），但同一个函数对兔子方也成立（自对弈测试用）。
 * 结构：迭代加深 + negamax + alpha-beta + 节点上限。
 */
export function aiSearch(state: State, maxDepth = 4, budget: readonly number[] = NODE_BUDGET): SearchInfo | null {
  if (state.over) return null
  const root = legalActions(state)
  if (root.length === 0) return null

  const rng = new Rng(state.rng)
  const sign = state.turn === 'fox' ? 1 : -1

  // 走法排序：用 1 层静态评估排个序，让 alpha-beta 尽早剪枝；
  // 同分之间按可播种随机打散，保证不同 seed 有不同棋风、相同 seed 完全可复盘。
  const ordered = rng
    .shuffle(root)
    .map((a) => ({ a, key: evaluate(reduce(state, a).board) * sign }))
    .sort((x, y) => y.key - x.key)
    .map((x) => x.a)

  let best: SearchInfo | null = null
  let abortedAny = false

  for (let i = 0; i < SEARCH_DEPTHS.length; i++) {
    const depth = SEARCH_DEPTHS[i]
    if (depth > maxDepth) break
    const ctx: Ctx = {
      nodes: 0,
      limit: budget[i] === undefined ? NODE_BUDGET[NODE_BUDGET.length - 1] : budget[i],
    }
    let alpha = -Infinity
    let local: SearchInfo | null = null
    try {
      for (const m of ordered) {
        const sc = -negamax(reduce(state, m), depth - 1, -Infinity, -alpha, ctx)
        if (local === null || sc > local.score) {
          local = { action: m, depth, score: sc, nodes: 0, aborted: false }
        }
        if (sc > alpha) alpha = sc
      }
    } catch (e) {
      if (e !== ABORT) throw e
      abortedAny = true
    }
    if (local !== null) {
      local.nodes = ctx.nodes
      local.aborted = abortedAny
      best = local
    }
    if (abortedAny) break
  }

  if (best === null) {
    return { action: root[0], depth: 0, score: 0, nodes: 0, aborted: abortedAny }
  }
  return best
}

/**
 * 电脑（执狐狸）的动作。**不是狐狸回合、或已终局时必须返回 null** ——
 * 这是 GameModule 对 aiAction 的硬契约：壳层每落一个子就会挂一次定时器，
 * 一旦这里在玩家回合也返回走法，AI 就会替玩家把棋子全走光，玩家永远插不上手。
 *
 * `aiSearch` 本身对双方通用（自对弈测试用），门禁只加在这一层。
 */
export function aiAction(state: State): Action | null {
  if (state.over || state.turn !== 'fox') return null
  const info = aiSearch(state)
  return info === null ? null : info.action
}

/** negamax：从当前走子方的视角返回值 */
function negamax(state: State, depth: number, alpha: number, beta: number, ctx: Ctx): number {
  ctx.nodes++
  if (ctx.nodes > ctx.limit) throw ABORT

  const side = state.turn
  const sign = side === 'fox' ? 1 : -1

  const w = winnerOf(state)
  if (w === 'fox') return sign * MATE
  if (w === 'rabbit') return -sign * MATE
  if (w === 'draw') return 0
  if (depth <= 0) return sign * evaluate(state.board)

  const moves = legalActions(state)
  if (moves.length === 0) return -sign * MATE

  let best = -Infinity
  for (const m of moves) {
    const sc = -negamax(reduce(state, m), depth - 1, -beta, -alpha, ctx)
    if (sc > best) best = sc
    if (sc > alpha) alpha = sc
    if (alpha >= beta) break
  }
  return best
}

/**
 * 静态评估（始终从「狐狸视角」返回，越大越有利于狐狸）：
 *  1. 已到出口列且不挨着任何猎犬 → +MATE（实际由 winnerOf 提前判定）
 *  2. 离最近出口列还有几列 → 越近越好
 *  3. 狐狸还剩几个合法出口 → 越少越糟（兔子方的核心目标）
 *  4. 站上出口列却挨着猎犬 → 重罚：这一手没赢成，还把自己钉死在底线
 *  5. 与最近猎犬的切比雪夫距离 → 贴太近就被堵
 *  6. 猎犬在列方向的铺开程度 → 铺得越开，狐狸越难单边突破
 */
export function evaluate(board: readonly Piece[]): number {
  const fox = findPiece(board, FOX)
  if (fox < 0) return -MATE
  if (isExitCell(fox) && !adjacentToHound(board, fox)) return MATE
  const exits = slidesFrom(board, fox)
  if (exits.length === 0) return -MATE

  let v = 0
  v -= exitDistance(fox) * 40
  v -= exits.length * 14
  if (isExitCell(fox)) v -= adjacentToHound(board, fox) ? 600 : 0

  let nearest = 9
  let minC = COLS
  let maxC = -1
  for (let i = 0; i < CELLS; i++) {
    if (!isHound(board[i])) continue
    const c = colOf(i)
    const r = rowOf(i)
    if (c < minC) minC = c
    if (c > maxC) maxC = c
    const d = Math.max(Math.abs(c - colOf(fox)), Math.abs(r - rowOf(fox)))
    if (d < nearest) nearest = d
  }
  // 猎犬里至少有一只狗，必有 minC/maxC 有效
  v += nearest * 8
  v += (maxC - minC) * 5
  return v
}
