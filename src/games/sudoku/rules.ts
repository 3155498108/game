/**
 * 数独规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 三条硬约定：
 * - 随机数一律用 core/rng 的 Rng，rng 状态（32 位整数）放在 State.rng；
 *   题面由 seed 生成 → 同种子必得同一题（每日挑战靠这个）。
 * - 本文件不读时间、不用 Math.random()、不碰 DOM，reduce 因此完全可复盘。
 * - 数独不是实时游戏：没有墙上时钟，也不提供 tick。
 *
 * 盘面表示：长度 81 的一维数组，下标 i = 行 * 9 + 列；0 表示空格，1~9 是数字。
 * 玩家填的数、题面给的数、候选数各存一份，冲突与「检查」的结果分两个数组：
 *  - conflict：自动检测（同行/同列/同宫出现重复），每次落子后整体重算；
 *  - wrong：「检查」的结果（与完整解不符），只在该格被改动时清掉。
 * 渲染层把两者合起来当作「标红」。
 */
import { Rng } from '../../core/rng'

/** 边长：9×9 */
export const SIDE = 9
/** 格数：81 */
export const CELLS = SIDE * SIDE
/** 目标空格数：挖到这么多就收工（实际受「唯一解」约束，通常落在 28~40） */
export const TARGET_BLANKS = 40
/** 唯一性检查的节点上限：超了就是「没证明唯一」，这一格 conservatively 不挖 */
const DIG_NODE_BUDGET = 200_000
/** 公开求解器的节点上限（兜底防死循环，正常盘面远达不到） */
const SOLVE_NODE_BUDGET = 5_000_000
/** 数字位掩码：第 d 位代表数字 d（d = 1..9） */
const FULL_MASK = 0x3fe

// ---------------- 坐标换算 ----------------

/** 第 i 格的行号（0~8） */
export function rowOf(i: number): number {
  return Math.floor(i / SIDE)
}

/** 第 i 格的列号（0~8） */
export function colOf(i: number): number {
  return i % SIDE
}

/** 第 i 格所属的 3×3 宫（0~8） */
export function boxOf(i: number): number {
  return Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3)
}

// ---------------- 状态 ----------------

export interface State {
  /** 题面（81 个数，0 是空格） */
  puzzle: number[]
  /** 完整解（81 个数，1~9） */
  solution: number[]
  /** 玩家当前盘面（81 个数，0 是空格） */
  values: number[]
  /** 哪些格是题面给的（不能改） */
  given: boolean[]
  /** 每格的候选数字（升序） */
  notes: number[][]
  /** 自动冲突：与同行/同列/同宫重复 */
  conflict: boolean[]
  /** 「检查」标错：与完整解不符 */
  wrong: boolean[]
  /** 是否用过「检查」（用过才给填对的格标绿） */
  checked: boolean
  /** 当前选中格，-1 表示没有 */
  selected: number
  /** 笔记模式：数字面板改为记候选 */
  noteMode: boolean
  /** 提示次数 */
  hints: number
  /** 是否通关 */
  over: boolean
  /** rng 状态（32 位整数） */
  rng: number
}

export type Action =
  /** 选中第 index 格（0~80） */
  | { type: 'select'; index: number }
  /** 在选中格填 value（0 = 擦除） */
  | { type: 'place'; value: number }
  /** 切换选中格的候选数字 value（1~9） */
  | { type: 'toggleNote'; value: number }
  /** 开关笔记模式 */
  | { type: 'toggleNoteMode' }
  /** 填一个正确数字 */
  | { type: 'hint' }
  /** 标出与完整解冲突的格子 */
  | { type: 'check' }
  /** 换一题（rng 推进到下一个种子） */
  | { type: 'newGame' }

/** 难度名（按空格数分档） */
export type Difficulty = '入门' | '简单' | '中等'

// ---------------- 求解器 ----------------

/**
 * 候选掩码的置位数表：候选数个数是热点，用查表代替逐位计数。
 * 注意掩码用的是第 1~9 位（值 1~9），最大 0x3FE = 1022，表要开到 1024。
 */
const POP = (() => {
  const t = new Uint8Array(1024)
  for (let m = 0; m < t.length; m++) {
    let c = 0
    let x = m
    while (x !== 0) {
      x &= x - 1
      c += 1
    }
    t[m] = c
  }
  return t
})()

/**
 * 每格的伙伴数：同行 8 + 同列 8 + 同宫 8 = 24 条记录，但去重后只有 20 个伙伴
 * （行与宫重叠 2 格、列与宫重叠 2 格）。
 *
 * 必须去重：伙伴表里同一格出现两次时，回滚栈会先后存下「改之前的值」和
 * 「改之后的值」，还原时后者覆盖前者 → 那个数字被永久抹掉 → 求解器会漏解。
 */
const PEER_COUNT = 20

/** 每格的 20 个伙伴（不重复），落子时批量改候选 */
const PEERS = (() => {
  const t = new Int32Array(CELLS * PEER_COUNT)
  let p = 0
  for (let i = 0; i < CELLS; i++) {
    const r = rowOf(i)
    const c = colOf(i)
    const br = r - (r % 3)
    const bc = c - (c % 3)
    const seen = new Set<number>()
    const push = (j: number): void => {
      if (j === i || seen.has(j)) return
      seen.add(j)
      t[p] = j
      p += 1
    }
    for (let k = 0; k < SIDE; k++) push(r * SIDE + k)
    for (let k = 0; k < SIDE; k++) push(k * SIDE + c)
    for (let dr = 0; dr < 3; dr++) {
      for (let dc = 0; dc < 3; dc++) push((br + dr) * SIDE + bc + dc)
    }
  }
  return t
})()

interface SearchCtx {
  /** 可变的盘面（搜索过程中被改写） */
  board: number[]
  /** 每格的候选数字掩码（增量维护，比每步重算快一个量级） */
  cand: Int32Array
  /** 空格下标（固定长度，用 nEmpty 标记有效段） */
  empties: Int32Array
  /** 有效空格数 */
  nEmpty: number
  /** 落子回滚栈：每次落子存 1 + 20 个旧候选值 */
  stack: Int32Array
  /** 栈顶 */
  top: number
  /** 已找到的解数 */
  count: number
  /** 第一个解的快照 */
  first: number[] | null
  /** 已访问的节点数 */
  nodes: number
  /** 节点上限 */
  budget: number
  /** 是否因为超预算而中断（中断 = 没证明唯一） */
  aborted: boolean
}

/**
 * 建立搜索现场。盘面本身有冲突（同行/同列/同宫重复）时直接判无解。
 */
function buildCtx(board: readonly number[], budget: number): SearchCtx | null {
  if (board.length !== CELLS) return null
  const row = new Array<number>(SIDE).fill(0)
  const col = new Array<number>(SIDE).fill(0)
  const box = new Array<number>(SIDE).fill(0)
  const cand = new Int32Array(CELLS)
  const empties = new Int32Array(CELLS)
  let n = 0
  for (let i = 0; i < CELLS; i++) {
    const v = board[i]
    if (!Number.isInteger(v)) return null
    const r = rowOf(i)
    const c = colOf(i)
    const b = boxOf(i)
    if (v === 0) {
      empties[n] = i
      n += 1
      continue
    }
    if (v < 1 || v > 9) return null
    const bit = 1 << v
    if ((row[r] & bit) !== 0 || (col[c] & bit) !== 0 || (box[b] & bit) !== 0) return null
    row[r] |= bit
    col[c] |= bit
    box[b] |= bit
  }
  for (let k = 0; k < n; k++) {
    const i = empties[k]
    cand[i] = ~(row[rowOf(i)] | col[colOf(i)] | box[boxOf(i)]) & FULL_MASK
  }
  return {
    board: board.slice(),
    cand,
    empties,
    nEmpty: n,
    stack: new Int32Array((PEER_COUNT + 1) * (CELLS + 1)),
    top: 0,
    count: 0,
    first: null,
    nodes: 0,
    budget,
    aborted: false,
  }
}

/** 落子：记下受影响格子的旧候选，再把这个数字从伙伴的候选里去掉 */
function place(ctx: SearchCtx, i: number, d: number): void {
  const bit = 1 << d
  const off = i * PEER_COUNT
  const st = ctx.stack
  let t = ctx.top
  st[t] = ctx.cand[i]
  t += 1
  for (let k = 0; k < PEER_COUNT; k++) {
    const p = PEERS[off + k]
    st[t] = ctx.cand[p]
    t += 1
    ctx.cand[p] &= ~bit
  }
  ctx.top = t
  ctx.board[i] = d
  ctx.cand[i] = 0
}

/** 回滚：候选值原样还原（不能凭「补一位」还原——有些伙伴本来就没有这个候选） */
function unplace(ctx: SearchCtx, i: number): void {
  const off = i * PEER_COUNT
  const st = ctx.stack
  const t = ctx.top - (PEER_COUNT + 1)
  ctx.cand[i] = st[t]
  for (let k = 0; k < PEER_COUNT; k++) ctx.cand[PEERS[off + k]] = st[t + 1 + k]
  ctx.top = t
  ctx.board[i] = 0
}

/**
 * 回溯搜索：每步挑「候选数字最少」的空格（MRV），候选为 0 立刻回溯。
 * 数到 limit 个解就停 —— 唯一性判定只需要知道「有没有第二个解」。
 */
function search(ctx: SearchCtx, limit: number): number {
  ctx.nodes += 1
  if (ctx.nodes > ctx.budget) {
    ctx.aborted = true
    return ctx.count
  }
  if (ctx.nEmpty === 0) {
    ctx.count += 1
    if (ctx.first === null) ctx.first = ctx.board.slice()
    return ctx.count
  }

  let bestK = 0
  let bestMask = 0
  let bestCount = 10
  for (let k = 0; k < ctx.nEmpty; k++) {
    const i = ctx.empties[k]
    const m = ctx.cand[i]
    if (m === 0) return ctx.count
    const c = POP[m]
    if (c < bestCount) {
      bestCount = c
      bestK = k
      bestMask = m
      if (c === 1) break
    }
  }

  const i = ctx.empties[bestK]
  const last = ctx.nEmpty - 1
  const tail = ctx.empties[last]
  for (let d = 1; d <= 9; d++) {
    const bit = 1 << d
    if ((bestMask & bit) === 0) continue
    place(ctx, i, d)
    // 把这格挪到有效段之外，递归只碰 [0, nEmpty)
    ctx.empties[bestK] = tail
    ctx.empties[last] = i
    ctx.nEmpty = last
    search(ctx, limit)
    ctx.nEmpty = last + 1
    ctx.empties[bestK] = i
    ctx.empties[last] = tail
    unplace(ctx, i)
    if (ctx.count >= limit || ctx.aborted) return ctx.count
  }
  return ctx.count
}

/** 解出一个盘面，无解返回 null（不修改入参） */
export function solve(board: readonly number[]): number[] | null {
  const ctx = buildCtx(board, SOLVE_NODE_BUDGET)
  if (ctx === null) return null
  return search(ctx, 1) > 0 ? ctx.first : null
}

/** 数解的个数，最多数到 limit 个就停 */
export function countSolutions(board: readonly number[], limit = 2): number {
  const ctx = buildCtx(board, SOLVE_NODE_BUDGET)
  if (ctx === null) return 0
  return search(ctx, limit)
}

/** 盘面是否恰好只有一个解 */
export function hasUniqueSolution(board: readonly number[]): boolean {
  return countSolutions(board, 2) === 1
}

// ---------------- 出题 ----------------

/** 生成 0..n-1 的随机置换 */
function shuffledOrder(r: Rng, n: number): number[] {
  return r.shuffle(Array.from({ length: n }, (_, i) => i))
}

/**
 * 随机回溯生成一个完整合法解。
 *
 * 关键取舍：**格子顺序固定（行优先），随机的是每格选哪个数字**。
 * 随机格子顺序会让回溯爆炸（实测一题要跑几分钟），固定顺序则是毫秒级。
 * 生成完再整体做一次随机置换（带内换行、宫内换列、换带/宫、换数字），
 * 这样解的分布依然足够散，不会每次都长得像同一道题。
 */
export function generateSolution(r: Rng): number[] {
  const board = new Array<number>(CELLS).fill(0)
  const row = new Array<number>(SIDE).fill(0)
  const col = new Array<number>(SIDE).fill(0)
  const box = new Array<number>(SIDE).fill(0)
  fillSolution(board, row, col, box, 0, r)

  const bands = r.shuffle([0, 1, 2])
  const stacks = r.shuffle([0, 1, 2])
  const rowsIn = [r.shuffle([0, 1, 2]), r.shuffle([0, 1, 2]), r.shuffle([0, 1, 2])]
  const colsIn = [r.shuffle([0, 1, 2]), r.shuffle([0, 1, 2]), r.shuffle([0, 1, 2])]
  const digits = r.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8])
  const out = new Array<number>(CELLS).fill(0)
  for (let r0 = 0; r0 < SIDE; r0++) {
    const nr = bands[Math.floor(r0 / 3)] * 3 + rowsIn[Math.floor(r0 / 3)][r0 % 3]
    for (let c0 = 0; c0 < SIDE; c0++) {
      const nc = stacks[Math.floor(c0 / 3)] * 3 + colsIn[Math.floor(c0 / 3)][c0 % 3]
      out[nr * SIDE + nc] = digits[board[r0 * SIDE + c0] - 1] + 1
    }
  }
  return out
}

function fillSolution(
  board: number[],
  row: number[],
  col: number[],
  box: number[],
  k: number,
  r: Rng,
): boolean {
  if (k === CELLS) return true
  const i = k
  const ri = rowOf(i)
  const ci = colOf(i)
  const bi = boxOf(i)
  const used = row[ri] | col[ci] | box[bi]
  const candidates: number[] = []
  for (let d = 1; d <= 9; d++) if ((used & (1 << d)) === 0) candidates.push(d)
  if (candidates.length === 0) return false
  for (const d of r.shuffle(candidates)) {
    const bit = 1 << d
    board[i] = d
    row[ri] |= bit
    col[ci] |= bit
    box[bi] |= bit
    if (fillSolution(board, row, col, box, k + 1, r)) return true
    row[ri] &= ~bit
    col[ci] &= ~bit
    box[bi] &= ~bit
    board[i] = 0
  }
  return false
}

/**
 * 按 rng 决定的顺序逐格挖空：挖掉之后解仍然唯一才保留这个空格。
 *
 * 多轮扫：挖掉一格会让别的空格从「被唯一确定」变成「可推可不推」，
 * 所以第一轮失败的格子在后面几轮可能就能挖了（多轮通常能多挖 3~6 格）。
 */
export function digPuzzle(r: Rng, solution: readonly number[], target: number): number[] {
  const puzzle = solution.slice()
  let blanks = 0
  for (let pass = 0; pass < 8 && blanks < target; pass++) {
    const order = shuffledOrder(r, CELLS)
    let removed = 0
    for (const i of order) {
      if (blanks >= target) break
      if (puzzle[i] === 0) continue
      const backup = puzzle[i]
      puzzle[i] = 0
      if (isUniqueWithBudget(puzzle, DIG_NODE_BUDGET)) {
        blanks += 1
        removed += 1
      } else {
        puzzle[i] = backup
      }
    }
    if (removed === 0) break
  }
  return puzzle
}

/** 唯一性判定 + 节点预算：超预算时保守地返回 false（没证明唯一就不算唯一） */
function isUniqueWithBudget(board: readonly number[], budget: number): boolean {
  const ctx = buildCtx(board, budget)
  if (ctx === null) return false
  return search(ctx, 2) === 1 && !ctx.aborted
}

/**
 * 出一道题：生成解 → 挖空。
 *
 * 挖空受「唯一解」约束，贪心挖到底往往只有 30 格上下，
 * 所以最多试 4 次（每次都是毫秒级），挑空格最多的那次。
 */
export function generatePuzzle(r: Rng, target: number): { puzzle: number[]; solution: number[] } {
  let bestPuzzle: number[] = []
  let bestSolution: number[] = []
  let bestBlanks = -1
  for (let attempt = 0; attempt < 4; attempt++) {
    const solution = generateSolution(r)
    const puzzle = digPuzzle(r, solution, target)
    const blanks = blankCount(puzzle)
    if (blanks > bestBlanks) {
      bestBlanks = blanks
      bestPuzzle = puzzle
      bestSolution = solution
    }
    if (blanks >= target) break
  }
  return { puzzle: bestPuzzle, solution: bestSolution }
}

// ---------------- 盘面判定 ----------------

/** 盘面里的空格数 */
export function blankCount(puzzle: readonly number[]): number {
  let n = 0
  for (let i = 0; i < puzzle.length; i++) if (puzzle[i] === 0) n += 1
  return n
}

/** 难度档（按空格数） */
export function difficultyOf(puzzle: readonly number[]): Difficulty {
  const blanks = blankCount(puzzle)
  if (blanks >= 36) return '中等'
  if (blanks >= 30) return '简单'
  return '入门'
}

/**
 * 自动冲突：与同行、同列或同宫里另一个格子重复的数字，两格都算冲突。
 */
export function computeConflicts(values: readonly number[]): boolean[] {
  const out = new Array<boolean>(CELLS).fill(false)
  for (let i = 0; i < CELLS; i++) {
    const v = values[i]
    if (!v) continue
    const r = rowOf(i)
    const c = colOf(i)
    for (let k = 0; k < SIDE; k++) {
      const j = r * SIDE + k
      if (j !== i && values[j] === v) {
        out[i] = true
        out[j] = true
      }
      const l = k * SIDE + c
      if (l !== i && values[l] === v) {
        out[i] = true
        out[l] = true
      }
    }
    const br = r - (r % 3)
    const bc = c - (c % 3)
    for (let dr = 0; dr < 3; dr++) {
      for (let dc = 0; dc < 3; dc++) {
        const j = (br + dr) * SIDE + bc + dc
        if (j !== i && values[j] === v) {
          out[i] = true
          out[j] = true
        }
      }
    }
  }
  return out
}

/** 盘面是否全部填对（题面给定的格不算在内） */
export function isSolved(values: readonly number[], solution: readonly number[], given: readonly boolean[]): boolean {
  for (let i = 0; i < CELLS; i++) {
    if (given[i]) continue
    if (values[i] !== solution[i]) return false
  }
  return true
}

/** 该格是否标红：自动冲突 或「检查」标错 */
export function isRed(s: State, i: number): boolean {
  return s.conflict[i] || s.wrong[i]
}

/** 玩家已经填了几格（不含题面给定的） */
export function filledCount(s: State): number {
  let n = 0
  for (let i = 0; i < CELLS; i++) if (!s.given[i] && s.values[i] !== 0) n += 1
  return n
}

/** 分数：空格越多分越高，用一次提示扣 50 分 */
export function scoreOf(s: State): number {
  return Math.max(0, 1000 + blankCount(s.puzzle) * 10 - s.hints * 50)
}

// ---------------- 初始状态与迁移 ----------------

function emptyFlags(): boolean[] {
  return new Array<boolean>(CELLS).fill(false)
}

function emptyNotes(): number[][] {
  return Array.from({ length: CELLS }, (): number[] => [])
}

/** 开局：按种子出一道题 */
export function create(seed: number): State {
  const r = new Rng(seed)
  const { puzzle, solution } = generatePuzzle(r, TARGET_BLANKS)
  return {
    puzzle,
    solution,
    values: puzzle.slice(),
    given: puzzle.map((v) => v !== 0),
    notes: emptyNotes(),
    conflict: emptyFlags(),
    wrong: emptyFlags(),
    checked: false,
    selected: -1,
    noteMode: false,
    hints: 0,
    over: false,
    rng: r.s,
  }
}

/** 纯函数状态迁移 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'select': {
      if (state.over) return state
      const i = action.index
      if (!Number.isInteger(i) || i < 0 || i >= CELLS) return state
      if (state.selected === i) return state
      return { ...state, selected: i }
    }

    case 'place': {
      if (state.over) return state
      const v = action.value
      if (!Number.isInteger(v) || v < 0 || v > 9) return state
      const i = state.selected
      if (i < 0) return state
      if (state.given[i]) return state
      // 再点同一个数字 = 擦除
      const next = state.values[i] === v ? 0 : v
      if (next === state.values[i]) return state
      const values = state.values.slice()
      values[i] = next
      const notes = state.notes.slice()
      if (next !== 0) notes[i] = []
      const wrong = state.wrong.slice()
      wrong[i] = false
      const conflict = computeConflicts(values)
      return { ...state, values, notes, wrong, conflict, over: isSolved(values, state.solution, state.given) }
    }

    case 'toggleNote': {
      if (state.over) return state
      const v = action.value
      if (!Number.isInteger(v) || v < 1 || v > 9) return state
      const i = state.selected
      if (i < 0) return state
      if (state.given[i]) return state
      const cur = state.notes[i]
      const next = cur.indexOf(v) >= 0 ? cur.filter((d) => d !== v) : cur.concat([v]).sort((a, b) => a - b)
      const notes = state.notes.slice()
      notes[i] = next
      return { ...state, notes }
    }

    case 'toggleNoteMode': {
      if (state.over) return state
      return { ...state, noteMode: !state.noteMode }
    }

    case 'hint': {
      if (state.over) return state
      // 找第一格没填对的（空格优先按顺序；已经填错的那格也会被改正）
      let target = -1
      for (let i = 0; i < CELLS; i++) {
        if (state.given[i]) continue
        if (state.values[i] !== state.solution[i]) {
          target = i
          break
        }
      }
      if (target < 0) return state
      const values = state.values.slice()
      values[target] = state.solution[target]
      const notes = state.notes.slice()
      notes[target] = []
      const wrong = state.wrong.slice()
      wrong[target] = false
      const conflict = computeConflicts(values)
      return {
        ...state,
        values,
        notes,
        wrong,
        conflict,
        hints: state.hints + 1,
        over: isSolved(values, state.solution, state.given),
      }
    }

    case 'check': {
      if (state.over) return state
      const wrong = emptyFlags()
      for (let i = 0; i < CELLS; i++) {
        if (state.given[i]) continue
        const v = state.values[i]
        if (v !== 0 && v !== state.solution[i]) wrong[i] = true
      }
      return { ...state, wrong, checked: true }
    }

    case 'newGame': {
      // rng 推进一格得到新种子 → 换一题（同一条操作序列必得同一串题）
      const r = new Rng(state.rng)
      const seed = (r.next() * 0x100000000) | 0
      const fresh = create(seed)
      return { ...fresh, rng: r.s }
    }
  }
}
