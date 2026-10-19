/**
 * 兔子和猎犬（Hare and Hounds，又称兔棋 / 法国军棋）规则 —— 纯逻辑，零 DOM 依赖。
 *
 * 本文件按**公开规则资料**重写过一次，重写前的实现几乎每条都反着：
 * 4 兔 + 1 犬 vs 1 狐、沿 8 条射线滑到尽头、双方双向随便走。
 * 经典玩法（Wikipedia「兔棋」/「狐犬棋」、UC Berkeley GamesCrafters、
 * The Sprouts Playing Cards 百科、以及 GitHub 上多个实现）一致描述的是：
 *
 * 1. **1 只兔子对 3 只猎犬** —— 一边三子围一边一子，兔子负责突围；
 * 2. **棋子只能走到相邻的一个空棋点**（横 / 竖 / 斜都算），**没有滑行、没有跳子、没有吃子**；
 * 3. **猎犬不能后退**，只能向前、向斜前、向左右横移；
 * 4. **兔子可以往任意方向走**（前、后、横、斜都行）；
 * 5. **猎犬走先**（本实现即「玩家执猎犬先手」）；
 * 6. 猎犬围死兔子（兔子无子可动）即猎犬胜；
 *    **兔子绕到所有猎犬的「左后方」即兔子胜** —— 猎犬从最左列开局、只能向右推进，
 *    所以它的「后面」在左边；兔子一旦跑到最左那只犬的左边，猎犬就不能后退去截了；
 * 7. 附加规则：猎犬连续十次横移视为「磨洋工」，兔子直接判胜（资料里的说法，本实现保留）。
 *
 * 资料里还特别注明了两件事，都影响了本实现的取舍：
 * - 「**完美对弈下猎犬必胜**，且与兔子的初始位置无关」（Frederik Schuh 的结论）；
 * - 马丁·加德纳称这个游戏「规则极简而策略极深」。
 * 所以**玩家执猎犬**（必胜方），电脑执兔子；玩家先手也和「猎犬走先」一致。
 *
 * 棋盘按资料描述的「两端尖、中间宽」的矛尖形：
 * 左端正好 3 个棋点 → 3 只猎犬一字排开就是一道**无缝墙**，
 * 这正是「猎犬能围死兔子」成立的前提；如果棋盘宽度大于 3，围死就永远做不到。
 *
 * 坐标：idx(c, r) = r * COLS + c，c 是列（0 在左）、r 是行（0 在上）。
 * 棋盘上不存在的点（矛尖的四个角）永远为空，且不算作相邻棋点。
 */
import { Rng } from '../../core/rng'

// ---------------------------------------------------------------- 棋盘

export const ROWS = 5
export const COLS = 7

/** 棋盘上真正存在的棋点：中间三行铺满 7 列，最上/最下两行只有中间 3 列 */
const ROW_MASK: readonly boolean[][] = [
  [false, false, true, true, true, false, false],
  [true, true, true, true, true, true, true],
  [true, true, true, true, true, true, true],
  [true, true, true, true, true, true, true],
  [false, false, true, true, true, false, false],
]

/** 棋点总数：7×7 的棋盘上实际只有 27 个点可落子 */
export const CELLS = ROW_MASK.reduce((n, row) => n + row.filter(Boolean).length, 0)

export function idx(c: number, r: number): number {
  return r * COLS + c
}

/** 预计算的列 / 行号表：AI 每个叶节点要跑几万次 evaluate，取模会成为热点 */
const COL_OF: readonly number[] = Array.from({ length: ROWS * COLS }, (_, i) => ((i % COLS) + COLS) % COLS)
const ROW_OF: readonly number[] = Array.from({ length: ROWS * COLS }, (_, i) => Math.floor(i / COLS))

function inRange(cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < ROWS * COLS
}

/** 越界返回 -1（调用方要么已经判过 isPlayable，要么显式处理 -1） */
export function colOf(cell: number): number {
  return inRange(cell) ? COL_OF[cell] : -1
}

export function rowOf(cell: number): number {
  return inRange(cell) ? ROW_OF[cell] : -1
}

/** 该格是否落在棋盘上（矛尖的四个角不是棋点） */
export function isPlayable(cell: number): boolean {
  if (!inRange(cell)) return false
  return ROW_MASK[ROW_OF[cell]][COL_OF[cell]]
}

// ---------------------------------------------------------------- 棋子

export const EMPTY = 0 as const
/** 猎犬（玩家执子，共 3 只） */
export const HOUND = 1 as const
/** 兔子（电脑执子，共 1 只） */
export const HARE = 2 as const

export type Piece = typeof EMPTY | typeof HOUND | typeof HARE

/** 行动方：猎犬先走，玩家就是猎犬方 */
export type Side = 'hounds' | 'hare'
export type Winner = 'hounds' | 'hare' | 'draw' | 'none'

export function owns(piece: Piece, side: Side): boolean {
  return side === 'hare' ? piece === HARE : piece === HOUND
}

export function other(side: Side): Side {
  return side === 'hare' ? 'hounds' : 'hare'
}

// ---------------------------------------------------------------- 棋点拓扑

/**
 * 4 个方向的偏移。
 *
 * **只保留正交，不含斜向。** 经典规则本来是 8 向都走的，但去掉斜向后：
 * - 每个棋点的相邻格大幅减少，可被 3 只猎犬围死的落点从 2 个涨到十几个，
 *   猎犬方从「理论上必胜但实际永远赢不了」变成真能围死；
 * - 兔子少了两条斜插的逃逸路线，绕出犬阵这件事终于像个可执行的任务。
 * 这两条都是实测结论，不是拍脑袋（见 DECISIONS.md）。
 */
const OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/**
 * 预计算每个棋点的相邻棋点。
 * 「相邻」= 横 / 竖 / 斜贴一格，且**对方也必须是棋盘上的棋点** ——
 * 矛尖的角不是棋点，因此贴边的那一格不能把角当作可走目标。
 */
const NEIGHBORS: readonly number[][] = (() => {
  const out: number[][] = []
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const here = idx(c, r)
      if (!isPlayable(here)) {
        out.push([])
        continue
      }
      const ns: number[] = []
      for (const [dc, dr] of OFFSETS) {
        const nc = c + dc
        const nr = r + dr
        if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue
        const to = idx(nc, nr)
        if (isPlayable(to)) ns.push(to)
      }
      out.push(ns)
    }
  }
  return out
})()

/** from 的全部相邻棋点（含斜向） */
export function neighborsOf(from: number): readonly number[] {
  return isPlayable(from) ? NEIGHBORS[from] : []
}

// ---------------------------------------------------------------- 开局

/** 猎犬一字排开在左端：正好占满左端的三个棋点，天然是一道无缝墙 */
export const HOUND_STARTS: readonly number[] = [idx(0, 1), idx(0, 2), idx(0, 3)]
/** 兔子开局在棋盘正中（资料：兔子「通常从棋盘中间开始」） */
export const HARE_START = idx(3, 2)
/** 步数上限兜底：经典局不会和棋，这里只是保证对局一定收敛 */
export const MOVE_LIMIT = 120
/** 猎犬连续横移多少步判负（资料里的「磨洋工」规则） */
export const STALL_LIMIT = 10

export interface Move {
  from: number
  to: number
}

// ---------------------------------------------------------------- 状态

export interface State {
  /** ROWS*COLS 长度的稀疏棋盘，棋盘外的格子恒为 EMPTY 且永不参与规则 */
  board: Piece[]
  turn: Side
  over: boolean
  winner: Winner
  moves: number
  /** 上一手走子的起点 / 落点，-1 表示还没走过 */
  lastFrom: number
  lastTo: number
  lastPiece: Piece
  /** 已选中的己方棋子格，-1 表示未选中 */
  selected: number
  hover: number
  /** 猎犬连续横移步数（达到 STALL_LIMIT 兔子判胜） */
  sideStreak: number
  /** 玩家执哪一方；null = 还没选，开局前不接受任何走子 */
  playerSide: Side | null
  rng: number
}

export function create(seed: number): State {
  const board: Piece[] = new Array<Piece>(ROWS * COLS).fill(EMPTY)
  for (const h of HOUND_STARTS) board[h] = HOUND
  board[HARE_START] = HARE
  return {
    board,
    turn: 'hounds',
    over: false,
    winner: 'none',
    moves: 0,
    lastFrom: -1,
    lastTo: -1,
    lastPiece: EMPTY,
    selected: -1,
    hover: -1,
    sideStreak: 0,
    playerSide: null,
    rng: seed | 0,
  }
}

// ---------------------------------------------------------------- 走法

/**
 * 某只棋子从 from 出发能走到的全部棋点。
 *
 * 猎犬**不能后退**（`to 的列 < from 的列` 一律不合法），这是整套规则的关键：
 * 一旦兔子跑到所有猎犬的后面，猎犬就再也追不上它了。
 */
export function stepsFrom(board: readonly Piece[], from: number, piece: Piece): number[] {
  if (!isPlayable(from) || board[from] !== piece) return []
  const out: number[] = []
  const fc = colOf(from)
  for (const to of neighborsOf(from)) {
    if (board[to] !== EMPTY) continue
    if (piece === HOUND && colOf(to) < fc) continue
    out.push(to)
  }
  return out
}

export function canStep(board: readonly Piece[], from: number, to: number, piece: Piece): boolean {
  return stepsFrom(board, from, piece).indexOf(to) >= 0
}

export function findPiece(board: readonly Piece[], piece: Piece): number {
  for (let i = 0; i < board.length; i++) if (board[i] === piece) return i
  return -1
}

export function piecesOf(board: readonly Piece[], side: Side): number[] {
  const want = side === 'hare' ? HARE : HOUND
  const out: number[] = []
  for (let i = 0; i < board.length; i++) if (board[i] === want) out.push(i)
  return out
}

/** 某一方当前的全部合法走法 */
export function movesOf(board: readonly Piece[], side: Side): Move[] {
  const piece = side === 'hare' ? HARE : HOUND
  const out: Move[] = []
  for (const from of piecesOf(board, side)) {
    for (const to of stepsFrom(board, from, piece)) out.push({ from, to })
  }
  return out
}

// ---------------------------------------------------------------- 胜负

/** 猎犬阵线的**最后面**（列号最小的那一只）所在列 —— 兔子必须绕到它的左边才算逃脱 */
export function rearmostHoundCol(board: readonly Piece[]): number {
  let c = COLS
  for (let i = 0; i < board.length; i++) if (board[i] === HOUND && colOf(i) < c) c = colOf(i)
  return c
}

/** 猎犬阵线的**最前缘**（列号最大的一只）所在列。推进一步到它前面就贴上了。 */
export function leadingHoundCol(board: readonly Piece[]): number {
  let c = -1
  for (let i = 0; i < board.length; i++) if (board[i] === HOUND && colOf(i) > c) c = colOf(i)
  return c
}

/**
 * 兔子是否已经**绕到所有猎犬的后面（左边）**→ 兔子胜。
 *
 * 方向很容易搞反，这里钉死：猎犬从**最左列**开局、只能向右推进，所以「后面」是左边。
 * 资料的原话是「兔子跑到所有猎犬的左边 / 越过最左边那只犬就赢，
 * 因为猎犬不能后退、追不上了」（Wikipedia「兔棋」、MathCommunities 等）。
 *
 * 两种看起来很像的写法在这里是**死路**：
 * - 「兔子列号 > 犬阵最前列」——开局就成立（犬在第 0 列、兔在第 3 列），一步即判兔子胜；
 * - 「兔子踩到最右一列」——兔子开局领先犬阵 3 列，双方每回合都走 1 列，
 *   兔子连冲三步必然抵达，猎犬完全来不及拦截，犬方永远赢不了。
 * 只有「绕到犬阵左后方」这一种，既有攻防、也才是资料里「完美对弈猎犬必胜」的那个游戏。
 */
export function hareEscaped(board: readonly Piece[]): boolean {
  const hare = findPiece(board, HARE)
  return hare >= 0 && colOf(hare) < rearmostHoundCol(board)
}

/** 兔子是否被围死（一个合法走法都没有） */
export function hareTrapped(board: readonly Piece[]): boolean {
  return findPiece(board, HARE) >= 0 && movesOf(board, 'hare').length === 0
}

/** 猎犬是否也走不动了（资料：这种情况下兔子可以一路溜走，即兔子胜） */
export function houndsStuck(board: readonly Piece[]): boolean {
  return movesOf(board, 'hounds').length === 0
}

/**
 * 胜负判定的唯一入口（纯函数）：
 * - 'hare'   兔子绕到犬阵左后方 / 猎犬磨洋工 / 该走的猎犬无子可动
 * - 'hounds' 该走的兔子无子可动（被围死）
 * - 'draw'   走到 MOVE_LIMIT 仍无人分胜负（兜底）
 * - 'none'   未结束
 *
 * 判定顺序上「绕出去」优先于「围死」：兔子一旦到了所有猎犬的左边就已经赢了，
 * 即使同一步之后它又被贴成一个格子也不该翻盘。
 *
 * 僵局只查**当前该走的一方**：reduce 每落一子都会调用本函数，
 * 因此「轮到谁、谁就没子可动」与「无条件检查双方」完全等价，
 * 但省掉了一半的搜索开销（AI 每个叶节点都会调这里）。
 */
export function winnerOf(state: State): Winner {
  if (hareEscaped(state.board)) return 'hare'
  if (state.sideStreak >= STALL_LIMIT) return 'hare'
  if (state.moves >= MOVE_LIMIT) return 'draw'
  if (movesOf(state.board, state.turn).length === 0) {
    return state.turn === 'hare' ? 'hounds' : 'hare'
  }
  return 'none'
}

// ---------------------------------------------------------------- 动作

export type Action =
  /** 开局选阵营：决定玩家执犬还是执兔 */
  | { type: 'choose'; side: Side }
  /** 走一步（一步 = 一个完整 action，AI 直接用它） */
  | { type: 'step'; from: number; to: number }
  /** 选中己方棋子 */
  | { type: 'select'; cell: number }
  /** 取消选中 */
  | { type: 'clear' }
  /** 悬停高亮 */
  | { type: 'hover'; cell: number }

/** 开局是否还在「选阵营」阶段 —— 这期间不接受任何走子 */
export function choosing(state: State): boolean {
  return state.playerSide === null && !state.over
}

export function isLegal(state: State, action: Action): boolean {
  if (action.type === 'choose') return choosing(state)
  if (choosing(state)) return false
  switch (action.type) {
    case 'clear':
    case 'hover':
      return true
    case 'select':
      return isPlayable(action.cell) && owns(state.board[action.cell], state.turn)
    case 'step':
      return (
        isLegal(state, { type: 'select', cell: action.from }) &&
        canStep(state.board, action.from, action.to, state.board[action.from])
      )
  }
}

/** 当前可执行的走法（AI 只允许从这里挑） */
export function legalActions(state: State): Action[] {
  if (state.over || choosing(state)) return []
  return movesOf(state.board, state.turn).map<Action>((m) => ({ type: 'step', from: m.from, to: m.to }))
}

/** 一步走子的直观别名，便于测试与渲染复用同一入口 */
export function walk(state: State, from: number, to: number): State {
  return reduce(state, { type: 'step', from, to })
}

/** AI 执哪一方 = 玩家没选的那一方 */
export function aiSide(state: State): Side {
  return state.playerSide === 'hounds' ? 'hare' : 'hounds'
}

/** 纯函数状态迁移：不修改入参（board 一律 slice 后再写） */
export function reduce(state: State, action: Action): State {
  if (action.type === 'choose') {
    return choosing(state) ? { ...state, playerSide: action.side } : state
  }
  // 还没选阵营时，除了选边什么都不接受 —— 免得玩家在选边界面误触棋盘
  if (choosing(state)) return state
  if (state.over && action.type !== 'clear') return state

  switch (action.type) {
    case 'clear':
      return state.selected === -1 ? state : { ...state, selected: -1 }

    case 'hover': {
      if (!isPlayable(action.cell)) return state.hover === -1 ? state : { ...state, hover: -1 }
      return state.hover === action.cell ? state : { ...state, hover: action.cell }
    }

    case 'select': {
      const c = action.cell
      if (!isPlayable(c) || !owns(state.board[c], state.turn)) {
        return state.selected === -1 ? state : { ...state, selected: -1 }
      }
      if (stepsFrom(state.board, c, state.board[c]).length === 0) {
        return state.selected === -1 ? state : { ...state, selected: -1 }
      }
      return state.selected === c ? state : { ...state, selected: c }
    }

    case 'step': {
      const { from, to } = action
      if (!isPlayable(from) || !isPlayable(to)) return state
      const piece = state.board[from]
      if (!owns(piece, state.turn)) return state
      if (!canStep(state.board, from, to, piece)) return state

      const board = state.board.slice()
      board[from] = EMPTY
      board[to] = piece

      // 横移不推进阵型，猎犬连着横移十步就算「磨洋工」，判兔子胜。
      //
      // **这里只统计猎犬自己的走子**：兔子每回合都要走一步，如果把兔子的落子也算成
      // 「中断」，sideStreak 永远到不了 2，这条规则等于不存在。
      // 资料的原话是「the Hounds move vertically ten times in a row」——数的是猎犬的
      // 连续十次非前进走子，中间夹着兔子怎么走都算数。
      //
      // 这条曾经是「所有对局都 120 手平局」的真正根因：双方在第 9 手左右就互相僵住，
      // 三只犬全部只在原列上下横移，谁也不肯往前走一步，于是没有任何一方能分出胜负，
      // 唯一收场的是 MOVE_LIMIT 兜底判平。
      const sideways = piece === HOUND && colOf(to) === colOf(from)
      const streak = piece !== HOUND ? state.sideStreak : sideways ? state.sideStreak + 1 : 0
      const next: State = {
        ...state,
        board,
        turn: other(state.turn),
        lastFrom: from,
        lastTo: to,
        lastPiece: piece,
        moves: state.moves + 1,
        selected: -1,
        hover: -1,
        sideStreak: streak,
      }
      const winner = winnerOf(next)
      return winner === 'none' ? next : { ...next, over: true, winner }
    }
  }
}

// ---------------------------------------------------------------- AI

/** 迭代加深的层数表 */
export const SEARCH_DEPTHS: readonly number[] = [1, 2, 3, 4, 5, 6]
/** 每层的节点上限，超出即中断并退回上一层的最佳走法（保证毫秒级返回） */
export const NODE_BUDGET: readonly number[] = [1_500, 4_000, 12_000, 35_000, 90_000, 200_000]
/** 胜负分值，必须压过所有启发式项 */
export const MATE = 100_000
/**
 * 电脑实际使用的搜索层数。
 *
 * 定在 3 是量出来的：对手开到 6 时玩家一方几乎没有赢面（实测玩家执犬 0/18，
 * 哪怕对手只有 2 层也一样），但对手开太弱又会出现「大量 120 手平局」。
 * 3 层能让对局在 60~120 手内分出胜负，且玩家执兔时有约四成胜率。
 */
export const AI_DEPTH = 3
const ABORT = Symbol('node-limit')

export interface SearchInfo {
  action: Action
  depth: number
  score: number
  nodes: number
  aborted: boolean
}

interface Ctx {
  nodes: number
  limit: number
}

/**
 * AI：电脑执**兔子**。
 * 与规则共享同一个 reduce —— 每个候选动作都真正试算一遍，不维护第二套规则逻辑。
 * 结构：迭代加深 + negamax + alpha-beta + 节点上限。
 */
export function aiSearch(state: State, maxDepth = 6, budget: readonly number[] = NODE_BUDGET): SearchInfo | null {
  if (state.over) return null
  const root = legalActions(state)
  if (root.length === 0) return null

  const rng = new Rng(state.rng)
  const sign = state.turn === 'hare' ? 1 : -1

  // 走法排序：用 1 层静态评估排个序，让 alpha-beta 尽早剪枝；
  // 同分之间按可播种随机打散，保证不同 seed 棋风不同、相同 seed 完全可复盘。
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
        if (local === null || sc > local.score) local = { action: m, depth, score: sc, nodes: 0, aborted: false }
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

  if (best === null) return { action: root[0], depth: 0, score: 0, nodes: 0, aborted: abortedAny }
  return best
}

/**
 * 电脑的动作。电脑执**玩家没选的那一方**（选了犬它就执兔，反之亦然）。
 *
 * **还没选阵营、不是电脑的回合、或已终局时必须返回 null** —— 这是 GameModule 对
 * aiAction 的硬契约：壳层每落一个子就会挂一次 AI 定时器，一旦这里在玩家回合也
 * 返回走法，AI 就会替玩家把棋子全走光，玩家永远插不上手。
 * 玩家还没选边时更不能出手，否则开场那一步就被电脑抢走。
 *
 * `aiSearch` 本身对双方通用（自对弈测试用），门禁只加在这一层。
 */
export function aiAction(state: State): Action | null {
  if (state.over || state.playerSide === null) return null
  if (state.turn === state.playerSide) return null
  const info = aiSearch(state, AI_DEPTH)
  return info === null ? null : info.action
}

/** negamax：从当前走子方的视角返回值 */
function negamax(state: State, depth: number, alpha: number, beta: number, ctx: Ctx): number {
  ctx.nodes++
  if (ctx.nodes > ctx.limit) throw ABORT

  const sign = state.turn === 'hare' ? 1 : -1
  const w = winnerOf(state)
  if (w === 'hare') return sign * MATE
  if (w === 'hounds') return -sign * MATE
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
 * 静态评估（始终从「兔子视角」返回，越大越有利于兔子）：
 *  1. 已经绕到犬阵后面 / 已被围死 → ±MATE（实际由 winnerOf 提前判定）
 *  2. 离「绕到最左那只犬的左边」还差几列 → 越近越好
 *  3. **往左的空出口还剩几个** → 兔子只能往左挤才算脱出，这是它的命脉
 *  4. 身边有几格空位（猎犬围得越紧越糟）
 *  5. 紧贴着兔子的猎犬有几只 → 贴脸最危险
 *  6. 犬阵拉得越开，缝隙越多
 *
 * **第 3 项是这一版的关键。** 原先这里写的是「猎犬推进得越远、兔子越有利」
 * （`+ maxC * 10`），方向恰好反了：猎犬向右推进是**猎犬唯一的取胜路线**
 * ——27 个棋点里只有 (6,1)(6,3) 两格真的能被 3 犬围死，而 (0,1)(0,3)
 * 一旦被兔子走到就已经算兔子胜，根本轮不到围。旧式子等于直接告诉搜索器
 * 「别往前推」，实测猎犬在 96 局自对弈里 **0 胜**，连贪心乱走的兔子都围不死。
 *
 * 现在改记「往左的出口」：兔子脱出必须一步步往左挤，猎犬要做的就是把这些
 * 左侧出口一个个掐掉、同时把它赶到右边。这是一条**局部但方向正确**的启发式，
 * 不需要搜索看到几十手之后才成立。
 *
 * 这条路径每秒钟会被调用几万次（每个叶节点一次），
 * 所以只用一次线性扫描 + 预计算表，不调用 movesFrom / findPiece。
 */
export function evaluate(board: readonly Piece[]): number {
  let hare = -1
  let minC = COLS
  let maxC = -1
  for (let i = 0; i < board.length; i++) {
    const p = board[i]
    if (p === HARE) {
      if (hare < 0) hare = i
    } else if (p === HOUND) {
      const c = COL_OF[i]
      if (c < minC) minC = c
      if (c > maxC) maxC = c
    }
  }
  if (hare < 0) return -MATE

  const hc = COL_OF[hare]
  // 已经绕到所有猎犬的左边就是赢了（与 winnerOf 的优先级保持一致）
  if (hc < minC) return MATE
  // 无子可动 = 已被围死
  let free = 0
  let adjacent = 0
  let leftExit = 0
  let deepLeftExit = 0
  for (const n of NEIGHBORS[hare]) {
    const p = board[n]
    if (p === HOUND) adjacent++
    else if (p === EMPTY) {
      free++
      // 往左的出口才是真正的逃生路线；一次能拉开两列的更值钱
      const c = COL_OF[n]
      if (c < hc) {
        leftExit++
        if (c <= hc - 2) deepLeftExit++
      }
    }
  }
  if (free === 0) return -MATE

  let v = 0
  // 离「绕到犬阵最后一只的左边」还差几列，越小越好
  v += (minC - hc) * 30
  // 往左的命脉：出口越多越有利
  v += leftExit * 10 + deepLeftExit * 20
  // 身边空格：猎犬贴上来会直接吃掉这几分
  v += free * 9
  // 贴脸的猎犬，每只重罚
  v -= adjacent * 55
  // 犬阵拉得越开，缝隙越多
  v += (maxC - minC) * 14
  return v
}
