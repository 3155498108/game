import { describe, expect, it } from 'vitest'
import {
  SIZE,
  aiAction,
  colOf,
  countDiscs,
  create,
  flipsFor,
  idx,
  isCorner,
  legalActions,
  opponent,
  place,
  reduce,
  rowOf,
  type Action,
  type Cell,
  type Player,
  type State,
} from './rules'

/**
 * 造一个自定义局面。每行 8 个字符：'.'= 空，'1'= 黑，'2'= 白，row 0 在最上方。
 * 例：'..1.....' 表示第 0 行第 2 列是黑子。
 */
function stateOf(rows: string[], turn: Player = 1): State {
  const board = new Array<Cell>(SIZE * SIZE).fill(0)
  for (let r = 0; r < Math.min(rows.length, SIZE); r++) {
    const line = rows[r].padEnd(SIZE, '.')
    for (let c = 0; c < SIZE; c++) {
      board[idx(c, r)] = line[c] === '1' ? 1 : line[c] === '2' ? 2 : 0
    }
  }
  return { ...create(1), board, turn }
}

/**
 * 以 base 填满整盘，再按 [格索引, 值] 覆盖。
 * 默认由「铺满棋盘的那一方」行棋（filled(1,…) = 黑先，filled(2,…) = 白先）。
 */
function filled(base: Player, overrides: Array<[number, Cell]>, turn: Player = base): State {
  const board = new Array<Cell>(SIZE * SIZE).fill(base)
  for (const [i, v] of overrides) board[i] = v
  return { ...create(1), board, turn }
}

/** 取一个动作里的落点索引：先按 type 缩窄，再访问 .index（不给 Action 写 any） */
function placedIndex(action: Action | null): number {
  expect(action).not.toBeNull()
  if (action === null || action.type !== 'place') throw new Error('AI 没有返回落子动作')
  return action.index
}

const B = '........'
const at = (col: number, row: number): number => idx(col, row)
const asc = (a: number, b: number): number => a - b
const sorted = (xs: number[]): number[] => xs.slice().sort(asc)

describe('开局', () => {
  it('中央四子为黑 2 白 2，主对角线是黑、副对角线是白', () => {
    const s = create(42)
    expect(s.board[at(3, 3)]).toBe(1)
    expect(s.board[at(4, 4)]).toBe(1)
    expect(s.board[at(3, 4)]).toBe(2)
    expect(s.board[at(4, 3)]).toBe(2)
  })

  it('棋子数黑=白=2，除中央四格外全空', () => {
    const s = create(7)
    expect(countDiscs(s.board)).toEqual([2, 2])
    expect(s.black).toBe(2)
    expect(s.white).toBe(2)
    expect(s.board.filter((v) => v !== 0).length).toBe(4)
  })

  it('黑先、棋盘未结束、无落子记录', () => {
    const s = create(2026)
    expect(s.turn).toBe(1)
    expect(s.over).toBe(false)
    expect(s.winner).toBe(0)
    expect(s.moves).toBe(0)
    expect(s.passes).toBe(0)
    expect(s.lastMove).toBe(-1)
    expect(s.flipped).toEqual([])
  })

  it('开局双方各恰好四个合法落点', () => {
    // 标准开局黑先：黑的四个点沿主对角线向外张开（c4 / e6 / f5 / d3），
    // 白的四个点沿副对角线张开（d6 / f4 / c5 / e3）——开局时双方的落点并不相同，
    // 各自要夹的是对方那一对子。
    const s = create(1)
    const black = sorted(legalActions(s.board, 1))
    const white = sorted(legalActions(s.board, 2))
    expect(black).toEqual(sorted([at(2, 4), at(4, 2), at(3, 5), at(5, 3)]))
    expect(white).toEqual(sorted([at(3, 2), at(5, 4), at(2, 3), at(4, 5)]))
    // 开局盘面 180° 旋转后不变，因此每一方自己的四个落点也是成对出现的
    for (const set of [black, white]) {
      expect(sorted(set.map((i) => SIZE * SIZE - 1 - i))).toEqual(set)
    }
  })

  it('create 对同一 seed 完全一致；不同 seed 只体现在 rng 上', () => {
    expect(create(123)).toEqual(create(123))
    expect(create(123).board).toEqual(create(456).board)
    expect(create(123).rng).not.toBe(create(456).rng)
  })
})

describe('翻转规则', () => {
  it('横向翻转', () => {
    // 黑落 (0,0)，向右夹住 (1,0)=白、(2,0)=黑
    const s = stateOf(['.21.....', B, B, B, B, B, B, B])
    const n = place(s, at(0, 0))
    expect(n).not.toBe(s)
    expect(n.flipped).toEqual([at(1, 0)])
    expect(n.board[at(0, 0)]).toBe(1)
    expect(n.board[at(1, 0)]).toBe(1)
    expect(n.board[at(2, 0)]).toBe(1)
  })

  it('纵向翻转', () => {
    // 黑落 (0,0)，向下夹住 (0,1)=白、(0,2)=黑
    const s = stateOf([B, '2......', '1......', B, B, B, B, B])
    const n = place(s, at(0, 0))
    expect(n).not.toBe(s)
    expect(n.flipped).toEqual([at(0, 1)])
    expect(n.board[at(0, 0)]).toBe(1)
    expect(n.board[at(0, 1)]).toBe(1)
    expect(n.board[at(0, 2)]).toBe(1)
  })

  it('主对角线（↘）翻转', () => {
    // 黑落 (0,0)，沿 ↘ 夹住 (1,1)=白、(2,2)=黑
    const s = stateOf([B, '.2......', '..1.....', B, B, B, B, B])
    const n = place(s, at(0, 0))
    expect(n).not.toBe(s)
    expect(n.flipped).toEqual([at(1, 1)])
    expect(n.board[at(0, 0)]).toBe(1)
    expect(n.board[at(1, 1)]).toBe(1)
    expect(n.board[at(2, 2)]).toBe(1)
  })

  it('副对角线（↗）翻转', () => {
    // 黑落 (2,0)，向左上夹住 (1,1)=白、(0,2)=黑
    const s = stateOf([B, '.2......', '1.......', B, B, B, B, B])
    const n = place(s, at(2, 0))
    expect(n).not.toBe(s)
    expect(n.flipped).toEqual([at(1, 1)])
    expect(n.board[at(2, 0)]).toBe(1)
    expect(n.board[at(0, 2)]).toBe(1)
  })

  it('四个方向同时翻转，逐格统计被翻棋子', () => {
    // 白落 (3,3)：上下左右各有一颗黑子，顶端各由一颗白子封住
    const s = stateOf([B, '...2....', '...1....', '121.12..', '...1....', '...2....', B, B], 2)
    const n = place(s, at(3, 3))
    expect(n).not.toBe(s)
    const expect4 = sorted([at(2, 3), at(3, 2), at(4, 3), at(3, 4)])
    expect(sorted(n.flipped)).toEqual(expect4)
    expect(n.flipped.length).toBe(4)
    for (const i of n.flipped) expect(n.board[i]).toBe(2)
  })

  it('只能夹连续的敌子：中间有空格则不算翻转', () => {
    // (1,0)=白 与 (3,0)=黑 之间夹着一个空格
    const s = stateOf(['.2.1...', B, B, B, B, B, B, B])
    expect(flipsFor(s.board, at(0, 0), 1)).toEqual([])
    expect(place(s, at(0, 0))).toBe(s)
  })

  it('敌子串末端不是己方棋子则不翻转（顶到棋盘边缘）', () => {
    const s = stateOf(['.......2', B, B, B, B, B, B, B])
    expect(flipsFor(s.board, at(6, 0), 1)).toEqual([])
    expect(place(s, at(6, 0))).toBe(s)
  })

  it('落子后己方在该方向的连续棋子数 = 被夹敌子数 + 1', () => {
    // B W W W W _ _ _ ，黑在 (5,0) 落子
    const s = stateOf(['12222...', B, B, B, B, B, B, B])
    const n = place(s, at(5, 0))
    expect(n.flipped.length).toBe(4)
    for (let c = 0; c <= 5; c++) expect(n.board[at(c, 0)]).toBe(1)
    expect(n.board[at(6, 0)]).toBe(0)
  })

  it('落子后棋子总数只 +1，被翻的棋子是换色而不是新增', () => {
    // 黑落 (0,0)：横向吃 (1,0)、纵向吃 (0,1)，一次翻两颗
    const s = stateOf(['.21.....', '2......', '1......', B, B, B, B, B])
    const n = place(s, at(0, 0))
    expect(n).not.toBe(s)
    expect(sorted(n.flipped)).toEqual(sorted([at(1, 0), at(0, 1)]))
    const before = countDiscs(s.board)
    const after = countDiscs(n.board)
    expect(after[0] + after[1]).toBe(before[0] + before[1] + 1)
    expect(after[0]).toBe(before[0] + 1 + n.flipped.length)
    expect(after[1]).toBe(before[1] - n.flipped.length)
    expect(n.black).toBe(after[0])
    expect(n.white).toBe(after[1])
  })

  it('flipsFor 对非空格与非法索引都返回空', () => {
    const s = stateOf(['222.....', B, B, B, B, B, B, B])
    expect(flipsFor(s.board, at(0, 0), 2)).toEqual([])
    expect(flipsFor(s.board, -1, 1)).toEqual([])
    expect(flipsFor(s.board, SIZE * SIZE, 1)).toEqual([])
    expect(flipsFor(s.board, 1.5, 1)).toEqual([])
  })
})

describe('合法性与非法落子', () => {
  it('夹不住任何敌子则落子非法，状态原样返回', () => {
    const s = create(1)
    expect(place(s, at(0, 0))).toBe(s)
  })

  it('落在已有棋子的格子上非法', () => {
    const s = create(1)
    expect(place(s, at(3, 3))).toBe(s)
  })

  it('越界与非整数索引被拒绝', () => {
    const s = create(1)
    expect(place(s, -1)).toBe(s)
    expect(place(s, SIZE * SIZE)).toBe(s)
    expect(place(s, 3.7)).toBe(s)
  })

  it('合法落子后 turn 切到对方，并记录落点', () => {
    const n = place(create(1), at(2, 4))
    expect(n).not.toBe(create(1))
    expect(n.turn).toBe(2)
    expect(n.moves).toBe(1)
    expect(n.passes).toBe(0)
    expect(n.lastMove).toBe(at(2, 4))
    expect(n.flipped).toEqual([at(3, 4)])
    expect(n.black).toBe(4)
    expect(n.white).toBe(1)
  })

  it('hover 不改变棋盘，leave 重置 hover', () => {
    const s = create(1)
    const h = reduce(s, { type: 'hover', index: at(2, 4) })
    expect(h.board).toEqual(s.board)
    expect(h.moves).toBe(0)
    expect(h.hover).toBe(at(2, 4))
    expect(reduce(h, { type: 'leave' }).hover).toBe(-1)
    expect(reduce(h, { type: 'hover', index: at(2, 4) })).toBe(h)
  })
})

describe('跳过与终局', () => {
  it('当前方无合法落子时自动跳过：turn 翻回原方、passes 递增', () => {
    // 满盘黑子，只留白子 (1,0)(2,0) 被 (0,0) 的黑落一吃二，另有一颗孤立白子 (6,6) 守着 (7,7)。
    // 黑落 (0,0) 之后白无处可下 → 自动跳过；黑仍可用 (7,7) 收掉最后一颗白子。
    const s = filled(1, [
      [at(0, 0), 0],
      [at(1, 0), 2],
      [at(2, 0), 2],
      [at(6, 6), 2],
      [at(7, 7), 0],
    ])
    const n = place(s, at(0, 0))
    expect(n).not.toBe(s)
    expect(n.moves).toBe(1)
    expect(sorted(n.flipped)).toEqual(sorted([at(1, 0), at(2, 0)]))
    expect(n.passes).toBe(1)
    expect(n.turn).toBe(1)
    expect(n.over).toBe(false)
    expect(legalActions(n.board, 2)).toEqual([])
    expect(legalActions(n.board, 1)).toEqual([at(7, 7)])
  })

  it('双方均无合法落子时 passes 达到 2 并终局', () => {
    // 全黑，只留 (6,6) 一颗白子与 (7,7) 空格；黑落 (7,7) 吃掉白子后满盘
    const s = filled(1, [
      [at(6, 6), 2],
      [at(7, 7), 0],
    ])
    const n = place(s, at(7, 7))
    expect(n.flipped).toEqual([at(6, 6)])
    expect(n.passes).toBe(2)
    expect(n.over).toBe(true)
    expect(n.black + n.white).toBe(SIZE * SIZE)
  })

  it('终局后不再接受落子与 hover', () => {
    const done = place(filled(1, [[at(6, 6), 2], [at(7, 7), 0]]), at(7, 7))
    expect(done.over).toBe(true)
    expect(place(done, at(0, 0))).toBe(done)
    expect(reduce(done, { type: 'hover', index: at(0, 0) })).toBe(done)
  })

  it('总棋子数恒等于 4 + 落子数', () => {
    let s = create(5)
    let guard = 0
    while (!s.over && guard++ < SIZE * SIZE + 5) {
      const legal = legalActions(s.board, s.turn)
      s = reduce(s, { type: 'place', index: legal[guard % legal.length] })
      expect(s.black + s.white).toBe(4 + s.moves)
    }
    expect(s.over).toBe(true)
  })
})

describe('胜负', () => {
  it('黑子多 → winner 1', () => {
    const n = place(filled(1, [[at(6, 6), 2], [at(7, 7), 0]]), at(7, 7))
    expect(n.over).toBe(true)
    expect(n.black).toBe(SIZE * SIZE)
    expect(n.white).toBe(0)
    expect(n.winner).toBe(1)
  })

  it('白子多 → winner 2', () => {
    // 满盘白子，只留 (6,6) 一颗黑子与 (7,7) 空格，轮到白走
    const n = place(filled(2, [[at(6, 6), 1], [at(7, 7), 0]]), at(7, 7))
    expect(n.over).toBe(true)
    expect(n.white).toBe(SIZE * SIZE)
    expect(n.black).toBe(0)
    expect(n.winner).toBe(2)
  })

  it('棋子数相同 → 平局，winner 为 0', () => {
    // 落子前：黑 30 子、白 33 子、1 个空格；黑在 (7,7) 只翻一颗白子 → 32:32
    const blacks: number[] = []
    for (let r = 0; r < 3; r++) for (let c = 0; c < SIZE; c++) blacks.push(at(c, r))
    for (let c = 0; c <= 2; c++) blacks.push(at(c, 3))
    blacks.push(at(5, 5), at(7, 6), at(6, 7))
    const overrides: Array<[number, Cell]> = blacks.map((i) => [i, 1])
    overrides.push([at(7, 7), 0])
    const s = filled(2, overrides, 1)
    expect(countDiscs(s.board)).toEqual([30, 33])
    expect(legalActions(s.board, 1)).toEqual([at(7, 7)])
    const n = place(s, at(7, 7))
    expect(n.over).toBe(true)
    expect(n.black).toBe(32)
    expect(n.white).toBe(32)
    expect(n.winner).toBe(0)
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参：翻转也不会就地改 board', () => {
    const s = stateOf(['.21.....', B, B, B, B, B, B, B])
    const before = s.board.slice()
    const next = place(s, at(0, 0))
    expect(next).not.toBe(s)
    expect(s.board).toEqual(before)
    expect(s.board[at(1, 0)]).toBe(2)
    expect(s.moves).toBe(0)
    expect(next.flipped).not.toBe(s.flipped)
  })

  it('新状态的 board 与入参不是同一引用', () => {
    const s = create(1)
    expect(place(s, at(2, 4)).board).not.toBe(s.board)
  })

  it('相同输入两次调用结果完全相等', () => {
    const s = stateOf(['.21.....', B, B, B, B, B, B, B])
    expect(reduce(s, { type: 'place', index: at(0, 0) })).toEqual(reduce(s, { type: 'place', index: at(0, 0) }))
  })

  it('legalActions / flipsFor 不修改棋盘', () => {
    const s = create(1)
    const before = s.board.slice()
    legalActions(s.board, 1)
    flipsFor(s.board, at(2, 4), 1)
    expect(s.board).toEqual(before)
  })
})

describe('AI', () => {
  const ai = (s: State): State => ({ ...s, turn: 2 as Player })

  it('轮到玩家（黑）时返回 null', () => {
    expect(aiAction(create(1))).toBeNull()
  })

  it('终局返回 null', () => {
    expect(aiAction(ai({ ...create(1), over: true }))).toBeNull()
  })

  it('白方无合法落点时返回 null', () => {
    // 承接「自动跳过」那一局的局面：白已经无处可下，但棋局还没结束
    const after = place(
      filled(1, [
        [at(0, 0), 0],
        [at(1, 0), 2],
        [at(2, 0), 2],
        [at(6, 6), 2],
        [at(7, 7), 0],
      ]),
      at(0, 0),
    )
    expect(after.over).toBe(false)
    expect(legalActions(after.board, 2)).toEqual([])
    expect(aiAction(ai(after))).toBeNull()
  })

  it('开局白方的落点必在四个合法点之内', () => {
    const s = ai(create(1))
    expect(legalActions(s.board, 2)).toContain(placedIndex(aiAction(s)))
  })

  it('优先占角：角上一手翻的子最多，其余合法点都翻得更少', () => {
    // 白可下 12 点，其中角上 (0,0) 翻 3 子，其余各点最多只翻 2 子
    const s = ai(
      stateOf(
        [
          '........',
          '.1....1.',
          '..1...1.',
          '...1121.',
          '..2221..',
          '..22211.',
          '..2222..',
          '........',
        ],
        2,
      ),
    )
    const corner = at(0, 0)
    const legal = legalActions(s.board, 2)
    expect(legal.length).toBeGreaterThanOrEqual(4)
    expect(legal).toContain(corner)
    const cornerFlips = flipsFor(s.board, corner, 2).length
    expect(cornerFlips).toBeGreaterThan(1)
    for (const i of legal) {
      if (i === corner) continue
      expect(flipsFor(s.board, i, 2).length).toBeLessThan(cornerFlips)
    }
    const at0 = placedIndex(aiAction(s))
    expect(isCorner(colOf(at0), rowOf(at0))).toBe(true)
    expect(at0).toBe(corner)
  })

  it('相同状态总是返回相同动作（可复盘）', () => {
    const s = ai(create(99))
    expect(aiAction(s)).toEqual(aiAction(s))
  })

  it('AI 每一步都从合法落点中选，且整局必然走到终局', () => {
    for (let seed = 1; seed <= 5; seed++) {
      let s = create(seed * 7919)
      let guard = 0
      while (!s.over && guard++ < SIZE * SIZE + 5) {
        const legal = legalActions(s.board, s.turn)
        expect(legal.length).toBeGreaterThan(0)
        if (s.turn === 2) {
          const at = placedIndex(aiAction(s))
          expect(legal).toContain(at)
          s = reduce(s, { type: 'place', index: at })
        } else {
          s = reduce(s, { type: 'place', index: legal[seed % legal.length] })
        }
      }
      expect(s.over).toBe(true)
      expect(s.moves).toBeGreaterThan(0)
      expect(s.moves).toBeLessThanOrEqual(SIZE * SIZE)
      expect(s.black + s.white).toBe(4 + s.moves)
    }
  })

  it('AI 单步决策耗时 < 100ms（实测值见下方控制台）', () => {
    const samples: number[] = []
    for (let seed = 1; seed <= 3; seed++) {
      let s = create(seed * 104729)
      let guard = 0
      while (!s.over && guard++ < SIZE * SIZE + 5) {
        const legal = legalActions(s.board, s.turn)
        if (s.turn === 2) {
          const t0 = performance.now()
          const at = placedIndex(aiAction(s))
          samples.push(performance.now() - t0)
          s = reduce(s, { type: 'place', index: at })
        } else {
          s = reduce(s, { type: 'place', index: legal[guard % legal.length] })
        }
      }
    }
    expect(samples.length).toBeGreaterThan(20)
    const max = Math.max(...samples)
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length
    console.log(`[reversi AI 耗时] 共决策 ${samples.length} 次，平均 ${avg.toFixed(2)}ms，最慢 ${max.toFixed(2)}ms`)
    expect(max).toBeLessThan(100)
  })
})

describe('坐标工具', () => {
  it('idx / colOf / rowOf 互为逆运算', () => {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        expect(rowOf(idx(c, r))).toBe(r)
        expect(colOf(idx(c, r))).toBe(c)
      }
    }
  })

  it('opponent 在 1 / 2 之间来回切换', () => {
    expect(opponent(1)).toBe(2)
    expect(opponent(2)).toBe(1)
    expect(opponent(opponent(1))).toBe(1)
  })

  it('isCorner 只认四个角', () => {
    expect(isCorner(0, 0)).toBe(true)
    expect(isCorner(7, 7)).toBe(true)
    expect(isCorner(0, 7)).toBe(true)
    expect(isCorner(7, 0)).toBe(true)
    expect(isCorner(0, 1)).toBe(false)
    expect(isCorner(1, 1)).toBe(false)
  })
})
