/**
 * 五子棋规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 设计要点：
 * - 15×15 棋盘，黑（玩家）先手、白（电脑）后手，任意方向连成五子即胜；默认关闭禁手。
 * - AI 走「候选裁剪 + 形状打分 + alpha-beta」路线：绝不遍历 225 个空点，
 *   只在已有棋子附近生成候选并取前若干个送进搜索，单步耗时稳定在毫秒级。
 */
import { Rng } from '../../core/rng'

export const SIZE = 15
export const CELLS = SIZE * SIZE

/** 预留但未启用：三三 / 四四 / 长连禁手（本游戏默认关闭，保持规则简单） */
export const FORBIDDEN_RULES = false

/** 1 = 黑（玩家，先手），2 = 白（电脑，后手） */
export type Player = 1 | 2
export type Cell = 0 | Player

export const HUMAN: Player = 1
export const COMPUTER: Player = 2

/** 四个连线方向：横、竖、右下斜、右上斜 */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
]

export interface State {
  /** 一维棋盘，索引 = row * SIZE + col，row 0 在最上面 */
  board: Cell[]
  /** 下一步该谁落子 */
  turn: Player
  over: boolean
  /** 0 表示平局或未结束 */
  winner: Player | 0
  /** 获胜连线上所有棋格，用于高亮 */
  winCells: number[]
  lastMove: number
  moves: number
  /** 指针悬停的格子，-1 表示无 */
  hover: number
  /** 按顺序记录每一手的棋格索引，悔棋时回退 */
  history: number[]
  rng: number
}

export type Action =
  | { type: 'place'; cell: number }
  | { type: 'hover'; cell: number }
  | { type: 'leave' }
  | { type: 'undo' }

export const idx = (col: number, row: number): number => row * SIZE + col
export const colOf = (i: number): number => i % SIZE
export const rowOf = (i: number): number => Math.floor(i / SIZE)
export const flip = (p: Player): Player => (p === 1 ? 2 : 1)

export function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < SIZE && row >= 0 && row < SIZE
}

export function create(seed: number): State {
  return {
    board: new Array<Cell>(CELLS).fill(0),
    turn: 1,
    over: false,
    winner: 0,
    winCells: [],
    lastMove: -1,
    moves: 0,
    hover: -1,
    history: [],
    rng: seed | 0,
  }
}

/** 该格子是否为合法落点：棋盘内、未被占据、坐标是整数 */
export function canPlace(board: readonly Cell[], cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < CELLS && board[cell] === 0
}

// ---------------------------------------------------------------- 胜负判定

/**
 * 判断把 cell 落成 p 之后是否连成五子；是则返回这条连线上的全部棋格（含长连），否则空数组。
 * 落子只会新增一条穿过该格的连线，所以判定只需要看 cell 的四个方向。
 */
export function winsAt(board: readonly Cell[], cell: number, p: Player): number[] {
  const col = colOf(cell)
  const row = rowOf(cell)
  for (const [dc, dr] of DIRS) {
    const back: number[] = []
    const front: number[] = []
    let c = col + dc
    let r = row + dr
    while (inBounds(c, r) && board[idx(c, r)] === p) {
      front.push(idx(c, r))
      c += dc
      r += dr
    }
    c = col - dc
    r = row - dr
    while (inBounds(c, r) && board[idx(c, r)] === p) {
      back.push(idx(c, r))
      c -= dc
      r -= dr
    }
    const run = back.reverse().concat(cell, front)
    if (run.length >= 5) return run
  }
  return []
}

/** 若 p 在盘上已有五连，返回那条连线的棋格；否则空数组 */
export function findWin(board: readonly Cell[], p: Player): number[] {
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== p) continue
    const line = winsAt(board, i, p)
    if (line.length > 0) return line
  }
  return []
}

export function isFull(board: readonly Cell[]): boolean {
  for (let i = 0; i < CELLS; i++) if (board[i] === 0) return false
  return true
}

export function emptyCells(board: readonly Cell[]): number[] {
  const out: number[] = []
  for (let i = 0; i < CELLS; i++) if (board[i] === 0) out.push(i)
  return out
}

// ---------------------------------------------------------------- 纯状态迁移

/** 纯函数状态迁移 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'leave':
      return state.hover === -1 ? state : { ...state, hover: -1 }

    case 'hover': {
      if (state.over || !Number.isInteger(action.cell) || action.cell < 0 || action.cell >= CELLS) return state
      if (state.board[action.cell] !== 0) return state
      return state.hover === action.cell ? state : { ...state, hover: action.cell }
    }

    case 'place': {
      if (state.over) return state
      if (!canPlace(state.board, action.cell)) return state
      const board = state.board.slice()
      board[action.cell] = state.turn
      const winCells = winsAt(board, action.cell, state.turn)
      const over = winCells.length > 0 || isFull(board)
      return {
        ...state,
        board,
        turn: flip(state.turn),
        over,
        winner: winCells.length > 0 ? state.turn : 0,
        winCells,
        lastMove: action.cell,
        moves: state.moves + 1,
        history: state.history.concat(action.cell),
      }
    }

    case 'undo': {
      // 悔棋：一次退回到「玩家的回合」。
      // 手数为偶 → 现在轮到玩家 → 退一整个来回；手数为奇 → 还在等电脑 → 退掉自己刚落的那一手。
      if (state.over) return state
      if (state.history.length === 0) return state
      const history = state.history.slice()
      const board = state.board.slice()
      const steps = history.length % 2 === 0 ? Math.min(2, history.length) : 1
      for (let k = 0; k < steps; k++) board[history.pop() as number] = 0
      return {
        ...state,
        board,
        history,
        moves: history.length,
        lastMove: history.length > 0 ? history[history.length - 1] : -1,
        turn: HUMAN,
        winner: 0,
        winCells: [],
        over: false,
      }
    }
  }
}

/** 落子（棋盘类专用落子没有重力，直接按格子） */
export function place(state: State, cell: number): State {
  return reduce(state, { type: 'place', cell })
}

// ---------------------------------------------------------------- 形状打分

/** 连续同色子 + 两端开口数的分档表（数值差足够大，保证高优先级先被选中） */
const SCORE = {
  FIVE: 10_000_000,
  OPEN_FOUR: 1_000_000,
  FOUR: 120_000,
  OPEN_THREE: 40_000,
  THREE: 900,
  OPEN_TWO: 700,
  TWO: 70,
  ONE: 30,
} as const

/** len = 连子长度（含落点），open = 两端空着的端数（0/1/2） */
function runScore(len: number, open: number): number {
  if (len >= 5) return SCORE.FIVE
  if (len === 4) return open >= 2 ? SCORE.OPEN_FOUR : SCORE.FOUR
  if (len === 3) return open >= 2 ? SCORE.OPEN_THREE : SCORE.THREE
  if (len === 2) return open >= 2 ? SCORE.OPEN_TWO : SCORE.TWO
  return SCORE.ONE
}

/**
 * 假设在空点 cell 落下 p 之后的进攻价值：
 * 沿四个方向统计「连续同色长度 + 两端开口数」，按五连 / 活四 / 冲四 / 活三 … 分档求和。
 * 要求 board[cell] === 0。
 */
export function moveScore(board: readonly Cell[], cell: number, p: Player): number {
  const col = colOf(cell)
  const row = rowOf(cell)
  let total = 0
  for (const [dc, dr] of DIRS) {
    let len = 1
    let open = 0
    for (const sign of [1, -1] as const) {
      let c = col + dc * sign
      let r = row + dr * sign
      let run = 0
      while (inBounds(c, r) && board[idx(c, r)] === p) {
        run++
        c += dc * sign
        r += dr * sign
      }
      len += run
      if (run > 0 && inBounds(c, r) && board[idx(c, r)] === 0) open++
    }
    total += runScore(len, open)
  }
  return total
}

/** 四个方向上所有「完整连线」的集合（共 88 条），用于整盘评估 */
const LINES: ReadonlyArray<readonly number[]> = buildLines()

function buildLines(): number[][] {
  const lines: number[][] = []
  const push = (cells: number[]): void => {
    if (cells.length >= 5) lines.push(cells)
  }
  for (let r = 0; r < SIZE; r++) {
    const l: number[] = []
    for (let c = 0; c < SIZE; c++) l.push(idx(c, r))
    push(l)
  }
  for (let c = 0; c < SIZE; c++) {
    const l: number[] = []
    for (let r = 0; r < SIZE; r++) l.push(idx(c, r))
    push(l)
  }
  // 右下斜（左边界起 + 上边界起）
  for (let r = 0; r < SIZE; r++) {
    const l: number[] = []
    for (let k = 0; k < SIZE && inBounds(r + k, k); k++) l.push(idx(k, r + k))
    push(l)
  }
  for (let c = 1; c < SIZE; c++) {
    const l: number[] = []
    for (let k = 0; k < SIZE && inBounds(c + k, k); k++) l.push(idx(c + k, k))
    push(l)
  }
  // 右上斜（左边界起 + 上边界起）
  for (let r = SIZE - 1; r >= 0; r--) {
    const l: number[] = []
    for (let k = 0; k < SIZE && inBounds(r - k, k); k++) l.push(idx(k, r - k))
    push(l)
  }
  for (let c = 1; c < SIZE; c++) {
    const l: number[] = []
    for (let k = 0; k < SIZE && inBounds(c + k, k); k++) l.push(idx(c + k, k))
    push(l)
  }
  return lines
}

/** 整盘静态评估（以 me 视角）：自身所有连线的价值 - 对方所有连线的价值 */
export function evalBoard(board: readonly Cell[], me: Player): number {
  let mine = 0
  let theirs = 0
  for (const line of LINES) {
    let i = 0
    while (i < line.length) {
      const v = board[line[i]]
      if (v === 0) {
        i++
        continue
      }
      const start = i
      while (i < line.length && board[line[i]] === v) i++
      const open =
        (start > 0 && board[line[start - 1]] === 0 ? 1 : 0) + (i < line.length && board[line[i]] === 0 ? 1 : 0)
      const sc = runScore(i - start, open)
      if (v === me) mine += sc
      else theirs += sc
    }
  }
  return mine - theirs
}

// ---------------------------------------------------------------- 候选裁剪

function centerDist(cell: number): number {
  const mid = (SIZE - 1) / 2
  return Math.max(Math.abs(colOf(cell) - mid), Math.abs(rowOf(cell) - mid))
}

/**
 * 候选池：只取「已有棋子上下左右 radius 格内」的空点（空盘时退化为中心附近 5×5）。
 * radius=1 用于搜索内层（所有必胜点 / 必堵点都在这一圈里，池子小一倍），2 用于根节点。
 */
export function candidatePool(board: readonly Cell[], radius = 2): number[] {
  const near = new Uint8Array(CELLS)
  let hasStone = false
  for (let i = 0; i < CELLS; i++) {
    if (board[i] === 0) continue
    hasStone = true
    const col = colOf(i)
    const row = rowOf(i)
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const c = col + dc
        const r = row + dr
        if (!inBounds(c, r)) continue
        const j = idx(c, r)
        if (board[j] === 0) near[j] = 1
      }
    }
  }
  const pool: number[] = []
  if (hasStone) {
    for (let i = 0; i < CELLS; i++) if (near[i]) pool.push(i)
  } else {
    for (let i = 0; i < CELLS; i++) if (centerDist(i) <= 2) pool.push(i)
  }
  return pool
}

/**
 * 候选点：候选池按「该点的进攻价值 + 防守价值」降序排序，只把前 limit 个交给搜索。
 * 获胜点永远落在已有棋子 1 格内，因此一定在候选池里，裁剪不会漏掉必胜 / 必堵点。
 */
export function candidateCells(board: readonly Cell[], me: Player, limit: number, radius = 2): number[] {
  return rankMoves(board, candidatePool(board, radius), me, limit, null)
}

/** 按进攻+防守价值排序并截断；tieSeed 非空时用可播种随机打散同分项，保证「同状态同结果」但不同种子有多样性 */
function rankMoves(
  board: readonly Cell[],
  pool: readonly number[],
  me: Player,
  limit: number,
  tieSeed: number | null,
): number[] {
  const opp = flip(me)
  const scored = pool.map((i) => ({
    i,
    s: moveScore(board, i, me) + Math.round(moveScore(board, i, opp) * 0.9),
    d: centerDist(i),
  }))
  if (tieSeed !== null) new Rng(tieSeed).shuffle(scored)
  // 稳定排序：同分项保持 shuffle 后的顺序
  scored.sort((a, b) => b.s - a.s || a.d - b.d)
  return scored.slice(0, limit).map((x) => x.i)
}

// ---------------------------------------------------------------- 威胁扫描

/** 落下 p 就能连成五子的空点 */
export function winningCells(board: readonly Cell[], p: Player): number[] {
  return threatCells(board, p, 5)
}

/** 落下 p 就能连成四子的空点（活四 / 冲四都算） */
export function fourCells(board: readonly Cell[], p: Player): number[] {
  return threatCells(board, p, 4)
}

function threatCells(board: readonly Cell[], p: Player, need: number): number[] {
  const out: number[] = []
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const i = idx(col, row)
      if (board[i] !== 0) continue
      let hit = false
      for (const [dc, dr] of DIRS) {
        let n = 1
        for (const sign of [1, -1] as const) {
          let c = col + dc * sign
          let r = row + dr * sign
          while (inBounds(c, r) && board[idx(c, r)] === p) {
            n++
            c += dc * sign
            r += dr * sign
          }
        }
        if (n >= need) {
          hit = true
          break
        }
      }
      if (hit) out.push(i)
    }
  }
  return out
}

// ---------------------------------------------------------------- AI 搜索

/** 根节点保留的候选数（≤12，保证单步毫秒级） */
const ROOT_CANDIDATES = 12
/** 内层节点保留的候选数 */
const INNER_CANDIDATES = 10
/** 搜索深度（4 层：我方 1 手 + 对方 2 手 + 我方 3 手 + 对方 4 手） */
const SEARCH_DEPTH = 4
/** 节点数兜底上限，超出即停止加深搜索（保证主线程不会卡住） */
const MAX_NODES = 24000
const WIN_SCORE = 5_000_000

interface TtEntry {
  depth: number
  value: number
}

interface SearchCtx {
  nodes: number
  aborted: boolean
  tt: Map<string, TtEntry>
}

function boardKey(board: readonly Cell[], me: Player): string {
  return (me === 1 ? 'b' : 'w') + board.join('')
}

function negamax(board: Cell[], me: Player, depth: number, alpha: number, beta: number, ctx: SearchCtx): number {
  if (++ctx.nodes > MAX_NODES) {
    ctx.aborted = true
    return evalBoard(board, me)
  }
  if (depth <= 0) return evalBoard(board, me)

  const key = boardKey(board, me)
  const hit = ctx.tt.get(key)
  if (hit && hit.depth >= depth) return hit.value

  const opp = flip(me)
  const moves = candidateCells(board, me, depth >= 3 ? ROOT_CANDIDATES : INNER_CANDIDATES, depth >= 3 ? 2 : 1)
  if (moves.length === 0) return evalBoard(board, me)

  let best = -Infinity
  for (const c of moves) {
    board[c] = me
    // 走得更早的五连比晚一步的五连更值钱
    const value =
      winsAt(board, c, me).length > 0 ? WIN_SCORE - (SEARCH_DEPTH - depth) : -negamax(board, opp, depth - 1, -beta, -alpha, ctx)
    board[c] = 0
    if (value > best) best = value
    if (best > alpha) alpha = best
    if (alpha >= beta || ctx.aborted) break
  }
  if (!ctx.aborted) {
    if (ctx.tt.size > 6000) ctx.tt.clear()
    ctx.tt.set(key, { depth, value: best })
  }
  return best
}

/**
 * 求 me 在当前局面下的最佳落点。绝不修改传入的 state：
 * 只在 board 的副本上试算，随机（用于同分打散）来自 state.rng，可完整复盘。
 */
export function bestMoveFor(state: State, me: Player): number {
  if (state.over || state.turn !== me) return -1
  const board = state.board.slice()
  if (!board.some((v) => v === 0)) return -1
  const opp = flip(me)

  // 1) 自己能连成五子，直接赢
  const ownWin = winningCells(board, me)
  if (ownWin.length > 0) return rankMoves(board, ownWin, me, 1, state.rng)[0]

  // 2) 对手下一手能成五，必须堵（这一步同时覆盖「冲四」与「活三逼叫」）
  const oppWin = winningCells(board, opp)
  if (oppWin.length > 0) return rankMoves(board, oppWin, me, 1, state.rng)[0]

  // 3) 其余局面：候选裁剪 + alpha-beta 搜索（胜 → 堵四 → 造三 → 防守 都由它自然涌现）
  const moves = rankMoves(board, candidatePool(board), me, ROOT_CANDIDATES, state.rng)
  if (moves.length === 0) return emptyCells(board)[0]

  const ctx: SearchCtx = { nodes: 0, aborted: false, tt: new Map() }
  let best = -Infinity
  let bestCell = moves[0]
  for (const c of moves) {
    board[c] = me
    const value =
      winsAt(board, c, me).length > 0 ? WIN_SCORE : -negamax(board, opp, SEARCH_DEPTH - 1, -Infinity, Infinity, ctx)
    board[c] = 0
    if (value > best) {
      best = value
      bestCell = c
    }
    if (ctx.aborted) break
  }
  return bestCell
}

/** 轮到电脑（白）时返回落子动作，否则返回 null */
export function aiAction(state: State): Action | null {
  if (state.over || state.turn !== COMPUTER) return null
  const cell = bestMoveFor(state, COMPUTER)
  return cell < 0 ? null : { type: 'place', cell }
}

/** 提示按钮用：返回玩家当前局面下的建议落点，-1 表示无建议 */
export function advise(state: State): number {
  return bestMoveFor(state, HUMAN)
}