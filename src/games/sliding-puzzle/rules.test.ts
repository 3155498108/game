import { describe, expect, it } from 'vitest'
import {
  BLANK,
  CELLS,
  GOAL,
  SIZE,
  blankIndex,
  colOf,
  create,
  idx,
  inversions,
  isGoal,
  isSolvable,
  move,
  reduce,
  rowOf,
  type State,
} from './rules'

/** 用给定棋盘造一个状态，其余字段取 create 的默认值 */
function stateOf(board: readonly number[], over: Partial<State> = {}): State {
  const s = create(1)
  return { ...s, board: board.slice(), initial: board.slice(), solved: isGoal(board), ...over }
}

/** 离目标态只差一步的棋盘：空格在右下角左边一格，把 15 滑回去即完成 */
const ONE_MOVE_AWAY: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, BLANK, 15]
/** 目标态把 1、2 对调：逆序数为 1，不可解 */
const UNSOLVABLE: number[] = [2, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, BLANK]

describe('初始棋盘', () => {
  it('create 生成 4×4 共 16 格', () => {
    const s = create(42)
    expect(s.board.length).toBe(CELLS)
    expect(s.board.length).toBe(SIZE * SIZE)
    expect(CELLS).toBe(16)
  })

  it('含 1-15 各出现一次，且有且仅有一个 0', () => {
    const s = create(42)
    for (let n = 1; n <= 15; n++) expect(s.board.filter((v) => v === n).length).toBe(1)
    expect(s.board.filter((v) => v === 0).length).toBe(1)
    expect(new Set(s.board).size).toBe(CELLS)
  })

  it('空格初始在右下角', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = create(seed)
      expect(blankIndex(s.board)).toBe(CELLS - 1)
      expect(s.board[15]).toBe(BLANK)
    }
  })

  it('开局步数为 0、未通关，并保存了初始棋盘快照', () => {
    const s = create(7)
    expect(s.moves).toBe(0)
    expect(s.solved).toBe(false)
    expect(s.lastMove).toBeNull()
    expect(s.initial).toEqual(s.board)
    expect(s.initial).not.toBe(s.board)
  })
})

describe('交换规则', () => {
  it('点击与空格相邻的数字块会与之交换', () => {
    const s = stateOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, BLANK], { solved: false })
    // 空格在 15：左边（索引 14）装的是 15，上边（索引 11）装的是 12
    const left = move(s, 14)
    expect(left.board[15]).toBe(15)
    expect(left.board[14]).toBe(BLANK)
    const up = move(s, 11)
    expect(up.board[15]).toBe(12)
    expect(up.board[11]).toBe(BLANK)
  })

  it('记录了移动方向：from 是被点中的块，to 是原空格位置', () => {
    const s = stateOf(ONE_MOVE_AWAY)
    const n = move(s, 15)
    expect(n.lastMove).toEqual({ from: 15, to: 14 })
    expect(n.seq).toBe(s.seq + 1)
  })

  it('与空格不相邻的块点击无效（返回同一 state）', () => {
    const s = create(11)
    const blank = blankIndex(s.board)
    const far = blank - SIZE * 2 >= 0 ? blank - SIZE * 2 : blank + SIZE
    expect(move(s, far)).toBe(s)
    expect(move(s, 0)).toBe(s)
  })

  it('点击空格自身无效', () => {
    const s = create(3)
    expect(move(s, blankIndex(s.board))).toBe(s)
  })

  it('越界与非整数坐标不改变状态', () => {
    const s = create(5)
    expect(move(s, -1)).toBe(s)
    expect(move(s, CELLS)).toBe(s)
    expect(move(s, 999)).toBe(s)
    expect(move(s, 1.5)).toBe(s)
    expect(move(s, NaN)).toBe(s)
  })

  it('斜对角不算相邻', () => {
    // 空格在索引 14（行 3、列 2），索引 9（行 2、列 1）是它的斜对角
    const s = stateOf(ONE_MOVE_AWAY)
    const b = blankIndex(s.board)
    expect(move(s, b - SIZE - 1)).toBe(s)
  })
})

describe('目标判定与通关', () => {
  it('走出最后一步后标记通关', () => {
    const s = stateOf(ONE_MOVE_AWAY, { moves: 37, solved: false })
    expect(s.solved).toBe(false)
    const n = move(s, 15)
    expect(n.board).toEqual([...GOAL])
    expect(n.solved).toBe(true)
    expect(n.moves).toBe(38)
    expect(isGoal(n.board)).toBe(true)
  })

  it('通关后不再接受移动', () => {
    const won = move(stateOf(ONE_MOVE_AWAY), 15)
    expect(won.solved).toBe(true)
    expect(move(won, 0)).toBe(won)
    expect(move(won, 11)).toBe(won)
  })

  it('步数正确累加，非法点击不计步', () => {
    let s = create(2024)
    for (let k = 0; k < 5; k++) {
      const before = s.moves
      // 顶行的格子与空格永不相邻，点击无效
      expect(move(s, k)).toBe(s)
      expect(s.moves).toBe(before)
      // 空格在底行，沿着底行来回挪
      const b = blankIndex(s.board)
      const c = colOf(b)
      const target = c < SIZE - 1 ? idx(c + 1, rowOf(b)) : idx(c - 1, rowOf(b))
      s = move(s, target)
      expect(s.moves).toBe(before + 1)
    }
  })
})

describe('可解性校验', () => {
  it('目标态可解', () => {
    expect(isSolvable([...GOAL])).toBe(true)
    expect(inversions([...GOAL])).toBe(0)
  })

  it('构造出的不可解局面判为 false', () => {
    expect(inversions(UNSOLVABLE)).toBe(1)
    expect(isSolvable(UNSOLVABLE)).toBe(false)
    // 空格不在右下角、且奇偶不符的局面同样不可解
    expect(isSolvable([...ONE_MOVE_AWAY])).toBe(true)
    expect(isSolvable([2, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, BLANK])).toBe(false)
  })

  it('打乱 100 个不同 seed 生成的棋盘全部可解，且开局不是已还原状态', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const s = create(1000 + i * 7919)
      expect(isSolvable(s.board)).toBe(true)
      expect(blankIndex(s.board)).toBe(CELLS - 1)
      expect(isGoal(s.board)).toBe(false)
      expect(s.board.filter((v) => v === BLANK).length).toBe(1)
      seen.add(s.board.join(','))
    }
    // 100 个 seed 不应生成完全相同的棋盘
    expect(seen.size).toBeGreaterThan(90)
  })

  it('连续 200 次 shuffle 出来的棋盘同样保证可解', () => {
    let s = create(99)
    for (let k = 0; k < 200; k++) {
      s = reduce(s, { type: 'shuffle' })
      expect(isSolvable(s.board)).toBe(true)
      expect(blankIndex(s.board)).toBe(CELLS - 1)
      expect(isGoal(s.board)).toBe(false)
    }
  })

  it('任意合法走法推进过程中，棋盘始终落在可解集合内', () => {
    let s = create(31)
    for (let k = 0; k < 60; k++) {
      s = move(s, idx(k % SIZE, SIZE - 1 - (((k / SIZE) | 0) % SIZE)))
      expect(isSolvable(s.board)).toBe(true)
    }
  })
})

describe('打乱与重置', () => {
  it('打乱：换新棋盘、步数清零、推进 rng、不改动入参', () => {
    const s = move(create(123), 15)
    const before = s.board.slice()
    const rngBefore = s.rng
    const n = reduce(s, { type: 'shuffle' })
    expect(s.board).toEqual(before)
    expect(s.rng).toBe(rngBefore)
    expect(n.board).not.toEqual(before)
    expect(n.moves).toBe(0)
    expect(n.solved).toBe(false)
    expect(n.lastMove).toBeNull()
    expect(n.initial).toEqual(n.board)
    expect(n.rng).not.toBe(rngBefore)
    expect(isSolvable(n.board)).toBe(true)
  })

  it('打乱：相同状态总是得到相同结果（可复盘）', () => {
    const s = create(555)
    expect(reduce(s, { type: 'shuffle' })).toEqual(reduce(s, { type: 'shuffle' }))
  })

  it('重置：回到本局初始棋盘并清零', () => {
    const s0 = create(21)
    let s = s0
    // 空格一路往上走，保证真的走动了（不会像在同一行来回那样走一圈回到原局面）
    for (let k = 0; k < 4; k++) s = move(s, blankIndex(s.board) - SIZE)
    expect(s.board).not.toEqual(s0.board)
    const n = reduce(s, { type: 'reset' })
    expect(n.board).toEqual(s0.board)
    expect(n.moves).toBe(0)
    expect(n.solved).toBe(false)
    expect(n.lastMove).toBeNull()
    expect(s.board).not.toEqual(n.board)
  })

  it('开局状态下的重置是空操作', () => {
    const s = create(8)
    expect(reduce(s, { type: 'reset' })).toBe(s)
  })

  it('通关后可以重置或打乱，重新开始', () => {
    const won = move(stateOf(ONE_MOVE_AWAY), 15)
    expect(won.solved).toBe(true)
    const reset = reduce(won, { type: 'reset' })
    expect(reset.solved).toBe(false)
    expect(reset.board).toEqual(ONE_MOVE_AWAY)
    const shuffled = reduce(won, { type: 'shuffle' })
    expect(shuffled.solved).toBe(false)
    expect(isSolvable(shuffled.board)).toBe(true)
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参的任何字段', () => {
    const s = move(create(20260913), 14)
    const snap = {
      board: s.board.slice(),
      initial: s.initial.slice(),
      moves: s.moves,
      solved: s.solved,
      lastMove: s.lastMove ? { ...s.lastMove } : null,
      seq: s.seq,
      hover: s.hover,
      rng: s.rng,
    }
    reduce(s, { type: 'move', index: 11 })
    reduce(s, { type: 'shuffle' })
    reduce(s, { type: 'reset' })
    reduce(s, { type: 'hover', index: 3 })
    expect(s.board).toEqual(snap.board)
    expect(s.initial).toEqual(snap.initial)
    expect(s.moves).toBe(snap.moves)
    expect(s.solved).toBe(snap.solved)
    expect(s.lastMove).toEqual(snap.lastMove)
    expect(s.seq).toBe(snap.seq)
    expect(s.hover).toBe(snap.hover)
    expect(s.rng).toBe(snap.rng)
  })

  it('相同输入两次调用结果完全相等', () => {
    const s = move(create(4242), 15)
    expect(reduce(s, { type: 'move', index: 11 })).toEqual(reduce(s, { type: 'move', index: 11 }))
    expect(reduce(s, { type: 'shuffle' })).toEqual(reduce(s, { type: 'shuffle' }))
    expect(reduce(s, { type: 'hover', index: 2 })).toEqual(reduce(s, { type: 'hover', index: 2 }))
  })

  it('create 对同一 seed 完全一致（可复盘）', () => {
    for (const seed of [1, 999, -12345]) expect(create(seed)).toEqual(create(seed))
    expect(create(1).board).not.toEqual(create(2).board)
  })

  it('hover / leave 只改悬停，不动棋盘', () => {
    const s = create(77)
    const h = reduce(s, { type: 'hover', index: 6 })
    expect(h.board).toEqual(s.board)
    expect(h.hover).toBe(6)
    expect(h.moves).toBe(0)
    expect(reduce(h, { type: 'leave' }).hover).toBe(-1)
    expect(reduce(s, { type: 'leave' })).toBe(s)
    expect(reduce(s, { type: 'hover', index: -1 })).toBe(s)
  })
})
