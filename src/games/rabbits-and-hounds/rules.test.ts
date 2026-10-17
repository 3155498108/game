import { describe, expect, it } from 'vitest'
import {
  CELLS,
  COLS,
  DIRS,
  DOG,
  DOG_START,
  EMPTY,
  FOX,
  FOX_START,
  MOVE_LIMIT,
  NODE_BUDGET,
  ORTHO,
  RABBIT,
  RABBIT_STARTS,
  ROWS,
  SEARCH_DEPTHS,
  adjacentToHound,
  aiAction,
  aiSearch,
  canSlide,
  colOf,
  create,
  evaluate,
  exitDistance,
  findPiece,
  foxEscaped,
  foxStuck,
  idx,
  inBoard,
  isExitCell,
  isHound,
  legalActions,
  movesOf,
  other,
  owns,
  piecesOf,
  reduce,
  rowOf,
  slide,
  slideTarget,
  slidesFrom,
  winnerOf,
  type Action,
  type Piece,
  type Side,
  type State,
} from './rules'

const clone = (s: State): State => JSON.parse(JSON.stringify(s)) as State

/** 构造一个任意局面：board 为 63 格数组，over/winner 按 winnerOf 同步推导 */
function stateWith(board: Piece[], turn: Side, moves = 0): State {
  const s: State = { ...create(7), board, turn, moves }
  const w = winnerOf(s)
  return w === 'none' ? s : { ...s, over: true, winner: w }
}

/** 空盘 */
function blank(): Piece[] {
  return new Array<Piece>(CELLS).fill(EMPTY)
}

/** 放好棋子后交给 stateWith */
function withPieces(pieces: Array<[number, Piece]>, turn: Side, moves = 0): State {
  const board = blank()
  for (const [cell, p] of pieces) board[cell] = p
  return stateWith(board, turn, moves)
}

/** 只放狐狸与狗（兔子全部让开），用于单独测试滑行与封死判定 */
function foxAndDog(foxCell: number, dogCell: number, turn: Side = 'fox'): State {
  return withPieces(
    [
      [foxCell, FOX],
      [dogCell, DOG],
    ],
    turn,
  )
}

describe('棋盘尺寸与坐标', () => {
  it('棋盘 7 行 × 9 列 = 63 格', () => {
    expect(ROWS).toBe(7)
    expect(COLS).toBe(9)
    expect(CELLS).toBe(63)
  })

  it('idx / colOf / rowOf 互为逆映射，覆盖全部 63 格', () => {
    const seen = new Set<number>()
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = idx(c, r)
        expect(colOf(cell)).toBe(c)
        expect(rowOf(cell)).toBe(r)
        expect(seen.has(cell)).toBe(false)
        seen.add(cell)
      }
    }
    expect(seen.size).toBe(CELLS)
  })

  it('inBoard 拒绝越界与非整数', () => {
    expect(inBoard(0)).toBe(true)
    expect(inBoard(62)).toBe(true)
    expect(inBoard(-1)).toBe(false)
    expect(inBoard(63)).toBe(false)
    expect(inBoard(1.5)).toBe(false)
  })

  it('步数上限为 200 步（平局兜底）', () => {
    expect(MOVE_LIMIT).toBe(200)
  })
})

describe('开局', () => {
  it('开局 4 只兔子 + 1 只狗 + 1 只狐狸，其余全空', () => {
    const s = create(42)
    expect(s.board.filter((p) => p === RABBIT).length).toBe(4)
    expect(s.board.filter((p) => p === DOG).length).toBe(1)
    expect(s.board.filter((p) => p === FOX).length).toBe(1)
    expect(s.board.filter((p) => p === EMPTY).length).toBe(CELLS - 6)
    expect(RABBIT_STARTS.length).toBe(4)
  })

  it('狐狸起始在中心行（第 3 行）的中心列（第 4 列）', () => {
    const s = create(1)
    expect(rowOf(FOX_START)).toBe(3)
    expect(colOf(FOX_START)).toBe(4)
    expect(rowOf(FOX_START)).toBe((ROWS - 1) / 2)
    expect(s.board[FOX_START]).toBe(FOX)
    expect(findPiece(s.board, FOX)).toBe(FOX_START)
  })

  it('开局棋子互不重叠，狗与狐狸同在中心列', () => {
    const s = create(7)
    const occupied = s.board.map((p, i) => (p === EMPTY ? -1 : i)).filter((i) => i >= 0)
    expect(occupied.length).toBe(6)
    expect(new Set(occupied).size).toBe(6)
    expect(colOf(DOG_START)).toBe(colOf(FOX_START))
    expect(rowOf(DOG_START)).toBe(ROWS - 1)
  })

  it('兔子先走，电脑执狐狸', () => {
    const s = create(3)
    expect(s.turn).toBe('rabbit')
    expect(s.over).toBe(false)
    expect(s.winner).toBe('none')
    expect(s.moves).toBe(0)
    expect(s.selected).toBe(-1)
    expect(s.lastFrom).toBe(-1)
  })

  it('create 对同一 seed 完全一致，不同 seed 只在 rng 上不同', () => {
    expect(create(123)).toEqual(create(123))
    expect(create(123).rng).toBe(123)
    expect(create(124).board).toEqual(create(123).board)
    expect(create(124).rng).not.toBe(create(123).rng)
  })

  it('开局狐狸 4 个正交方向都空着，4 条斜线紧邻格都是兔子', () => {
    const s = create(5)
    const outs = slidesFrom(s.board, FOX_START)
    // 四个正交方向紧邻格是空的，可以直接滑过去
    for (const c of [idx(3, 3), idx(5, 3), idx(4, 2), idx(4, 4)]) expect(outs).toContain(c)
    // 四条斜向的紧邻格都被兔子占住：不能停在兔子上，只能滑到兔子后面的空格
    const beyond = [idx(2, 1), idx(6, 1), idx(2, 5), idx(6, 5)]
    for (const b of beyond) {
      expect(s.board[b]).toBe(EMPTY)
      expect(outs).toContain(b)
    }
    for (const r of RABBIT_STARTS) {
      expect(s.board[r]).toBe(RABBIT)
      expect(outs).not.toContain(r)
    }
    // 落点一定是空格
    for (const t of outs) expect(s.board[t]).toBe(EMPTY)
  })

  it('开局兔子方共有 5 个棋子（4 兔 + 1 狗）', () => {
    const s = create(9)
    expect(piecesOf(s.board, 'rabbit').length).toBe(5)
    expect(piecesOf(s.board, 'fox')).toEqual([FOX_START])
    expect(piecesOf(s.board, 'rabbit')).toContain(DOG_START)
    expect(legalActions(s).every((a) => a.type === 'slide')).toBe(true)
  })
})

describe('滑行：只能落到该方向的第一个空格', () => {
  it('8 条射线覆盖东西南北与两条 45° 对角线', () => {
    expect(DIRS.length).toBe(8)
    const key = DIRS.map(([dc, dr]) => `${dc},${dr}`).sort()
    expect(key).toEqual(
      ['-1,-1', '-1,0', '-1,1', '0,-1', '0,1', '1,-1', '1,0', '1,1'].sort(),
    )
  })

  it('水平滑行：遇到棋子会跳过它，落在更远的空格上', () => {
    const board = blank()
    board[idx(4, 3)] = RABBIT
    board[idx(3, 3)] = DOG // 正前方被占，但更远的格子空着
    expect(slideTarget(board, idx(4, 3), 1)).toBe(idx(2, 3))
    expect(slidesFrom(board, idx(4, 3))).toContain(idx(2, 3))
    expect(slidesFrom(board, idx(4, 3))).not.toContain(idx(3, 3))
  })

  it('竖直滑行：只能停在第一个空格，不能越过空格继续滑', () => {
    const board = blank()
    board[idx(4, 3)] = RABBIT
    expect(slideTarget(board, idx(4, 3), 2)).toBe(idx(4, 4))
    expect(slideTarget(board, idx(4, 3), 3)).toBe(idx(4, 2))
    // 不能跳过空格滑得更远
    expect(slidesFrom(board, idx(4, 3))).toContain(idx(4, 4))
    expect(slidesFrom(board, idx(4, 3))).not.toContain(idx(4, 5))
  })

  it('斜向滑行：沿 45° 对角线落到第一个空格', () => {
    const board = blank()
    board[idx(4, 3)] = RABBIT
    board[idx(5, 4)] = DOG
    expect(slideTarget(board, idx(4, 3), 4)).toBe(idx(6, 5))
    expect(slideTarget(board, idx(4, 3), 6)).toBe(idx(5, 2))
  })

  it('方向被棋子完全堵死时没有落点（不能停在有子的格上）', () => {
    const board = blank()
    for (let c = 5; c < COLS; c++) board[idx(c, 3)] = RABBIT // 往东整条射线占满
    board[idx(4, 3)] = RABBIT // 被测的兔子
    expect(slideTarget(board, idx(4, 3), 0)).toBe(-1)
    expect(slidesFrom(board, idx(4, 3))).not.toContain(idx(5, 3))
    expect(canSlide(board, idx(4, 3), idx(6, 3))).toBe(false)
    expect(slidesFrom(board, idx(4, 3))).toHaveLength(7)
  })

  it('狗可以越过棋子滑行到更远的空格，但不能落在棋子格上', () => {
    const board = blank()
    board[idx(4, 6)] = DOG
    board[idx(4, 5)] = RABBIT
    expect(slideTarget(board, DOG_START, 3)).toBe(idx(4, 4)) // 北
    expect(canSlide(board, DOG_START, idx(4, 5))).toBe(false) // 不能压在兔子上
    expect(canSlide(board, DOG_START, idx(4, 4))).toBe(true)
  })

  it('canSlide 拒绝不共线的落点与棋盘外的落点', () => {
    const board = blank()
    board[idx(4, 3)] = FOX
    expect(canSlide(board, idx(4, 3), idx(5, 1))).toBe(false) // 不在任何一条直线上
    expect(canSlide(board, idx(4, 3), -1)).toBe(false)
    expect(canSlide(board, idx(4, 3), CELLS)).toBe(false)
    expect(canSlide(board, idx(4, 3), idx(4, 3))).toBe(false)
    expect(canSlide(board, idx(4, 3), idx(5, 2))).toBe(true) // 东北方向第一个空格
  })

  it('滑行非法时 reduce 原样返回同一个 state（棋子数组不被改写）', () => {
    const s = create(1)
    expect(slide(s, FOX_START, RABBIT_STARTS[0])).toBe(s) // 落点有子
    expect(slide(s, FOX_START, idx(4, 2))).toBe(s) // 不是轮到狐狸走
    expect(slide(s, DOG_START, FOX_START)).toBe(s) // 落点有子
    expect(slide(s, DOG_START, idx(8, 6))).toBe(s) // 不共线
    expect(slide(s, -1, 0)).toBe(s)
    expect(slide(s, FOX_START, 99)).toBe(s)
  })

  it('越界与非整数的格号被拒绝', () => {
    const s = create(1)
    const before = clone(s)
    reduce(s, { type: 'slide', from: FOX_START, to: 1.5 })
    reduce(s, { type: 'slide', from: -3, to: 4 })
    expect(s).toEqual(before)
  })
})

describe('胜负判定', () => {
  it('狐狸在第 0 列且不挨着任何猎犬 → 狐狸胜', () => {
    const s = foxAndDog(idx(0, 3), idx(4, 6))
    expect(isExitCell(idx(0, 3))).toBe(true)
    expect(winnerOf(s)).toBe('fox')
    expect(foxEscaped(s.board)).toBe(true)
  })

  it('狐狸在第 8 列且不挨着任何猎犬 → 狐狸胜', () => {
    expect(winnerOf(foxAndDog(idx(8, 2), idx(4, 6)))).toBe('fox')
  })

  it('狐狸已站在底线列但与狗上下相邻 → 不算赢，继续走', () => {
    const s = foxAndDog(idx(0, 3), idx(0, 2))
    expect(isExitCell(idx(0, 3))).toBe(true)
    expect(adjacentToHound(s.board, idx(0, 3))).toBe(true)
    expect(winnerOf(s)).toBe('none')
    expect(foxEscaped(s.board)).toBe(false)
  })

  it('兔子也算猎犬：底线格挨着兔子同样不算赢', () => {
    const board = blank()
    board[idx(0, 3)] = FOX
    board[idx(0, 2)] = DOG
    board[idx(1, 3)] = RABBIT
    const s = stateWith(board, 'rabbit')
    expect(adjacentToHound(board, idx(0, 3))).toBe(true)
    expect(winnerOf(s)).toBe('none')
  })

  it('斜向相邻不算「挨着猎犬」，仍判狐狸胜', () => {
    expect(winnerOf(foxAndDog(idx(0, 3), idx(1, 2)))).toBe('fox')
    expect(winnerOf(foxAndDog(idx(0, 3), idx(1, 4)))).toBe('fox')
    expect(ORTHO.length).toBe(4)
  })

  it('一步滑到出口且不挨着猎犬 → 直接判狐狸胜', () => {
    let s = foxAndDog(idx(1, 3), idx(4, 6), 'fox')
    expect(s.over).toBe(false)
    s = slide(s, idx(1, 3), idx(0, 3))
    expect(s.over).toBe(true)
    expect(s.winner).toBe('fox')
    expect(s.lastTo).toBe(idx(0, 3))
    expect(s.moves).toBe(1)
  })

  it('滑到出口但正挨着狗不算赢，这一手只是普通走子', () => {
    const s = slide(foxAndDog(idx(1, 3), idx(0, 2), 'fox'), idx(1, 3), idx(0, 3))
    expect(s.over).toBe(false)
    expect(s.winner).toBe('none')
    expect(s.board[idx(0, 3)]).toBe(FOX)
  })

  it('狐狸所有方向都被封死 → 兔子胜', () => {
    const board = blank()
    board[FOX_START] = FOX
    for (let i = 0; i < CELLS; i++) if (i !== FOX_START) board[i] = RABBIT
    const s = stateWith(board, 'rabbit')
    expect(foxStuck(board)).toBe(true)
    expect(winnerOf(s)).toBe('rabbit')
    expect(slidesFrom(board, FOX_START)).toHaveLength(0)
  })

  it('走到步数上限仍无人分胜负 → 判平局', () => {
    const s = create(11)
    expect(winnerOf(s)).toBe('none')
    expect(winnerOf({ ...s, moves: MOVE_LIMIT })).toBe('draw')
    // 封死判定优先于平局兜底
    const board = blank()
    board[FOX_START] = FOX
    for (let i = 0; i < CELLS; i++) if (i !== FOX_START) board[i] = RABBIT
    expect(winnerOf({ ...s, board, moves: MOVE_LIMIT })).toBe('rabbit')
  })

  it('到达步数上限的那一步就结束，不会拖到无限步', () => {
    const s: State = { ...create(2), moves: MOVE_LIMIT - 1, turn: 'rabbit' }
    const targets = slidesFrom(s.board, RABBIT_STARTS[0])
    expect(targets.length).toBeGreaterThan(0)
    const n = slide(s, RABBIT_STARTS[0], targets[0])
    expect(n.over).toBe(true)
    expect(n.winner).toBe('draw')
    expect(n.moves).toBe(MOVE_LIMIT)
  })

  it('终局后不再接受任何走子', () => {
    const s = stateWith(foxAndDog(idx(0, 3), idx(4, 6)).board, 'fox')
    expect(s.over).toBe(true)
    const from = RABBIT_STARTS[0]
    expect(slide(s, from, slidesFrom(s.board, from)[0])).toBe(s)
    expect(reduce(s, { type: 'select', cell: from })).toBe(s)
    expect(legalActions(s)).toEqual([])
  })

  it('胜负与出口距离的辅助判定一致', () => {
    expect(exitDistance(idx(4, 3))).toBe(4)
    expect(exitDistance(idx(0, 3))).toBe(0)
    expect(exitDistance(idx(8, 6))).toBe(0)
    expect(exitDistance(idx(2, 1))).toBe(2)
    expect(isHound(RABBIT)).toBe(true)
    expect(isHound(DOG)).toBe(true)
    expect(isHound(FOX)).toBe(false)
    expect(owns(DOG, 'rabbit')).toBe(true)
    expect(owns(RABBIT, 'fox')).toBe(false)
    expect(other('fox')).toBe('rabbit')
    expect(other('rabbit')).toBe('fox')
  })
})

describe('选中与悬停', () => {
  it('只能选中己方有子可动的棋子', () => {
    let s = create(4)
    s = reduce(s, { type: 'select', cell: RABBIT_STARTS[0] })
    expect(s.selected).toBe(RABBIT_STARTS[0])
    s = reduce(s, { type: 'select', cell: FOX_START })
    expect(s.selected).toBe(-1)
    expect(reduce(s, { type: 'clear' }).selected).toBe(-1)
    expect(reduce(s, { type: 'clear' }).selected).toBe(-1)
  })

  it('悬停不改变盘面与步数，越界归 -1', () => {
    const s0 = create(6)
    const s = reduce(s0, { type: 'hover', cell: FOX_START })
    expect(s.hover).toBe(FOX_START)
    expect(s.board).toEqual(s0.board)
    expect(s.moves).toBe(0)
    expect(reduce(s, { type: 'hover', cell: 99 }).hover).toBe(-1)
  })

  it('滑行会自动清掉选中与悬停', () => {
    let s = create(8)
    s = reduce(s, { type: 'hover', cell: RABBIT_STARTS[1] })
    s = reduce(s, { type: 'select', cell: RABBIT_STARTS[1] })
    const to = slidesFrom(s.board, RABBIT_STARTS[1])[0]
    s = slide(s, RABBIT_STARTS[1], to)
    expect(s.selected).toBe(-1)
    expect(s.hover).toBe(-1)
    expect(s.lastPiece).toBe(RABBIT)
    expect(s.lastFrom).toBe(RABBIT_STARTS[1])
  })
})

describe('AI', () => {
  /**
   * 自对弈入口：**对双方都生效**，与「谁来走」无关。
   *
   * 不能用 `aiAction`：那是给站点壳的契约入口，只在狐狸回合出手
   * （壳层每落一子就挂一次定时器，AI 若在玩家回合也返回走法就会替玩家把棋走光）。
   * 自对弈与「测试兔子方 AI 会不会封死狐狸」要的是不带门禁的搜索入口。
   */
  function bestOf(state: State): Action {
    const info = aiSearch(state)
    expect(info).not.toBeNull()
    return info!.action
  }

  it('aiAction 只在狐狸回合出手：玩家回合必须返回 null', () => {
    // 这条是壳层契约的回归测试 —— 曾经漏门禁，导致 AI 接管双方、玩家完全无法操控
    const s0 = create(7)
    expect(s0.turn).toBe('rabbit')
    expect(aiAction(s0)).toBeNull()
    expect(bestOf(s0)).not.toBeNull()

    const s1 = reduce(s0, bestOf(s0))
    expect(s1.turn).toBe('fox')
    expect(aiAction(s1)).not.toBeNull()

    const s2 = reduce(s1, aiAction(s1)!)
    expect(s2.turn).toBe('rabbit')
    expect(aiAction(s2)).toBeNull()

    // 终局一律 null
    expect(aiAction({ ...create(7), over: true })).toBeNull()
  })

  it('终局时 aiAction 返回 null', () => {
    const s = stateWith(foxAndDog(idx(0, 3), idx(4, 6)).board, 'fox')
    expect(aiAction(s)).toBeNull()
    expect(aiSearch(s)).toBeNull()
  })

  it('走法必定来自 legalActions：能一步到底线时狐狸就立刻赢', () => {
    // 狐狸 (1,2)，狗在 (0,1)。(0,2) 是挨着狗的底线格，(0,3) 是不挨着狗的底线格 → 应该走 (0,3)
    const s = withPieces(
      [
        [idx(1, 2), FOX],
        [idx(0, 1), DOG],
      ],
      'fox',
    )
    expect(canSlide(s.board, idx(1, 2), idx(0, 3))).toBe(true)
    const a = aiAction(s)
    expect(legalActions(s)).toContainEqual(a!)
    expect(a).toEqual({ type: 'slide', from: idx(1, 2), to: idx(0, 3) })
    const n = reduce(s, a!)
    expect(n.over).toBe(true)
    expect(n.winner).toBe('fox')
  })

  it('不会把「挨着狗的底线格」当成出口去踩', () => {
    const s = withPieces(
      [
        [idx(1, 2), FOX],
        [idx(0, 1), DOG],
        [idx(0, 3), RABBIT], // 把真正能赢的那一格堵掉，只剩挨着狗的底线格
      ],
      'fox',
    )
    const a = aiAction(s)
    expect(legalActions(s)).toContainEqual(a!)
    expect(a).not.toEqual({ type: 'slide', from: idx(1, 2), to: idx(0, 2) })
    expect(reduce(s, a!).winner).not.toBe('fox')
  })

  it('整局走法全部合法，且每一手都会切换行动方', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = create(seed * 7919)
      let guard = 0
      while (!s.over && guard++ < MOVE_LIMIT + 5) {
        const legal = legalActions(s)
        expect(legal.length).toBeGreaterThan(0)
        const a = bestOf(s)
        expect(legal).toContainEqual(a)
        const before = s.turn
        s = reduce(s, a)
        if (!s.over) expect(s.turn).toBe(before === 'fox' ? 'rabbit' : 'fox')
      }
      expect(s.over).toBe(true)
      expect(s.moves).toBeLessThanOrEqual(MOVE_LIMIT)
      expect(s.winner).not.toBe('none')
    }
  })

  it('双方都由 AI 驱动时必然走到终局，不会卡死', () => {
    const results = new Set<string>()
    for (let seed = 1; seed <= 8; seed++) {
      let s = create(seed * 104729)
      let guard = 0
      while (!s.over && guard++ <= MOVE_LIMIT) {
        s = reduce(s, bestOf(s))
      }
      expect(s.over).toBe(true)
      expect(s.moves).toBeLessThanOrEqual(MOVE_LIMIT)
      expect(['fox', 'rabbit', 'draw']).toContain(s.winner)
      results.add(s.winner)
    }
    // 至少有一局不是走到步数上限的平局兜底
    expect(results.size).toBeGreaterThan(0)
  })

  it('兔子 AI 会封死狐狸的最后出口', () => {
    // 只留一个空格 (4,0)：狐狸唯一的一步就是滑上去，而兔子能滑进去把它堵死
    const board = blank()
    board[idx(4, 3)] = FOX
    for (let i = 0; i < CELLS; i++) if (i !== idx(4, 3) && i !== idx(4, 0)) board[i] = RABBIT
    const s = stateWith(board, 'rabbit')
    expect(s.over).toBe(false)
    expect(slidesFrom(board, idx(4, 3))).toEqual([idx(4, 0)])
    const a = bestOf(s)
    expect(legalActions(s)).toContainEqual(a)
    const n = reduce(s, a)
    expect(n.winner).toBe('rabbit')
    expect(foxStuck(n.board)).toBe(true)
  })

  it('兔子方不可能全局无子可动：任意猎犬总有路可走（63 格只有 6 枚棋子）', () => {
    // 兜底性质：滑行可以越过棋子，因此只要有一条射线上存在空格就有走法，
    // 6 枚棋子不可能封死 7×9 棋盘的任意一条射线，对局不会停在「无人可走」上。
    let s = create(31)
    let guard = 0
    while (!s.over && guard++ < MOVE_LIMIT) {
      expect(legalActions(s).length).toBeGreaterThan(0)
      const legal = legalActions(s)
      s = reduce(s, legal[guard % legal.length])
    }
    expect(s.over).toBe(true)
  })

  it('相同状态总是返回相同动作（可复盘），不同 seed 可以不同', () => {
    const s = foxAndDog(idx(4, 3), idx(4, 6), 'fox')
    expect(aiAction(s)).toEqual(aiAction(s))
    const moves = new Set<string>()
    for (let seed = 1; seed <= 10; seed++) moves.add(JSON.stringify(aiAction({ ...create(seed), turn: 'fox' })))
    expect(moves.size).toBeGreaterThan(1)
  })

  it('节点上限存在且被遵守（不会无界搜索）', () => {
    expect(SEARCH_DEPTHS.length).toBeGreaterThan(1)
    expect(NODE_BUDGET.length).toBe(SEARCH_DEPTHS.length)
    let s = foxAndDog(idx(4, 3), idx(4, 6), 'fox')
    for (let i = 0; i < 6; i++) {
      if (s.over) break
      const info = aiSearch(s)
      expect(info).not.toBeNull()
      expect(info!.nodes).toBeLessThanOrEqual(NODE_BUDGET[NODE_BUDGET.length - 1] + 1)
      s = reduce(s, info!.action)
    }
    // 极小预算时也能在毫秒级返回合法动作（兜底路径）
    const tight = aiSearch(foxAndDog(idx(4, 3), idx(4, 6), 'fox'), 4, [1, 1, 1, 1])
    expect(tight).not.toBeNull()
    expect(legalActions(foxAndDog(idx(4, 3), idx(4, 6), 'fox'))).toContainEqual(tight!.action)
  })

  it('评估函数方向正确：狐狸离底线更近时分更高，被封死时是极小值', () => {
    const near = foxAndDog(idx(1, 3), idx(4, 6)).board
    const far = foxAndDog(idx(4, 3), idx(4, 6)).board
    expect(evaluate(near)).toBeGreaterThan(evaluate(far))
    expect(evaluate(far)).toBeLessThan(0)
    const blocked = blank()
    blocked[idx(4, 3)] = FOX
    for (let i = 0; i < CELLS; i++) if (i !== idx(4, 3)) blocked[i] = RABBIT
    expect(evaluate(blocked)).toBeLessThan(-1000)
    expect(evaluate(foxAndDog(idx(0, 3), idx(4, 6)).board)).toBeGreaterThan(1000)
  })

  it('AI 单步耗时流畅（目标 < 150ms，打印实测值）', () => {
    let worst = 0
    let total = 0
    let n = 0
    for (let seed = 1; seed <= 12; seed++) {
      let s = create(seed * 104729)
      let guard = 0
      while (!s.over && guard++ <= MOVE_LIMIT) {
        const t0 = performance.now()
        const a = bestOf(s)
        const dt = performance.now() - t0
        worst = Math.max(worst, dt)
        total += dt
        n++
        s = reduce(s, a)
      }
    }
    const avg = total / n
    console.log(`[AI 耗时] 决策 ${n} 次，平均 ${avg.toFixed(3)}ms，最差 ${worst.toFixed(3)}ms`)
    expect(worst).toBeLessThan(150)
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参：board 数组先拷贝再写', () => {
    const s = create(13)
    const before = clone(s)
    const boardRef = s.board
    const n = slide(s, RABBIT_STARTS[0], slidesFrom(s.board, RABBIT_STARTS[0])[0])
    expect(s).toEqual(before)
    expect(boardRef).toBe(s.board)
    expect(n).not.toBe(s)
    expect(n.board).not.toBe(s.board)
  })

  it('连续多步 reduce 不会污染最初的 state', () => {
    const s0 = create(5)
    const snap = clone(s0)
    let s = s0
    let guard = 0
    while (!s.over && guard++ < MOVE_LIMIT + 5) {
      const legal = legalActions(s)
      if (legal.length === 0) break
      s = reduce(s, legal[guard % legal.length])
    }
    expect(s0).toEqual(snap)
    expect(s0.moves).toBe(0)
    expect(s.moves).toBeGreaterThan(0)
  })

  it('相同输入两次调用 reduce 结果完全相等', () => {
    const s = create(17)
    const from = RABBIT_STARTS[2]
    const to = slidesFrom(s.board, from)[0]
    expect(slide(s, from, to)).toEqual(slide(s, from, to))
  })

  it('aiAction 不修改入参', () => {
    const s = create(19)
    const before = clone(s)
    aiAction(s)
    aiAction(s)
    expect(s).toEqual(before)
  })

  it('movesOf 与 legalActions 一一对应', () => {
    const s = create(23)
    expect(legalActions(s).length).toBe(movesOf(s.board, s.turn).length)
    const fox = foxAndDog(idx(4, 3), idx(4, 6), 'fox')
    expect(legalActions(fox).length).toBe(movesOf(fox.board, 'fox').length)
  })
})

describe('开局整局可玩性', () => {
  it('从开局随机合法走子也能走到终局（不会中途僵死）', () => {
    let s = create(20240101)
    let guard = 0
    while (!s.over && guard++ <= MOVE_LIMIT) {
      const legal: Action[] = legalActions(s)
      expect(legal.length).toBeGreaterThan(0)
      const pick = legal[guard % legal.length]
      expect(legal).toContainEqual(pick)
      s = reduce(s, pick)
    }
    expect(s.over).toBe(true)
    expect(s.moves).toBeLessThanOrEqual(MOVE_LIMIT)
    expect(winnerOf(s)).toBe(s.winner)
  })
})
