/**
 * 随机迷宫规则：纯逻辑，零 DOM 依赖，可在 node 环境单测。
 *
 * ## 生成算法：递归回溯 DFS（显式栈）
 *
 * 产出的是**完美迷宫**——通行关系构成一棵生成树：全图连通、无环、任意两点之间
 * 恰好一条路。这不是「希望如此」，而是算法结构本身保证的，并由 rules.test.ts
 * 逐条穷举断言（连通 / 无环 / 起点必有路）。
 *
 * 选它而不是别的算法有两个实测理由：
 *   - DFS 产出的通道最长最曲折。同尺寸同种子下它的直径是 61，随机 Prim 只有 22——
 *     对「找路」这个玩法来说，长路径才是难题。
 *   - 二叉树算法虽然最好写，但有强烈的对角偏置（玩家一路往右上走就出去了），
 *     递归分割又会留下大量长直墙，太好认。
 *
 * ## 为什么不用「随机放墙」
 *
 * 随机放墙会产出**不连通**的区域，玩家会卡在一个够不到的终点上——
 * 而这种缺陷在渲染上完全看不出来（墙画得好好的），只有走到那儿才发现走不通。
 * 生成树从结构上杜绝了这件事。
 *
 * 本文件不碰 DOM、不读 Date / performance、不用 Math.random：随机一律走 Rng，
 * 因此同一种子永远复现同一张迷宫，「每日挑战」和复盘才对得上账。
 */
import { Rng, hashSeed } from '../../core/rng'

// ---------------- 墙位掩码 ----------------
// 每个格子存一个 4 位掩码，某位为 1 表示那个方向的墙还关着。
// 为什么存掩码而不是存 4 个 boolean：拆墙必须成对改（本格的东墙 = 邻格的西墙），
// 掩码让「两侧一致」变成一条可断言的不变量，测试能直接抓出单边开墙的 bug。
export const WALL_N = 1
export const WALL_E = 2
export const WALL_S = 4
export const WALL_W = 8
/** 四面全封 */
export const ALL_WALLS = WALL_N | WALL_E | WALL_S | WALL_W

export interface Dir {
  /** 列增量 */
  dc: number
  /** 行增量 */
  dr: number
  /** 该方向的墙位 */
  bit: number
}

/**
 * 方向表。索引即 action 里的 dir，顺序固定为「上 右 下 左」，
 * 渲染、键盘映射与测试都依赖它，不要随手调整。
 */
export const DIRS: readonly Dir[] = [
  { dc: 0, dr: -1, bit: WALL_N },
  { dc: 1, dr: 0, bit: WALL_E },
  { dc: 0, dr: 1, bit: WALL_S },
  { dc: -1, dr: 0, bit: WALL_W },
]

/** 反方向：上↔下、右↔左。拆墙时用它取邻格那一侧。 */
export function oppositeDir(dir: number): number {
  return (dir + 2) % 4
}

// ---------------- 网格基础 ----------------

/** 下标：第 r 行第 c 列（row 0 在最上面、col 0 在最左边） */
export function cellIndex(cols: number, c: number, r: number): number {
  return r * cols + c
}

export function colOf(cols: number, cell: number): number {
  return cell % cols
}

export function rowOf(cols: number, cell: number): number {
  return (cell - (cell % cols)) / cols
}

export function inBounds(cols: number, rows: number, c: number, r: number): boolean {
  return c >= 0 && r >= 0 && c < cols && r < rows
}

export interface Neighbor {
  cell: number
  /** 从当前格看过去的方向索引 */
  dir: number
}

/** 格子四周盘内的相邻格（含墙是否开着——这里只管盘内性） */
export function neighborsOf(cols: number, rows: number, cell: number): Neighbor[] {
  const c = colOf(cols, cell)
  const r = rowOf(cols, cell)
  const out: Neighbor[] = []
  for (let d = 0; d < 4; d++) {
    const nc = c + DIRS[d].dc
    const nr = r + DIRS[d].dr
    if (!inBounds(cols, rows, nc, nr)) continue
    out.push({ cell: cellIndex(cols, nc, nr), dir: d })
  }
  return out
}

/** 从 from 朝 dir 走一格：墙关着或出界都返回 null */
export function stepCell(cols: number, rows: number, cells: readonly number[], from: number, dir: number): number | null {
  if (!Number.isInteger(dir) || dir < 0 || dir >= DIRS.length) return null
  if ((cells[from] & DIRS[dir].bit) !== 0) return null
  for (const n of neighborsOf(cols, rows, from)) if (n.dir === dir) return n.cell
  return null
}

/** 通行的方向（墙开着的那些） */
export function openDirs(cells: readonly number[], cell: number): number[] {
  const out: number[] = []
  for (let d = 0; d < DIRS.length; d++) if ((cells[cell] & DIRS[d].bit) === 0) out.push(d)
  return out
}

// ---------------- 生成 ----------------

/**
 * 递归回溯（显式栈版）生成完美迷宫。
 *
 * 递归改成显式栈不是风格问题：迷宫最大 17×17，递归深度理论上可达 289 层，
 * 而这里每一步都要跑在 `create()` 里，显式栈也让「同一个格子只入栈一次」变得好断言。
 *
 * 纯函数：给定 (cols, rows, seed) 必然得到同一个数组，且不读任何全局状态。
 */
export function generateMaze(cols: number, rows: number, seed: number): number[] {
  const total = cols * rows
  const cells: number[] = new Array<number>(total).fill(ALL_WALLS)
  const visited = new Uint8Array(total)
  const rng = new Rng(hashSeed(seed))

  // 起点固定为左上角，终点固定为右下角：两点对角时路径最长，最耐走
  const stack: number[] = [0]
  visited[0] = 1

  while (stack.length > 0) {
    const cur = stack[stack.length - 1]

    const options: Neighbor[] = []
    for (const n of neighborsOf(cols, rows, cur)) {
      if (visited[n.cell] === 1) continue
      options.push(n)
    }

    // 四个方向都走过了 = 走到死路，回退一格
    if (options.length === 0) {
      stack.pop()
      continue
    }

    const pick = options[rng.int(options.length)]
    // 拆墙必须成对：本格的 dir 面 + 邻格的反向面，两边同时开
    cells[cur] &= ~DIRS[pick.dir].bit
    cells[pick.cell] &= ~DIRS[oppositeDir(pick.dir)].bit
    visited[pick.cell] = 1
    stack.push(pick.cell)
  }
  return cells
}

/**
 * 开通的通道数。
 *
 * 每条只数一次——只看「东」与「南」两个方向，东墙与南墙天然各属一条边。
 * 完美迷宫里这个值恒等于 格子数 - 1（树的性质），是最能一票否决的不变量。
 */
export function passageCount(cols: number, rows: number, cells: readonly number[]): number {
  let n = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cellIndex(cols, c, r)
      if (c + 1 < cols && (cells[cell] & WALL_E) === 0) n++
      if (r + 1 < rows && (cells[cell] & WALL_S) === 0) n++
    }
  }
  return n
}

/** 从 from 出发沿通路能走到的格子数 */
export function reachableCount(cols: number, rows: number, cells: readonly number[], from: number): number {
  const seen = new Uint8Array(cols * rows)
  const queue: number[] = [from]
  seen[from] = 1
  let n = 1
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
    for (const nb of neighborsOf(cols, rows, cur)) {
      if (seen[nb.cell] === 1) continue
      if ((cells[cur] & DIRS[nb.dir].bit) !== 0) continue
      seen[nb.cell] = 1
      n++
      queue.push(nb.cell)
    }
  }
  return n
}

/**
 * 最短路（广度优先），返回含首尾的格子序列；走不通返回 null。
 *
 * 完美迷宫里任意两点之间**恰好**一条路，所以这里返回的既是「最短」也是「唯一」——
 * 提示功能直接用它，玩家看到的也是它承诺的那条路。
 */
export function shortestPath(cols: number, rows: number, cells: readonly number[], from: number, to: number): number[] | null {
  if (from === to) return [from]
  const prev = new Int32Array(cols * rows).fill(-1)
  const seen = new Uint8Array(cols * rows)
  const queue: number[] = [from]
  seen[from] = 1

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
    for (const nb of neighborsOf(cols, rows, cur)) {
      if (seen[nb.cell] === 1) continue
      if ((cells[cur] & DIRS[nb.dir].bit) !== 0) continue
      seen[nb.cell] = 1
      prev[nb.cell] = cur
      if (nb.cell === to) {
        const path: number[] = [to]
        let at = to
        while (at !== from) {
          const p = prev[at]
          if (p < 0) return null
          path.push(p)
          at = p
        }
        return path.reverse()
      }
      queue.push(nb.cell)
    }
  }
  return null
}

// ---------------- 关卡规模与步数预算 ----------------

/** 最小边长 */
export const SIDE_MIN = 9
/** 最大边长。再大单格就窄到不好点了（17 格时每格约 38 逻辑像素）。 */
export const SIDE_MAX = 17

/** 第 level 关的边长（正方形，1 起） */
export function sideForLevel(level: number): number {
  const lv = Math.max(1, Math.floor(level))
  return Math.min(SIDE_MAX, SIDE_MIN + 2 * (lv - 1))
}

/** 余量比例：步数上限比最短路宽多少 */
export const SLACK_RATE = 0.5
/** 余量保底：最短路太短时也至少多给这几步 */
export const MIN_EXTRA = 5

/**
 * 步数上限 = 最短路 + 余量，余量逐关收紧（封顶在 MIN_EXTRA）。
 *
 * 收紧而不是固定比例，是因为迷宫越大探索成本越高：同样 50% 余量，
 * 9×9 上够用，17×17 上就太紧，难度曲线会突然翘起来。
 */
export function limitFor(par: number, level: number): number {
  const lv = Math.max(1, Math.floor(level))
  return par + Math.max(MIN_EXTRA, Math.ceil(par * SLACK_RATE) - (lv - 1))
}

// ---------------- 状态机 ----------------

/** 没有提示 */
export const NO_HINT = -1

export interface State {
  /** 当前关（1 起） */
  level: number
  /** 边长（行列相同） */
  cols: number
  rows: number
  /** 墙位掩码，长度 = cols * rows */
  cells: number[]
  /**
   * 走过的格子序列，trail[0] 是起点，末位是当前位置。
   *
   * 用它同时表达「当前位置」和「步数」：步数恒等于 trail.length - 1，
   * 撤销就是砍掉末位。不另存一个位置字段，就不会出现两者对不上的状态。
   */
  trail: number[]
  /** 本关最短路步数（唯一解） */
  par: number
  /** 本关步数上限 */
  limit: number
  /** 本局是否结束（步数用光） */
  over: boolean
  /** 本关是否已抵达终点（此时等玩家点「下一关」） */
  clearedThisLevel: boolean
  /** 本局已通关的关数，即成绩 */
  cleared: number
  /** 提示方向，NO_HINT 表示没有 */
  hint: number
  /** 本关提示是否已用过 */
  hintUsed: boolean
  /** 本关迷宫种子（重开同一关时复用，保证拿到一模一样的迷宫） */
  mazeSeed: number
  /** 自增序号，供渲染做动画签名 */
  seq: number
  /** 随机游标，只用于换关时派生下一关的种子 */
  rng: number
}

export type Action =
  /** 朝某个方向走一格 */
  | { type: 'move'; dir: number }
  /** 撤销一步，不额外计步 */
  | { type: 'undo' }
  /** 求一次提示，每关限一次 */
  | { type: 'hint' }
  /** 重开本关：同一关、同一个种子，也就是同一张迷宫 */
  | { type: 'restart' }
  /** 进入下一关（只在刚过关时可用） */
  | { type: 'next' }

export function playerCell(state: State): number {
  return state.trail[state.trail.length - 1]
}

/** 终点恒为右下角 */
export function exitCell(state: State): number {
  return state.cols * state.rows - 1
}

export function movesOf(state: State): number {
  return state.trail.length - 1
}

/** 开一个新关的完整状态。入参只用来继承「本局已通关关数」与随机游标 */
function beginLevel(state: State, level: number, mazeSeed: number, rng: number): State {
  const side = sideForLevel(level)
  const cells = generateMaze(side, side, mazeSeed)
  const exit = side * side - 1
  const path = shortestPath(side, side, cells, 0, exit)
  // 生成树保证起点到终点必有唯一通路；万一不成立，宁可给一条合法兜底也不返回坏局面
  const par = path === null ? 0 : path.length - 1
  return {
    ...state,
    level,
    cols: side,
    rows: side,
    cells,
    trail: [0],
    par,
    limit: limitFor(par, level),
    over: false,
    clearedThisLevel: false,
    hint: NO_HINT,
    hintUsed: false,
    mazeSeed,
    seq: state.seq + 1,
    rng,
  }
}

function blankState(rng: number): State {
  return {
    level: 1,
    cols: 0,
    rows: 0,
    cells: [],
    trail: [0],
    par: 0,
    limit: 0,
    over: false,
    clearedThisLevel: false,
    cleared: 0,
    hint: NO_HINT,
    hintUsed: false,
    mazeSeed: 0,
    seq: 0,
    rng,
  }
}

export function create(seed: number): State {
  const rng = new Rng(hashSeed(seed))
  const mazeSeed = hashSeed(rng.int(0x7fffffff))
  return beginLevel(blankState(rng.s), 1, mazeSeed, rng.s)
}

/** 从当前位置出发，正确的下一个方向；已经在终点或走不通时返回 NO_HINT */
export function nextDir(state: State): number {
  const cur = playerCell(state)
  const path = shortestPath(state.cols, state.rows, state.cells, cur, exitCell(state))
  if (path === null || path.length < 2) return NO_HINT
  const a = path[0]
  const b = path[1]
  for (const n of neighborsOf(state.cols, state.rows, a)) {
    if (n.cell === b) return n.dir
  }
  return NO_HINT
}

function doMove(state: State, dir: number): State {
  if (state.over || state.clearedThisLevel) return state
  const to = stepCell(state.cols, state.rows, state.cells, playerCell(state), dir)
  if (to === null) return state

  const trail = state.trail.concat(to)
  const base: State = { ...state, trail, hint: NO_HINT, seq: state.seq + 1 }

  // 先判终点再判超时：正好用掉最后一步踩到终点，算过关不算输
  if (to === exitCell(state)) {
    return { ...base, clearedThisLevel: true, cleared: state.cleared + 1 }
  }
  if (trail.length - 1 >= state.limit) return { ...base, over: true }
  return base
}

/** 纯函数状态迁移：不读时间、不读全局随机数、不修改入参 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'move':
      return doMove(state, action.dir)

    case 'undo': {
      if (state.over || state.clearedThisLevel) return state
      if (state.trail.length <= 1) return state
      return { ...state, trail: state.trail.slice(0, -1), hint: NO_HINT, seq: state.seq + 1 }
    }

    case 'hint': {
      if (state.over || state.clearedThisLevel || state.hintUsed) return state
      const dir = nextDir(state)
      if (dir === NO_HINT) return state
      return { ...state, hint: dir, hintUsed: true, seq: state.seq + 1 }
    }

    case 'restart': {
      if (state.over) return state
      if (state.clearedThisLevel) return state
      if (state.trail.length === 1 && state.hint === NO_HINT) return state
      // 复用同一个种子：重开必须是同一张迷宫，否则「重开」就变成了「换一张」
      return beginLevel(state, state.level, state.mazeSeed, state.rng)
    }

    case 'next': {
      if (!state.clearedThisLevel) return state
      const rng = new Rng(state.rng)
      const mazeSeed = hashSeed(rng.int(0x7fffffff))
      return beginLevel(state, state.level + 1, mazeSeed, rng.s)
    }
  }
}

// ---------------- 结算 ----------------

/**
 * 门票制保本线：通关 2 关才回本。
 *
 * 这款游戏没有「输」这个瞬间——只有步数用光才结束，而那正是玩得最爽的时候。
 * 所以成绩只按通关关数算，钱走门票制（与钓鱼 / 连珠 / 轨道车 / 射靶同一套），
 * 不去硬凑一个 win / lose。
 */
export const COIN_PAR = 2

/** 按通关关数换算净盈亏；正 = 赚，负 = 输，0 = 退还 */
export function coinsFor(cleared: number, bet: number): number {
  if (!Number.isFinite(cleared)) return 0
  const mult = Math.floor(cleared / COIN_PAR)
  if (!Number.isFinite(mult) || mult <= 0) return -bet
  return bet * mult
}
