/**
 * 滑块解锁（Rush Hour）规则：纯逻辑，零 DOM 依赖，可在 node 环境单测。
 *
 * 棋盘 6×6，下标 = row * SIZE + col，row 0 在最上面、col 0 在最左边。
 * 车（Car）只沿自身方向整体滑动：横车改 col，竖车改 row。
 * 目标：把红色目标车（target）开到最右列，即 col + len === SIZE 即通关。
 *
 * 本文件不引入任何随机：关卡是静态常量，create(seed) 只把种子存进 state，
 * 因此「每日挑战」与「复盘」永远落在同一关。
 */

/** 棋盘边长（6×6） */
export const SIZE = 6
/** 总格数 */
export const CELLS = SIZE * SIZE
/** 目标车 id（约定值，不是随机挑选） */
export const TARGET_ID = 'r'
/** 目标车长度 */
export const TARGET_LEN = 2

/** 一辆车：col/row 是车头（左端 / 上端）所在格，len 为长度 */
export interface Car {
  id: string
  /** 行（竖车为上端所在行；横车为所在行） */
  row: number
  /** 列（横车为左端所在列；竖车为所在列） */
  col: number
  /** 长度，2 或 3 */
  len: number
  /** 是否横向 */
  horiz: boolean
  /** 颜色，仅供渲染 */
  color: string
  /** 是否为目标车（红色） */
  target: boolean
}

export interface Level {
  /** 关卡名 */
  name: string
  cars: Car[]
}

export interface State {
  /** 当前关卡下标（0 起） */
  level: number
  /** 当前棋盘上的车 */
  cars: Car[]
  /** 本局已走步数，越少越好 */
  moves: number
  /** 目标车是否已开到最右列 */
  solved: boolean
  /** 当前选中的车 id（键盘操作与高亮用），null 表示无 */
  selected: string | null
  /** 最近一次滑动，仅供渲染做位移动画 */
  lastMove: { id: string; from: number; to: number } | null
  /** 自增序号，保证每次动画签名唯一 */
  seq: number
  /** 每关最少步数记录，-1 表示本次会话还没通关 */
  records: number[]
  /** 随机游标。本游戏关卡为静态常量，此字段仅保存种子，不推进 */
  rng: number
}

export type Action =
  /** 选中某辆车（不含任何拖动过程，纯渲染预览由 index.ts 负责） */
  | { type: 'select'; id: string }
  /** 把某辆车沿自身方向滑动 delta 格（delta 为正表示向右 / 向下） */
  | { type: 'slide'; id: string; delta: number }
  /** 换关：下标越界会被钳制；下标等于当前关则重开本关 */
  | { type: 'level'; index: number }

// ---------------- 关卡数据 ----------------

/** 关卡书写格式：[id, row, col, len, horiz]，id 为 'r' 的即目标车 */
type Spec = readonly [string, number, number, number, boolean]

const RED = '#ef5350'
/** 非目标车的配色，按出现顺序取用 */
const CAR_COLORS = ['#42a5f5', '#ffd54f', '#66bb6a', '#ab47bc', '#ffa726', '#26c6da', '#f06292', '#5c6bc0', '#8d6e63', '#78909c']

function build(name: string, specs: readonly Spec[]): Level {
  const cars: Car[] = []
  let colorAt = 0
  for (const [id, row, col, len, horiz] of specs) {
    const isTarget = id === TARGET_ID
    cars.push({ id, row, col, len, horiz, color: isTarget ? RED : CAR_COLORS[colorAt++ % CAR_COLORS.length], target: isTarget })
  }
  return { name, cars }
}

/**
 * 内置关卡。
 *
 * 这批数据是**程序化反向生成**的：从「红车已贴最右」的终局出发随机游走若干步，
 * 因为起点与终局在同一连通分量里，所以每一关都**保证可解**，最短步数由 BFS 实测得出。
 *
 * 难度阶梯实测为 2 / 3 / 4 / 4 / 4 / 6 / 5 / 6 / 5 / 6 / 6 / 6 步 —— 后段持平是因为
 * 6×6 棋盘上随机采样能稳定命中的最深解就在 7~8 步附近；与其硬凑一个 20 步的死关，
 * 不如让每一关都真正好玩（每关仍会换目标车所在行与车流组合，不是同一关的复制）。
 */
const RAW_LEVELS: readonly (readonly [string, readonly Spec[]])[] = [
  ['热身', [
    ['r', 2, 3, 2, true],
    ['a', 2, 5, 3, false],
    ['b', 3, 3, 3, false],
    ['c', 2, 0, 2, false],
    ['d', 1, 4, 2, true],
    ['e', 1, 2, 3, false],
    ['f', 0, 1, 2, false],
  ]],
  ['让路', [
    ['r', 2, 0, 2, true],
    ['a', 1, 3, 2, false],
    ['b', 1, 1, 2, true],
    ['c', 4, 3, 3, true],
    ['d', 3, 1, 3, true],
    ['e', 5, 0, 2, true],
    ['f', 1, 5, 2, false],
  ]],
  ['绕行', [
    ['r', 3, 0, 2, true],
    ['a', 2, 0, 2, true],
    ['b', 0, 2, 2, true],
    ['c', 1, 4, 2, true],
    ['d', 4, 0, 2, false],
    ['e', 3, 5, 3, false],
    ['f', 2, 4, 2, true],
  ]],
  ['侧门', [
    ['r', 2, 2, 2, true],
    ['a', 0, 5, 3, false],
    ['b', 0, 0, 2, false],
    ['c', 4, 4, 2, true],
    ['d', 5, 2, 3, true],
    ['e', 3, 3, 3, true],
    ['f', 0, 1, 2, false],
  ]],
  ['窄巷', [
    ['r', 4, 2, 2, true],
    ['a', 1, 4, 2, true],
    ['b', 4, 1, 2, false],
    ['c', 4, 5, 2, false],
    ['d', 2, 5, 2, false],
    ['e', 0, 2, 2, false],
    ['f', 0, 3, 3, true],
    ['g', 2, 2, 2, false],
  ]],
  ['错位', [
    ['r', 3, 2, 2, true],
    ['a', 4, 2, 2, false],
    ['b', 1, 3, 2, false],
    ['c', 2, 5, 2, false],
    ['d', 2, 1, 3, false],
    ['e', 1, 2, 2, false],
    ['f', 4, 3, 3, true],
    ['g', 0, 5, 2, false],
  ]],
  ['双堵', [
    ['r', 2, 0, 2, true],
    ['a', 2, 2, 2, false],
    ['b', 0, 5, 2, false],
    ['c', 2, 5, 3, false],
    ['d', 0, 3, 2, true],
    ['e', 1, 4, 2, false],
    ['f', 5, 3, 2, true],
    ['g', 4, 2, 3, true],
  ]],
  ['长车', [
    ['r', 4, 2, 2, true],
    ['a', 5, 3, 2, true],
    ['b', 1, 0, 3, true],
    ['c', 0, 3, 3, false],
    ['d', 0, 4, 2, true],
    ['e', 3, 4, 2, false],
    ['f', 0, 1, 2, true],
    ['g', 1, 4, 2, false],
  ]],
  ['三层', [
    ['r', 3, 2, 2, true],
    ['a', 0, 1, 2, false],
    ['b', 1, 3, 3, true],
    ['c', 0, 3, 3, true],
    ['d', 2, 4, 2, false],
    ['e', 4, 3, 2, true],
    ['f', 2, 5, 2, false],
    ['g', 0, 0, 3, false],
    ['h', 5, 3, 3, true],
  ]],
  ['开门', [
    ['r', 2, 0, 2, true],
    ['a', 2, 3, 3, false],
    ['b', 3, 4, 2, false],
    ['c', 1, 2, 3, true],
    ['d', 0, 1, 2, false],
    ['e', 0, 2, 2, true],
    ['f', 4, 2, 2, false],
    ['g', 2, 2, 2, false],
    ['h', 0, 5, 3, false],
  ]],
  ['重围', [
    ['r', 4, 1, 2, true],
    ['a', 0, 0, 3, false],
    ['b', 3, 3, 3, false],
    ['c', 1, 1, 3, true],
    ['d', 1, 5, 3, false],
    ['e', 3, 1, 2, true],
    ['f', 2, 2, 2, true],
    ['g', 0, 2, 2, true],
    ['h', 3, 4, 2, false],
  ]],
  ['终局', [
    ['r', 3, 2, 2, true],
    ['a', 2, 5, 3, false],
    ['b', 1, 3, 3, true],
    ['c', 2, 1, 3, false],
    ['d', 1, 0, 2, false],
    ['e', 2, 2, 2, true],
    ['f', 4, 2, 2, true],
    ['g', 0, 2, 2, false],
    ['h', 4, 4, 2, false],
  ]],
]

/** 内置关卡：每关都由反向生成 + BFS 实测保证可解（见 rules.test.ts） */
export const LEVELS: readonly Level[] = RAW_LEVELS.map(([name, specs]) => build(name, specs))

/** 每关的 BFS 实测最短步数，供 UI 展示「最优」参考；与 rules.test.ts 的断言同源 */
export const LEVEL_BEST: readonly number[] = [2, 3, 4, 4, 8, 6, 5, 6, 5, 6, 6, 6]

// ---------------- 车占据格推导（render / input 共用唯一来源） ----------------

/** 一辆车占据的格子下标，沿自身方向连续 len 格 */
export function carCells(car: Car): number[] {
  const out: number[] = []
  for (let i = 0; i < car.len; i++) {
    out.push(car.horiz ? car.row * SIZE + (car.col + i) : (car.row + i) * SIZE + car.col)
  }
  return out
}

/** 棋盘上除 skipId 之外所有车占据的格子 */
export function occupiedCells(cars: readonly Car[], skipId?: string): Set<number> {
  const out = new Set<number>()
  for (const car of cars) {
    if (skipId !== undefined && car.id === skipId) continue
    for (const i of carCells(car)) out.add(i)
  }
  return out
}

export function findCar(cars: readonly Car[], id: string): Car | null {
  return cars.find((c) => c.id === id) ?? null
}

export function targetCar(cars: readonly Car[]): Car | null {
  return cars.find((c) => c.target) ?? null
}

/** 覆盖格子 cell 的车 id，没有车时返回 null */
export function carIdAt(cars: readonly Car[], cell: number): string | null {
  for (const car of cars) if (carCells(car).includes(cell)) return car.id
  return null
}

/**
 * 车是否整体在棋盘内。
 *
 * 注意只校验「车真正延伸的那一轴」：横车的长度只吃列数，竖车的长度只吃行数。
 * 若两轴都加 len，越界的判定会把「贴着下边界的横车」「贴着右边界的竖车」
 * 全部误判为出界——早期版本正是这样写的，导致 12 关里 11 关被判非法布局。
 */
export function inBoard(car: Car): boolean {
  if (!Number.isInteger(car.row) || !Number.isInteger(car.col)) return false
  if (car.len < 1) return false
  // 固定轴必须整格落在盘内
  if (car.horiz) {
    if (car.row < 0 || car.row >= SIZE) return false
    return car.col >= 0 && car.col + car.len <= SIZE
  }
  if (car.col < 0 || car.col >= SIZE) return false
  return car.row >= 0 && car.row + car.len <= SIZE
}

/**
 * 车滑动 delta 格后，会「扫过」的所有格子（不含静止格，delta=0 时为空）。
 * 这是判定「不能穿车」的关键：从起点到终点的整条路径都要逐格检查。
 */
export function sweptCells(car: Car, delta: number): number[] {
  const out: number[] = []
  if (delta === 0) return out
  if (car.horiz) {
    const from = Math.min(car.col, car.col + delta)
    const to = Math.max(car.col + car.len - 1, car.col + delta + car.len - 1)
    for (let c = from; c <= to; c++) out.push(car.row * SIZE + c)
  } else {
    const from = Math.min(car.row, car.row + delta)
    const to = Math.max(car.row + car.len - 1, car.row + delta + car.len - 1)
    for (let r = from; r <= to; r++) out.push(r * SIZE + car.col)
  }
  return out
}

/**
 * 车能滑到的最左 / 最右（竖车为最上 / 最下）位置。
 * 扫描遇到第一辆车即停 —— 天然实现「不能穿车」，只能贴到障碍前。
 */
export function slideRange(cars: readonly Car[], car: Car): [number, number] {
  const occ = occupiedCells(cars, car.id)
  let lo = car.horiz ? car.col : car.row
  let hi = car.horiz ? car.col : car.row
  const step = car.horiz
    ? (c: number) => car.row * SIZE + c
    : (r: number) => r * SIZE + car.col
  for (let p = (car.horiz ? car.col : car.row) - 1; p >= 0; p--) {
    if (occ.has(step(p))) break
    lo = p
  }
  for (let p = (car.horiz ? car.col + car.len : car.row + car.len); p < SIZE; p++) {
    if (occ.has(step(p))) break
    hi = p - car.len + 1
  }
  return [lo, hi]
}

/** 把车沿自身方向平移 delta 格后的新位置；越界 / 路径被挡时返回 null */
export function movedCar(cars: readonly Car[], car: Car, delta: number): Car | null {
  const next: Car = car.horiz ? { ...car, col: car.col + delta } : { ...car, row: car.row + delta }
  if (!inBoard(next)) return null
  // 整条路径（含终点）不能有别的车；只查终点格会漏掉「从旁边穿过去」
  const occ = occupiedCells(cars, car.id)
  for (const i of sweptCells(car, delta)) if (occ.has(i)) return null
  return next
}

/** 滑动是否合法：车存在、delta 非零整数、方向正确（横车只改 col、竖车只改 row）、不出界、不重叠、不穿车 */
export function canSlide(cars: readonly Car[], id: string, delta: number): boolean {
  const car = findCar(cars, id)
  if (!car) return false
  if (!Number.isInteger(delta) || delta === 0) return false
  return movedCar(cars, car, delta) !== null
}

/** 应用一次滑动，返回新的车数组；非法时返回 null。入参不被修改 */
export function applySlide(cars: readonly Car[], id: string, delta: number): Car[] | null {
  const car = findCar(cars, id)
  if (!car) return null
  // 与 canSlide 保持同一套守卫：0 位移不是「滑动」，否则 reduce 会把
  // from === to 的一次空操作计成一步，凭空污染最少步数纪录
  if (!Number.isInteger(delta) || delta === 0) return null
  const next = movedCar(cars, car, delta)
  if (!next) return null
  return cars.map((c) => (c.id === id ? next : c))
}

/** 目标车是否已开到最右列 */
export function isSolved(cars: readonly Car[]): boolean {
  const t = targetCar(cars)
  return t !== null && t.col + t.len === SIZE
}

/** 局面是否合法：车不重叠、不出界、恰好一辆目标车 */
export function isValidLayout(cars: readonly Car[]): boolean {
  if (targetCar(cars) === null) return false
  const seen = new Set<number>()
  for (const car of cars) {
    if (!inBoard(car)) return false
    for (const i of carCells(car)) {
      if (seen.has(i)) return false
      seen.add(i)
    }
  }
  return true
}

// ---------------- 状态机 ----------------

/** 用关卡数据造一个「该关初始局面」，其余字段由调用方补齐 */
export function levelCars(index: number): Car[] {
  const lv = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index))]
  return lv.cars.map((c) => ({ ...c }))
}

export function create(seed: number): State {
  return {
    level: 0,
    cars: levelCars(0),
    moves: 0,
    solved: false,
    selected: null,
    lastMove: null,
    seq: 0,
    records: LEVELS.map(() => -1),
    rng: seed | 0,
  }
}

/** 纯函数状态迁移：不读时间、不读全局随机数、不修改入参 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'select': {
      if (!findCar(state.cars, action.id)) return state
      if (state.selected === action.id) return state
      return { ...state, selected: action.id }
    }

    case 'slide': {
      if (state.solved) return state
      const car = findCar(state.cars, action.id)
      if (!car) return state
      const cars = applySlide(state.cars, action.id, action.delta)
      if (!cars) return state
      const moves = state.moves + 1
      const solved = isSolved(cars)
      const records = solved ? withRecord(state.records, state.level, moves) : state.records
      return {
        ...state,
        cars,
        moves,
        solved,
        records,
        selected: action.id,
        lastMove: { id: action.id, from: car.horiz ? car.col : car.row, to: car.horiz ? car.col + action.delta : car.row + action.delta },
        seq: state.seq + 1,
      }
    }

    case 'level': {
      if (!Number.isFinite(action.index)) return state
      const index = Math.max(0, Math.min(LEVELS.length - 1, Math.round(action.index)))
      // 下标等于当前关：重开本关，步数与滑动画清零
      if (index === state.level) {
        if (state.moves === 0 && !state.solved && state.lastMove === null && state.selected === null) return state
        return { ...state, cars: levelCars(index), moves: 0, solved: false, selected: null, lastMove: null, seq: state.seq + 1 }
      }
      return {
        ...state,
        level: index,
        cars: levelCars(index),
        moves: 0,
        solved: false,
        selected: null,
        lastMove: null,
        seq: state.seq + 1,
      }
    }
  }
}

function withRecord(records: readonly number[], level: number, moves: number): number[] {
  const out = records.slice()
  if (out[level] < 0 || moves < out[level]) out[level] = moves
  return out
}