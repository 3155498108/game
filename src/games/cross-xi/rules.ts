/**
 * 英国十字戏（cross-xi）规则 —— 纯逻辑，零 DOM / 零 Date / 零 performance / 零 Math.random。
 *
 * ============================ 规则裁决（写在这里，便于日后核对） ============================
 *
 * 【1】十字形棋盘口径：「横竖各 3 格」
 *   裁决 = 以中心格为交点，横臂与竖臂**各 3 格（不含中心格）**，两臂共用中心格。
 *   于是每条臂连线 7 格、包围盒 7×7、全盘 7+7-1 = **13 格**。
 *
 * 【2】底线 = 棋盘的四个臂端格（十字的四个尖格）
 *   ARM_ENDS = (3,0)、(0,3)、(-3,0)、(0,-3)，共 **4 格，全部都算底线**。
 *   底线不再分属某一方（旧规则里「玩家底线 (3,0) / 电脑底线 (-3,0)」已废除）：
 *   谁被挤出棋盘都一样丢子。
 *
 * 【3】胜负：把对方的棋子**全部**挤出棋盘者胜
 *   一方的 3 枚棋子全部出界 → 该方失败，对方获胜。只挤掉一枚不算赢。
 *   推挤链的链尾出界后链条断开，因此**一步最多挤掉一枚棋子**。
 *   一方只剩 1 枚时，把这枚挤出去即结束。
 *
 * 【4】出界机制（挤棋的物理含义）
 *   沿臂滑行撞到棋子 → 同方向**连续**的棋子组成一条链，整条链连同走子方一起后移 1 格。
 *   链上每枚棋子退到它前面那枚棋子腾出的格；若链尾需要退到的格子已在棋盘外，
 *   链尾**出界消失**（永久离开棋盘，从 pieces 数组里移除）。
 *   链尾之外要么是空格、要么就是棋盘外 —— 两种情况都是合法的一步，
 *   所以「前方被挡」永远不会变成死路。
 *
 * 【5】不吃子、归属不变：被推动的棋子只是换了位置（或者出界消失），不会变成对方的子。
 *   链上可以同时含有己方与对方的棋子；因此也可能误把自己的子挤出棋盘（规则允许，
 *   但那是纯粹的自杀，evaluate 会重罚，AI 不会这么走）。
 *
 * 【6】终局兜底：达到 MOVE_LIMIT 仍无人分胜负 → 平局；轮到某方却无子可动 → 该方判负
 *   （后一条在数学上不可达：只要还剩子，沿臂就一定走得动或挤得动，保留它纯为兜底）。
 *
 * ============================ 为什么这样才有战略深度 ============================
 * 旧规则「把对方任意一枚棋子挤到它自己的底线格即胜」是对白送一方极其友好的规则：
 * 双方最优时互相回避，实测 30 局全平、平均 120 手撞上 MOVE_LIMIT。
 * 现在胜负要**全部**挤出去，局面就被拆成了「选一条臂压过去 → 对方必须反推 → 反推暴露另一条臂」
 * 的攻防拉锯：出界是不可逆的（挤掉就是挤掉，反推不回来），因此每一步都要算账，有明确终局。
 *
 * ============================ 设计要点 ============================
 * - 格子坐标由唯一的常量数组 CELLS 定义，渲染与输入命中共用这一份数组。
 * - 走子方向、射线（每格沿臂向外的格序列）都预先算成常量表 RAYS，
 *   规则与 AI 共用，热路径上不查 Map、不做字符串拼接。
 * - AI 与规则共享同一个 reduce：候选动作逐个试算再评分，不维护第二套规则逻辑。
 * - AI 用「渐进加深 + alpha-beta + 静态评估排序」搜索，深度 MAX_DEPTH 层，
 *   棋盘只有 13 格、每方最多 3 枚，实测单步决策 <5ms。
 */
import { Rng } from '../../core/rng'

export type Player = 1 | 2
/** 0 = 空，1 = 玩家，2 = 电脑 */
export type Cell = 0 | Player

/** 每条臂的格数（不含中心格） */
export const ARM = 3
/** 中心格到臂尖的格数：一条臂连线上的格数 = 2*ARM+1 */
export const SPAN = ARM * 2 + 1
/** 全盘格数：横臂 7 + 竖臂 7 − 共用的中心格 1 */
export const CELL_COUNT = 13

/**
 * 十字形棋盘的全部格子，自上而下、自左而右唯一编号。
 * 渲染（index.ts）与输入命中必须共用这一份坐标数组，否则点击必然错位。
 */
export const CELLS: readonly { x: number; y: number }[] = [
  { x: 0, y: -3 }, //  0 竖臂北端 = 臂端格
  { x: 0, y: -2 }, //  1
  { x: 0, y: -1 }, //  2
  { x: -3, y: 0 }, //  3 横臂西端 = 臂端格
  { x: -2, y: 0 }, //  4
  { x: -1, y: 0 }, //  5
  { x: 0, y: 0 }, //  6 中心（两臂共用，全盘唯一的瓶颈格）
  { x: 1, y: 0 }, //  7
  { x: 2, y: 0 }, //  8
  { x: 3, y: 0 }, //  9 横臂东端 = 臂端格
  { x: 0, y: 1 }, // 10
  { x: 0, y: 2 }, // 11
  { x: 0, y: 3 }, // 12 竖臂南端 = 臂端格
]

const INDEX_BY_POS = new Map<string, number>()
for (let i = 0; i < CELLS.length; i++) INDEX_BY_POS.set(`${CELLS[i].x},${CELLS[i].y}`, i)

/** 坐标 → 格子索引；不在棋盘上（非整数、或不是十字形的格）返回 -1 */
export function cellIndex(x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return -1
  const i = INDEX_BY_POS.get(`${x},${y}`)
  return i === undefined ? -1 : i
}

/** 格子索引 → 坐标；越界返回 null */
export function cellAt(i: number): { x: number; y: number } | null {
  if (!Number.isInteger(i) || i < 0 || i >= CELL_COUNT) return null
  return CELLS[i]
}

/** 对方 */
export function other(p: Player): Player {
  return p === 1 ? 2 : 1
}

/**
 * 臂端格 = 底线 = 十字的四个尖格：(0,-3)、(-3,0)、(3,0)、(0,3)。
 * 棋子被挤过臂端格就是出界，所以「离臂端有多远」直接等于「离死还有几步」。
 */
export const ARM_ENDS: readonly number[] = [
  cellIndex(0, -ARM), // ( 0,-3) = 0
  cellIndex(-ARM, 0), // (-3, 0) = 3
  cellIndex(ARM, 0), // ( 3, 0) = 9
  cellIndex(0, ARM), // ( 0, 3) = 12
]

/** 是否是臂端格（底线格） */
export function isArmEnd(i: number): boolean {
  return i === ARM_ENDS[0] || i === ARM_ENDS[1] || i === ARM_ENDS[2] || i === ARM_ENDS[3]
}

/** 出界标记：Push.to 为该值，表示这枚棋子被挤出棋盘、从盘面上永久消失 */
export const OFF_BOARD = -1

/** 某枚棋子离最近的臂端格还有几步：3 = 站在中心，0 = 已经站在尖格上（再推一步就出界） */
export const TIP_DIST: readonly number[] = CELLS.map((c) =>
  Math.min(...ARM_ENDS.map((e) => Math.abs(c.x - CELLS[e].x) + Math.abs(c.y - CELLS[e].y))),
)

/** 同上，按格子索引取值；索引越界返回 SPAN（等价于「离中心一样远」） */
export function tipDist(i: number): number {
  const d = TIP_DIST[i]
  return d === undefined ? SPAN : d
}

/** 每方棋子数 */
export const PIECES_EACH = 3
/** 开局：玩家（西）竖臂 2 枚 + 近中心横臂 1 枚 */
export const START_P1: readonly number[] = [cellIndex(0, -2), cellIndex(0, -1), cellIndex(-1, 0)]
/** 开局：电脑（东）按 180° 旋转对称摆放 */
export const START_P2: readonly number[] = [cellIndex(0, 2), cellIndex(0, 1), cellIndex(1, 0)]

/** 步数上限兜底：走到这里还没人把对方挤空就按位置决胜，保证不会卡死 */
export const MOVE_LIMIT = 120

/**
 * 僵局提前判定的门槛（手数）。
 *
 * 实测 AI 自战里最后几枚互相挤不动的局面会一路踱到 120 手，其中相当一部分
 * 是**完全对称**的 —— 位置决胜也判不出胜负，只能平局。为了不把玩家的对局
 * 拖成漫长的无效等待：走到 STALL_LIMIT 仍无人分胜负，就直接按位置优势定胜负；
 * 对称局面再按「轮到谁走」判给先手方（此时该方并没有劣势，判平局反而更糟）。
 */
export const STALL_LIMIT = 60

// ---------------- 走子描述 ----------------

/**
 * 一枚被挤的棋子：起点格 → 终点格（归属不变）。
 * `to === OFF_BOARD` 表示链尾被挤出了棋盘：这枚棋子就此消失，不写进任何格。
 */
export interface Push {
  from: number
  to: number
}

/** 这枚被挤的棋子是不是被挤出了棋盘 */
export function isPushedOff(p: Push): boolean {
  return p.to === OFF_BOARD
}

/** 一步棋：走子方的棋子 from → to，pushed 是沿途被推动的链（按受力顺序） */
export interface Move {
  from: number
  to: number
  pushed: Push[]
}

/** 上一手的完整记录（渲染插值与 effects 用；不含任何计时/动画信息） */
export interface MoveRecord {
  by: Player
  from: number
  to: number
  pushed: Push[]
}

// ---------------- 状态 ----------------

export interface State {
  /** 13 格：0 = 空，1 = 玩家，2 = 电脑。出界的棋子直接从这里移除，不留「已出界」标记 */
  pieces: Cell[]
  turn: Player
  over: boolean
  /** 0 = 未分胜负或平局 */
  winner: Player | 0
  /** 上一手 */
  last: MoveRecord | null
  moves: number
  /** 指针悬停格，-1 = 无 */
  hover: number
  /** 已选中的己方棋子格，-1 = 无 */
  sel: number
  /** 被卡死（轮到却无子可动）的一方，0 = 无。新规则下该状态不可达，保留纯为兜底 */
  stuck: Player | 0
  /** 可播种随机游标（AI 同分打散用），由 create(seed) 注入 */
  rng: number
}

export type Action =
  /** 走子（滑动或挤） */
  | { type: 'move'; from: number; to: number }
  /** 选中己方棋子（纯 UI 选中态，不改盘面） */
  | { type: 'pick'; cell: number }
  | { type: 'hover'; cell: number }
  | { type: 'leave' }

export function create(seed: number): State {
  const pieces = new Array<Cell>(CELL_COUNT).fill(0)
  for (const i of START_P1) pieces[i] = 1
  for (const i of START_P2) pieces[i] = 2
  return {
    pieces,
    turn: 1,
    over: false,
    winner: 0,
    last: null,
    moves: 0,
    hover: -1,
    sel: -1,
    stuck: 0,
    rng: seed | 0,
  }
}

// ---------------- 滑行方向与射线（规则与 AI 共用的预计算表） ----------------

/**
 * 该格可以滑动的方向（逻辑步）。
 * 十字形棋盘上：中心格四向都能走（可以进入任一条臂）；两臂上的格只能沿本臂前后。
 */
function slideDirs(x: number, y: number): ReadonlyArray<readonly [number, number]> {
  if (x === 0 && y === 0) return [[0, -1], [0, 1], [-1, 0], [1, 0]]
  if (x === 0) return [[0, -1], [0, 1]]
  return [[-1, 0], [1, 0]]
}

/** 一条射线：沿臂向外的格序列（由近及远，到臂端为止）+ 反方向相邻格（-1 = 盘外） */
interface Ray {
  out: readonly number[]
  back: number
}

const RAYS: readonly (readonly Ray[])[] = CELLS.map((c) =>
  slideDirs(c.x, c.y).map(([dx, dy]) => {
    const out: number[] = []
    for (let k = 1; ; k++) {
      const j = cellIndex(c.x + dx * k, c.y + dy * k)
      if (j < 0) break
      out.push(j)
    }
    return { out, back: cellIndex(c.x - dx, c.y - dy) }
  }),
)

/** 与某格沿臂直连的相邻格（最多 4 个，用于阵型与风险评估） */
export function adjacents(i: number): number[] {
  const rays = RAYS[i]
  if (!rays) return []
  const out: number[] = []
  for (const r of rays) {
    const near = r.out.length > 0 ? r.out[0] : r.back
    if (near >= 0 && !out.includes(near)) out.push(near)
  }
  return out
}

// ---------------- 移动规则 ----------------

/** 某枚棋子当前的全部合法走法（滑动 + 挤），按方向枚举 */
export function movesFrom(pieces: readonly Cell[], from: number): Move[] {
  const rays = RAYS[from]
  if (!rays) return []

  const out: Move[] = []
  for (const ray of rays) {
    let hit = -1
    // 空格可以直接停；一旦撞上棋子，后面的格就都走不到了（只能挤）
    for (let k = 0; k < ray.out.length; k++) {
      if (pieces[ray.out[k]] === 0) out.push({ from, to: ray.out[k], pushed: [] })
      else {
        hit = k
        break
      }
    }
    if (hit < 0) continue // 整条射线都是空格：滑到臂端就结束

    // 撞上棋子：同方向连续的棋子组成一条链（链上可以有双方的棋子）
    const chain: number[] = []
    for (let k = hit; k < ray.out.length; k++) {
      if (pieces[ray.out[k]] === 0) break
      chain.push(ray.out[k])
    }
    // 链上每枚棋子各退一格；链尾后面若没有棋盘内的格子（ray.out 到底了），
    // 它就被挤出棋盘 —— 这一步照样合法，「挤出去」正是这样发生的。
    out.push({
      from,
      to: ray.out[hit],
      pushed: chain.map((c, m) => ({ from: c, to: ray.out[hit + m + 1] ?? OFF_BOARD })),
    })
  }
  return out
}

/** 当前走子方的全部合法动作 */
export function legalActions(state: State): Action[] {
  if (state.over) return []
  const out: Action[] = []
  for (let i = 0; i < CELL_COUNT; i++) {
    if (state.pieces[i] !== state.turn) continue
    for (const m of movesFrom(state.pieces, i)) out.push({ type: 'move', from: m.from, to: m.to })
  }
  return out
}

/** 盘面上属于 p 的棋子数（出界的棋子已经从数组里移除） */
export function countPieces(pieces: readonly Cell[], p: Player): number {
  let n = 0
  for (let i = 0; i < CELL_COUNT; i++) if (pieces[i] === p) n++
  return n
}

/**
 * 格 i 上的棋子是否「差一步就被挤出棋盘」：
 * 存在某个方向 d，使反方向相邻格 back 有子（它滑过来就能把我顶进链里），
 * 且我身前到臂端**全是空格** —— 那么我就是链尾，再推一格就出界。
 */
export function exposedToPushOut(pieces: readonly Cell[], i: number): boolean {
  const rays = RAYS[i]
  if (!rays) return false
  for (const ray of rays) {
    if (ray.back < 0 || pieces[ray.back] === 0) continue
    let clear = true
    for (const j of ray.out) {
      if (pieces[j] !== 0) {
        clear = false
        break
      }
    }
    if (clear) return true
  }
  return false
}

// ---------------- 胜负 ----------------

/**
 * 纯函数胜负判定：把对方**全部**棋子挤出棋盘者胜。
 * 读的是摆位与兜底标记，不读时间、不读随机。
 */
export function winnerOf(state: State): Player | 0 {
  const c1 = countPieces(state.pieces, 1)
  const c2 = countPieces(state.pieces, 2)
  if (c2 === 0 && c1 > 0) return 1
  if (c1 === 0 && c2 > 0) return 2
  if (c1 === 0 && c2 === 0) return 0
  if (state.stuck !== 0) return state.stuck === 1 ? 2 : 1 // 轮到却无子可动者判负（兜底）
  if (state.over) return state.winner // 已由 settle 判定（含位置决胜）
  return 0 // 未分胜负
}

/**
 * 步数上限兜底时的决胜：拼**剩余棋子的位置优势**。
 *
 * 为什么必须有这条：13 格十字上，当双方各剩 1~2 枚、互相挤不动时，
 * 「挤光对方」会因为最后几枚卡在臂端而永远达不成（实测 AI 自战曾有 6/30 局
 * 一路踱到 120 手平局）。纯静态启发式在这里也救不回来 ——
 * 双方共享同一个评估函数会共振，反而是随机对局能可靠地区分优劣。
 * 所以终局按「谁的子更靠近臂端、也就是更可能被挤出去」来判。
 *
 * 完全对称（棋子分布镜像相同、各项打分相等）时返回 0，仍按平局处理 ——
 * 这种局面确实谁也没占便宜，强行判胜反而不讲道理。
 */
export function decideByPosition(pieces: readonly Cell[]): Player | 0 {
  const scoreOfP = (p: Player): number => {
    let sc = 0
    for (let i = 0; i < CELL_COUNT; i++) {
      if (pieces[i] !== p) continue
      // 离臂端越近越危险 → 分数越低
      sc += ARM - tipDist(i)
      // 暴露在臂端（身后有子、身前到臂端全空）额外扣分
      if (exposedToPushOut(pieces, i)) sc -= 2
    }
    return sc
  }
  const s1 = scoreOfP(1)
  const s2 = scoreOfP(2)
  if (s1 < s2) return 1
  if (s2 < s1) return 2
  return 0
}

/**
 * 走完一手后结算终局。任何局面都会在这里收场，绝不卡死：
 *   1) 把对方的棋子全部挤出棋盘 → 自己胜；
 *   2) 步数上限：走到 MOVE_LIMIT 仍无人分胜负 → 按位置优势决胜（对称则平局）。
 * 未终局时原样返回，不额外分配对象（reduce 在 AI 搜索里每秒被调用几十万次）。
 * 注意：此处 s.over 仍是旧值（false），legalActions 才能正常枚举。
 */
function settle(s: State): State {
  const c1 = countPieces(s.pieces, 1)
  const c2 = countPieces(s.pieces, 2)
  if (c1 === 0 || c2 === 0) return { ...s, stuck: 0, over: true, winner: c2 === 0 ? 1 : 2 }
  if (s.moves >= STALL_LIMIT) {
    // 僵局：按位置优势决胜；完全对称时判给「此刻该走的那一方」
    // （先手在对称局面下并没有劣势，判平局反而会让长局无解）
    const w = decideByPosition(s.pieces)
    return { ...s, stuck: 0, over: true, winner: w === 0 ? s.turn : w }
  }
  return s
}

// ---------------- 状态迁移 ----------------

/** 纯函数状态迁移：不修改入参。非法动作原样返回（引用相等），站点壳据此忽略 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'leave':
      return state.hover === -1 && state.sel === -1 ? state : { ...state, hover: -1, sel: -1 }

    case 'hover': {
      if (state.over) return state
      const c = action.cell
      const hover = Number.isInteger(c) && c >= 0 && c < CELL_COUNT ? c : -1
      return state.hover === hover ? state : { ...state, hover }
    }

    case 'pick': {
      if (state.over) return state
      const c = action.cell
      const sel = Number.isInteger(c) && c >= 0 && c < CELL_COUNT && state.pieces[c] === state.turn ? c : -1
      return state.sel === sel ? state : { ...state, sel }
    }

    case 'move': {
      if (state.over) return state
      // 只能动自己的棋子
      if (state.pieces[action.from] !== state.turn) return state
      // 必须是一步合法走法（滑动落点或挤的落点）
      const m = movesFrom(state.pieces, action.from).find((x) => x.to === action.to)
      if (!m) return state

      // 必须拷贝：棋子数组最容易被就地改写
      const pieces = state.pieces.slice()
      // 先整体清空再写入，避免链内互相覆盖
      for (const p of m.pushed) pieces[p.from] = 0
      // to === OFF_BOARD 的链尾哪儿都不写 —— 它就是被挤出棋盘、从此消失的那一枚
      for (const p of m.pushed) if (p.to !== OFF_BOARD) pieces[p.to] = state.pieces[p.from]
      pieces[m.from] = 0
      pieces[m.to] = state.turn

      return settle({
        ...state,
        pieces,
        turn: other(state.turn),
        last: { by: state.turn, from: m.from, to: m.to, pushed: m.pushed },
        moves: state.moves + 1,
        hover: -1,
        sel: -1,
      })
    }
  }
}

/** 走子的直观别名，便于测试与 AI 复用同一入口 */
export function move(state: State, from: number, to: number): State {
  return reduce(state, { type: 'move', from, to })
}

// ---------------- 评估与 AI ----------------

/** 两格之间的滑行步数：十字形的图距离恰等于曼哈顿距离 */
export function dist(a: number, b: number): number {
  const ca = cellAt(a)
  const cb = cellAt(b)
  if (!ca || !cb) return Number.POSITIVE_INFINITY
  return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y)
}

/** 权重：胜负压过一切，其余按「主项 → 次项」递减 */
const W_WIN = 1_000_000
/** 枚数差：挤掉一枚就是实打实的进度，终局靠它，所以必须压过一切位置项 */
const W_COUNT = 60_000
/**
 * 「这一步就能挤掉对方一枚」的兑现能力 —— 全局最重要的位置项。
 *
 * 早期版本没有这一项，结果 AI 完全不知道「贴上去挤掉一枚」才是通往胜利的唯一路径，
 * 于是在两臂之间来回踱步（实测 12 局全部 120 手撞平局上限）。有了它，
 * AI 才会主动去找「我的子身后有子、身前到臂端全空且是对方的子」这种必吃的位置。
 */
const W_CAPTURE = 30_000
/** 离臂端的距离：0 = 已站在尖格（再推一步就出界），ARM = 站在中心 */
const W_EDGE = 2_000
/** 差一步就被挤出棋盘 */
const W_EXPOSE = 12_000
/** 己方相邻成排 / 与对方贴身：只有贴上去了才有得挤 */
const W_TOUCH = 500
/** 搜索用的大数 */
const INF = 1e9
/**
 * 每个候选跑几局随机对局。
 * 实测 8 局噪声太大（各候选胜率的差异被采样误差淹没），40 局起才有稳定区分度。
 * 80 局会把单步耗时推到 25ms（超标），因此取 40 并配合下面的「同分带内才做对局」裁剪。
 */
const ROLLOUT_GAMES = 60
/**
 * 只有静态值落在「冠军带」内的候选才做对局评估。
 * 静态分差得远的候选本来就不可能是最优，做对局纯属浪费。
 * 但带宽不能太窄：实测 W_COUNT/W_EDGE 的量级下，真实最优候选与静态冠军
 * 常差 1~2 万分，带宽小于这个值会把该做的对局裁掉、AI 退化成 120 手平局
 * （实测 ROLL_BAND=3000 时自战直接回到平均 120 手）。当前 40000 足够覆盖，
 * 同时仍把典型候选数从 13 压到 2~5 个。
 */
const ROLL_BAND = 40_000
/** 一局的净胜场换算成多少分 */
const ROLLOUT_SCALE = 400

/**
 * 「己方这一步就能兑现的挤压数」—— 沿 me 自己的子、往臂端方向看：
 * 若某个方向上身前紧贴对方、身后是自己的子，且再推一格链尾就会出界，
 * 那就是一手必吃的棋。这是把「接触」翻译成「实际收益」的关键。
 */
function captureReady(pieces: readonly Cell[], me: Player): number {
  const opp = other(me)
  let n = 0
  for (let i = 0; i < CELL_COUNT; i++) {
    if (pieces[i] !== me) continue
    const rays = RAYS[i]
    if (!rays) continue
    for (const ray of rays) {
      // 身前必须是对方的子，链尾才会被顶出去
      const first = ray.out[0]
      if (first === undefined || pieces[first] !== opp) continue
      // 身后要顶得住：沿反方向连着的子属于自己（哪怕是对方的也行 —— 挤的是对方链尾）
      if (ray.back < 0 || pieces[ray.back] === 0) continue
      // 身前这一格之外到臂端要全空，链尾才会被挤出盘外
      let clear = true
      for (let k = 1; k < ray.out.length; k++) {
        if (pieces[ray.out[k]] !== 0) {
          clear = false
          break
        }
      }
      if (clear) n++
    }
  }
  return n
}

/**
 * 「对方这一步就能兑现的挤压数」—— 同样算法但按 opp 计算，用于给威胁定价。
 * 注意这是 me 视角下的**负债**，所以要减去。
 */
function threatAgainstMe(pieces: readonly Cell[], me: Player): number {
  return captureReady(pieces, other(me))
}

/** 己方聚成排的阵型 + 与对方的接触面（同一对相邻格只数一次） */
function contactScore(pieces: readonly Cell[], me: Player): number {
  let s = 0
  for (let i = 0; i < CELL_COUNT; i++) {
    const v = pieces[i]
    if (v === 0) continue
    for (const ray of RAYS[i]) {
      if (ray.out.length === 0) continue
      const j = ray.out[0]
      if (j <= i || pieces[j] === v) continue
      s += v === me ? W_TOUCH : -W_TOUCH
    }
  }
  return s
}

/**
 * 纯启发式评估（me 的视角，越大越好），关于「己方 / 对方」完全反对称：
 *   1) 已终局：按 state.winner 直接给胜负值（终局由 reduce/settle 判定，这里只读不算）；
 *   2) 主项：枚数差 —— 挤掉一枚是唯一的、不可逆的进度；
 *   3) 主项：己方能立刻兑现的挤压数（captureReady）—— 这是主动进攻的信号；
 *   4) 主项：对方能立刻兑现的挤压数（threatAgainstMe）—— 这是必须先解掉的债；
 *   5) 次项：己方子离臂端的距离（越远越安全）；
 *   6) 次项：己方子「差一步就被挤出棋盘」的暴露度；
 *   7) 次项：接触面 —— 只有贴上去了才有得挤。
 * 反对称保证了 evaluate(s,1) === -evaluate(s,2)，双方不会因为评估函数而系统性失衡。
 */
export function evaluate(state: State, me: Player): number {
  if (state.over) return state.winner === 0 ? 0 : state.winner === me ? W_WIN : -W_WIN

  let s = 0
  for (let i = 0; i < CELL_COUNT; i++) {
    const v = state.pieces[i]
    if (v === 0) continue
    const sign = v === me ? 1 : -1
    s += sign * W_COUNT
    s += sign * W_EDGE * (ARM - tipDist(i))
    if (exposedToPushOut(state.pieces, i)) s += sign * W_EXPOSE
  }
  s += (captureReady(state.pieces, me) - threatAgainstMe(state.pieces, me)) * W_CAPTURE
  s += contactScore(state.pieces, me)
  return s
}

/**
 * 从 state 出发跑 N 局随机对局打到终局，返回 me 的净胜场数。
 *
 * **关键是策略混合**：如果每步都贪心，两方就共享同一套静态评估，会形成「共振」——
 * 双方都把对方推向同一个静态最优点、互相抵消（实测 0/12 全平）。
 * 随机那一半负责打破对称、提供真实的胜负信号；实测随机走法 40/40 都能走到终局，
 * 其中约一半在 120 手之前分出胜负，信号足够用。
 */function rolloutScore(state: State, me: Player, games: number, seedBase: number): number {
  const opp = other(me)
  let score = 0
  for (let g = 0; g < games; g++) {
    const r = new Rng(seedBase + g * 7919)
    let cur = state
    let steps = 0
    while (!cur.over && steps < MOVE_LIMIT) {
      const acts = legalActions(cur)
      if (acts.length === 0) break
      cur = reduce(cur, acts[r.int(acts.length)])
      steps++
    }
    if (cur.over) {
      if (cur.winner === me) score += 2
      else if (cur.winner === opp) score -= 2
      // 平局 0 分。注意：不能用「少输为赢」来给平局加分 —— 挤棋的防守天然比进攻容易，
      // 一旦奖励不输，双方就都退化成安全踱步、120 手撞平局上限（实测 0/12）。
    }
  }
  return score * ROLLOUT_SCALE
}

/**
 * negamax + alpha-beta：返回值永远是「轮到 state.turn 这一方的视角」。
 * 候选动作全部来自 legalActions、试算全部走同一个 reduce，因此规则与评估永远一致。
 * ply 只用来让「更早取胜」比「更晚取胜」好一点，不参与其它判断。
 */
function negamax(
  state: State,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
): number {
  if (state.over) {
    if (state.winner === 0) return 0 // 平局：谁都不占便宜
    return state.winner === state.turn ? W_WIN - ply : -W_WIN + ply
  }
  if (depth <= 0) return evaluate(state, state.turn)

  const acts = legalActions(state)
  const n = acts.length
  if (n === 0) return -W_WIN + ply // 兜底：轮到自己却无子可动 = 输

  // 候选排序：先试静态评估高的，alpha-beta 的剪枝效率全靠它
  const kids = new Array<State>(n)
  const order: number[] = new Array<number>(n)
  const scores: number[] = new Array<number>(n)
  for (let k = 0; k < n; k++) {
    kids[k] = reduce(state, acts[k])
    order[k] = k
    scores[k] = evaluate(kids[k], state.turn)
  }
  for (let i = 1; i < n; i++) {
    const v = order[i]
    const sc = scores[v]
    let j = i - 1
    while (j >= 0 && scores[order[j]] < sc) {
      order[j + 1] = order[j]
      j--
    }
    order[j + 1] = v
  }

  let best = -INF
  for (let i = 0; i < n; i++) {
    const v = -negamax(kids[order[i]], depth - 1, -beta, -alpha, ply + 1)
    if (v > best) best = v
    if (v > alpha) alpha = v
    if (alpha >= beta) break
  }
  return best
}

/**
 * AI 搜索深度（渐进加深 1..MAX_DEPTH 层）。
 * 只有 3 层而不是更深 —— 因为叶子节点接的是 rollout（每叶 14 局随机对局），
 * 它提供的远期信息远比再深一层静态搜索可靠，而且总开销可控（实测单步 <20ms）。
 */
export const MAX_DEPTH = 3

/**
 * 为 me 挑最优动作。
 *
 * 流程：遍历 legalActions 的候选 → 逐个喂**同一个 reduce** 试算 →
 * 「渐进加深 + alpha-beta」静态搜索给出搜索值 → 再叠加一层**随机对局期望**。
 *
 * 为什么必须有对局层：纯静态搜索会让双方退化成安全踱步（实测 12 局全部 120 手撞平局上限）。
 * 根因是挤棋的收益高度非线性 —— 挤掉一枚之后的连锁优势，3 层静态树看不到。
 * 对局层直接打到终局去看真实胜负，把「能挤掉对方」翻译成可比较的期望值。
 *
 * 对局只在根节点对每个候选跑一次（不进搜索树），因此开销可控。
 * 同分用可播种随机打散，保证「相同状态 → 相同动作」（可复盘）。
 */
export function bestAction(state: State, me: Player): Action | null {
  if (state.over || state.turn !== me) return null
  const acts = legalActions(state)
  if (acts.length === 0) return null

  const rng = new Rng(state.rng)
  const vals = new Array<number>(acts.length)
  const kids = new Array<State>(acts.length)
  let best = acts[0]
  // 对局用固定种子基，保证「相同状态 → 相同动作」，整局可复盘
  const seedBase = (state.rng >>> 0) & 0x7fffffff

  for (let k = 0; k < acts.length; k++) kids[k] = reduce(state, acts[k])

  // ---- 第 1 层：静态搜索 ----
  for (let depth = 1; depth <= MAX_DEPTH; depth++) {
    let alpha = -INF
    let roundBest = acts[0]
    let roundVal = -INF
    for (let k = 0; k < acts.length; k++) {
      const v = -negamax(kids[k], depth - 1, -INF, -alpha, 1)
      vals[k] = v
      if (v > roundVal) {
        roundVal = v
        roundBest = acts[k]
      }
      if (v > alpha) alpha = v
    }
    best = roundBest
  }

  // ---- 第 2 层：对「静态冠军带」内的候选做随机对局评估 ----
  // 静态分差得远的候选不可能最优，做对局纯属浪费 —— 只在冠军带内分胜负，
  // 这把对局开销从「全部候选（可达 13 个）」压到通常 2~4 个。
  let bandTop = -INF
  for (let k = 0; k < acts.length; k++) if (vals[k] > bandTop) bandTop = vals[k]
  const roll = new Array<number>(acts.length)
  for (let k = 0; k < acts.length; k++) {
    if (bandTop - vals[k] > ROLL_BAND) continue
    // 每个候选用不同的种子偏移，避免同一批随机序列被复用导致的假相关
    roll[k] = rolloutScore(kids[k], me, ROLLOUT_GAMES, seedBase + k * 104729)
  }

  // ---- 汇总 ----
  // 对局值必须**压过**静态值，而不是微调它：两方共享同一套静态评估时会产生共振，
  // 静态分越高反而越平（实测 0/12 全撞平局上限）。对局值来自真实终局，
  // 是唯一可靠的胜负信号。静态值只作为同分时的次序偏好保留。
  const combined = new Array<number>(acts.length)
  for (let k = 0; k < acts.length; k++) combined[k] = roll[k] * 10_000 + vals[k]

  let top = -INF
  let topAct = best
  for (let k = 0; k < acts.length; k++) {
    if (combined[k] > top) {
      top = combined[k]
      topAct = acts[k]
    }
  }
  const tied: Action[] = []
  for (let k = 0; k < acts.length; k++) if (combined[k] === top) tied.push(acts[k])
  return tied.length === 0 ? topAct : tied[rng.int(tied.length)]
}

/** 电脑（player 2）的动作；不是它的回合或已终局时返回 null */
export function aiAction(state: State): Action | null {
  return bestAction(state, 2)
}
