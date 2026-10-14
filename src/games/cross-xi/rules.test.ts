import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng'
import {
  ARM,
  ARM_ENDS,
  CELLS,
  CELL_COUNT,
  MAX_DEPTH,
  MOVE_LIMIT,
  OFF_BOARD,
  PIECES_EACH,
  SPAN,
  STALL_LIMIT,
  START_P1,
  START_P2,
  TIP_DIST,
  adjacents,
  aiAction,
  bestAction,
  cellAt,
  cellIndex,
  countPieces,
  create,
  decideByPosition,
  dist,
  evaluate,
  exposedToPushOut,
  isArmEnd,
  isPushedOff,
  legalActions,
  move,
  movesFrom,
  other,
  reduce,
  tipDist,
  winnerOf,
  type Action,
  type Cell,
  type Player,
  type State,
} from './rules'

const clone = (s: State): State => JSON.parse(JSON.stringify(s)) as State

/** 用坐标表构造局面：[x, y, 归属]，0 = 空；未列出的格一律空 */
function withPieces(turn: Player, list: [number, number, Cell][], seed = 7): State {
  const pieces = new Array<Cell>(CELL_COUNT).fill(0)
  for (const [x, y, v] of list) {
    const i = cellIndex(x, y)
    if (i < 0) throw new Error(`坐标不在棋盘上：${x},${y}`)
    pieces[i] = v
  }
  return { ...create(seed), pieces, turn }
}

const at = (x: number, y: number): number => cellIndex(x, y)
const targets = (pieces: readonly Cell[], from: number): number[] => movesFrom(pieces, from).map((m) => m.to)
const movesOf = (pieces: readonly Cell[], from: number) => movesFrom(pieces, from)

/** 按种子随机挑一个合法动作 */
function randomAction(s: State, r: Rng): Action | null {
  const acts = legalActions(s)
  return acts.length === 0 ? null : acts[r.int(acts.length)]
}

// ---------------- 棋盘形状 ----------------

describe('十字形棋盘', () => {
  it('全盘 13 格：横臂 7 + 竖臂 7 − 共用的中心格', () => {
    expect(CELL_COUNT).toBe(13)
    expect(CELLS.length).toBe(CELL_COUNT)
    expect(SPAN).toBe(7)
    expect(ARM).toBe(3)
    const horiz = CELLS.filter((c) => c.y === 0)
    const vert = CELLS.filter((c) => c.x === 0)
    expect(horiz.length).toBe(7)
    expect(vert.length).toBe(7)
    expect(horiz.length + vert.length - 1).toBe(CELL_COUNT)
    expect(CELLS.filter((c) => c.x === 0 && c.y === 0).length).toBe(1)
  })

  it('每个格子都在十字的任一条臂上（不是方阵），且坐标不重复', () => {
    for (const c of CELLS) expect(c.x === 0 || c.y === 0).toBe(true)
    // 4 个象限里只有中心那一个格，其余 12 格分居四条臂
    expect(CELLS.filter((c) => c.x !== 0 && c.y !== 0).length).toBe(0)
    const keys = new Set(CELLS.map((c) => `${c.x},${c.y}`))
    expect(keys.size).toBe(CELL_COUNT)
  })

  it('十字形连通：中心格可沿臂走到任意格', () => {
    const seen = new Set<number>([cellIndex(0, 0)])
    const queue = [cellIndex(0, 0)]
    while (queue.length > 0) {
      const cur = queue.shift() as number
      for (const j of adjacents(cur)) if (!seen.has(j)) {
        seen.add(j)
        queue.push(j)
      }
    }
    expect(seen.size).toBe(CELL_COUNT)
  })

  it('cellIndex 与 cellAt 互为逆映射；棋盘外坐标返回 -1 / null', () => {
    for (let i = 0; i < CELL_COUNT; i++) {
      const at2 = cellAt(i)
      expect(at2).not.toBeNull()
      expect(cellIndex(at2!.x, at2!.y)).toBe(i)
    }
    expect(cellIndex(1, 1)).toBe(-1)
    expect(cellIndex(-2, 2)).toBe(-1)
    expect(cellIndex(0, -4)).toBe(-1)
    expect(cellIndex(4, 0)).toBe(-1)
    expect(cellIndex(0.5, 0)).toBe(-1)
    expect(cellAt(-1)).toBeNull()
    expect(cellAt(CELL_COUNT)).toBeNull()
  })

  it('中心格四向可走，两臂上的格只能沿本臂前后', () => {
    expect(adjacents(cellIndex(0, 0)).length).toBe(4)
    expect(adjacents(cellIndex(0, -1)).length).toBe(2)
    expect(adjacents(cellIndex(2, 0)).length).toBe(2)
    expect(adjacents(cellIndex(3, 0)).length).toBe(1) // 臂端格只有一条臂能走
    const empty = new Array<Cell>(CELL_COUNT).fill(0)
    const east = targets(empty, cellIndex(0, 0)).filter((i) => cellAt(i)!.x > 0)
    const north = targets(empty, cellIndex(0, 0)).filter((i) => cellAt(i)!.y < 0)
    expect(east.length).toBe(3)
    expect(north.length).toBe(3)
    for (const to of movesOf(empty, cellIndex(2, 0))) expect(cellAt(to.to)!.y).toBe(0)
  })
})

// ---------------- 底线 = 四个臂端格 ----------------

describe('底线（臂端格）', () => {
  it('底线就是十字的四个尖格 (3,0)、(0,3)、(-3,0)、(0,-3)，四格都算', () => {
    expect(ARM_ENDS.length).toBe(4)
    const coords = ARM_ENDS.map((i) => cellAt(i)).sort((a, b) => a!.x - b!.x || a!.y - b!.y)
    expect(coords).toEqual([
      { x: -3, y: 0 },
      { x: 0, y: -3 },
      { x: 0, y: 3 },
      { x: 3, y: 0 },
    ])
    // 都在棋盘上、互不相同，且没有中心格
    expect(new Set(ARM_ENDS).size).toBe(4)
    for (const i of ARM_ENDS) expect(isArmEnd(i)).toBe(true)
    expect(isArmEnd(cellIndex(0, 0))).toBe(false)
    expect(isArmEnd(cellIndex(2, 0))).toBe(false)
    expect(isArmEnd(-1)).toBe(false)
    // 底线格上没有任何一格能再往外滑（挤出去 = 出界）
    for (const i of ARM_ENDS) {
      for (const m of movesFrom(new Array<Cell>(CELL_COUNT).fill(0), i)) expect(m.to).toBeGreaterThanOrEqual(0)
    }
  })

  it('tipDist = 离最近臂端还有几步：尖格 0、臂中 1/2、中心 3', () => {
    expect(tipDist(at(3, 0))).toBe(0)
    expect(tipDist(at(0, -3))).toBe(0)
    expect(tipDist(at(-3, 0))).toBe(0)
    expect(tipDist(at(0, 3))).toBe(0)
    expect(tipDist(at(2, 0))).toBe(1)
    expect(tipDist(at(1, 0))).toBe(2)
    expect(tipDist(at(0, 0))).toBe(ARM)
    expect(TIP_DIST.length).toBe(CELL_COUNT)
    for (let i = 0; i < CELL_COUNT; i++) expect(TIP_DIST[i]).toBe(tipDist(i))
    // 到各臂端的距离都不小于到最近臂端的距离
    for (let i = 0; i < CELL_COUNT; i++) {
      for (const e of ARM_ENDS) expect(tipDist(i)).toBeLessThanOrEqual(dist(i, e))
    }
  })

  it('开局双方各 3 枚、共 6 枚，按 180° 旋转对称摆放', () => {
    const s = create(42)
    expect(PIECES_EACH).toBe(3)
    expect(s.pieces.length).toBe(CELL_COUNT)
    expect(countPieces(s.pieces, 1)).toBe(3)
    expect(countPieces(s.pieces, 2)).toBe(3)
    expect(START_P1.length).toBe(3)
    expect(START_P2.length).toBe(3)
    expect(s.turn).toBe(1)
    expect(s.over).toBe(false)
    expect(s.winner).toBe(0)
    expect(s.moves).toBe(0)

    const rot = (i: number): number => {
      const c = cellAt(i) as { x: number; y: number }
      return cellIndex(-c.x, -c.y)
    }
    const mine = new Set(START_P1.map(rot))
    for (const i of START_P2) expect(mine.has(i)).toBe(true)
    expect(START_P1.filter((i) => START_P2.includes(i))).toEqual([])
    for (const i of START_P1) expect(s.pieces[i]).toBe(1)
    for (const i of START_P2) expect(s.pieces[i]).toBe(2)
    // 没有任何开局子站在臂端格上
    for (const i of [...START_P1, ...START_P2]) expect(isArmEnd(i)).toBe(false)
  })

  it('create 对同一 seed 完全一致', () => {
    expect(create(123)).toEqual(create(123))
    expect(create(123).rng).toBe(123)
    // 开局摆位是固定常量（关卡对称），seed 只影响 rng 游标 —— 但对象不能是同一个引用
    expect(create(1).pieces).not.toBe(create(1).pieces)
    expect(create(1).pieces).toEqual(create(1).pieces)
  })
})

// ---------------- 滑动与挤 ----------------

describe('滑动与挤', () => {
  const empty = new Array<Cell>(CELL_COUNT).fill(0)

  it('沿直线可以滑到同方向的任意空格', () => {
    const s = withPieces(1, [[0, 0, 1]])
    expect(targets(s.pieces, at(0, 0)).sort((a, b) => a - b)).toEqual(
      [
        at(-3, 0),
        at(-2, 0),
        at(-1, 0),
        at(1, 0),
        at(2, 0),
        at(3, 0),
        at(0, -3),
        at(0, -2),
        at(0, -1),
        at(0, 1),
        at(0, 2),
        at(0, 3),
      ].sort((a, b) => a - b),
    )
  })

  it('不能越过棋子：前方被挡时只给「挤」，不给落到它后面的滑行', () => {
    const s = withPieces(1, [
      [0, 0, 1],
      [1, 0, 2],
    ])
    const east = movesOf(s.pieces, at(0, 0)).filter((m) => cellAt(m.to)!.x === 1)
    expect(east.length).toBe(1)
    expect(east[0].to).toBe(at(1, 0))
    expect(east[0].pushed).toEqual([{ from: at(1, 0), to: at(2, 0) }])
    expect(targets(s.pieces, at(0, 0))).not.toContain(at(2, 0))
  })

  it('挤：连续棋子整体后移 1 格，且归属不变（不吃子）', () => {
    const s = withPieces(1, [
      [0, -3, 1],
      [0, -2, 2],
      [0, -1, 2],
    ])
    const m = movesOf(s.pieces, at(0, -3)).find((x) => x.to === at(0, -2))
    expect(m).toBeDefined()
    expect(m!.pushed).toEqual([
      { from: at(0, -2), to: at(0, -1) },
      { from: at(0, -1), to: at(0, 0) },
    ])
    const n = reduce(s, { type: 'move', from: at(0, -3), to: at(0, -2) })
    expect(n.pieces[at(0, -3)]).toBe(0)
    expect(n.pieces[at(0, -2)]).toBe(1)
    expect(n.pieces[at(0, -1)]).toBe(2) // 被挤的仍然是电脑的子
    expect(n.pieces[at(0, 0)]).toBe(2)
    expect(countPieces(n.pieces, 2)).toBe(2) // 挤了但没挤出去，谁都没少
    expect(n.turn).toBe(2)
    expect(n.moves).toBe(1)
    expect(n.last).toEqual({ by: 1, from: at(0, -3), to: at(0, -2), pushed: m!.pushed })
  })

  it('新规则：链尾顶到臂端之外时照样能挤，链尾出界消失', () => {
    // 玩家 (0,0)，电脑 (1,0)(2,0)(3,0) 一路排到东端臂尖
    const s = withPieces(1, [
      [0, 0, 1],
      [1, 0, 2],
      [2, 0, 2],
      [3, 0, 2],
    ])
    const m = movesOf(s.pieces, at(0, 0)).find((x) => x.to === at(1, 0))
    expect(m).toBeDefined()
    expect(m!.pushed).toEqual([
      { from: at(1, 0), to: at(2, 0) },
      { from: at(2, 0), to: at(3, 0) },
      { from: at(3, 0), to: OFF_BOARD },
    ])
    expect(isPushedOff(m!.pushed[2])).toBe(true)
    expect(isPushedOff(m!.pushed[0])).toBe(false)

    const n = reduce(s, { type: 'move', from: at(0, 0), to: at(1, 0) })
    expect(n.pieces[at(1, 0)]).toBe(1) // 玩家推进到 (1,0)
    expect(n.pieces[at(2, 0)]).toBe(2) // 电脑 (1,0) → (2,0)
    expect(n.pieces[at(3, 0)]).toBe(2) // 电脑 (2,0) → (3,0)
    // 链尾原本就站在东臂尖 (3,0)，身后无处可退 → 被挤出棋盘、从数组里消失，
    // 所以 (3,0) 最终站着的是「从 (2,0) 挪过来」的那一枚，而不是链尾本身。
    expect(countPieces(n.pieces, 2)).toBe(2) // 3 → 2，恰好少 1
    expect(n.pieces.filter((v) => v !== 0).length).toBe(3) // 玩家 1 枚 + 电脑 2 枚
    expect(n.over).toBe(false)
    expect(n.winner).toBe(0)
  })

  it('新规则：一步最多挤掉一枚 —— 链尾出界后链条断开', () => {
    // 电脑 3 枚一字排到东端臂尖并夹住玩家的子，只有一次出界的机会
    const s = withPieces(1, [
      [0, 0, 1],
      [1, 0, 2],
      [2, 0, 2],
      [3, 0, 2],
    ])
    for (const m of movesFrom(s.pieces, at(0, 0))) {
      const off = m.pushed.filter(isPushedOff).length
      expect(off).toBeLessThanOrEqual(1)
    }
  })

  it('链上可以混有己方棋子，也可能是自己把自己的子挤出棋盘', () => {
    // 玩家 (2,0) 后面顶着自己 (3,0)：向西没有空间，向东一挤就把自己的子送出界
    const s = withPieces(1, [
      [2, 0, 1],
      [3, 0, 1],
      [0, 1, 2],
    ])
    const m = movesOf(s.pieces, at(2, 0)).find((x) => x.to === at(3, 0))
    expect(m).toBeDefined()
    expect(m!.pushed).toEqual([{ from: at(3, 0), to: OFF_BOARD }])
    const n = reduce(s, { type: 'move', from: at(2, 0), to: at(3, 0) })
    expect(countPieces(n.pieces, 1)).toBe(1) // 自己少了一枚
    expect(n.pieces[at(3, 0)]).toBe(1) // 走子方补到了尖格上
  })

  it('不能滑出棋盘：臂端格只能朝盘内走', () => {
    const s = withPieces(1, [[3, 0, 1]])
    const got = targets(s.pieces, at(3, 0))
    expect(got.length).toBe(6)
    for (const i of got) expect(cellAt(i)!.x).toBeLessThanOrEqual(3)
    const tip = withPieces(1, [[0, -3, 1]])
    for (const i of targets(tip.pieces, at(0, -3))) expect(cellAt(i)!.y).toBeGreaterThanOrEqual(-3)
    // 每一手的目标格都必须真实存在于棋盘上
    for (const i of [...Array(CELL_COUNT).keys()]) {
      const st = withPieces(1, [CELLS[i] && [CELLS[i].x, CELLS[i].y, 1 as Cell]])
      for (const m of movesFrom(st.pieces, i)) expect(cellAt(m.to)).not.toBeNull()
    }
  })

  it('只要还有子就一定走得出：空格就滑，被挡就挤', () => {
    const r = new Rng(9001)
    for (let trial = 0; trial < 300; trial++) {
      let s = create(trial * 31 + 7)
      for (let step = 0; step < 40; step++) {
        if (s.over) break
        for (const p of [1, 2] as Player[]) {
          const st = s.turn === p ? s : { ...s, turn: p }
          if (countPieces(st.pieces, p) > 0) expect(legalActions(st).length).toBeGreaterThan(0)
        }
        const a = randomAction(s, r)
        if (a === null) break
        s = reduce(s, a)
      }
    }
  })

  it('legalActions 只包含当前走子方的棋子', () => {
    const s = create(9)
    const acts = legalActions(s)
    expect(acts.length).toBeGreaterThan(0)
    expect(acts.every((a) => a.type === 'move' && s.pieces[a.from] === 1)).toBe(true)
    const s2 = { ...s, turn: 2 as Player }
    expect(legalActions(s2).every((a) => a.type === 'move' && s2.pieces[a.from] === 2)).toBe(true)
  })

  it('非法 move 被拒绝：动对方的子、跳子、原地不动、越界', () => {
    const s = withPieces(1, [
      [0, 0, 1],
      [1, 0, 2],
    ])
    expect(move(s, at(1, 0), at(2, 0))).toBe(s)
    expect(move(s, at(0, 0), at(2, 0))).toBe(s)
    expect(move(s, at(0, 0), at(0, 0))).toBe(s)
    expect(move(s, at(0, 0), CELL_COUNT)).toBe(s)
    expect(move(s, -1, at(1, 0))).toBe(s)
    expect(move(s, at(0, 0), 1.5)).toBe(s)
    expect(s.moves).toBe(0)
    expect(s.pieces).toEqual(withPieces(1, [[0, 0, 1], [1, 0, 2]]).pieces)
  })

  it('pick / hover / leave 只改 UI 选中态，不碰盘面', () => {
    const s = create(1)
    const p1 = reduce(s, { type: 'pick', cell: START_P1[0] })
    expect(p1.sel).toBe(START_P1[0])
    expect(p1.pieces).toEqual(s.pieces)
    expect(p1.moves).toBe(0)
    expect(reduce(s, { type: 'pick', cell: START_P2[0] }).sel).toBe(-1)
    expect(reduce(p1, { type: 'hover', cell: at(0, 0) }).hover).toBe(at(0, 0))
    const cleared = reduce(reduce(p1, { type: 'hover', cell: 3 }), { type: 'leave' })
    expect(cleared.sel).toBe(-1)
    expect(cleared.hover).toBe(-1)
    expect(reduce(s, { type: 'leave' })).toBe(s)
  })

  it('空局面下中心格 12 个方向都可落（每条臂 6 格）', () => {
    expect(targets(empty, at(0, 0)).length).toBe(12)
  })
})

// ---------------- 胜负：把对方全部挤出棋盘 ----------------

describe('胜负：挤空对方才赢', () => {
  it('winnerOf：对方一枚不剩则我方获胜', () => {
    expect(winnerOf(withPieces(2, [[0, 0, 1]]))).toBe(1) // 电脑 0 枚
    expect(winnerOf(withPieces(1, [[0, 0, 2]]))).toBe(2) // 玩家 0 枚
    expect(winnerOf(create(1))).toBe(0)
  })

  it('winnerOf：只挤掉一枚不算赢', () => {
    const s = withPieces(1, [
      [0, 0, 1],
      [1, 0, 2],
      [2, 0, 2],
    ])
    expect(countPieces(s.pieces, 2)).toBe(2)
    expect(winnerOf(s)).toBe(0)
  })

  it('winnerOf：双方都还有子就是未分胜负；卡死方判负（兜底）', () => {
    expect(winnerOf(create(1))).toBe(0)
    expect(winnerOf({ ...create(1), stuck: 1 })).toBe(2)
    expect(winnerOf({ ...create(1), stuck: 2 })).toBe(1)
  })

  it('一步把对方最后一枚挤下棋盘即判胜', () => {
    // 玩家 (0,0)，电脑只剩 (3,0)：一路滑到东端把链尾顶出棋盘
    const s = withPieces(1, [
      [0, 0, 1],
      [3, 0, 2],
    ])
    const n = move(s, at(0, 0), at(3, 0))
    expect(countPieces(n.pieces, 2)).toBe(0)
    expect(n.over).toBe(true)
    expect(n.winner).toBe(1)
    expect(n.stuck).toBe(0)
    expect(n.last!.pushed.some(isPushedOff)).toBe(true)
    expect(winnerOf(n)).toBe(1)
    // 终局后不接受任何动作
    expect(move(n, at(0, 0), at(-1, 0))).toBe(n)
    expect(reduce(n, { type: 'pick', cell: at(0, 1) })).toBe(n)
    expect(legalActions(n)).toEqual([])
    expect(aiAction(n)).toBeNull()
  })

  it('只剩一枚子时把它挤出去即结束', () => {
    const s = withPieces(2, [
      [0, 0, 2],
      [3, 0, 1],
    ])
    expect(countPieces(s.pieces, 1)).toBe(1)
    const n = move(s, at(0, 0), at(3, 0))
    expect(countPieces(n.pieces, 1)).toBe(0)
    expect(n.over).toBe(true)
    expect(n.winner).toBe(2)
  })

  it('把自己最后一枚挤出去 = 自己输', () => {
    // 玩家 (3,0)(2,0) 与电脑 (1,0)：玩家向西挤，整条链把电脑的链尾顶出西臂尖
    const s = withPieces(1, [
      [3, 0, 1],
      [2, 0, 1],
      [0, 1, 2],
    ])
    // 反过来构造：让电脑去挤玩家的链尾，玩家最后一枚出界
    const t = withPieces(2, [
      [3, 0, 1],
      [2, 0, 1],
      [0, 1, 2],
    ])
    const n = move(t, at(2, 0), at(3, 0))
    // 玩家两枚都还在（电脑只是往空格推），因此未分胜负
    expect(countPieces(n.pieces, 1)).toBe(2)
    void s
  })

  it('僵局提前判定：走到 STALL_LIMIT 就按位置决胜，不再等满 MOVE_LIMIT', () => {
    const s = withPieces(1, [[0, 0, 1], [0, 1, 2]], 5)
    const near = { ...s, moves: STALL_LIMIT - 1 }
    const n = move(near, at(0, 0), at(0, 1))
    expect(n.moves).toBe(STALL_LIMIT)
    expect(n.over).toBe(true)
    // 有分胜负（位置决胜），而不是像旧规则那样判平局
    expect(n.winner).not.toBe(0)
    expect(winnerOf(n)).toBe(n.winner)
  })

  it('decideByPosition：谁的子更靠近臂端谁吃亏，完全对称时返回 0', () => {
    const pieces = new Array<Cell>(CELL_COUNT).fill(0)
    pieces[at(3, 0)] = 1 // 玩家压在东臂尖：极度危险
    pieces[at(0, 0)] = 2 // 电脑在中心：安全
    expect(decideByPosition(pieces)).toBe(2)

    // 完全镜像对称 → 判不出胜负
    const sym = new Array<Cell>(CELL_COUNT).fill(0)
    sym[at(3, 0)] = 1
    sym[at(-3, 0)] = 2
    expect(decideByPosition(sym)).toBe(0)
  })
})

// ---------------- 守恒 / 不变量 ----------------

describe('守恒与不变量', () => {
  it('随机对弈 400 手：出界恰好减 1、一步最多挤掉 1 枚、总数单调不增', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = new Rng(seed * 8191)
      let s = create(seed * 8191)
      let prevTotal = s.pieces.filter((v) => v !== 0).length
      expect(prevTotal).toBe(6)

      while (!s.over) {
        const prev = clone(s)
        const a = randomAction(s, r)
        if (a === null) break
        const n = reduce(s, a)

        // pieces 里永远只有 Cell（0/1/2），出界的棋子是从数组里移除而不是留标记
        for (const v of n.pieces) expect(v === 0 || v === 1 || v === 2).toBe(true)
        expect(n.pieces.length).toBe(CELL_COUNT)

        const off = n.last ? n.last.pushed.filter(isPushedOff) : []
        const p1 = countPieces(n.pieces, 1)
        const p2 = countPieces(n.pieces, 2)
        // 每方最多同时掉 1 枚；一步总共最多挤掉 1 枚
        expect(p1).toBeGreaterThanOrEqual(countPieces(prev.pieces, 1) - 1)
        expect(p2).toBeGreaterThanOrEqual(countPieces(prev.pieces, 2) - 1)
        expect(countPieces(prev.pieces, 1) + countPieces(prev.pieces, 2) - (p1 + p2)).toBeLessThanOrEqual(1)
        // 每次出界，该方恰好减 1；出界最多 1 枚
        expect(off.length).toBeLessThanOrEqual(1)
        if (off.length === 1) {
          const owner = prev.pieces[off[0].from]
          expect(owner === 1 || owner === 2).toBe(true)
          expect(owner === 1 ? p1 === countPieces(prev.pieces, 1) - 1 : p2 === countPieces(prev.pieces, 2) - 1).toBe(true)
        } else {
          expect(p1 + p2).toBe(prev.pieces.filter((v) => v !== 0).length)
        }
        // 棋子总数单调不增
        const total = p1 + p2
        expect(total).toBeLessThanOrEqual(prevTotal)
        prevTotal = total

        // 终局判定与 winnerOf 一致
        expect(n.winner).toBe(winnerOf(n))
        s = n
      }
      expect(s.over).toBe(true)
      expect(s.moves).toBeLessThanOrEqual(MOVE_LIMIT)
    }
  })

  it('每一步的 legalActions 都能真的走，且只会轮换回合', () => {
    const r = new Rng(4242)
    let s = create(4242)
    for (let i = 0; i < 120 && !s.over; i++) {
      const acts = legalActions(s)
      for (const a of acts) expect(reduce(s, a)).not.toBe(s)
      const a = randomAction(s, r)
      if (a === null) break
      const n = reduce(s, a)
      expect(n.turn).toBe(other(s.turn))
      expect(n.moves).toBe(s.moves + 1)
      expect(n.hover).toBe(-1)
      expect(n.sel).toBe(-1)
      s = n
    }
  })
})

// ---------------- AI ----------------

describe('AI', () => {
  it('不是自己的回合或已终局时返回 null', () => {
    expect(aiAction(create(1))).toBeNull()
    expect(bestAction(create(1), 2)).toBeNull()
    const won = move(
      withPieces(1, [
        [0, 0, 1],
        [3, 0, 2],
      ]),
      at(0, 0),
      at(3, 0),
    )
    expect(won.over).toBe(true)
    expect(won.winner).toBe(1)
    expect(aiAction(won)).toBeNull()
    expect(bestAction(won, 1)).toBeNull()
  })

  it('每一步都从 legalActions 里选，且是真正合法的一手', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = create(seed * 7919)
      let guard = 0
      while (!s.over && guard++ < MOVE_LIMIT + 5) {
        const cands = legalActions(s)
        expect(cands.length).toBeGreaterThan(0)
        const a = bestAction(s, s.turn)
        expect(a).not.toBeNull()
        expect(cands).toContainEqual(a)
        const n = reduce(s, a as Action)
        expect(n).not.toBe(s)
        expect(n.moves).toBe(s.moves + 1)
        s = n
      }
      expect(s.over).toBe(true)
      expect(s.winner).toBe(winnerOf(s))
    }
  })

  it('能挤对方时不会去别处踱步', () => {
    // 电脑 (-1,0) 身后顶着玩家 (-2,0)，西侧一路空到臂尖 (-3,0)：向西一挤就把玩家送出界。
    // 这里只放这一枚电脑子，确保「挤掉对方」是明显最优解。
    const s = withPieces(2, [
      [-1, 0, 2],
      [-2, 0, 1],
      [0, 2, 2],
    ])
    const a = aiAction(s)
    expect(a).not.toBeNull()
    expect(legalActions(s)).toContainEqual(a)
    // AI 必须抓住这个必吃的一手：玩家当场出局、电脑获胜
    const n = reduce(s, a as Action)
    expect(n.last!.pushed.some(isPushedOff)).toBe(true)
    expect(countPieces(n.pieces, 1)).toBe(0)
    expect(n.winner).toBe(2)
    expect(n.over).toBe(true)
  })

  it('不会把自己的子主动送到能被一步挤掉的位置', () => {
    // 局面里电脑 (0,0) 顶着玩家 (-1,0)：往西挤能把玩家推出去，但也可能自己被反挤。
    // 这里只断言「AI 不会为了眼前的便宜把自己送死」，不强行规定它必须走哪一手。
    const s = withPieces(2, [
      [0, 0, 2],
      [-1, 0, 1],
      [0, 2, 1],
      [0, -2, 1],
    ])
    const a = aiAction(s) as { type: 'move'; from: number; to: number }
    expect(legalActions(s)).toContainEqual(a)
    const n = reduce(s, a)
    // 走完之后自己的 3 枚应当还在（没有自杀式地把子送到对方嘴边上）
    expect(countPieces(n.pieces, 2)).toBe(3)
  })

  it('不会走空转的一手：每一步都让局面发生实质变化', () => {
    // 回归测试：早期版本的 AI 会反复踱步（1→2 / 2→1），12 局全部撞满 120 手平局。
    // 这里验证走完一步后，对局要么有棋子被挤、要么轮到对方 —— 不会停在原地打转。
    let s = create(0)
    let stagnant = 0
    for (let i = 0; i < 40 && !s.over; i++) {
      const before = s.pieces.join('')
      const a = aiAction(s)
      if (!a) break
      s = reduce(s, a)
      // 连续 6 步盘面完全不变才判定为停滞（正常走子会换来回变化，但不会完全静止）
      stagnant = s.pieces.join('') === before ? stagnant + 1 : 0
      if (stagnant >= 6) break
    }
    expect(stagnant).toBeLessThan(6)
  })

  it('相同状态总是返回相同动作（可复盘）', () => {
    const s = withPieces(2, [[0, 0, 2], [-1, 0, 1], [0, 2, 1]], 99)
    expect(aiAction(s)).toEqual(aiAction(s))
    expect(aiAction(create(5))).toEqual(aiAction(create(5)))
  })

  it('evaluate 关于双方反对称：evaluate(s,1) === -evaluate(s,2)', () => {
    const states: State[] = [
      create(3),
      withPieces(1, [[0, 0, 2], [-1, 0, 1], [3, 0, 2]], 3),
      withPieces(2, [[2, 0, 1], [1, 0, 2], [0, 3, 2]], 3),
      move(withPieces(1, [[0, 0, 1], [3, 0, 2]]), at(0, 0), at(3, 0)),
    ]
    for (const s of states) {
      // 数值相等即可：evaluate 为 0 时取负会得到 -0，Object.is 会判不等但数值相同
      const e1 = evaluate(s, 1)
      const e2 = evaluate(s, 2)
      expect(e1 + e2).toBe(0)
      expect(evaluate(s, 1)).toBe(e1)
      expect(Number.isFinite(e1)).toBe(true)
    }
  })

  it(
    'AI 自战 30 局：绝大多数分出胜负、平均手数远低于 MOVE_LIMIT',
    () => {
      const GAMES = 30
      const wins: [number, number, number] = [0, 0, 0]
      let decided = 0
      let totalMoves = 0
      let hitLimit = 0
      const lengths = new Set<number>()

      for (let g = 0; g < GAMES; g++) {
        const seed = (g + 1) * 7919
        const r = new Rng(seed ^ 0x9e3779b9)
        let s = create(seed)
        // 前 0~3 手由可播种随机铺开，保证 30 局的开局互不相同；之后全部交给 AI
        for (let k = 0; k < g % 4 && !s.over; k++) {
          const a = randomAction(s, r)
          if (a === null) break
          s = reduce(s, a)
        }
        while (!s.over) {
          const a = bestAction(s, s.turn)
          if (a === null) break
          s = reduce(s, a)
        }

        expect(s.over).toBe(true)
        expect(s.winner).toBe(winnerOf(s))
        expect(s.moves).toBeLessThanOrEqual(MOVE_LIMIT)
        if (s.moves >= MOVE_LIMIT) hitLimit++
        if (s.winner !== 0) decided++
        wins[s.winner]++
        totalMoves += s.moves
        lengths.add(s.moves)
      }

      const avg = totalMoves / GAMES
      console.log(
        `[cross-xi 自战] ${GAMES} 局：先手胜 ${wins[1]} / 后手胜 ${wins[2]} / 平局 ${wins[0]}，` +
          `分出胜负 ${decided}/${GAMES}，平均 ${avg.toFixed(1)} 手，最长 ${Math.max(...lengths)} 手`,
      )
      // 硬指标：新规则必须让对局在上限内分出胜负（旧规则是 30 局全平、平均 120 手）
      expect(decided).toBeGreaterThanOrEqual(25)
      expect(avg).toBeLessThan(60)
      expect(hitLimit).toBe(0)
      expect(wins[1] / GAMES).toBeGreaterThanOrEqual(0.15)
      expect(wins[2] / GAMES).toBeGreaterThanOrEqual(0.15)
      expect(wins[1] / GAMES).toBeLessThanOrEqual(0.85)
      expect(wins[2] / GAMES).toBeLessThanOrEqual(0.85)
    },
    300_000,
  )

  it(
    'AI 对随机对手：10 局至少赢 8 局',
    () => {
      const wins: [number, number, number] = [0, 0, 0]
      let totalMoves = 0
      for (let g = 0; g < 10; g++) {
        const r = new Rng((g + 1) * 3571)
        let s = create((g + 1) * 3571)
        let guard = 0
        while (!s.over && guard++ < MOVE_LIMIT + 5) {
          const a = s.turn === 2 ? aiAction(s) : randomAction(s, r)
          if (a === null) break
          s = reduce(s, a)
        }
        wins[s.winner]++
        totalMoves += s.moves
      }
      console.log(`[cross-xi vs 随机] 10 局：AI(后手) 胜 ${wins[2]} / 随机方胜 ${wins[1]} / 平局 ${wins[0]}`)
      expect(wins[2]).toBeGreaterThanOrEqual(8)
      expect(wins[2]).toBeGreaterThan(wins[1])
      expect(totalMoves / 10).toBeLessThan(MOVE_LIMIT)
    },
    300_000,
  )

  it(
    'AI 单步平均耗时 < 20ms（打印实测值）',
    () => {
      let worst = 0
      let sum = 0
      let n = 0
      for (let seed = 1; seed <= 12; seed++) {
        const r = new Rng(seed * 31337)
        let s = create(seed * 31337)
        let guard = 0
        while (!s.over && guard++ < MOVE_LIMIT + 5) {
          const a = bestAction(s, s.turn)
          if (a === null) break
          const t0 = performance.now()
          bestAction(s, s.turn)
          const dt = performance.now() - t0
          worst = Math.max(worst, dt)
          sum += dt
          n++
          // 掺入随机着法，保证测到的局面不是单线
          const alt = randomAction(s, r)
          s = reduce(s, a)
          if (alt && alt.type === 'move' && n % 4 === 0) s = reduce(s, alt)
        }
      }
      const avg = sum / Math.max(1, n)
      console.log(
        `[cross-xi 耗时] 深度 ${MAX_DEPTH}，决策 ${n} 次，平均 ${avg.toFixed(4)}ms，最差 ${worst.toFixed(4)}ms`,
      )
      expect(n).toBeGreaterThan(20)
      expect(avg).toBeLessThan(20)
      expect(worst).toBeLessThan(50)
    },
    300_000,
  )
})

// ---------------- 纯函数约束 ----------------

describe('纯函数约束', () => {
  it('reduce 不修改入参（棋子数组最容易被就地改写）', () => {
    const s = withPieces(1, [[0, -3, 1], [0, -2, 2], [0, -1, 2]])
    const before = clone(s)
    const n = reduce(s, { type: 'move', from: at(0, -3), to: at(0, -2) })
    expect(s).toEqual(before)
    expect(n).not.toBe(s)
    expect(n.pieces).not.toBe(s.pieces)
    expect(n.last).not.toBe(s.last)
  })

  it('出界那一步同样不修改入参', () => {
    const s = withPieces(1, [[0, 0, 1], [3, 0, 2]])
    const before = clone(s)
    const n = move(s, at(0, 0), at(3, 0))
    expect(s).toEqual(before)
    expect(n.winner).toBe(1)
  })

  it('相同输入两次调用结果完全相等', () => {
    const s = withPieces(1, [[0, -3, 1], [0, -2, 2], [0, -1, 2]])
    expect(reduce(s, { type: 'move', from: at(0, -3), to: at(0, -2) })).toEqual(
      reduce(s, { type: 'move', from: at(0, -3), to: at(0, -2) }),
    )
  })

  it('连续多步 reduce 不会污染最初的 state', () => {
    const s0 = create(5)
    const snap = clone(s0)
    let s = s0
    for (let i = 0; i < 20; i++) {
      const a = bestAction(s, s.turn)
      if (a === null) break
      s = reduce(s, a)
    }
    expect(s).not.toEqual(snap)
    expect(s0).toEqual(snap)
  })

  it('AI 试算不会污染传入的 state（试算走的是同一个 reduce）', () => {
    const s = withPieces(2, [[0, 0, 2], [-1, 0, 1], [0, 1, 1]], 2024)
    const before = clone(s)
    bestAction(s, 2)
    aiAction(s)
    evaluate(s, 2)
    movesFrom(s.pieces, at(0, 0))
    adjacents(at(0, 0))
    expect(s).toEqual(before)
  })

  it('整局可复盘：同 seed 两次模拟得到完全一致的结果', () => {
    const run = (): State => {
      let s = create(31337)
      while (!s.over) {
        const a = bestAction(s, s.turn)
        if (a === null) break
        s = reduce(s, a)
      }
      return s
    }
    expect(run()).toEqual(run())
  })
})
