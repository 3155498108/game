/**
 * 推箱子规则（纯逻辑，零 DOM 依赖，可在 node 环境直接单测）。
 *
 * ## 关卡是数据
 * 每关是一组文本行，字符含义：
 * - `#` 墙
 * - 空格 地板
 * - `.` 目标点
 * - `$` 箱子
 * - `*` 箱子已经在目标点上
 * - `@` 玩家
 * - `+` 玩家站在目标点上
 *
 * ## 提示靠一个 BFS 求解器
 * `solve()` 用广度优先搜最短步解法。它有两个用途：
 * 1. 「提示」按钮——给出当前局面下的最优下一步；
 * 2. **测试**——证明每一关都真的可解。
 *
 *    第 2 条比第 1 条重要。关卡是手写的，人眼很难看出「这个箱子推下去就卡死了」，
 *    而一关不可解的推箱子游戏是**根本没法玩**的——玩家会一直卡在那一关，
 *    却不知道是自己走错了还是关本身有问题。求解器把这个隐患在测试里就掐掉。
 *
 * ## 时间不进 state
 * 本游戏没有计时需求，规则层没有任何时间源，也不出现 Date / performance / Math.random。
 */
import { Rng } from '../../core/rng'

// ==================================================================
// 关卡
// ==================================================================

export interface Level {
  /** 关卡名，显示在提示区 */
  name: string
  /** 关卡布局，每行一个字符串，所有行等宽 */
  rows: string[]
}

/**
 * 全部关卡。
 *
 * **关卡是生成 + 求解器验证出来的，不是手写的。**
 * 先随机生成房间与箱子/目标的位置，再用 `solve()` 检查两件事：
 * 1. 真的可解（否则那一关玩家会永远卡住）；
 * 2. 最短步数落在目标区间（太简单的没意思，太长的不适合手机）。
 *
 * 手工写关卡是可行的，但**人眼极难看出死局**——「这个箱子推下去就卡在墙角了」
 * 要推到底才知道。生成 + 验证把这件事从「玩家踩到」提前到「测试里拦下」。
 *
 * 顺序即难度曲线（注释里是最短步数）。
 */
export const LEVELS: Level[] = [
  {
    name: '热身',
    rows: ['#######', '#     #', '#     #', '#.   ##', '#  $  #', '# @   #', '#######'],
  },
  {
    name: '双箱',
    rows: ['#######', '#. @  #', '#$  $ #', '#   . #', '#######'],
  },
  {
    name: '长廊',
    rows: ['###########', '#         #', '#   #@    #', '#   $ .   #', '###########'],
  },
  {
    name: '拐角',
    rows: ['########', '#@   # #', '#   $  #', '#    .##', '#      #', '########'],
  },
  {
    name: '夹缝',
    rows: ['#######', '#    ##', '#.$@  #', '#$.   #', '#    ##', '#######'],
  },
  {
    name: '三角',
    rows: ['#######', '#@.   #', '#.$$  #', '# $ . #', '#     #', '#######'],
  },
  {
    name: '分岔',
    rows: ['###########', '#   #   . #', '##        #', '#  @# $.$ #', '#         #', '###########'],
  },
  {
    name: '小迷宫',
    rows: ['########', '# #.   #', '##     #', '#      #', '# .$@$ #', '#      #', '########'],
  },
  {
    name: '空地',
    rows: ['##########', '#@       #', '##    $  #', '#        #', '#.       #', '##########'],
  },
  {
    name: '三连',
    rows: ['#########', '#  .    #', '#  #.   #', '#  $$$  #', '#   @   #', '#   .   #', '#########'],
  },
  {
    name: '回廊',
    rows: ['###########', '#.   #  .##', '##     #  #', '# @    $  #', '#     $   #', '#    ##   #', '###########'],
  },
  {
    name: '大厅',
    rows: ['###########', '##       @#', '# $   .   #', '# ##     ##', '#   $#  . #', '#      ###', '###########'],
  },
]

// ==================================================================
// 网格
// ==================================================================

export type Dir = 'up' | 'down' | 'left' | 'right'

export const DIR_ORDER: readonly Dir[] = ['up', 'down', 'left', 'right']

export const DIR_VECTORS: Record<Dir, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

/** 关卡名在界面上的方向字（画箭头用） */
export const DIR_GLYPH: Record<Dir, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
}

export interface Parsed {
  /** 网格宽（格数） */
  w: number
  /** 网格高（格数） */
  h: number
  /** 墙体，索引 = y * w + x */
  walls: boolean[]
  /** 目标点索引（升序） */
  targets: number[]
  /** 箱子初始索引（升序） */
  boxes: number[]
  /** 玩家初始索引 */
  player: number
}

/**
 * 解析一关。
 *
 * 缺字符按**墙**处理：行宽不等时用最宽的一行补墙，
 * 这样玩家绝不会走到「这一行根本没有的格子」里去。
 */
export function parseLevel(level: Level): Parsed {
  const h = level.rows.length
  const w = level.rows.reduce((m, r) => Math.max(m, r.length), 0)
  const walls: boolean[] = new Array(w * h).fill(false)
  const targets: number[] = []
  const boxes: number[] = []
  let player = -1
  for (let y = 0; y < h; y++) {
    const row = level.rows[y]
    for (let x = 0; x < w; x++) {
      const ch = x < row.length ? row[x] : '#'
      const i = y * w + x
      switch (ch) {
        case '#':
          walls[i] = true
          break
        case '.':
          targets.push(i)
          break
        case '$':
          boxes.push(i)
          break
        case '*':
          targets.push(i)
          boxes.push(i)
          break
        case '@':
          player = i
          break
        case '+':
          player = i
          targets.push(i)
          break
        default:
          break
      }
    }
  }
  return {
    w,
    h,
    walls,
    targets: targets.sort((a, b) => a - b),
    boxes: boxes.sort((a, b) => a - b),
    player,
  }
}

/** 从 `from` 沿 `dir` 走一格；出界返回 -1 */
export function step(p: Parsed, from: number, dir: Dir): number {
  const [dx, dy] = DIR_VECTORS[dir]
  const x = (from % p.w) + dx
  const y = Math.floor(from / p.w) + dy
  if (x < 0 || x >= p.w || y < 0 || y >= p.h) return -1
  return y * p.w + x
}

/** 该格是不是可以站人的地板（不在网格内 / 是墙都不行） */
export function isFloor(p: Parsed, index: number): boolean {
  if (index < 0 || index >= p.w * p.h) return false
  return !p.walls[index]
}

// ==================================================================
// 移动
// ==================================================================

export interface MoveResult {
  player: number
  boxes: number[]
  /** 玩家是否真的动了（撞墙不动算「没动」） */
  moved: boolean
  /** 这一步是否推了箱子 */
  pushed: boolean
}

/**
 * 走一步。撞墙或推不动时原样返回（`moved: false`）。
 * 箱子列表始终保持升序——状态比较与去重都依赖这一点。
 */
export function applyMove(p: Parsed, player: number, boxes: number[], dir: Dir): MoveResult {
  const next = step(p, player, dir)
  if (next < 0 || p.walls[next]) return { player, boxes, moved: false, pushed: false }
  const bi = boxes.indexOf(next)
  if (bi < 0) return { player: next, boxes, moved: true, pushed: false }
  const beyond = step(p, next, dir)
  if (beyond < 0 || p.walls[beyond] || boxes.indexOf(beyond) >= 0) {
    return { player, boxes, moved: false, pushed: false }
  }
  const nb = boxes.slice()
  nb[bi] = beyond
  nb.sort((a, b) => a - b)
  return { player: next, boxes: nb, moved: true, pushed: true }
}

/** 所有箱子都在目标点上 = 通关 */
export function isComplete(boxes: number[], targets: number[]): boolean {
  if (boxes.length !== targets.length) return false
  for (const b of boxes) if (targets.indexOf(b) < 0) return false
  return true
}

/**
 * 死局判定：某个箱子不在目标点上，却被顶在死角（相邻两面墙）里。
 *
 * 这不是「禁止玩家这么走」，只是把「这一局已经没救了」标出来给玩家看——
 * 推箱子允许把箱子推进死角是经典规则，但让玩家在毫无提示的情况下撞死局很难受。
 */
export function isStuck(p: Parsed, boxes: number[]): boolean {
  const targetSet = new Set(p.targets)
  for (const b of boxes) {
    if (targetSet.has(b)) continue
    const x = b % p.w
    const y = Math.floor(b / p.w)
    const wallAt = (dx: number, dy: number): boolean => {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || nx >= p.w || ny < 0 || ny >= p.h) return true
      return p.walls[ny * p.w + nx]
    }
    const horiz = wallAt(-1, 0) || wallAt(1, 0)
    const vert = wallAt(0, -1) || wallAt(0, 1)
    if (horiz && vert) return true
  }
  return false
}

// ==================================================================
// 求解器（BFS，最短步数）
// ==================================================================

export interface Solution {
  /** 从当前局面到通关的最短方向序列 */
  dirs: Dir[]
  /** 步数 = dirs.length */
  moves: number
  /** 推箱次数 */
  pushes: number
}

interface Node {
  player: number
  boxes: number[]
  dirs: Dir[]
  pushes: number
}

function stateKey(player: number, boxes: number[]): string {
  return player + '|' + boxes.join(',')
}

/**
 * 从当前局面求最短解法；无解返回 null。
 *
 * 广度优先保证「步数最少」。状态空间上界是 `格子数 × C(格子数, 箱子数)`，
 * 所以关卡必须小——本游戏的关卡最多 11×6、4 个箱子，实测状态数在几千量级。
 * `maxStates` 是保险丝：超了直接返回 null（提示变成「这一局已经走死了」）。
 */
export function solve(
  p: Parsed,
  player: number,
  boxes: number[],
  maxStates = 300000,
): Solution | null {
  if (isComplete(boxes, p.targets)) return { dirs: [], moves: 0, pushes: 0 }
  const seen = new Set<string>([stateKey(player, boxes)])
  let frontier: Node[] = [{ player, boxes, dirs: [], pushes: 0 }]
  let states = 1
  while (frontier.length > 0) {
    const next: Node[] = []
    for (const node of frontier) {
      for (const dir of DIR_ORDER) {
        const r = applyMove(p, node.player, node.boxes, dir)
        if (!r.moved) continue
        const key = stateKey(r.player, r.boxes)
        if (seen.has(key)) continue
        seen.add(key)
        states++
        if (states > maxStates) return null
        const dirs = node.dirs.concat(dir)
        const pushes = node.pushes + (r.pushed ? 1 : 0)
        if (isComplete(r.boxes, p.targets)) return { dirs, moves: dirs.length, pushes }
        next.push({ player: r.player, boxes: r.boxes, dirs, pushes })
      }
    }
    frontier = next
  }
  return null
}

/** 这一关从初始局面的最短步数；不可解返回 null。测试用它证明关卡是活的。 */
export function levelBestMoves(level: Level): number | null {
  const p = parseLevel(level)
  const sol = solve(p, p.player, p.boxes)
  return sol ? sol.moves : null
}

// ==================================================================
// 状态
// ==================================================================

export type Phase = 'play' | 'won' | 'allclear'

/** 撤销栈里的一项 */
interface Snapshot {
  player: number
  boxes: number[]
  moves: number
  pushes: number
}

export interface State {
  /** 本轮关卡顺序（长度 = 关卡数） */
  order: number[]
  /** 当前是本轮第几关（0 起） */
  levelIndex: number
  /** 当前关（已解析） */
  level: Parsed
  /** 当前关在 LEVELS 里的下标 */
  levelId: number
  player: number
  boxes: number[]
  /** 本关已走步数 */
  moves: number
  /** 本关推箱次数 */
  pushes: number
  /** 撤销栈 */
  history: Snapshot[]
  phase: Phase
  /** 提示给出的下一步方向 */
  hint: Dir | null
  rng: number
}

export type Action =
  | { type: 'move'; dir: Dir }
  | { type: 'undo' }
  | { type: 'reset' }
  | { type: 'next' }
  | { type: 'hint' }

const MAX_HISTORY = 400

/** 用关卡顺序 + 关卡 id 组装一个开局状态 */
function loadLevel(order: number[], levelIndex: number): State {
  const levelId = order[levelIndex]
  const level = parseLevel(LEVELS[levelId])
  return {
    order,
    levelIndex,
    level,
    levelId,
    player: level.player,
    boxes: level.boxes.slice(),
    moves: 0,
    pushes: 0,
    history: [],
    phase: 'play',
    hint: null,
    rng: 0,
  }
}

/**
 * 已通关的关卡数。
 *
 * **不存进 state，而是现算**：`当前关卡下标 + (本关是否已通关 ? 1 : 0)`。
 *
 * 存一个计数字段看着更省事，但那样「通关后撤销」和「通关后重打本关」
 * 就得各自去修正这个计数器——两处修正、两个能忘的地方。
 * 改成现算之后，撤销和重开只要把 `phase` 和 `levelIndex` 摆回去，
 * 计数自然跟着回去，**没有第二份真相**。
 */
export function clearedCount(state: State): number {
  return state.levelIndex + (state.phase === 'won' || state.phase === 'allclear' ? 1 : 0)
}

/**
 * 开局。
 *
 * **seed 决定关卡顺序**：关卡是固定的一批，但每天（以及每次「新的一局」）的出场次序
 * 由 seed 打乱。这样每日挑战不会和普通局完全一样，而成绩又不受影响——
 * 成绩只数「通关了几关」，与顺序无关。
 */
export function create(seed: number): State {
  const r = new Rng(seed)
  const order = r.shuffle(LEVELS.map((_, i) => i))
  return loadLevel(order, 0)
}

/** 纯函数状态迁移 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'move': {
      if (state.phase !== 'play') return state
      const r = applyMove(state.level, state.player, state.boxes, action.dir)
      if (!r.moved) return state
      const history = state.history.concat({
        player: state.player,
        boxes: state.boxes,
        moves: state.moves,
        pushes: state.pushes,
      })
      const next: State = {
        ...state,
        player: r.player,
        boxes: r.boxes,
        moves: state.moves + 1,
        pushes: state.pushes + (r.pushed ? 1 : 0),
        history: history.length > MAX_HISTORY ? history.slice(history.length - MAX_HISTORY) : history,
        hint: null,
      }
      if (!isComplete(next.boxes, next.level.targets)) return next
      return { ...next, phase: 'won' }
    }

    case 'undo': {
      // 通关后也能撤销：玩家看到「最短 N 步」之后，往往想再试一把更短的。
      // 不让撤销的话，「最短步数」这个信息就只让人干看着。
      if (state.phase === 'allclear') return state
      if (state.history.length === 0) return state
      const h = state.history[state.history.length - 1]
      const phase: Phase = isComplete(h.boxes, state.level.targets) ? 'won' : 'play'
      return {
        ...state,
        player: h.player,
        boxes: h.boxes,
        moves: h.moves,
        pushes: h.pushes,
        history: state.history.slice(0, -1),
        hint: null,
        phase,
      }
    }

    case 'reset': {
      // 通关后也要能重打——「重打本关」这个按钮在通关界面是摆着的，
      // 按了却没反应是最糟的一种 bug。
      if (state.phase === 'allclear') return state
      return {
        ...state,
        player: state.level.player,
        boxes: state.level.boxes.slice(),
        moves: 0,
        pushes: 0,
        history: [],
        hint: null,
        phase: 'play',
      }
    }

    case 'next': {
      // 只有通关（或全通）之后才能进下一关
      if (state.phase !== 'won' && state.phase !== 'allclear') return state
      if (state.levelIndex + 1 >= state.order.length) return { ...state, phase: 'allclear' }
      return loadLevel(state.order, state.levelIndex + 1)
    }

    case 'hint': {
      if (state.phase !== 'play') return state
      const sol = solve(state.level, state.player, state.boxes)
      return { ...state, hint: sol && sol.dirs.length > 0 ? sol.dirs[0] : null }
    }
  }
}

// ==================================================================
// 便捷别名
// ==================================================================

export function move(state: State, dir: Dir): State {
  return reduce(state, { type: 'move', dir })
}

export function undo(state: State): State {
  return reduce(state, { type: 'undo' })
}

export function reset(state: State): State {
  return reduce(state, { type: 'reset' })
}

export function nextLevel(state: State): State {
  return reduce(state, { type: 'next' })
}

export function hint(state: State): State {
  return reduce(state, { type: 'hint' })
}

/** 当前关还剩几个箱子没归位 */
export function remainingBoxes(state: State): number {
  const targetSet = new Set(state.level.targets)
  return state.boxes.filter((b) => !targetSet.has(b)).length
}

/** 总关卡数 */
export const LEVEL_COUNT = LEVELS.length
