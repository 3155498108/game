/**
 * 6 连珠规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 设计要点：
 * - 连线用「路径」表示：path 是球格子索引的数组，首元素为起点球，末元素为当前连到的球。
 * - 八邻域吸附、防自交、回退截断全部在 reduce 内完成，渲染层只负责画 state.path，
 *   因此同一 seed 的对局可以完整复盘。
 * - 动画与计时不进 state：消除动画由渲染层用 anim.elapsedSince 按 clears + 格子索引做。
 * - 无解判定（洪泛整盘）比较贵，只在消除补球之后做一次，并带 SHUFFLE_LIMIT 次上限兜底。
 * - 随机全部走 core/rng 的 Rng，种子由 create(seed) 注入，禁止 Math.random。
 */
import { Rng } from '../../core/rng'

export const COLS = 7
export const ROWS = 9
/** 棋盘总格数 */
export const CELL_COUNT = COLS * ROWS
/** 球色种类数（越多越难出 4 连，也越容易触发洗牌） */
export const COLORS = 6
/** 连到几个球即可消除 */
export const MATCH_MIN = 4
/** 空格取值 */
export const EMPTY = 0
/** 无解时最多重洗次数；用尽仍无解则判定本局结束（兜底，避免无限洗牌） */
export const SHUFFLE_LIMIT = 12

export interface State {
  /** 每格的球色：0 为空，1..COLORS 为球色。索引 = row * COLS + col */
  cells: number[]
  /** 当前连线路径（球格子索引），空数组表示没有正在进行的连线 */
  path: number[]
  /** 指针悬停的格子，-1 表示无 */
  hoverCell: number
  /** 最近一次消除的格子索引，仅用于渲染做消除反馈 */
  lastCleared: number[]
  /** 成功消除的次数（渲染动画的签名来源，不参与规则） */
  clears: number
  /** 当前连击：连续成功消除的次数 */
  combo: number
  /** 历史最高连击 */
  bestCombo: number
  /** 总分 */
  score: number
  /** 洗牌总次数（自动 + 手动） */
  shuffles: number
  /** 当前这块棋盘已尝试的洗牌次数，棋盘重新变得有解时归零 */
  shuffleTries: number
  /** 本局是否结束（兜底：重洗用尽仍无解） */
  over: boolean
  /** 可播种随机数状态，保证同一 seed 可完整复盘 */
  rng: number
}

export type Action =
  /** 按下：若落在球上则以该球为起点新建一条路径 */
  | { type: 'down'; cell: number }
  /** 拖动：更新悬停，并按指针所在格的八邻域吸附同色球 / 回退截断 */
  | { type: 'move'; cell: number }
  /** 松手：路径达到 MATCH_MIN 则消除并补球，否则丢弃路径 */
  | { type: 'up' }
  /** 主动洗牌 */
  | { type: 'shuffle' }

// ---------------- 棋盘基础工具 ----------------

export function cellOf(col: number, row: number): number {
  return row * COLS + col
}

export function colOf(index: number): number {
  return index % COLS
}

export function rowOf(index: number): number {
  return Math.floor(index / COLS)
}

/** 格子索引是否合法（顺带排除小数与 NaN） */
export function inBounds(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < CELL_COUNT
}

/**
 * 八邻域内所有合法格子的索引。
 * 顺序固定（左上、上、右上、左、右、左下、下、右下），保证吸附多候选时的选择可复盘。
 */
export function neighbors(index: number): number[] {
  const row = rowOf(index)
  const col = colOf(index)
  const out: number[] = []
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      const r = row + dr
      const c = col + dc
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue
      out.push(cellOf(c, r))
    }
  }
  return out
}

/** 各色球的初始数量：63 格平均分给 6 色，前 3 色各 11 个、后 3 色各 10 个 */
export function colorQuota(): number[] {
  const base = Math.floor(CELL_COUNT / COLORS)
  const extra = CELL_COUNT - base * COLORS
  return Array.from({ length: COLORS }, (_, c) => base + (c < extra ? 1 : 0))
}

// ---------------- 初始局面 ----------------

/** 初始棋盘：按配额铺满整盘（球色数量严格均衡）后用种子洗牌 */
export function create(seed: number): State {
  const quota = colorQuota()
  const deck: number[] = []
  for (let c = 0; c < COLORS; c++) for (let k = 0; k < quota[c]; k++) deck.push(c + 1)
  const r = new Rng(seed)
  const cells = r.shuffle(deck)
  return {
    cells,
    path: [],
    hoverCell: -1,
    lastCleared: [],
    clears: 0,
    combo: 0,
    bestCombo: 0,
    score: 0,
    shuffles: 0,
    shuffleTries: 0,
    over: false,
    rng: r.s,
  }
}

// ---------------- 补球 ----------------

/**
 * 从顶部补球：逐列、每列自上而下扫描，遇到空格就补一颗新球。
 * - 每列补出来的球自上而下依次落到各空位，等价于新球从顶部投入后落满整列；
 * - 补球数量恰好等于空位数量，因此「补球后总球数守恒」；
 * - 新球颜色由传入的 Rng 决定，不影响入参 cells。
 */
export function refillFromTop(cells: readonly number[], r: Rng): number[] {
  const out = cells.slice()
  for (let c = 0; c < COLS; c++) {
    for (let row = 0; row < ROWS; row++) {
      const i = cellOf(c, row)
      if (out[i] === EMPTY) out[i] = r.int(COLORS) + 1
    }
  }
  return out
}

// ---------------- 无解判定 ----------------

/** 同色球按八邻域连通，块大小达到 MATCH_MIN 即存在合法消除 */
export function hasAnyMoveIn(cells: readonly number[]): boolean {
  const seen = new Array<boolean>(CELL_COUNT).fill(false)
  for (let start = 0; start < CELL_COUNT; start++) {
    if (seen[start] || cells[start] === EMPTY) continue
    const color = cells[start]
    const stack: number[] = [start]
    seen[start] = true
    let size = 0
    while (stack.length > 0) {
      const cur = stack.pop()
      if (cur === undefined) break
      size++
      if (size >= MATCH_MIN) return true
      for (const n of neighbors(cur)) {
        if (seen[n] || cells[n] !== color) continue
        seen[n] = true
        stack.push(n)
      }
    }
  }
  return false
}

export function hasAnyMove(state: State): boolean {
  return hasAnyMoveIn(state.cells)
}

/** 洗牌：只重排球色，各色球数（以及空位数量）完全不变 */
export function shuffleBoard(state: State): State {
  const r = new Rng(state.rng)
  return {
    ...state,
    cells: r.shuffle(state.cells),
    lastCleared: [],
    shuffles: state.shuffles + 1,
    shuffleTries: state.shuffleTries + 1,
    rng: r.s,
  }
}

/**
 * 无解兜底：当前棋盘没有合法消除时自动洗牌，直到出现可消除的排列；
 * 尝试 SHUFFLE_LIMIT 次仍无解则判定本局结束。
 * 棋盘重新变得有解时把重试计数归零。
 */
export function ensureSolvable(state: State): State {
  if (state.over) return state
  if (hasAnyMove(state)) return state.shuffleTries === 0 ? state : { ...state, shuffleTries: 0 }
  const r = new Rng(state.rng)
  let s = state
  let tries = state.shuffleTries
  while (tries < SHUFFLE_LIMIT && !hasAnyMove(s)) {
    s = { ...s, cells: r.shuffle(s.cells), lastCleared: [], shuffles: s.shuffles + 1 }
    tries++
  }
  return { ...s, shuffleTries: tries, over: tries >= SHUFFLE_LIMIT && !hasAnyMove(s), rng: r.s }
}

// ---------------- 吸附 ----------------

/**
 * 判断从 `from` 连到 `to` 的这一段是否会与已有路径**几何相交**（自交）。
 *
 * 路径是八邻域的折线，相邻两球之间可能是一段「直线」（横/竖）或一段「斜线」。
 * 两段相交只有两种可能：
 *   1. 共享端点 —— 已被「同格不重入」挡住；
 *   2. **两条斜边构成一个 2×2 方块的对角线** —— 例如下标 A(1,0)→B(2,1) 与
 *      C(2,0)→D(1,1)，两条对角线在方块正中相交，但四个端点互不相同。
 * 横/竖段之间、以及横竖与斜线之间，只要不共享端点就不会真正相交
 * （斜线从一个角到对角，只在角上与横竖段接触，那属于情况 1）。
 *
 * 因此只需检测情况 2：两段都是斜线，且构成同一个 2×2 方块的对角线。
 */
function crossesSegment(
  from: number,
  to: number,
  s0: number,
  s1: number,
): boolean {
  // 只有斜线才可能相交
  const dc1 = colOf(to) - colOf(from)
  const dr1 = rowOf(to) - rowOf(from)
  if (dr1 === 0 || dc1 === 0) return false
  const dc2 = colOf(s1) - colOf(s0)
  const dr2 = rowOf(s1) - rowOf(s0)
  if (dr2 === 0 || dc2 === 0) return false

  // 两段斜线的端点是否恰好是同一个 2×2 方块的四个角：
  // 用 (col+row, col-row) 的极值范围判定方块的包围盒是否与新段相同
  const minC = Math.min(colOf(from), colOf(to))
  const maxC = Math.max(colOf(from), colOf(to))
  const minR = Math.min(rowOf(from), rowOf(to))
  const maxR = Math.max(rowOf(from), rowOf(to))

  const sMinC = Math.min(colOf(s0), colOf(s1))
  const sMaxC = Math.max(colOf(s0), colOf(s1))
  const sMinR = Math.min(rowOf(s0), rowOf(s1))
  const sMaxR = Math.max(rowOf(s0), rowOf(s1))

  // 同一个 2×2 方块
  if (minC !== sMinC || maxC !== sMaxC || minR !== sMinR || maxR !== sMaxR) return false

  // 同一组对角线上则重合（会被「同格不重入」提前拦下，这里只处理另一条对角线）
  const sameDiagonal =
    (colOf(from) === colOf(s0) && colOf(to) === colOf(s1)) ||
    (colOf(from) === colOf(s1) && colOf(to) === colOf(s0))
  return !sameDiagonal
}

/**
 * 新增一段 `from → to` 后，路径 `next` 是否合法：
 *   - 不自交：与已有的每一段都不几何相交；
 *   - 不成环：新球不能与**起点**相邻（否则首尾相接闭合成圈）。
 *
 * 规格第 22 条要求「连线时不允许自交」；成环一并禁掉是因为六连珠的环会绕开
 * 「越长越难」的设计意图，让 4 个球围成一个小圈就能消除。
 */
export function pathIsValid(next: readonly number[]): boolean {
  const n = next.length
  if (n < 2) return true
  const last = next[n - 1]
  const prev = next[n - 2]

  // 成环：新球与**起点**相邻即闭合。门槛看的是「加入之后」的长度 ——
  // 4 球连线才刚够消除，此时闭环才成立；只有 2~3 球时绕回起点旁边是正常的折线。
  if (n >= MATCH_MIN &&
      Math.abs(colOf(last) - colOf(next[0])) <= 1 &&
      Math.abs(rowOf(last) - rowOf(next[0])) <= 1) {
    return false
  }

  for (let i = 0; i + 1 < n; i++) {
    if (crossesSegment(prev, last, next[i], next[i + 1])) return false
  }
  return true
}

/**
 * 在指针所在格 pointer 的八邻域内，寻找与路径末球同色、且尚未出现在路径中的球。
 * 候选还必须满足「加入后路径不自交、不成环」——这才是规格要求的防自交守卫。
 * 找不到返回 -1。
 */
export function snapTarget(state: State, pointer: number): number {
  const path = state.path
  const last = path[path.length - 1]
  const color = state.cells[last]
  if (color === EMPTY) return -1
  for (const n of neighbors(pointer)) {
    if (state.cells[n] !== color) continue
    if (path.indexOf(n) >= 0) continue
    if (!pathIsValid(path.concat(n))) continue
    return n
  }
  return -1
}

/** 消除得分：球数越多、连击越长越高 */
export function scoreOf(count: number, combo: number): number {
  return count * count * 5 + (combo - 1) * 20
}

// ---------------- 状态迁移 ----------------

/** 纯函数状态迁移：相同输入产生完全相同的输出，且绝不修改入参 */
export function reduce(state: State, action: Action): State {
  // 本局结束后不再接受任何操作（重开交给站点壳的「新的一局」）
  if (state.over) return state

  switch (action.type) {
    case 'down': {
      // 落在空格、越界、小数上视为无效按下，直接丢弃（不打断已有路径以外的东西）
      if (!inBounds(action.cell) || state.cells[action.cell] === EMPTY) return state
      if (state.path.length === 1 && state.path[0] === action.cell) return state
      return { ...state, path: [action.cell], hoverCell: action.cell }
    }

    case 'move': {
      const hover = inBounds(action.cell) ? action.cell : -1
      if (state.path.length === 0) {
        return state.hoverCell === hover ? state : { ...state, hoverCell: hover }
      }
      if (hover < 0) return state.hoverCell === -1 ? state : { ...state, hoverCell: -1 }

      const path = state.path
      const last = path[path.length - 1]
      if (hover === last) return state.hoverCell === hover ? state : { ...state, hoverCell: hover }

      let next: number[]
      if (path.length >= 2 && hover === path[path.length - 2]) {
        // 回退：拖回上一个球时截断路径，让玩家能改掉连错的线
        next = path.slice(0, -1)
      } else {
        const target = snapTarget(state, hover)
        if (target < 0) return state.hoverCell === hover ? state : { ...state, hoverCell: hover }
        next = path.concat(target)
      }
      return { ...state, path: next, hoverCell: hover }
    }

    case 'up': {
      const path = state.path
      // 连不到 4 个：丢弃路径并断掉连击；压根没连线就松手则什么都不做
      if (path.length < MATCH_MIN) {
        if (path.length === 0) return state
        return { ...state, path: [], combo: 0, lastCleared: [] }
      }
      // 消除：置空 → 从顶部补球 → 无解则自动洗牌
      const cleared = state.cells.slice()
      for (const i of path) cleared[i] = EMPTY
      const r = new Rng(state.rng)
      const combo = state.combo + 1
      const next: State = {
        ...state,
        cells: refillFromTop(cleared, r),
        path: [],
        lastCleared: path.slice(),
        clears: state.clears + 1,
        combo,
        bestCombo: Math.max(state.bestCombo, combo),
        score: state.score + scoreOf(path.length, combo),
        shuffleTries: 0,
        rng: r.s,
      }
      return ensureSolvable(next)
    }

    case 'shuffle':
      // 主动洗牌同样要走一次无解兜底，保证不会洗出一块死局
      return ensureSolvable(shuffleBoard(state))

    default:
      return state
  }
}
