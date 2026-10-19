/**
 * 中国跳棋规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 一、棋盘几何：星形（六芒星）棋盘用**字符串地图**定义，渲染与输入共用同一份格子表。
 * - 地图 13 行 × 13 列，行 = 六角坐标 r（-6..6），列 = 六角坐标 q（-6..6）
 * - 字符含义：'#'=没有孔，'.'=空孔，'a'=玩家起始区，'b'=电脑起始区，'*'=中心星格（目标格）
 *   （棋子不写进地图，开局由 create() 按 'a' / 'b' 摆子，所以不需要 'A' / 'B'）
 * - 中央是半径 3 的六边形（37 格）+ 六条尖角臂，每条臂 6 格（3+2+1），共 73 格
 * - 六角邻接：(q,r) 的六个邻居是 (q,r±1)、(q±1,r)、(q+1,r-1)、(q-1,r+1)
 *   （正好是任务书给的 (dc,dr) = [(0,1),(1,0),(1,-1),(0,-1),(-1,0),(-1,1)]）
 *
 * 二、胜负口径（歧义裁决，全部写在这里，测试直接断言）：
 * - 每一家的底区中央都有一个星格：HOME_STAR[p] = 紧贴该家起始三角正前方的那一格（中央六边形内）。
 *   例：玩家家在左侧（W 臂），它的星格是 (-3,1)；电脑家在右侧（E 臂），星格是 (3,-1)。
 * - **占领「对方家的中心星格」即获胜**：targetOf(p) = HOME_STAR[对手(p)]。
 *   之所以不是「占领自己家的星格」：自家星格就在自家门口，棋子一出门就能踏上去，
 *   按「自己家即胜」会让先手一步秒胜，游戏直接失效。因此星格归属哪家，
 *   目标就指向对方家的那一颗——与规格原文「占领对方底区中央的星星格」一致。
 *
 * 三、行动口径：
 * - 一步 = 滑一格到相邻空格，或一次**完整的连跳链**（连跳不能被对手打断，也不能中途停下，
 *   所以整条链算一个 action；path 记录依次经过的全部格）。
 * - 跳跃合法性：中间格必须是**敌方棋子**，落点必须是**空格**。中间是己方子不可跳，落点被占不可跳。
 * - 有吃必吃（标准中国跳棋）：只要存在跳跃，就不生成滑行选项。
 * - 连跳搜索的终止保证：`seen` 记录本步已经落过的所有格（含起点），每跳一次集合必增 1，
 *   而格子总数有限（73），因此递归深度 ≤ 73，必然终止；同一颗子被吃掉后立刻从工作盘移除，
 *   不会被重复跳过。工作盘上起点始终保留本子，落点自然回不到起点。
 * - 中国跳棋没有升变，reduce 结算时不做任何升变判断。
 */
import { Rng } from '../../core/rng'

export type Player = 1 | 2

/** 玩家（黄）先行 */
export const FIRST: Player = 1
/** 电脑执蓝 */
export const AI: Player = 2
/** 每方棋子数 = 起始三角的格数 */
export const PIECES_EACH = 6

export function opponent(p: Player): Player {
  return p === 1 ? 2 : 1
}

/** 0 = 普通空孔；1 = 玩家起始区；2 = 电脑起始区；3 = 中心星格（目标格） */
export const KIND_PLAIN = 0
export const KIND_STAR = 3

// ---------------- 棋盘地图 ----------------

/**
 * 棋盘地图（星形棋盘）：共 73 个孔 = 中央六边形 37 + 六条尖角臂各 6。
 * 行 r 从 -6 到 6，列 q 从 -6 到 6（字符串下标 = 坐标 + 6）。
 * '#' = 那一格没有孔（故意不用空格，免得被格式化工具悄悄吃掉）。
 */
export const MAP: readonly string[] = [
  '######.#####.', // r = -6
  '######.###..#', // r = -5
  '#####..#...##', // r = -4
  '#####.....###', // r = -3
  '####......b##', // r = -2
  '####.....*bb#', // r = -1  电脑家的中心星格在 (q=3)
  'aaa.......bbb', // r =  0
  '#aa*.....####', // r =  1  玩家家的中心星格在 (q=-3)
  '##a......####', // r =  2
  '###.....#####', // r =  3
  '##...#..#####', // r =  4
  '#..###.######', // r =  5
  '.#####.######', // r =  6
]

export const MAP_ROWS = 13
export const MAP_COLS = 13
/** 坐标原点在地图里的偏移 */
const Q0 = 6
const R0 = 6

/** 六角邻接偏移（Δq, Δr） */
const HEX_DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
]

/** (r * MAP_COLS + c) → 紧凑格子编号，-1 表示不是孔 */
const ID_TABLE = new Int8Array(MAP_ROWS * MAP_COLS).fill(-1)
const Q_LIST: number[] = []
const R_LIST: number[] = []
const KIND_LIST: number[] = []

/** 地图字符 → 格子类型；'#' 不是孔，其余都是 */
function kindOfChar(ch: string): 0 | 1 | 2 | 3 | -1 {
  if (ch === '#') return -1
  if (ch === '.') return KIND_PLAIN
  if (ch === 'a') return 1
  if (ch === 'b') return 2
  if (ch === '*') return KIND_STAR
  return KIND_PLAIN
}

for (let r = 0; r < MAP_ROWS; r++) {
  for (let c = 0; c < MAP_COLS; c++) {
    const kind = kindOfChar(MAP[r].charAt(c))
    if (kind === -1) continue
    ID_TABLE[r * MAP_COLS + c] = Q_LIST.length
    Q_LIST.push(c - Q0)
    R_LIST.push(r - R0)
    KIND_LIST.push(kind)
  }
}

/** 全盘孔位总数（73） */
export const CELL_COUNT = Q_LIST.length

/** (q, r) → 格子编号；越界或不是孔返回 -1 */
export function idAt(q: number, r: number): number {
  if (!Number.isInteger(q) || !Number.isInteger(r)) return -1
  if (q < -Q0 || q > Q0 || r < -R0 || r > R0) return -1
  return ID_TABLE[(r + R0) * MAP_COLS + (q + Q0)]
}

/** 格子编号 → 六角列坐标 */
export function qOf(id: number): number {
  return id >= 0 && id < CELL_COUNT ? Q_LIST[id] : -1
}

/** 格子编号 → 六角行坐标 */
export function rOf(id: number): number {
  return id >= 0 && id < CELL_COUNT ? R_LIST[id] : -1
}

/** 格子的地图类型：0 = 普通空孔，1 = 玩家家，2 = 电脑家，3 = 中心星格 */
export function kindOf(id: number): 0 | 1 | 2 | 3 {
  if (id < 0 || id >= CELL_COUNT) return KIND_PLAIN
  return KIND_LIST[id] as 0 | 1 | 2 | 3
}

/** 六角邻接表：格子编号 → 相邻格编号（渲染与输入、规则共用） */
export const NEIGHBORS: ReadonlyArray<ReadonlyArray<number>> = Q_LIST.map((q, id) => {
  const out: number[] = []
  for (const [dq, dr] of HEX_DIRS) {
    const n = idAt(q + dq, R_LIST[id] + dr)
    if (n >= 0) out.push(n)
  }
  return out
})

/** 玩家起始三角（6 格）与电脑起始三角（6 格） */
export const HOME_CELLS: ReadonlyArray<ReadonlyArray<number>> = [
  [],
  Q_LIST.map((_, id) => id).filter((id) => KIND_LIST[id] === 1),
  Q_LIST.map((_, id) => id).filter((id) => KIND_LIST[id] === 2),
]

/** 从 from 出发的六角距离（BFS 广度优先，格子数很少，够快） */
function bfsDist(from: number): number[] {
  const dist = new Array<number>(CELL_COUNT).fill(-1)
  if (from < 0 || from >= CELL_COUNT) return dist
  dist[from] = 0
  const queue: number[] = [from]
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
    for (const n of NEIGHBORS[cur]) {
      if (dist[n] >= 0) continue
      dist[n] = dist[cur] + 1
      queue.push(n)
    }
  }
  return dist
}

/** 两格之间的六角距离（非法格返回一个大数） */
export function hexDistRaw(a: number, b: number): number {
  if (a < 0 || b < 0 || a >= CELL_COUNT || b >= CELL_COUNT) return 99
  return bfsDist(a)[b]
}

/** 每一家的中心星格：地图上 '*' 标记的格子，归属「离它最近的那一家」 */
export const HOME_STAR: Readonly<Record<Player, number>> = (() => {
  const starIds: number[] = []
  for (let id = 0; id < CELL_COUNT; id++) if (KIND_LIST[id] === KIND_STAR) starIds.push(id)
  const owner = (star: number): Player => {
    let best: Player = 1
    let bestD = Infinity
    for (const p of [1, 2] as const) {
      let d = 0
      for (const home of HOME_CELLS[p]) d += hexDistRaw(star, home)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return best
  }
  const out: number[] = [-1, -1, -1]
  for (const star of starIds) out[owner(star)] = star
  return { 1: out[1], 2: out[2] }
})()

/** 胜利目标：p 的目标是对手家的中心星格 */
export function targetOf(p: Player): number {
  return HOME_STAR[opponent(p)]
}

/** 全盘六角距离表（预计算一次，AI 评分高频调用） */
const DIST_TABLE: number[][] = (() => {
  const out: number[][] = []
  for (let s = 0; s < CELL_COUNT; s++) out.push(bfsDist(s))
  return out
})()

/** 两格之间的六角距离（非法格返回一个大数） */
export function hexDist(a: number, b: number): number {
  if (a < 0 || b < 0 || a >= CELL_COUNT || b >= CELL_COUNT) return 99
  return DIST_TABLE[a][b]
}

/** 从 from 沿方向 d 走 k 格（k=1 相邻、k=2 跳过落点），越界返回 -1 */
function hop(from: number, d: number, k: number): number {
  const dir = HEX_DIRS[d]
  if (!dir) return -1
  return idAt(qOf(from) + dir[0] * k, rOf(from) + dir[1] * k)
}

/** 某一格上的棋子归属：0 = 空，1 / 2 = 玩家 / 电脑 */
export function ownerOf(c: number): Player | 0 {
  return c === 1 || c === 2 ? c : 0
}

// ---------------- 走法 ----------------

/** 一整步：单步滑行或一条完整的连跳链 */
export interface Move {
  from: number
  /** 落点；恒等于 path 的最后一个元素 */
  to: number
  /** 完整路径：path[0] === from；单步滑行时 path = [from, to] */
  path: number[]
  /** 本步吃掉的敌子格，顺序与跳跃顺序一致 */
  captures: number[]
}

/** 单步连跳链的防御性上限：全盘只有 12 颗子，正常远达不到 */
const MAX_CHAINS = 400
/** 单步连跳的最大跳数（理论上限 = 对手子数） */
const MAX_CHAIN_LEN = 20

/**
 * 枚举某颗棋子的全部连跳链。
 * 终止保证：seen 记录本步已经落过的所有格（含起点），每跳一次必增 1，格子数有限 ⇒ 必然终止。
 * 被吃掉的敌子立刻从工作盘移除，同一步内不会被重复跳过。
 */
function jumpChains(cells: readonly number[], from: number, player: Player): Move[] {
  const foe = opponent(player)
  const b = cells.slice()
  const seen = new Set<number>([from])
  const path: number[] = [from]
  const caps: number[] = []
  const out: Move[] = []

  const walk = (at: number): void => {
    if (out.length >= MAX_CHAINS || path.length >= MAX_CHAIN_LEN) return
    for (let d = 0; d < HEX_DIRS.length; d++) {
      const mid = hop(at, d, 1)
      if (mid < 0 || b[mid] !== foe) continue // 中间格必须是敌方棋子
      const dst = hop(at, d, 2)
      if (dst < 0 || b[dst] !== 0 || seen.has(dst)) continue // 落点必须是空格，且本步不重复落格
      b[mid] = 0 // 吃子：立刻移除
      path.push(dst)
      caps.push(mid)
      seen.add(dst)
      out.push({ from, to: dst, path: path.slice(), captures: caps.slice() })
      walk(dst)
      seen.delete(dst)
      caps.pop()
      path.pop()
      b[mid] = foe
      if (out.length >= MAX_CHAINS) return
    }
  }

  walk(from)
  return out
}

/**
 * 某颗棋子的全部合法走法。
 * 有吃必吃：存在跳跃时只返回跳跃链（标准中国跳棋规则），否则返回滑一格的选项。
 */
export function movesFrom(cells: readonly number[], from: number, player: Player): Move[] {
  if (from < 0 || from >= CELL_COUNT || cells[from] !== player) return []
  const jumps = jumpChains(cells, from, player)
  if (jumps.length > 0) return jumps
  const out: Move[] = []
  for (const n of NEIGHBORS[from]) if (cells[n] === 0) out.push({ from, to: n, path: [from, n], captures: [] })
  return out
}

/** 某一方在给定盘面上的全部合法走法 */
export function movesOf(cells: readonly number[], player: Player): Move[] {
  const out: Move[] = []
  for (let id = 0; id < CELL_COUNT; id++) {
    if (cells[id] !== player) continue
    for (const m of movesFrom(cells, id, player)) out.push(m)
  }
  return out
}

/** 指定棋子、指定落点的那一步（渲染层做「选中 → 点落点」时复用同一入口） */
export function findMove(cells: readonly number[], from: number, to: number, player: Player): Move | null {
  for (const m of movesFrom(cells, from, player)) if (m.to === to) return m
  return null
}

export function moveToAction(m: Move): Action {
  return { type: 'move', from: m.from, to: m.to, path: m.path.slice() }
}

// ---------------- 状态 ----------------

/** 最近一手，供渲染层沿 path 逐格播放动画（落点结果已由 state 定好，动画不进 state） */
export interface LastMove {
  player: Player
  from: number
  to: number
  path: number[]
  captures: number[]
}

export interface State {
  /** 73 个格子：0 = 空，1 = 玩家，2 = 电脑 */
  cells: number[]
  turn: Player
  /** 玩家选中的己方棋子格号，-1 表示未选中 */
  selected: number
  last: LastMove | null
  over: boolean
  /** 0 表示未结束 */
  winner: Player | 0
  moves: number
  rng: number
}

export type Action =
  /** 选中己方棋子（第一段：挑出发起点） */
  | { type: 'select'; from: number }
  /** 走完整的一步（第二段）：整条连跳链一次结算完 */
  | { type: 'move'; from: number; to: number; path: number[] }
  /** 取消选中 */
  | { type: 'clear' }
  /** 提示：替玩家随机走一步合法棋（走 Rng，种子来自 state.rng） */
  | { type: 'hint' }

export function create(seed: number): State {
  const cells = new Array<number>(CELL_COUNT).fill(0)
  for (const id of HOME_CELLS[1]) cells[id] = 1
  for (const id of HOME_CELLS[2]) cells[id] = 2
  return {
    cells,
    turn: FIRST,
    selected: -1,
    last: null,
    over: false,
    winner: 0,
    moves: 0,
    rng: seed | 0,
  }
}

/** 盘面上某方的棋子数 */
export function countPieces(cells: readonly number[], player: Player): number {
  let n = 0
  for (let id = 0; id < CELL_COUNT; id++) if (cells[id] === player) n++
  return n
}

/** 当前行动方在当前盘面上的全部合法动作（AI 只能从这里选） */
export function legalActions(state: State): Action[] {
  if (state.over) return []
  return movesOf(state.cells, state.turn).map(moveToAction)
}

function sameSeq(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** 纯函数状态迁移：不修改入参 */
export function reduce(state: State, action: Action): State {
  if (state.over) return state

  switch (action.type) {
    case 'select': {
      if (state.turn !== 1) return state
      if (!Number.isInteger(action.from) || action.from < 0 || action.from >= CELL_COUNT) return state
      if (state.cells[action.from] !== 1) return state
      if (movesFrom(state.cells, action.from, 1).length === 0) return state
      if (state.selected === action.from) return state
      return { ...state, selected: action.from }
    }

    case 'clear':
      return state.selected === -1 ? state : { ...state, selected: -1 }

    case 'hint': {
      if (state.turn !== 1) return state
      const cands = legalActions(state)
      if (cands.length === 0) return state
      const r = new Rng(state.rng)
      const pick = cands[r.int(cands.length)]
      const next = reduce(state, pick)
      return next === state ? state : { ...next, rng: r.s }
    }

    case 'move': {
      // 合法性校验：重新走一遍同一套走法生成，保证 AI 与玩家共用一条规则路径
      const mv = movesFrom(state.cells, action.from, state.turn).find(
        (m) => m.to === action.to && sameSeq(m.path, action.path),
      )
      if (!mv) return state

      const cells = state.cells.slice() // 拷贝，绝不就地改入参
      cells[mv.from] = 0
      for (const c of mv.captures) cells[c] = 0
      cells[mv.to] = state.turn

      const foe = opponent(state.turn)
      // 占领对方家的中心星格即胜；没有升变判定
      const won = cells[targetOf(state.turn)] === state.turn
      const foeStuck = countPieces(cells, foe) === 0 || movesOf(cells, foe).length === 0
      const over = won || foeStuck
      const last: LastMove = {
        player: state.turn,
        from: mv.from,
        to: mv.to,
        path: mv.path.slice(),
        captures: mv.captures.slice(),
      }

      return {
        ...state,
        cells,
        selected: -1,
        last,
        turn: over ? state.turn : foe,
        over,
        winner: over ? state.turn : 0,
        moves: state.moves + 1,
      }
    }
  }
}

// ---------------- AI ----------------

/** 一步直接取胜的权重，必须压过其他所有因素 */
const W_WIN = 1_000_000
/** 每吃掉一颗敌子的权重：必须压过「推进一格」的收益，AI 才会见子就吃 */
const W_CAPTURE = 900
/** 己方棋子到目标星格的距离，每格的距离和扣这么多分 */
const W_ADVANCE = 110
/** 对手棋子到「它自己的目标」的距离和，每格加这么多分（堵路） */
const W_DENY = 6

/**
 * AI：与规则共享同一个 reduce —— 每个候选动作都真正试算一遍，不维护第二套规则逻辑。
 * 6 颗子 + 连跳的分支因子已经足够大，不做深度 minimax，用四层启发式：
 *   1) 能一步踩上目标星格 → 直接取胜（压倒一切）
 *   2) 能吃子 → 吃（吃子权重 900 > 推进一格的收益）
 *   3) 距离自家目标星格越近越好（己方全部棋子到目标星的距离和）
 *   4) 尽量把对手的棋子挡在它自己的目标星格外面，同分用可播种随机打散
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
  const foe = opponent(me)
  if (next.over) return next.winner === me ? W_WIN : -W_WIN
  const caps = countPieces(prev.cells, foe) - countPieces(next.cells, foe)
  const advance = sumDist(next.cells, me, targetOf(me))
  const deny = sumDist(next.cells, foe, targetOf(foe))
  return caps * W_CAPTURE - advance * W_ADVANCE + deny * W_DENY + rng.next() * 3
}

/** 某方全部棋子到目标格的六角距离和（目标格被自己占住时自然为 0） */
function sumDist(cells: readonly number[], player: Player, target: number): number {
  let d = 0
  for (let id = 0; id < CELL_COUNT; id++) if (cells[id] === player) d += hexDist(id, target)
  return d
}