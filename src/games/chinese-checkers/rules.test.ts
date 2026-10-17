import { describe, expect, it } from 'vitest'
import {
  CELL_COUNT,
  HOME_CELLS,
  HOME_STAR,
  MAP,
  MAP_COLS,
  MAP_ROWS,
  NEIGHBORS,
  aiAction,
  countPieces,
  create,
  findMove,
  hexDist,
  idAt,
  kindOf,
  legalActions,
  moveToAction,
  movesFrom,
  movesOf,
  opponent,
  qOf,
  rOf,
  reduce,
  targetOf,
  type Action,
  type Player,
  type State,
} from './rules'

const clone = (s: State): State => JSON.parse(JSON.stringify(s)) as State

/**
 * Action 是 `select`（挑起点）与 `move`（整步）两段的联合类型，
 * 断言里要访问 `to` / `path` 必须先缩窄到 `move`，不能靠 `as any`。
 */
function expectMove(a: Action | null): { type: 'move'; from: number; to: number; path: number[] } {
  expect(a).not.toBeNull()
  expect(a!.type).toBe('move')
  return a as { type: 'move'; from: number; to: number; path: number[] }
}

/**
 * 空白盘 + 手工摆子：{ 'q,r': 玩家 }，其余全空（用于构造特定规则局面）。
 * anchor = true 时，若某一方一颗子都没有，就在对方的臂尖补一颗「锚子」，
 * 免得规则里的「对手无子可走判负」把构造局面的那一步直接判成终局。
 */
function stateWith(place: Record<string, Player>, turn: Player = 1, seed = 7, anchor = true): State {
  const base = create(seed)
  const cells = new Array<number>(CELL_COUNT).fill(0)
  for (const [key, p] of Object.entries(place)) {
    const [q, r] = key.split(',').map(Number)
    const id = idAt(q, r)
    if (id < 0) throw new Error(`(${q},${r}) 不是孔`)
    cells[id] = p
  }
  if (anchor) {
    if (countPieces(cells, 1) === 0) cells[idAt(-6, 0)] = 1
    if (countPieces(cells, 2) === 0) cells[idAt(6, -6)] = 2
  }
  return { ...base, cells, turn }
}

/** 当前回合那颗棋子的全部走法 */
function movesOfPiece(s: State, from: number) {
  return movesFrom(s.cells, from, s.turn)
}

/** 六条尖角臂的格位（与地图一一对应，直接写死便于断言） */
const ARMS: ReadonlyArray<ReadonlyArray<[number, number]>> = [
  // 西（玩家家）
  [
    [-4, 0],
    [-4, 1],
    [-4, 2],
    [-5, 0],
    [-5, 1],
    [-6, 0],
  ],
  // 东（电脑家）
  [
    [4, -2],
    [4, -1],
    [4, 0],
    [5, -1],
    [5, 0],
    [6, 0],
  ],
  [
    [2, 2],
    [1, 3],
    [0, 4],
    [1, 4],
    [0, 5],
    [0, 6],
  ],
  [
    [-2, 4],
    [-3, 4],
    [-4, 4],
    [-4, 5],
    [-5, 5],
    [-6, 6],
  ],
  [
    [-2, -2],
    [-1, -3],
    [-1, -4],
    [0, -4],
    [0, -5],
    [0, -6],
  ],
  [
    [2, -4],
    [3, -4],
    [4, -4],
    [4, -5],
    [5, -5],
    [6, -6],
  ],
]

/** 中央六边形（半径 3）的全部格 */
function centerCells(): number[] {
  const out: number[] = []
  for (let id = 0; id < CELL_COUNT; id++) {
    const q = qOf(id)
    const r = rOf(id)
    if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 3) out.push(id)
  }
  return out
}

describe('棋盘形状', () => {
  it('地图 13 行 × 13 列（没有孔用 #，不会被格式化吃掉空格）', () => {
    expect(MAP.length).toBe(MAP_ROWS)
    for (const line of MAP) expect(line.length).toBe(MAP_COLS)
  })

  it('全盘 73 个孔 = 中央六边形 37 + 六条尖角臂各 6', () => {
    expect(CELL_COUNT).toBe(73)
    expect(centerCells().length).toBe(37)
    const armIds = new Set(ARMS.flat().map(([q, r]) => idAt(q, r)))
    expect(armIds.size).toBe(36)
    // 73 格恰好被「中央 37 + 六臂 36」完全覆盖，互不重叠
    const all = new Set<number>([...centerCells(), ...armIds])
    expect(all.size).toBe(CELL_COUNT)
  })

  it('六个尖角三角各 6 格（每条臂 3+2+1），并且都在地图上', () => {
    for (const arm of ARMS) {
      const ids = arm.map(([q, r]) => idAt(q, r))
      expect(ids.every((id) => id >= 0)).toBe(true)
      expect(new Set(ids).size).toBe(6)
      // 臂尖只能挨着 1 个邻居，臂内侧挨着 5 个
      expect(NEIGHBORS[ids[ids.length - 1]].length).toBeGreaterThanOrEqual(1)
    }
  })

  it('六角邻接对称：a 邻 b ⇔ b 邻 a，距离为 1', () => {
    for (let id = 0; id < CELL_COUNT; id++) {
      expect(NEIGHBORS[id].length).toBeLessThanOrEqual(6)
      for (const n of NEIGHBORS[id]) {
        expect(NEIGHBORS[n]).toContain(id)
        expect(hexDist(id, n)).toBe(1)
      }
    }
    expect(NEIGHBORS.length).toBe(CELL_COUNT)
  })

  it('idAt 越界或非孔返回 -1，qOf/rOf 往返一致', () => {
    expect(idAt(0, 0)).toBeGreaterThanOrEqual(0)
    expect(idAt(7, 0)).toBe(-1)
    expect(idAt(0, -7)).toBe(-1)
    expect(idAt(0.5, 0)).toBe(-1)
    expect(idAt(-5, -1)).toBe(-1) // 地图上那一格没有孔
    for (let id = 0; id < CELL_COUNT; id++) expect(idAt(qOf(id), rOf(id))).toBe(id)
  })
})

describe('开局', () => {
  it('双方各 6 颗子，分别在自己的起始三角里', () => {
    const s = create(42)
    expect(s.cells.length).toBe(CELL_COUNT)
    expect(countPieces(s.cells, 1)).toBe(6)
    expect(countPieces(s.cells, 2)).toBe(6)
    expect(HOME_CELLS[1].length).toBe(6)
    expect(HOME_CELLS[2].length).toBe(6)
    for (const id of HOME_CELLS[1]) expect(s.cells[id]).toBe(1)
    for (const id of HOME_CELLS[2]) expect(s.cells[id]).toBe(2)
    expect(s.turn).toBe(1)
    expect(s.over).toBe(false)
    expect(s.winner).toBe(0)
    expect(s.moves).toBe(0)
    expect(s.selected).toBe(-1)
    expect(s.last).toBeNull()
  })

  it('两家各有一个中心星格，开局都是空的；目标指向对方的星格', () => {
    const s = create(1)
    expect(HOME_STAR[1]).toBeGreaterThanOrEqual(0)
    expect(HOME_STAR[2]).toBeGreaterThanOrEqual(0)
    expect(HOME_STAR[1]).not.toBe(HOME_STAR[2])
    expect(qOf(HOME_STAR[1])).toBeLessThan(0) // 玩家家在左边
    expect(qOf(HOME_STAR[2])).toBeGreaterThan(0) // 电脑家在右边
    expect(s.cells[HOME_STAR[1]]).toBe(0)
    expect(s.cells[HOME_STAR[2]]).toBe(0)
    expect(targetOf(1)).toBe(HOME_STAR[2])
    expect(targetOf(2)).toBe(HOME_STAR[1])
    // 星格紧贴自家三角正前方
    const near = (star: number, home: readonly number[]): number => Math.min(...home.map((id) => hexDist(id, star)))
    expect(near(HOME_STAR[1], HOME_CELLS[1])).toBeLessThanOrEqual(2)
    expect(near(HOME_STAR[2], HOME_CELLS[2])).toBeLessThanOrEqual(2)
    expect(hexDist(HOME_STAR[1], HOME_STAR[2])).toBeGreaterThan(5)
  })

  it('create 对同一 seed 完全一致', () => {
    expect(create(123)).toEqual(create(123))
    expect(create(123).rng).toBe(123)
    expect(create(123).cells).not.toBe(create(123).cells)
  })
})

describe('滑行', () => {
  it('滑一格到相邻空格：合法并换边', () => {
    const s = stateWith({ '0,0': 1 })
    const from = idAt(0, 0)
    const to = idAt(1, 0)
    const mv = findMove(s.cells, from, to, 1)
    expect(mv).not.toBeNull()
    const next = reduce(s, moveToAction(mv!))
    expect(next.cells[from]).toBe(0)
    expect(next.cells[to]).toBe(1)
    expect(next.turn).toBe(2)
    expect(next.moves).toBe(1)
    expect(next.selected).toBe(-1)
    expect(next.last?.path).toEqual([from, to])
    expect(next.last?.captures).toEqual([])
  })

  it('不能滑到有子的格（自己的和对手的都不行）', () => {
    // (0,1) 是敌子，但它身后 (0,2) 也被占，所以这一跳不成立，剩下 4 个滑行方向
    const s = stateWith({ '0,0': 1, '1,0': 1, '0,1': 2, '0,2': 2 })
    const tos = movesOfPiece(s, idAt(0, 0)).map((m) => m.to)
    expect(tos).not.toContain(idAt(1, 0)) // 自己的子
    expect(tos).not.toContain(idAt(0, 1)) // 对手的子
    expect(tos.length).toBe(4) // 六边形中心有 6 个邻居，两个被占
    expect(reduce(s, { type: 'move', from: idAt(0, 0), to: idAt(1, 0), path: [idAt(0, 0), idAt(1, 0)] })).toBe(s)
  })

  it('select 只接受能走动的己方子，clear 复位选中', () => {
    // (0,0) 被 6 个己方子围死：中间必须是敌子才能跳，所以它既滑不动也跳不了
    const s = stateWith({ '0,0': 1, '1,0': 1, '0,1': 1, '1,-1': 1, '0,-1': 1, '-1,0': 1, '-1,1': 1, '3,0': 1 })
    expect(movesFrom(s.cells, idAt(0, 0), 1).length).toBe(0)
    expect(reduce(s, { type: 'select', from: idAt(0, 0) })).toBe(s)

    const sel = reduce(s, { type: 'select', from: idAt(3, 0) })
    expect(sel.selected).toBe(idAt(3, 0))
    const cleared = reduce(sel, { type: 'clear' })
    expect(cleared.selected).toBe(-1)
    expect(reduce(cleared, { type: 'clear' })).toBe(cleared)
    expect(reduce(s, { type: 'select', from: -1 })).toBe(s)
    expect(reduce(s, { type: 'select', from: idAt(0, 3) })).toBe(s) // 空孔
    expect(reduce(s, { type: 'select', from: HOME_CELLS[2][0] })).toBe(s) // 对手的子
  })
})

describe('跳跃', () => {
  it('跳过相邻敌子落到其后空格', () => {
    const s = stateWith({ '0,0': 1, '1,0': 2, '-2,-1': 2 })
    const jump = movesOfPiece(s, idAt(0, 0)).find((m) => m.to === idAt(2, 0))
    expect(jump).toBeDefined()
    expect(jump!.captures).toEqual([idAt(1, 0)])
    const next = reduce(s, moveToAction(jump!))
    expect(next.cells[idAt(0, 0)]).toBe(0)
    expect(next.cells[idAt(1, 0)]).toBe(0) // 被吃掉的子立刻消失
    expect(next.cells[idAt(2, 0)]).toBe(1)
    expect(countPieces(next.cells, 2)).toBe(1)
    expect(next.turn).toBe(2)
  })

  it('中间是己方子则不可跳', () => {
    const s = stateWith({ '0,0': 1, '1,0': 1 })
    const moves = movesOfPiece(s, idAt(0, 0))
    expect(moves.map((m) => m.to)).not.toContain(idAt(2, 0))
    expect(moves.every((m) => m.path.length === 2)).toBe(true)
  })

  it('落点被占则不可跳', () => {
    const s = stateWith({ '0,0': 1, '1,0': 2, '2,0': 1 })
    const moves = movesOfPiece(s, idAt(0, 0))
    expect(moves.map((m) => m.to)).not.toContain(idAt(2, 0))
    expect(moves.every((m) => m.captures.length === 0)).toBe(true)
  })

  it('有吃必吃：能跳的时候不给出滑行选项', () => {
    const s = stateWith({ '0,0': 1, '1,0': 2, '2,1': 2 })
    expect(s.cells[idAt(0, 1)]).toBe(0) // 这一格本来可以滑过去
    const moves = movesOfPiece(s, idAt(0, 0))
    expect(moves.length).toBeGreaterThan(0)
    expect(moves.every((m) => m.captures.length > 0)).toBe(true)
  })

  it('连续跳 4 颗：整条链是一次 action，path 依次记录每一跳', () => {
    // 菱形回路：(-2,0) → (0,0) → (2,0) → (2,-2) → (0,-2)，最后一跳想回 (0,0) 必须被禁止
    const s = stateWith({ '-2,0': 1, '-1,0': 2, '1,0': 2, '2,-1': 2, '1,-2': 2, '0,-1': 2 })
    const moves = movesOfPiece(s, idAt(-2, 0))
    // 两条四连跳链各有一个走法方向（中途每一站也都是合法落点）
    expect(moves.length).toBe(7)
    expect(moves.map((m) => m.path.length).sort((a, b) => a - b)).toEqual([2, 3, 3, 4, 4, 5, 5])
    const cw = moves.find((m) => m.to === idAt(0, -2) && m.path.length === 5)
    const ccw = moves.find((m) => m.to === idAt(2, 0) && m.path.length === 5)
    expect(cw).toBeDefined()
    expect(ccw).toBeDefined()
    expect(cw!.path).toEqual([idAt(-2, 0), idAt(0, 0), idAt(2, 0), idAt(2, -2), idAt(0, -2)])
    expect(cw!.captures).toEqual([idAt(-1, 0), idAt(1, 0), idAt(2, -1), idAt(1, -2)])

    const next = reduce(s, moveToAction(cw!))
    expect(next.moves).toBe(1)
    expect(next.cells[idAt(0, -2)]).toBe(1)
    for (const c of cw!.captures) expect(next.cells[c]).toBe(0)
  })

  it('连跳作为单个 action 一次结算完：步数 +1、只换一次边', () => {
    const s = stateWith({ '-2,0': 1, '-1,0': 2, '1,0': 2, '2,-1': 2, '1,-2': 2, '0,-1': 2 })
    const mv = movesOfPiece(s, idAt(-2, 0)).find((m) => m.to === idAt(0, -2) && m.path.length === 5)!
    const next = reduce(s, moveToAction(mv))
    expect(next.moves).toBe(1)
    expect(next.turn).toBe(2)
    expect(next.last?.path).toEqual(mv.path)
    expect(next.last?.captures).toEqual(mv.captures)
    expect(next.over).toBe(false)
  })

  it('连跳搜索必然终止：路径不重复落格，也不会走回已落过的格子', () => {
    const s = stateWith({ '-2,0': 1, '-1,0': 2, '1,0': 2, '2,-1': 2, '1,-2': 2, '0,-1': 2 })
    const moves = movesOfPiece(s, idAt(-2, 0))
    expect(moves.length).toBeGreaterThan(0)
    for (const m of moves) {
      expect(new Set(m.path).size).toBe(m.path.length)
      expect(m.path.length).toBeLessThanOrEqual(CELL_COUNT)
      expect(new Set(m.captures).size).toBe(m.captures.length)
      for (const c of m.captures) expect(m.path).not.toContain(c)
    }
    // (0,0) 只在第一跳落过一次；后面那一跳想落回 (0,0) 必须被 seen 挡掉，否则会无限递归
    expect(moves.filter((m) => m.path.filter((id) => id === idAt(0, 0)).length > 1).length).toBe(0)
  })

  it('各种随机局面下连跳搜索都收敛', () => {
    let checked = 0
    for (let seed = 1; seed <= 30; seed++) {
      const s = create(seed * 7919)
      const moves = movesOf(s.cells, 1)
      for (const m of moves) expect(new Set(m.path).size).toBe(m.path.length)
      checked += moves.length
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('胜负', () => {
  it('占领对方家的中心星格即判胜', () => {
    const star = targetOf(1)
    const q = qOf(star)
    const r = rOf(star)
    const s = stateWith({ [`${q - 1},${r}`]: 1 }, 1)
    const mv = findMove(s.cells, idAt(q - 1, r), star, 1)
    expect(mv).not.toBeNull()
    const next = reduce(s, moveToAction(mv!))
    expect(next.cells[star]).toBe(1)
    expect(next.over).toBe(true)
    expect(next.winner).toBe(1)
  })

  it('电脑踩上玩家的星格同样判胜', () => {
    const star = targetOf(2)
    const q = qOf(star)
    const r = rOf(star)
    const s = stateWith({ [`${q - 1},${r}`]: 2 }, 2)
    const next = reduce(s, moveToAction(findMove(s.cells, idAt(q - 1, r), star, 2)!))
    expect(next.over).toBe(true)
    expect(next.winner).toBe(2)
  })

  it('走到自家星格不算赢', () => {
    const star = HOME_STAR[1]
    const q = qOf(star)
    const r = rOf(star)
    const s = stateWith({ [`${q - 1},${r}`]: 1 }, 1)
    const next = reduce(s, moveToAction(findMove(s.cells, idAt(q - 1, r), star, 1)!))
    expect(next.cells[star]).toBe(1)
    expect(next.over).toBe(false)
    expect(next.winner).toBe(0)
  })

  it('对手一颗子都不剩时判负', () => {
    const s = stateWith({ '0,0': 1 }, 1, 7, false)
    expect(countPieces(s.cells, 2)).toBe(0)
    const next = reduce(s, moveToAction(movesOfPiece(s, idAt(0, 0))[0]))
    expect(next.over).toBe(true)
    expect(next.winner).toBe(1)
  })

  it('对手被完全堵死（一颗子也动不了）时判负', () => {
    // 电脑子 (1,0)：6 个邻居全被玩家子占住，再把 6 个跳跃落点也占住
    const place: Record<string, Player> = { '1,0': 2, '0,-6': 1 }
    const dirs: ReadonlyArray<readonly [number, number]> = [
      [0, 1],
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, 0],
      [-1, 1],
    ]
    for (const [dq, dr] of dirs) {
      for (const n of NEIGHBORS[idAt(1, 0)]) {
        if (qOf(n) === 1 + dq && rOf(n) === 0 + dr) place[`${qOf(n)},${rOf(n)}`] = 1
      }
      const land = idAt(1 + dq * 2, 0 + dr * 2)
      if (land >= 0) place[`${qOf(land)},${rOf(land)}`] = 1
    }
    const s = stateWith(place, 1, 7, false)
    expect(movesOf(s.cells, 2).length).toBe(0)
    // 玩家走一枚离 (1,0) 足够远的子，免得顺手腾出它的跳跃落点
    const mv = movesOf(s.cells, 1).find((m) => m.from === idAt(0, -6))
    expect(mv).toBeDefined()
    const next = reduce(s, moveToAction(mv!))
    expect(movesOf(next.cells, 2).length).toBe(0)
    expect(next.over).toBe(true)
    expect(next.winner).toBe(1)
  })

  it('结束后不再接受任何动作', () => {
    const star = targetOf(1)
    const q = qOf(star)
    const r = rOf(star)
    const s = stateWith({ [`${q - 1},${r}`]: 1 }, 1)
    const over = reduce(s, moveToAction(findMove(s.cells, idAt(q - 1, r), star, 1)!))
    expect(over.over).toBe(true)
    expect(legalActions(over)).toEqual([])
    expect(reduce(over, { type: 'clear' })).toBe(over)
    expect(reduce(over, { type: 'hint' })).toBe(over)
    expect(aiAction(over)).toBeNull()
  })
})

describe('非法动作', () => {
  it('越界 / 非己方子 / 空孔 / 伪造 path 全部被拒绝', () => {
    const s = stateWith({ '0,0': 1, '1,0': 2 })
    expect(reduce(s, { type: 'move', from: -1, to: 0, path: [-1, 0] })).toBe(s)
    expect(reduce(s, { type: 'move', from: 999, to: 0, path: [999, 0] })).toBe(s)
    expect(reduce(s, { type: 'move', from: 0.5, to: 0, path: [0.5, 0] })).toBe(s)
    // 走对手的子
    expect(reduce(s, { type: 'move', from: idAt(1, 0), to: idAt(2, 0), path: [idAt(1, 0), idAt(2, 0)] })).toBe(s)
    // 空孔
    expect(reduce(s, { type: 'move', from: idAt(0, 3), to: idAt(1, 3), path: [idAt(0, 3), idAt(1, 3)] })).toBe(s)
    // 真实的一跳：path = [起点, 落点]
    const real = reduce(s, { type: 'move', from: idAt(0, 0), to: idAt(2, 0), path: [idAt(0, 0), idAt(2, 0)] })
    expect(real.cells[idAt(2, 0)]).toBe(1)
    expect(real.cells[idAt(1, 0)]).toBe(0)
    // 伪造：在 path 里塞一个根本不存在的中间落点
    expect(reduce(s, { type: 'move', from: idAt(0, 0), to: idAt(2, 0), path: [idAt(0, 0), idAt(1, 0), idAt(2, 0)] })).toBe(s)
    // 落点不是真的落点
    expect(reduce(s, { type: 'move', from: idAt(0, 0), to: idAt(0, -1), path: [idAt(0, 0), idAt(0, -1)] })).toBe(s)
  })

  it('电脑回合玩家不能插手', () => {
    const s = stateWith({ '0,0': 1 }, 2)
    expect(reduce(s, { type: 'select', from: idAt(0, 0) })).toBe(s)
    expect(reduce(s, { type: 'hint' })).toBe(s)
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参（cells 数组最容易被就地改）', () => {
    const s = stateWith({ '0,0': 1, '1,0': 2 })
    const before = clone(s)
    const next = reduce(s, moveToAction(movesOfPiece(s, idAt(0, 0))[0]))
    expect(s).toEqual(before)
    expect(next).not.toBe(s)
    expect(next.cells).not.toBe(s.cells)
    expect(next.last).not.toBe(s.last)
  })

  it('相同输入两次调用结果完全相等', () => {
    const s = stateWith({ '-2,0': 1, '-1,0': 2, '1,0': 2, '2,-1': 2, '1,-2': 2, '0,-1': 2 })
    const mv = movesOfPiece(s, idAt(-2, 0)).find((m) => m.to === idAt(0, -2))!
    expect(reduce(s, moveToAction(mv))).toEqual(reduce(s, moveToAction(mv)))
  })

  it('连跳过程也不会污染最初的 state', () => {
    const s0 = stateWith({ '-2,0': 1, '-1,0': 2, '1,0': 2, '2,-1': 2, '1,-2': 2, '0,-1': 2 })
    const snap = clone(s0)
    const mv = movesOfPiece(s0, idAt(-2, 0)).find((m) => m.to === idAt(0, -2))!
    reduce(s0, moveToAction(mv))
    expect(s0).toEqual(snap)
  })

  it('连续多步 reduce 不会污染最初的 state', () => {
    const s0 = create(5)
    const snap = clone(s0)
    let s = s0
    for (let i = 0; i < 12 && !s.over; i++) {
      const mv = movesOf(s.cells, s.turn)[0]
      if (!mv) break
      s = reduce(s, moveToAction(mv))
    }
    expect(s0).toEqual(snap)
    expect(s.moves).toBeGreaterThan(0)
  })
})

describe('AI', () => {
  it('只在电脑回合出招', () => {
    expect(aiAction(create(1))).toBeNull() // 开局轮到玩家
    expect(aiAction(stateWith({ '0,0': 1 }, 1))).toBeNull()
    expect(aiAction({ ...create(1), turn: 2, over: true, winner: 1 })).toBeNull()
    expect(aiAction(stateWith({ '0,0': 2 }, 2))).not.toBeNull()
  })

  it('每一步都从 legalActions 里选', () => {
    for (let seed = 1; seed <= 8; seed++) {
      let s = create(seed * 104729)
      let guard = 0
      while (!s.over && guard++ < 80) {
        const cands = legalActions(s)
        if (cands.length === 0) break
        const a = s.turn === 2 ? aiAction(s) : cands[seed % cands.length]
        expect(a).not.toBeNull()
        expect(cands).toContainEqual(a)
        s = reduce(s, a!)
      }
    }
  })

  it('能吃子时一定先吃子', () => {
    // 电脑子 (0,0) 可以跳过玩家子 (1,0) 落到 (2,0)
    const s = stateWith({ '0,0': 2, '1,0': 1 }, 2)
    const a = aiAction(s)
    expect(findMove(s.cells, idAt(0, 0), idAt(2, 0), 2)).not.toBeNull()
    expect(expectMove(a).to).toBe(idAt(2, 0))
    expect(countPieces(reduce(s, a!).cells, 1)).toBe(0)
  })

  it('一步能踩上目标星格时立刻取胜，不做别的', () => {
    const star = targetOf(2)
    const q = qOf(star)
    const r = rOf(star)
    const s = stateWith({ [`${q - 1},${r}`]: 2, '0,0': 2, '-1,-1': 2 }, 2)
    const a = aiAction(s)
    expect(expectMove(a).to).toBe(star)
    const next = reduce(s, a!)
    expect(next.over).toBe(true)
    expect(next.winner).toBe(2)
  })

  it('没有吃子时会挑「更靠近自己目标星格」的一步', () => {
    const target = targetOf(2)
    const s = stateWith({ '0,0': 2 }, 2)
    const dist = (st: State): number => {
      let d = 0
      for (let id = 0; id < CELL_COUNT; id++) if (st.cells[id] === 2) d += hexDist(id, target)
      return d
    }
    const a = aiAction(s)
    const next = reduce(s, a!)
    expect(dist(next)).toBeLessThan(dist(s))
    expect(expectMove(a).path.length).toBe(2)
  })

  it('相同状态总是返回相同动作（可复盘）', () => {
    const s = stateWith({ '0,0': 2, '1,0': 2, '-1,1': 2 }, 2, 99)
    expect(aiAction(s)).toEqual(aiAction(s))
  })

  it('不同 seed 的开局 AI 走法可以不同（可播种随机已生效）', () => {
    const moves = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) moves.add(JSON.stringify(aiAction({ ...create(seed), turn: 2 })))
    expect(moves.size).toBeGreaterThan(1)
  })

  it('全自动对局必然在有限步内终局，且每一步都合法', () => {
    let finished = 0
    for (let seed = 1; seed <= 12; seed++) {
      let s = create(seed * 31337)
      let guard = 0
      while (!s.over && guard++ < 300) {
        const cands = legalActions(s)
        if (cands.length === 0) break
        const a = s.turn === 2 ? aiAction(s) : cands[seed % cands.length]
        expect(cands).toContainEqual(a)
        s = reduce(s, a!)
      }
      expect(s.over).toBe(true)
      expect(s.winner === 1 || s.winner === 2).toBe(true)
      expect(s.moves).toBeLessThanOrEqual(300)
      finished++
    }
    expect(finished).toBe(12)
  })

  it('AI 单步耗时远低于 100ms（打印实测值）', () => {
    let worst = 0
    let total = 0
    let n = 0
    for (let seed = 1; seed <= 24; seed++) {
      let s = create(seed * 104729)
      let guard = 0
      while (!s.over && guard++ < 300) {
        const cands = legalActions(s)
        if (cands.length === 0) break
        if (s.turn !== 2) {
          s = reduce(s, cands[seed % cands.length])
          continue
        }
        const t0 = performance.now()
        const a = aiAction(s)
        const dt = performance.now() - t0
        worst = Math.max(worst, dt)
        total += dt
        n++
        s = reduce(s, a!)
      }
    }
    const avg = total / n
    console.log(`[AI 耗时] 决策 ${n} 次，平均 ${avg.toFixed(4)}ms，最差 ${worst.toFixed(4)}ms`)
    expect(n).toBeGreaterThan(0)
    expect(worst).toBeLessThan(100)
  })
})

describe('提示动作', () => {
  it('hint 只在玩家回合生效，且走出的正是 legalActions 里的某一步', () => {
    const s = stateWith({ '0,0': 1, '1,0': 2, '-2,-1': 2 })
    const next = reduce(s, { type: 'hint' })
    expect(next).not.toBe(s)
    expect(next.turn).toBe(2)
    expect(next.moves).toBe(1)
    expect(next.rng).not.toBe(s.rng)
    const same = legalActions(s).some((a) => reduce(s, a).last?.path.join() === next.last?.path.join())
    expect(same).toBe(true)
    expect(reduce({ ...s, turn: 2 }, { type: 'hint' })).toEqual({ ...s, turn: 2 })
  })

  it('开局也能 hint：走出的一步仍然合法', () => {
    const s = create(3)
    const a: Action = { type: 'hint' }
    const next = reduce(s, a)
    expect(next.moves).toBe(1)
    expect(legalActions(s).some((x) => reduce(s, x).last?.path.join() === next.last?.path.join())).toBe(true)
  })
})

describe('辅助函数', () => {
  it('opponent 互为对方', () => {
    expect(opponent(1)).toBe(2)
    expect(opponent(2)).toBe(1)
    expect(opponent(opponent(1))).toBe(1)
  })

  it('kindOf 区分普通空孔 / 起始区 / 星格', () => {
    expect(kindOf(HOME_CELLS[1][0])).toBe(1)
    expect(kindOf(HOME_CELLS[2][0])).toBe(2)
    expect(kindOf(HOME_STAR[1])).toBe(3)
    expect(kindOf(HOME_STAR[2])).toBe(3)
    expect(kindOf(idAt(0, 0))).toBe(0)
    expect(kindOf(-1)).toBe(0)
  })

  it('moveToAction 复制 path，避免外部改到 state 里的引用', () => {
    const path = [idAt(0, 0), idAt(1, 0)]
    const a = expectMove(moveToAction({ from: idAt(0, 0), to: idAt(1, 0), path, captures: [] }))
    expect(a.type).toBe('move')
    expect(a.path).not.toBe(path)
    expect(a.path).toEqual(path)
  })
})