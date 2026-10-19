/** 四子棋规则（纯逻辑，零 DOM 依赖，可在 node 环境单测） */

export const COLS = 7
export const ROWS = 6

export type Player = 1 | 2
/** 0 = 空，1 = 玩家（黑），2 = 电脑（白） */
export type Cell = 0 | Player

export interface State {
  /** 一维棋盘，索引 = row * COLS + col，row 0 在最底部 */
  board: Cell[]
  turn: Player
  over: boolean
  /** 0 表示平局或未结束 */
  winner: Player | 0
  /** 获胜的四连棋格索引，用于高亮 */
  winCells: number[]
  lastMove: number
  moves: number
  /** 指针悬停的列，-1 表示无 */
  hover: number
  rng: number
}

export type Action =
  | { type: 'drop'; col: number }
  | { type: 'hover'; col: number }
  | { type: 'leave' }

export const idx = (col: number, row: number): number => row * COLS + col
export const colOf = (i: number): number => i % COLS
export const rowOf = (i: number): number => Math.floor(i / COLS)

export function create(seed: number): State {
  return {
    board: new Array<Cell>(COLS * ROWS).fill(0),
    turn: 1,
    over: false,
    winner: 0,
    winCells: [],
    lastMove: -1,
    moves: 0,
    hover: -1,
    rng: seed | 0,
  }
}

export function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS
}

/** 该列还能落子时返回目标行号，否则 -1 */
export function dropRow(board: readonly Cell[], col: number): number {
  if (col < 0 || col >= COLS) return -1
  for (let r = 0; r < ROWS; r++) if (board[idx(col, r)] === 0) return r
  return -1
}

/** 当前可落子的列 */
export function legalColumns(board: readonly Cell[]): number[] {
  const out: number[] = []
  for (let c = 0; c < COLS; c++) if (dropRow(board, c) >= 0) out.push(c)
  return out
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], // 横
  [0, 1], // 竖
  [1, 1], // 右斜
  [1, -1], // 左斜
]

/** 若 player 已有四连，返回该四连的棋格索引；否则空数组 */
export function findWin(board: readonly Cell[], player: Player): number[] {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[idx(c, r)] !== player) continue
      for (const [dc, dr] of DIRS) {
        // 以当前格为最左/最下端起点，避免重复
        if (inBounds(c - dc, r - dr) && board[idx(c - dc, r - dr)] === player) continue
        const cells = [idx(c, r)]
        let ok = true
        for (let k = 1; k < 4; k++) {
          const cc = c + dc * k
          const rr = r + dr * k
          if (!inBounds(cc, rr) || board[idx(cc, rr)] !== player) {
            ok = false
            break
          }
          cells.push(idx(cc, rr))
        }
        if (ok) return cells
      }
    }
  }
  return []
}

export function isFull(board: readonly Cell[]): boolean {
  for (let c = 0; c < COLS; c++) if (dropRow(board, c) >= 0) return false
  return true
}

/**
 * 列出 player 下一手可以直接获胜的棋格索引（落子后即成四连）。
 * 用于 AI 判断「必须立刻堵住」的格子。
 */
export function winningCells(board: readonly Cell[], player: Player): number[] {
  const out: number[] = []
  for (const col of legalColumns(board)) {
    const r = dropRow(board, col)
    const next = board.slice()
    next[idx(col, r)] = player
    if (findWin(next, player).length > 0) out.push(idx(col, r))
  }
  return out
}

/** 纯函数状态迁移 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'leave':
      return state.hover === -1 ? state : { ...state, hover: -1 }

    case 'hover': {
      if (state.over || state.hover === action.col) return state
      return { ...state, hover: action.col }
    }

    case 'drop': {
      if (state.over) return state
      const col = action.col
      if (col < 0 || col >= COLS) return state
      const row = dropRow(state.board, col)
      if (row < 0) return state
      const board = state.board.slice()
      const at = idx(col, row)
      board[at] = state.turn
      const winCells = findWin(board, state.turn)
      const over = winCells.length > 0 || isFull(board)
      return {
        ...state,
        board,
        turn: state.turn === 1 ? 2 : 1,
        over,
        winner: winCells.length > 0 ? state.turn : 0,
        winCells,
        lastMove: at,
        moves: state.moves + 1,
        hover: state.hover,
      }
    }
  }
}

/** 落子的直观别名，便于测试与 AI 复用同一入口 */
export function drop(state: State, col: number): State {
  return reduce(state, { type: 'drop', col })
}

/**
 * AI：与规则共享同一个 reduce —— 每个候选动作都通过 reduce 试算，
 * 绝不维护第二套规则逻辑。
 * 优先级：自己立刻获胜 > 堵住对手下一手成四 > 造三/连线价值 > 靠近中心。
 */
export function aiAction(state: State): Action | null {
  if (state.over || state.turn !== 2) return null
  const legal = legalColumns(state.board)
  if (legal.length === 0) return null

  // 1) 自己能赢就直接赢
  for (const col of legal) {
    if (reduce(state, { type: 'drop', col }).winner === 2) return { type: 'drop', col }
  }

  // 2) 对手存在「下一手就能成四」的落点时，必须优先堵住
  //    注意：直接取对手的获胜点，而不是「落了子之后对手还有没有获胜点」——
  //    后者会把 3、4、5 列都算成「没堵住」，从而放弃唯一正确的第 3 列。
  const threats = winningCells(state.board, 1).map(colOf)
  if (threats.length > 0) {
    let bestCol = threats[0]
    let best = -Infinity
    for (const col of threats) {
      const s = positionValue(state.board, col, 2)
      if (s > best) {
        best = s
        bestCol = col
      }
    }
    return { type: 'drop', col: bestCol }
  }

  // 3) 普通局面：走价值最高的一格
  let bestCol = legal[0]
  let best = -Infinity
  for (const col of legal) {
    const s = positionValue(state.board, col, 2)
    if (s > best) {
      best = s
      bestCol = col
    }
  }
  return { type: 'drop', col: bestCol }
}

/** 中心偏好：3 列 → 最高 */
function centerBonus(col: number): number {
  return 12 - Math.abs(col - 3) * 4
}

/** 在 col 落子后，该落点四个方向的连线价值（越大越好） */
function positionValue(board: readonly Cell[], col: number, me: Player): number {
  const row = dropRow(board, col)
  if (row < 0) return -Infinity
  const probe = board.slice()
  const at = idx(col, row)
  probe[at] = me
  let score = centerBonus(col)
  const opp: Player = me === 1 ? 2 : 1

  for (const [dc, dr] of DIRS) {
    let own = 1
    let open = 0
    for (const sign of [1, -1] as const) {
      let c = col + dc * sign
      let r = row + dr * sign
      let run = 0
      while (inBounds(c, r) && probe[idx(c, r)] === me) {
        run++
        c += dc * sign
        r += dr * sign
      }
      own += run
      if (run > 0 && inBounds(c, r) && probe[idx(c, r)] === 0) {
        open++
        c += dc * sign
        r += dr * sign
        if (inBounds(c, r) && probe[idx(c, r)] === 0) open++
      }
    }
    // open 个空位意味着这条线的威胁程度
    if (own >= 4) score += 1_000_000
    else if (own === 3 && open >= 1) score += 1200
    else if (own === 2 && open >= 1) score += open === 2 ? 120 : 40
    else if (own === 1 && open === 2) score += 8

    // 对方在这条线上已经三连且有空位 = 危险
    let oppRun = 0
    for (const sign of [1, -1] as const) {
      let c = col + dc * sign
      let r = row + dr * sign
      let run = 0
      while (inBounds(c, r) && probe[idx(c, r)] === opp) {
        run++
        c += dc * sign
        r += dr * sign
      }
      oppRun = Math.max(oppRun, run)
    }
    if (oppRun >= 2) score -= oppRun >= 3 ? 2000 : 150
  }
  return score
}