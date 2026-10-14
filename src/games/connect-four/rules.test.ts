import { describe, expect, it } from 'vitest'
import { COLS, ROWS, aiAction, create, drop, findWin, idx, isFull, legalColumns, reduce, winningCells, type Player, type State } from './rules'

/**
 * rows[0] 是最底下一行，自下而上排列，每行 7 个字符：
 * '.'= 空，'1'= 玩家（黑），'2'= 电脑（白）
 */
function stateOf(rows: string[], turn: Player = 1, hover = -1): State {
  const board = new Array<number>(COLS * ROWS).fill(0)
  for (let r = 0; r < Math.min(rows.length, ROWS); r++) {
    const line = rows[r].padEnd(COLS, '.')
    for (let c = 0; c < COLS; c++) {
      board[idx(c, r)] = line[c] === '1' ? 1 : line[c] === '2' ? 2 : 0
    }
  }
  return { ...create(1), board: board as State['board'], turn, hover }
}

const EMPTY = '.......'

describe('棋盘与重力', () => {
  it('初始状态为空棋盘、黑先、未结束', () => {
    const s = create(42)
    expect(s.board.length).toBe(COLS * ROWS)
    expect(s.board.every((v) => v === 0)).toBe(true)
    expect(s.turn).toBe(1)
    expect(s.over).toBe(false)
    expect(legalColumns(s.board).length).toBe(COLS)
  })

  it('棋子只能落在该列最底部的空位，自下而上堆叠', () => {
    let s = create(1)
    s = drop(s, 3)
    s = drop(s, 3)
    expect(s.board[idx(3, 0)]).toBe(1)
    expect(s.board[idx(3, 1)]).toBe(2)
    expect(s.board[idx(3, 2)]).toBe(0)
  })

  it('已满的列不再接受落子，且不在合法列中', () => {
    const s = stateOf(['2222222', '222....', '222....', '222....', '222....', '222....'])
    expect(legalColumns(s.board)).not.toContain(0)
    expect(drop(s, 0)).toBe(s)
  })

  it('越界列不改变状态', () => {
    const s = create(1)
    expect(drop(s, -1)).toBe(s)
    expect(drop(s, COLS)).toBe(s)
  })
})

describe('胜负判定', () => {
  it('横向四连获胜并记录获胜格', () => {
    // 底行已有 0/1/2 列三子，补上第 5 列即成横向四连
    const s = drop(stateOf(['..111..'], 1), 5)
    expect(s.over).toBe(true)
    expect(s.winner).toBe(1)
    expect(s.winCells.length).toBe(4)
    expect(findWin(s.board, 1).length).toBe(4)
  })

  it('纵向四连获胜', () => {
    const s = stateOf(['1......', '1......', '1......', '1......', EMPTY, EMPTY])
    expect(findWin(s.board, 1).length).toBe(4)
  })

  it('斜向四连获胜', () => {
    const s = stateOf([EMPTY, EMPTY, '...1...', '..1....', '.1.....', '1......'])
    expect(findWin(s.board, 1).length).toBe(4)
  })

  it('反斜向四连也判胜', () => {
    const s = stateOf(['1......', '.1.....', '..1....', '...1...', EMPTY, EMPTY])
    expect(findWin(s.board, 1).length).toBe(4)
  })

  it('三连不算赢', () => {
    const s = stateOf(['11.1...'], 1)
    expect(findWin(s.board, 1)).toEqual([])
  })

  it('棋子填满且双方都无四连 = 平局', () => {
    // 上下交替排列：每条线最长只有 2 连，必然是平局
    const s = stateOf(['1122112', '2211221', '1122112', '2211221', '1122112', '2211221'])
    expect(isFull(s.board)).toBe(true)
    expect(findWin(s.board, 1)).toEqual([])
    expect(findWin(s.board, 2)).toEqual([])
    expect(drop(s, 0)).toBe(s)
  })

  it('结束后不再接受落子', () => {
    const s = drop(stateOf(['..111..'], 1), 5)
    expect(s.over).toBe(true)
    expect(drop(s, 0)).toBe(s)
  })

  it('winningCells 能算出下一手成四的位置', () => {
    const s = stateOf(['111....'], 1)
    expect(winningCells(s.board, 1)).toContain(idx(3, 0))
  })

  it('空棋盘没有直接获胜点', () => {
    expect(winningCells(create(1).board, 1)).toEqual([])
  })
})

describe('AI', () => {
  it('轮到玩家时返回 null', () => {
    expect(aiAction(create(1))).toBeNull()
  })

  it('有直接获胜的落子时立刻取胜', () => {
    // 电脑在底行已有三子，补第 3 列即成四
    const s = stateOf(['222....', EMPTY, EMPTY, EMPTY, EMPTY, EMPTY], 2)
    const a = aiAction(s)
    expect(a).toEqual({ type: 'drop', col: 3 })
    expect(reduce(s, a!).winner).toBe(2)
  })

  it('对手下一手能四连时优先堵住', () => {
    const s = stateOf(['111....', EMPTY, EMPTY, EMPTY, EMPTY, EMPTY], 2)
    expect(aiAction(s)).toEqual({ type: 'drop', col: 3 })
  })

  it('无紧急情况时优先占据中心', () => {
    const s = stateOf([EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, '1.1.....'], 2)
    expect(aiAction(s)).toEqual({ type: 'drop', col: 3 })
  })

  it('整局对弈中返回的每个 action 都是合法落子，且必然终局', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = create(seed * 7919)
      let guard = 0
      while (!s.over && guard++ < COLS * ROWS + 5) {
        if (s.turn === 2) {
          const a = aiAction(s)
          expect(a).not.toBeNull()
          expect(legalColumns(s.board)).toContain((a as { col: number }).col)
          s = reduce(s, a!)
        } else {
          const legal = legalColumns(s.board)
          if (legal.length === 0) break
          s = reduce(s, { type: 'drop', col: legal[seed % legal.length] })
        }
      }
      expect(s.over).toBe(true)
      expect(s.moves).toBeGreaterThan(0)
      expect(s.moves).toBeLessThanOrEqual(COLS * ROWS)
    }
  })

  it('相同状态总是返回相同动作（可复盘）', () => {
    const s = stateOf([EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, '1..2...'], 2)
    expect(aiAction(s)).toEqual(aiAction(s))
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参', () => {
    const s = stateOf(['1......'], 2)
    const before = s.board.slice()
    reduce(s, { type: 'drop', col: 0 })
    expect(s.board).toEqual(before)
    expect(s.moves).toBe(0)
  })

  it('相同输入产生相同输出', () => {
    const s = stateOf(['1......'], 2)
    expect(reduce(s, { type: 'drop', col: 4 })).toEqual(reduce(s, { type: 'drop', col: 4 }))
  })

  it('create 对同一 seed 完全一致', () => {
    expect(create(123)).toEqual(create(123))
  })

  it('hover 不改变棋盘', () => {
    const s = create(1)
    const n = reduce(s, { type: 'hover', col: 2 })
    expect(n.board).toEqual(s.board)
    expect(n.hover).toBe(2)
  })

  it('hover 不会产生落子', () => {
    const s = create(1)
    expect(reduce(s, { type: 'hover', col: 2 }).moves).toBe(0)
  })
})