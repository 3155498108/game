import { describe, expect, it } from 'vitest'
import {
  COLS,
  DIRS,
  FOUR_RATE,
  SIZE,
  SWIPE_THRESHOLD,
  TARGET,
  canMove,
  create,
  reduce,
  slideBoard,
  slideLine,
  swipeDir,
  type Dir,
  type State,
} from './rules'

/** 造一个指定棋盘的状态（分数、rng 固定，断言才稳） */
function withBoard(board: number[], extra: Partial<State> = {}): State {
  const s = create(20260913)
  return { ...s, board: board.slice(), over: !canMove(board), ...extra }
}

/** 把棋盘按行切开，方便断言某一行 */
function row(board: number[], r: number): number[] {
  return board.slice(r * COLS, r * COLS + COLS)
}

/** 上下翻转（对称性断言用） */
function flipRows(board: number[]): number[] {
  const out: number[] = []
  for (let r = COLS - 1; r >= 0; r--) out.push(...row(board, r))
  return out
}

describe('初始状态', () => {
  it('开局在棋盘上放了两个方块', () => {
    const s = create(42)
    expect(s.board.length).toBe(SIZE)
    expect(s.board.filter((v) => v !== 0).length).toBe(2)
  })

  it('开局的方块只可能是 2 或 4', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const tiles = create(seed * 7919).board.filter((v) => v !== 0)
      expect(tiles.every((v) => v === 2 || v === 4)).toBe(true)
    }
  })

  it('开局分数为 0，没通关也没结束', () => {
    const s = create(7)
    expect(s.score).toBe(0)
    expect(s.won).toBe(false)
    expect(s.wonAt).toBeNull()
    expect(s.over).toBe(false)
    expect(s.moves).toBe(0)
    expect(s.lastDir).toBeNull()
  })

  it('同一个 seed 生成完全相同的初始棋盘', () => {
    expect(create(8888)).toEqual(create(8888))
    expect(create(20260913).board).toEqual(create(20260913).board)
  })

  it('不同 seed 生成的初始棋盘不同', () => {
    const boards = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) boards.add(JSON.stringify(create(seed * 104729).board))
    expect(boards.size).toBeGreaterThan(10)
    expect(create(1).board).not.toEqual(create(2).board)
  })
})

describe('滑动与合并', () => {
  it('[2,2,2,2] 左滑 → [4,4,0,0]，得 8 分', () => {
    const sl = slideLine([2, 2, 2, 2])
    expect(sl.values).toEqual([4, 4, 0, 0])
    expect(sl.gained).toBe(8)
  })

  it('一次滑动里不能二次合并：[2,2,4,0] 左滑 → [4,4,0,0]，得 4 分', () => {
    const sl = slideLine([2, 2, 4, 0])
    expect(sl.values).toEqual([4, 4, 0, 0])
    expect(sl.gained).toBe(4)
  })

  it('[4,4,8,8] 左滑 → [8,16,0,0]，得 24 分', () => {
    const sl = slideLine([4, 4, 8, 8])
    expect(sl.values).toEqual([8, 16, 0, 0])
    expect(sl.gained).toBe(24)
  })

  it('合并出来的新方块不会再跟后面的方块合并', () => {
    const sl = slideLine([2, 2, 4, 4])
    expect(sl.values).toEqual([4, 8, 0, 0])
    expect(sl.gained).toBe(12)
  })

  it('滑动先把方块压紧，空格被挤到后面', () => {
    const sl = slideLine([0, 2, 0, 4])
    expect(sl.values).toEqual([2, 4, 0, 0])
    expect(sl.gained).toBe(0)
  })

  it('压紧后相邻且相等才合并', () => {
    expect(slideLine([2, 4, 2, 4]).values).toEqual([2, 4, 2, 4])
    expect(slideLine([2, 2, 4, 4]).gained).toBe(12)
  })

  it('四个方向互为对称', () => {
    const b = [0, 0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0]
    expect(row(slideBoard(b, 'left').board, 1)).toEqual([4, 4, 0, 0])
    expect(row(slideBoard(b, 'right').board, 1)).toEqual([0, 0, 4, 4])
    expect(row(slideBoard(b, 'up').board, 0)).toEqual([2, 2, 2, 2])
    expect(row(slideBoard(b, 'down').board, 3)).toEqual([2, 2, 2, 2])
    // 上滑等于「先上下翻转再下滑」的结果
    expect(slideBoard(b, 'up').board).toEqual(flipRows(slideBoard(b, 'down').board))
    // 四个方向的得分互相对应
    expect(slideBoard(b, 'left').gained).toBe(8)
    expect(slideBoard(b, 'right').gained).toBe(8)
    expect(slideBoard(b, 'up').gained).toBe(0)
    expect(slideBoard(b, 'down').gained).toBe(0)
  })

  it('上下滑动按列处理，左右滑动按行处理', () => {
    const b = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    expect(slideBoard(b, 'up').board[0]).toBe(2)
    expect(slideBoard(b, 'down').board[12]).toBe(2)
    expect(slideBoard(b, 'left').board[0]).toBe(2)
    expect(slideBoard(b, 'right').board[3]).toBe(2)
  })

  it('滑动后的分数按合并掉的数值累加', () => {
    const a = reduce(withBoard([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), { type: 'move', dir: 'left' })
    expect(a.score).toBe(4)
    const b = reduce(withBoard([4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { score: 10 }), {
      type: 'move',
      dir: 'left',
    })
    expect(b.score).toBe(18)
  })
})

describe('无效滑动', () => {
  it('滑动没有任何变化时状态原样返回（引用不变）', () => {
    // 满盘且没有一对相邻同值 → 四个方向都推不动
    const s = withBoard([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2])
    for (const dir of DIRS) {
      expect(reduce(s, { type: 'move', dir })).toBe(s)
    }
  })

  it('无效滑动不加分，也不生成新方块', () => {
    // 空格在右下角：这一列往上是压紧的，上滑推不动
    const board = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 0]
    const s = withBoard(board)
    const n = reduce(s, { type: 'move', dir: 'up' })
    expect(n).toBe(s)
    expect(n.score).toBe(0)
    expect(n.board).toEqual(board)
    expect(n.board.filter((v) => v !== 0).length).toBe(15)
    expect(n.moves).toBe(0)
  })
})

describe('canMove 判定', () => {
  it('有空格就能走', () => {
    expect(canMove([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 0])).toBe(true)
  })

  it('横向有相邻且相等的方块就能走', () => {
    expect(canMove([2, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4, 8, 16, 32])).toBe(true)
  })

  it('纵向有相邻且相等的方块就能走', () => {
    // 每一行都不挨着相等，但第 0 列的 2 与 2 是上下相邻的
    expect(canMove([2, 4, 8, 16, 2, 8, 16, 32, 4, 16, 32, 64, 8, 32, 64, 128])).toBe(true)
  })

  it('满盘且没有可合并的相邻方块就走不动了', () => {
    expect(canMove([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2])).toBe(false)
  })
})

describe('新方块', () => {
  it('新方块只落在空位', () => {
    let s = create(99)
    for (let i = 0; i < 60; i++) {
      const dir = DIRS[i % DIRS.length]
      const slid = slideBoard(s.board, dir)
      const next = reduce(s, { type: 'move', dir })
      if (next === s) continue
      // 滑动结果与最终棋盘不一样的那一格，就是新冒出来的方块
      for (let k = 0; k < SIZE; k++) {
        if (slid.board[k] === next.board[k]) continue
        expect(slid.board[k]).toBe(0)
        expect(next.board[k] === 2 || next.board[k] === 4).toBe(true)
      }
      s = next
    }
  })

  it('新方块的值只有 2 与 4', () => {
    let s = create(1234)
    for (let i = 0; i < 40; i++) {
      const dir = DIRS[i % DIRS.length]
      const slid = slideBoard(s.board, dir)
      const next = reduce(s, { type: 'move', dir })
      if (next === s) continue
      for (let k = 0; k < SIZE; k++) {
        if (slid.board[k] !== next.board[k]) expect([2, 4]).toContain(next.board[k])
      }
      s = next
    }
  })

  it('连续滑动时方块数始终不超过 16', () => {
    let s = create(20260913)
    for (let i = 0; i < 80; i++) {
      s = reduce(s, { type: 'move', dir: DIRS[i % DIRS.length] })
      expect(s.board.length).toBe(SIZE)
      expect(s.board.filter((v) => v !== 0).length).toBeLessThanOrEqual(SIZE)
    }
  })

  it('新方块是 4 的概率是 10%', () => {
    expect(FOUR_RATE).toBe(0.1)
  })
})

describe('通关与结束', () => {
  it('合成出 2048 就通关', () => {
    const s = withBoard([0, 0, 0, 0, 1024, 1024, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const n = reduce(s, { type: 'move', dir: 'left' })
    expect(n.board[4]).toBe(TARGET)
    expect(n.won).toBe(true)
    expect(n.wonAt).toBe(1)
    expect(n.over).toBe(false)
  })

  it('通关后游戏继续，还能接着滑', () => {
    const s = withBoard([0, 0, 0, 0, 1024, 1024, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const won = reduce(s, { type: 'move', dir: 'left' })
    const n = reduce(won, { type: 'move', dir: 'down' })
    expect(n.moves).toBe(2)
    expect(n.won).toBe(true)
    expect(n.board[12]).toBe(TARGET)
    expect(n.over).toBe(false)
  })

  it('满盘又没法合并就结束', () => {
    const s = withBoard([0, 8, 16, 32, 4, 2, 4, 8, 2, 4, 2, 4, 4, 2, 4, 2])
    expect(s.over).toBe(false)
    const n = reduce(s, { type: 'move', dir: 'left' })
    expect(n.board.filter((v) => v !== 0).length).toBe(SIZE)
    expect(n.over).toBe(true)
  })

  it('结束之后滑动不会再有任何变化', () => {
    const s = withBoard([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2])
    expect(s.over).toBe(true)
    for (const dir of DIRS) {
      expect(reduce(s, { type: 'move', dir })).toBe(s)
    }
  })
})

describe('拖动判定', () => {
  it('位移不足阈值不算滑动', () => {
    let s = create(5)
    s = reduce(s, { type: 'press', x: 300, y: 600 })
    s = reduce(s, { type: 'drag', x: 300 + SWIPE_THRESHOLD - 1, y: 600 })
    expect(swipeDir(s)).toBeNull()
  })

  it('横向位移取左右方向', () => {
    let s = create(5)
    s = reduce(s, { type: 'press', x: 300, y: 600 })
    s = reduce(s, { type: 'drag', x: 240, y: 600 })
    expect(swipeDir(s)).toBe('left')
    s = reduce(s, { type: 'drag', x: 360, y: 600 })
    expect(swipeDir(s)).toBe('right')
  })

  it('纵向位移取上下方向', () => {
    let s = create(5)
    s = reduce(s, { type: 'press', x: 300, y: 600 })
    s = reduce(s, { type: 'drag', x: 300, y: 540 })
    expect(swipeDir(s)).toBe('up')
    s = reduce(s, { type: 'drag', x: 300, y: 660 })
    expect(swipeDir(s)).toBe('down')
  })

  it('两个轴都超过阈值时取绝对值较大的那个', () => {
    let s = create(5)
    s = reduce(s, { type: 'press', x: 300, y: 600 })
    s = reduce(s, { type: 'drag', x: 360, y: 630 })
    expect(swipeDir(s)).toBe('right')
  })

  it('抬手时按位移产生一次滑动', () => {
    let s = withBoard([0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    s = reduce(s, { type: 'press', x: 400, y: 700 })
    s = reduce(s, { type: 'drag', x: 300, y: 700 })
    const n = reduce(s, { type: 'release' })
    expect(n.lastDir).toBe('left')
    expect(n.moves).toBe(1)
    expect(n.board[0]).toBe(2)
    expect(n.dragStart).toBeNull()
    expect(n.dragCur).toBeNull()
  })

  it('位移不够时抬手什么也不发生', () => {
    let s = withBoard([0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    s = reduce(s, { type: 'press', x: 400, y: 700 })
    s = reduce(s, { type: 'drag', x: 395, y: 700 })
    const n = reduce(s, { type: 'release' })
    expect(n.moves).toBe(0)
    expect(n.lastDir).toBeNull()
    expect(n.dragStart).toBeNull()
  })

  it('按下与移动会记录起点和当前位置', () => {
    let s = create(5)
    s = reduce(s, { type: 'press', x: 100, y: 200 })
    expect(s.dragStart).toEqual({ x: 100, y: 200 })
    expect(s.dragCur).toEqual({ x: 100, y: 200 })
    s = reduce(s, { type: 'drag', x: 130, y: 260 })
    expect(s.dragStart).toEqual({ x: 100, y: 200 })
    expect(s.dragCur).toEqual({ x: 130, y: 260 })
  })
})

describe('复盘性与纯函数约束', () => {
  it('同一个 seed + 同一串操作，必然得到完全相同的棋盘与分数', () => {
    const seq: Dir[] = ['left', 'up', 'right', 'down', 'left', 'up', 'right', 'down', 'left', 'up']
    const run = (): State => {
      let s = create(20260913)
      for (const d of seq) s = reduce(s, { type: 'move', dir: d })
      return s
    }
    const a = run()
    const b = run()
    expect(a.board).toEqual(b.board)
    expect(a.score).toBe(b.score)
    expect(a).toEqual(b)
  })

  it('重开之后依然可复盘', () => {
    const run = (): State => {
      let s = create(31415)
      s = reduce(s, { type: 'move', dir: 'left' })
      s = reduce(s, { type: 'restart' })
      s = reduce(s, { type: 'move', dir: 'up' })
      return s
    }
    expect(run()).toEqual(run())
  })

  it('重开会重新发牌并清零分数', () => {
    const t = reduce(withBoard([0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), { type: 'move', dir: 'left' })
    const r = reduce(t, { type: 'restart' })
    expect(r.score).toBe(0)
    expect(r.moves).toBe(0)
    expect(r.won).toBe(false)
    expect(r.wonAt).toBeNull()
    expect(r.over).toBe(false)
    expect(r.lastDir).toBeNull()
    expect(r.board.filter((v) => v !== 0).length).toBe(2)
  })

  it('reduce 不修改入参', () => {
    const s = withBoard([0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const board = s.board.slice()
    const rng = s.rng
    const n = reduce(s, { type: 'move', dir: 'left' })
    expect(s.board).toEqual(board)
    expect(s.rng).toBe(rng)
    expect(s.score).toBe(0)
    expect(n).not.toBe(s)
  })

  it('相同输入产生完全相同输出', () => {
    const s = withBoard([0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(reduce(s, { type: 'move', dir: 'left' })).toEqual(reduce(s, { type: 'move', dir: 'left' }))
  })

  it('tick 不会改变状态（回合制没有与时间相关的规则）', () => {
    const s = create(9)
    expect(reduce(s, { type: 'tick', ticks: 1 })).toBe(s)
    expect(reduce(s, { type: 'tick', ticks: 60 })).toBe(s)
  })
})
