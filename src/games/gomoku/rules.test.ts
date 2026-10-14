import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng'
import {
  CELLS,
  COMPUTER,
  FORBIDDEN_RULES,
  HUMAN,
  SIZE,
  advise,
  aiAction,
  bestMoveFor,
  canPlace,
  candidateCells,
  candidatePool,
  colOf,
  create,
  emptyCells,
  evalBoard,
  findWin,
  fourCells,
  idx,
  isFull,
  moveScore,
  place,
  reduce,
  rowOf,
  winningCells,
  winsAt,
  type Cell,
  type Player,
  type State,
} from './rules'

/** 用 [col,row,棋子] 列表拼一个局面 */
function boardOf(spec: ReadonlyArray<readonly [number, number, Player]>): Cell[] {
  const b = new Array<Cell>(CELLS).fill(0)
  for (const [c, r, p] of spec) b[idx(c, r)] = p
  return b
}

function st(board: Cell[], turn: Player = HUMAN): State {
  return { ...create(1), board, turn }
}

/** 一个「四方向最长连子都只有 2」的满盘，用来做平局用例 */
function fullNoWinBoard(): Cell[] {
  const b = new Array<Cell>(CELLS).fill(0)
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) b[idx(c, r)] = (r + 2 * c) % 4 < 2 ? 1 : 2
  }
  return b
}

describe('初始局面', () => {
  it('开局是 15×15 的空棋盘', () => {
    const s = create(42)
    expect(s.board.length).toBe(CELLS)
    expect(SIZE * SIZE).toBe(225)
    expect(s.board.every((v) => v === 0)).toBe(true)
    expect(s.over).toBe(false)
    expect(s.winner).toBe(0)
    expect(s.moves).toBe(0)
    expect(s.history).toEqual([])
    expect(s.lastMove).toBe(-1)
  })

  it('黑先：玩家执黑（1），电脑执白（2）', () => {
    expect(HUMAN).toBe(1)
    expect(COMPUTER).toBe(2)
    expect(create(1).turn).toBe(1)
  })

  it('禁手默认关闭（预留常量未启用）', () => {
    expect(FORBIDDEN_RULES).toBe(false)
  })

  it('create 对同一 seed 完全一致', () => {
    expect(create(123)).toEqual(create(123))
  })

  it('两次 create 得到互相独立的棋盘数组', () => {
    const a = create(7)
    const b = create(7)
    expect(a.board).not.toBe(b.board)
    expect(a.history).not.toBe(b.history)
  })

  it('索引与行列互为逆运算', () => {
    for (const [c, r] of [
      [0, 0],
      [14, 14],
      [7, 7],
      [3, 11],
    ] as const) {
      expect(colOf(idx(c, r))).toBe(c)
      expect(rowOf(idx(c, r))).toBe(r)
    }
  })

  it('空盘没有任何直接获胜点', () => {
    const s = create(1)
    expect(winningCells(s.board, 1)).toEqual([])
    expect(winningCells(s.board, 2)).toEqual([])
    expect(fourCells(s.board, 1)).toEqual([])
  })
})

describe('胜负判定', () => {
  it('横向五连判胜', () => {
    const s = place(st(boardOf([[0, 7, 1], [1, 7, 1], [2, 7, 1], [3, 7, 1]])), idx(4, 7))
    expect(s.over).toBe(true)
    expect(s.winner).toBe(1)
    expect(s.winCells).toHaveLength(5)
  })

  it('纵向五连判胜', () => {
    const b = boardOf([
      [5, 0, 1],
      [5, 1, 1],
      [5, 2, 1],
      [5, 3, 1],
    ])
    expect(winsAt([...b.slice(0, idx(5, 4)), 1, ...b.slice(idx(5, 4) + 1)], idx(5, 4), 1)).toHaveLength(5)
    expect(findWin(place(st(b), idx(5, 4)).board, 1)).toHaveLength(5)
  })

  it('右下斜五连判胜', () => {
    const b = boardOf([
      [0, 0, 1],
      [1, 1, 1],
      [2, 2, 1],
      [3, 3, 1],
    ])
    expect(winsAt([...b.slice(0, idx(4, 4)), 1, ...b.slice(idx(4, 4) + 1)], idx(4, 4), 1)).toHaveLength(5)
  })

  it('右上斜五连判胜', () => {
    const b = boardOf([
      [4, 0, 1],
      [3, 1, 1],
      [2, 2, 1],
      [1, 3, 1],
    ])
    expect(winsAt([...b.slice(0, idx(0, 4)), 1, ...b.slice(idx(0, 4) + 1)], idx(0, 4), 1)).toHaveLength(5)
  })

  it('六连也算胜，且整条连线都会被记录', () => {
    const b = boardOf([
      [2, 7, 1],
      [3, 7, 1],
      [4, 7, 1],
      [5, 7, 1],
      [6, 7, 1],
    ])
    const s = place(st(b), idx(7, 7))
    expect(s.over).toBe(true)
    expect(s.winner).toBe(1)
    expect(s.winCells).toHaveLength(6)
  })

  it('四连不算赢', () => {
    const b = boardOf([
      [3, 7, 1],
      [4, 7, 1],
      [5, 7, 1],
      [6, 7, 1],
    ])
    expect(findWin(b, 1)).toEqual([])
    expect(winsAt(b, idx(0, 0), 1)).toEqual([])
    // 但两端已经是「再下一手就成五」的危险点
    expect(winningCells(b, 1)).toContain(idx(2, 7))
    expect(winningCells(b, 1)).toContain(idx(7, 7))
    expect(fourCells(b, 1)).toContain(idx(2, 7))
  })

  it('棋盘边角上的五连也能判出来', () => {
    const b = boardOf([
      [0, 0, 2],
      [1, 0, 2],
      [2, 0, 2],
      [3, 0, 2],
    ])
    const s = place(st(b, COMPUTER), idx(4, 0))
    expect(s.over).toBe(true)
    expect(s.winner).toBe(2)
  })

  it('落子后同步更新轮次、手数、历史与最后一手', () => {
    const s = place(create(5), idx(7, 7))
    expect(s.turn).toBe(2)
    expect(s.moves).toBe(1)
    expect(s.lastMove).toBe(idx(7, 7))
    expect(s.history).toEqual([idx(7, 7)])
    expect(s.board[idx(7, 7)]).toBe(1)
  })

  it('获胜连线上全部是同一方的棋子', () => {
    const b = boardOf([
      [2, 5, 1],
      [3, 5, 1],
      [4, 5, 1],
      [6, 5, 1],
      [3, 6, 2],
      [4, 6, 1],
      [6, 6, 1],
    ])
    const s = place(st(b), idx(5, 5))
    expect(s.winner).toBe(1)
    expect(s.winCells.length).toBeGreaterThanOrEqual(5)
    expect(s.winCells.every((i) => s.board[i] === 1)).toBe(true)
  })

  it('结束后不再接受落子', () => {
    const s = place(st(boardOf([[0, 7, 1], [1, 7, 1], [2, 7, 1], [3, 7, 1]])), idx(4, 7))
    expect(place(s, idx(10, 10))).toBe(s)
  })
})

describe('非法落子', () => {
  it('已有棋子的格子被拒绝', () => {
    const s = place(create(1), idx(7, 7))
    expect(canPlace(s.board, idx(7, 7))).toBe(false)
    expect(place(s, idx(7, 7))).toBe(s)
  })

  it('越界坐标被拒绝', () => {
    const s = create(1)
    expect(place(s, -1)).toBe(s)
    expect(place(s, CELLS)).toBe(s)
    expect(place(s, 9999)).toBe(s)
  })

  it('非整数坐标被拒绝', () => {
    const s = create(1)
    expect(place(s, 3.5)).toBe(s)
    expect(canPlace(s.board, Number.NaN)).toBe(false)
  })

  it('hover 不改变棋盘，也不会越界', () => {
    const s = create(1)
    const n = reduce(s, { type: 'hover', cell: idx(2, 2) })
    expect(n.board).toEqual(s.board)
    expect(n.moves).toBe(0)
    expect(n.hover).toBe(idx(2, 2))
    expect(reduce(s, { type: 'hover', cell: CELLS })).toBe(s)
    expect(reduce(n, { type: 'leave' }).hover).toBe(-1)
  })

  it('hover 在已有棋子的格子上不生效', () => {
    const s = place(create(1), idx(7, 7))
    expect(reduce(s, { type: 'hover', cell: idx(7, 7) })).toBe(s)
  })
})

describe('平局判定', () => {
  it('四方向都无五连的满盘被判定为下满', () => {
    const b = fullNoWinBoard()
    expect(isFull(b)).toBe(true)
    expect(findWin(b, 1)).toEqual([])
    expect(findWin(b, 2)).toEqual([])
    expect(emptyCells(b)).toEqual([])
  })

  it('填满最后一步时判平局', () => {
    const b = fullNoWinBoard()
    b[idx(7, 7)] = 0
    const s = place(st(b), idx(7, 7))
    expect(s.over).toBe(true)
    expect(s.winner).toBe(0)
    expect(isFull(s.board)).toBe(true)
  })

  it('满盘后不再落子，AI 也不再出手', () => {
    const s = place(st(fullNoWinBoard()), idx(7, 7))
    expect(place(s, idx(0, 0))).toBe(s)
    expect(aiAction({ ...s, turn: 2 })).toBeNull()
  })

  it('未下满时空盘评估可用', () => {
    expect(evalBoard(create(1).board, 1)).toBe(0)
  })
})

describe('悔棋', () => {
  it('轮到玩家时，悔棋退回一整个来回', () => {
    let s = create(1)
    s = place(s, idx(7, 7))
    s = place(s, idx(8, 8))
    s = place(s, idx(7, 8))
    s = place(s, idx(9, 7))
    expect(s.turn).toBe(HUMAN)
    const u = reduce(s, { type: 'undo' })
    expect(u.turn).toBe(HUMAN)
    expect(u.history).toEqual([idx(7, 7), idx(8, 8)])
    expect(u.board[idx(7, 8)]).toBe(0)
    expect(u.board[idx(9, 7)]).toBe(0)
    expect(u.board[idx(7, 7)]).toBe(1)
    expect(u.board[idx(8, 8)]).toBe(2)
    expect(u.moves).toBe(2)
    expect(u.lastMove).toBe(idx(8, 8))
    expect(u.over).toBe(false)
  })

  it('刚落完子还在等电脑时，悔棋只退自己这一手', () => {
    let s = create(1)
    s = place(s, idx(7, 7))
    s = place(s, idx(8, 8))
    s = place(s, idx(7, 8))
    expect(s.turn).toBe(COMPUTER)
    const u = reduce(s, { type: 'undo' })
    expect(u.history).toEqual([idx(7, 7), idx(8, 8)])
    expect(u.board[idx(7, 8)]).toBe(0)
    expect(u.turn).toBe(HUMAN)
  })

  it('没有棋子时悔棋无效', () => {
    const s = create(1)
    expect(reduce(s, { type: 'undo' })).toBe(s)
  })

  it('结束后不能悔棋', () => {
    const won = place(st(boardOf([[0, 7, 1], [1, 7, 1], [2, 7, 1], [3, 7, 1]])), idx(4, 7))
    expect(reduce(won, { type: 'undo' })).toBe(won)
  })

  it('悔棋后同一格可以重新落子', () => {
    let s = create(1)
    s = place(s, idx(7, 7))
    s = place(s, idx(8, 8))
    s = place(s, idx(7, 8))
    s = place(s, idx(9, 7))
    s = reduce(s, { type: 'undo' })
    expect(place(s, idx(7, 8)).board[idx(7, 8)]).toBe(HUMAN)
  })

  it('单步时悔棋退回空盘', () => {
    const s = reduce(place(create(1), idx(7, 7)), { type: 'undo' })
    expect(s.history).toEqual([])
    expect(s.moves).toBe(0)
    expect(s.lastMove).toBe(-1)
    expect(s.board.every((v) => v === 0)).toBe(true)
  })
})

describe('AI 决策', () => {
  it('轮到玩家时返回 null', () => {
    expect(aiAction(create(1))).toBeNull()
    expect(aiAction(st(boardOf([[7, 7, 1]]), HUMAN))).toBeNull()
  })

  it('自己下一手能成五时立刻取胜', () => {
    const b = boardOf([
      [3, 7, 2],
      [4, 7, 2],
      [5, 7, 2],
      [6, 7, 2],
    ])
    const s = st(b, COMPUTER)
    const a = aiAction(s)
    const cell = (a as { cell: number }).cell
    expect([idx(2, 7), idx(7, 7)]).toContain(cell)
    expect(reduce(s, a!).winner).toBe(2)
    expect(reduce(s, a!).over).toBe(true)
  })

  it('能赢时优先赢，而不是去堵对手的冲四', () => {
    const b = boardOf([
      // 自己（白）四连在第一行
      [0, 0, 2],
      [1, 0, 2],
      [2, 0, 2],
      [3, 0, 2],
      // 对手（黑）三连在最后一行
      [5, 14, 1],
      [6, 14, 1],
      [7, 14, 1],
    ])
    const a = aiAction(st(b, COMPUTER))
    expect((a as { cell: number }).cell).toBe(idx(4, 0))
    expect(reduce(st(b, COMPUTER), a!).winner).toBe(2)
  })

  it('对手有冲四时必须一步抓住堵住', () => {
    // 黑在第 7 列四连、白堵住上端 → 黑只剩 (7,6) 一个必胜点，电脑必须立刻占住
    const b = boardOf([
      [7, 7, 1],
      [7, 8, 1],
      [7, 9, 1],
      [7, 10, 1],
      [7, 11, 2],
    ])
    const s = st(b, COMPUTER)
    const a = aiAction(s)
    const cell = (a as { cell: number }).cell
    expect(cell).toBe(idx(7, 6))
    expect(reduce(s, a!).board[cell]).toBe(2)
    expect(winningCells(reduce(s, a!).board, 1)).toEqual([])
  })

  it('会堵掉对手斜向的必败点', () => {
    const b = boardOf([
      [2, 2, 1],
      [3, 3, 1],
      [4, 4, 1],
      [5, 5, 1],
      [1, 1, 2],
    ])
    const s = st(b, COMPUTER)
    const a = aiAction(s)
    expect((a as { cell: number }).cell).toBe(idx(6, 6))
    expect(winningCells(reduce(s, a!).board, 1)).toEqual([])
  })

  it('空盘时落在中心附近', () => {
    const cell = advise(create(9))
    expect(Math.max(Math.abs(colOf(cell) - 7), Math.abs(rowOf(cell) - 7))).toBeLessThanOrEqual(2)
  })

  it('候选点只在已有棋子附近，且都为空点', () => {
    let s = create(3)
    for (const cell of [idx(7, 7), idx(9, 9), idx(4, 12)]) s = place(s, cell)
    const pool = candidatePool(s.board)
    expect(pool.length).toBeGreaterThan(0)
    expect(pool.every((i) => s.board[i] === 0)).toBe(true)
    const top = candidateCells(s.board, COMPUTER, 12)
    expect(top.length).toBeLessThanOrEqual(12)
    expect(top.every((i) => s.board[i] === 0)).toBe(true)
  })

  it('形状打分：活四 > 冲四 > 活三 > 活二', () => {
    const b = boardOf([
      [4, 7, 1],
      [5, 7, 1],
      [6, 7, 1],
      [8, 7, 1],
    ])
    const openFour = moveScore(b, idx(7, 7), 1)
    const c = boardOf([
      [4, 7, 1],
      [5, 7, 1],
      [6, 7, 1],
    ])
    const openThree = moveScore(c, idx(7, 7), 1)
    const one = moveScore(c, idx(7, 7), 2)
    expect(openFour).toBeGreaterThan(openThree)
    expect(openThree).toBeGreaterThan(one)
    expect(one).toBeGreaterThan(0)
  })

  it('对局中 AI 每一步都落在合法空点上', () => {
    for (let seed = 1; seed <= 6; seed++) {
      let s = create(seed * 7919)
      const r = new Rng(seed)
      let aiMoves = 0
      let guard = 0
      while (!s.over && guard++ < CELLS + 5) {
        const empties = emptyCells(s.board)
        if (empties.length === 0) break
        if (s.turn === COMPUTER) {
          const a = aiAction(s)
          expect(a).not.toBeNull()
          const cell = (a as { cell: number }).cell
          expect(Number.isInteger(cell)).toBe(true)
          expect(cell).toBeGreaterThanOrEqual(0)
          expect(cell).toBeLessThan(CELLS)
          expect(s.board[cell]).toBe(0)
          aiMoves++
          s = reduce(s, a!)
        } else {
          s = reduce(s, { type: 'place', cell: empties[r.int(empties.length)] })
        }
      }
      expect(s.over).toBe(true)
      expect(aiMoves).toBeGreaterThan(3)
      expect(s.moves).toBeLessThanOrEqual(CELLS)
      // 每一步都必须是合法落子，落子数与棋盘上的棋子数一致
      expect(s.moves).toBe(s.board.filter((v) => v !== 0).length)
    }
  })

  it('双方都交给 AI 时也必然走到终局', () => {
    // 只跑一局：AI 单步约 10~25ms，整局（可能下满 225 手）需要 2~3 秒
    let s = create(104729)
    let guard = 0
    while (!s.over && guard++ < CELLS + 5) {
      const empties = emptyCells(s.board)
      if (empties.length === 0) break
      const cell = bestMoveFor(s, s.turn)
      expect(empties).toContain(cell)
      s = reduce(s, { type: 'place', cell })
    }
    expect(s.over).toBe(true)
    expect([0, 1, 2]).toContain(s.winner)
    expect(s.moves).toBe(s.history.length)
  })

  it('相同状态永远返回相同动作（可复盘）', () => {
    const b = boardOf([
      [7, 7, 1],
      [7, 8, 2],
      [8, 8, 1],
      [9, 6, 2],
    ])
    const s = st(b, COMPUTER)
    expect(aiAction(s)).toEqual(aiAction(s))
    expect(advise({ ...s, turn: HUMAN })).toBe(advise({ ...s, turn: HUMAN }))
  })

  it('建议落点一定是合法空点', () => {
    let s = create(11)
    s = place(s, idx(7, 7))
    s = place(s, idx(8, 8))
    const cell = advise(s)
    expect(cell).toBeGreaterThanOrEqual(0)
    expect(s.board[cell]).toBe(0)
    expect(bestMoveFor(s, COMPUTER)).toBe(-1)
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参', () => {
    const s = st(boardOf([[7, 7, 1], [8, 8, 2]]), HUMAN)
    const board = s.board.slice()
    const history = s.history.slice()
    reduce(s, { type: 'place', cell: idx(9, 9) })
    expect(s.board).toEqual(board)
    expect(s.history).toEqual(history)
    expect(s.moves).toBe(0)
    expect(s.turn).toBe(HUMAN)
  })

  it('相同输入两次调用结果完全相等', () => {
    const s = st(boardOf([[7, 7, 1]]), HUMAN)
    expect(reduce(s, { type: 'place', cell: idx(9, 9) })).toEqual(reduce(s, { type: 'place', cell: idx(9, 9) }))
    expect(reduce(s, { type: 'undo' })).toEqual(reduce(s, { type: 'undo' }))
  })

  it('aiAction 不修改传入的 state', () => {
    const s = st(boardOf([[7, 7, 1], [8, 8, 2], [7, 8, 1]]), COMPUTER)
    const board = s.board.slice()
    aiAction(s)
    advise(s)
    expect(s.board).toEqual(board)
    expect(s.history).toEqual([])
    expect(s.moves).toBe(0)
  })

  it('同 seed 同开局 + 同落子 = 同结果', () => {
    const play = (): State => {
      let s = create(2024)
      for (const cell of [idx(7, 7), idx(8, 8), idx(7, 8), idx(9, 9)]) s = place(s, cell)
      return s
    }
    expect(play()).toEqual(play())
  })
})

describe('性能', () => {
  it('AI 单步耗时（打印实测数据）', () => {
    const samples: number[] = []
    for (let g = 0; g < 3; g++) {
      let s = create(9_000 + g)
      const r = new Rng(g + 1)
      let guard = 0
      while (!s.over && guard++ < CELLS + 5) {
        const empties = emptyCells(s.board)
        if (empties.length === 0) break
        if (s.turn === COMPUTER) {
          const t0 = performance.now()
          const a = aiAction(s)
          samples.push(performance.now() - t0)
          s = reduce(s, a!)
        } else {
          s = reduce(s, { type: 'place', cell: empties[r.int(empties.length)] })
        }
      }
    }
    expect(samples.length).toBeGreaterThan(10)
    const total = samples.reduce((x, y) => x + y, 0)
    const avg = total / samples.length
    const max = Math.max(...samples)
    console.log(
      `[gomoku AI] ${samples.length} 步 · 总耗时 ${total.toFixed(1)}ms · 平均 ${avg.toFixed(2)}ms/步 · 最慢 ${max.toFixed(2)}ms`,
    )
    expect(avg).toBeLessThan(150)
  })
})