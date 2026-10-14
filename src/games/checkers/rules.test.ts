import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng'
import {
  AI,
  CELL_COUNT,
  NODE_BUDGET,
  PIECES_EACH,
  SEARCH_DEPTHS,
  SIZE,
  aiAction,
  aiSearch,
  applyChain,
  bestMoveFrom,
  colOf,
  create,
  hasLegalMove,
  idx,
  isBackRank,
  isDark,
  isDarkSquare,
  isKing,
  legalActions,
  legalMoves,
  legalMovesFrom,
  moveToAction,
  opponent,
  ownerOf,
  reduce,
  rowOf,
  type Action,
  type Cell,
  type Move,
  type Player,
  type State,
} from './rules'

/**
 * 棋盘用 8 行字符串表示，row 0 在最上面：
 * '.' = 空，'b' = 黑子（玩家），'B' = 黑王，'r' = 红子（电脑），'R' = 红王
 */
const CHAR: Record<string, Cell> = { '.': 0, b: 1, B: 2, r: 3, R: 4 }

function stateOf(rows: string[], turn: Player = 1): State {
  const base = create(1)
  // 从空盘开始摆，避免混入 create() 的标准开局摆位
  const board = new Array<Cell>(CELL_COUNT).fill(0)
  for (let row = 0; row < SIZE; row++) {
    const line = (rows[row] ?? '').padEnd(SIZE, '.')
    for (let col = 0; col < SIZE; col++) board[idx(col, row)] = CHAR[line[col]]
  }
  return { ...base, board, turn }
}

/** 随机对局若干手，用来造真实的残局/中局局面 */
function playout(seed: number, plies: number): State {
  let s = create(seed)
  const r = new Rng((seed ^ 0x9e3779b9) | 0)
  for (let i = 0; i < plies && !s.over; i++) {
    const acts = legalActions(s)
    if (acts.length === 0) break
    s = reduce(s, acts[r.int(acts.length)])
  }
  return s
}

const toPaths = (moves: Move[]): number[][] => moves.map((m) => m.path.map((x) => x))

/** 强制轮到 AI 思考的局面 */
function aiTurn(s: State): State {
  return { ...s, turn: AI }
}

// ---------------- 棋盘与初始摆位 ----------------

describe('棋盘与开局', () => {
  it('8×8 共 64 格，其中 32 个深色格', () => {
    expect(CELL_COUNT).toBe(64)
    let dark = 0
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) if (isDark(col, row)) dark++
    }
    expect(dark).toBe(32)
  })

  it('开局双方各 12 枚，标准摆法是前后各 3 排', () => {
    const s = create(1)
    let black = 0
    let red = 0
    for (let i = 0; i < CELL_COUNT; i++) {
      if (s.board[i] === 1) black++
      if (s.board[i] === 3) red++
    }
    expect(black).toBe(PIECES_EACH)
    expect(red).toBe(PIECES_EACH)
    // 黑在 row 5~7，红在 row 0~2，中间两排空
    for (let row = 3; row <= 4; row++) {
      for (let col = 0; col < SIZE; col++) expect(s.board[idx(col, row)]).toBe(0)
    }
  })

  it('只有深色格上有子', () => {
    const s = create(9)
    for (let i = 0; i < CELL_COUNT; i++) {
      if (s.board[i] === 0) continue
      expect(isDarkSquare(i)).toBe(true)
      expect(isDark(colOf(i), rowOf(i))).toBe(true)
    }
  })

  it('开局玩家执黑先行、未结束', () => {
    const s = create(3)
    expect(s.turn).toBe(1)
    expect(s.over).toBe(false)
    expect(s.winner).toBe(0)
    expect(s.selected).toBe(-1)
    expect(s.moves).toBe(0)
    expect(legalActions(s).length).toBeGreaterThan(0)
  })

  it('create 对同一 seed 完全一致', () => {
    expect(create(123)).toEqual(create(123))
  })

  it('开局摆位与 seed 无关（棋盘上没有随机性）', () => {
    expect(create(1).board).toEqual(create(987654).board)
  })
})

// ---------------- 普通子走法 ----------------

describe('普通子移动', () => {
  // 黑子 (3,4) 只能向上（行号减小）走
  const OPEN: State = stateOf([
    '........',
    '........',
    '........',
    '........',
    '...b....',
    '........',
    '........',
    '........',
  ])
  const FROM = idx(3, 4)

  it('普通子向前斜走一格', () => {
    const moves = legalMovesFrom(OPEN.board, FROM, 1)
    expect(toPaths(moves)).toEqual([[FROM, idx(2, 3)], [FROM, idx(4, 3)]])
    expect(moves.every((m) => m.captures.length === 0)).toBe(true)
  })

  it('普通子不能后退', () => {
    const lands = toPaths(legalMovesFrom(OPEN.board, FROM, 1)).map((p) => p[p.length - 1])
    expect(lands).not.toContain(idx(2, 5))
    expect(lands).not.toContain(idx(4, 5))
    for (const land of lands) expect(rowOf(land)).toBeLessThan(rowOf(FROM))
  })

  it('红子同样只能向下走', () => {
    const s = stateOf([
      '........',
      '........',
      '...r....',
      '........',
      '........',
      '........',
      '........',
      '........',
    ])
    const from = idx(3, 2)
    const lands = toPaths(legalMovesFrom(s.board, from, 2)).map((p) => p[p.length - 1])
    expect(lands).toEqual([idx(2, 3), idx(4, 3)])
  })

  it('落点必须为空，不能走到有子的格子', () => {
    const s = stateOf([
      '........',
      '........',
      '........',
      '..b.....',
      '...b....',
      '........',
      '........',
      '........',
    ])
    // (2,3) 是自己的子：既不能走进去，也不能跳过它吃子，只能走 (4,3)
    const lands = toPaths(legalMovesFrom(s.board, idx(3, 4), 1)).map((p) => p[p.length - 1])
    expect(lands).toEqual([idx(4, 3)])
  })

  it('不是自己的棋子没有走法', () => {
    expect(legalMovesFrom(OPEN.board, FROM, 2)).toEqual([])
  })

  it('轮到对方时只能生成对方的走法', () => {
    const s = stateOf([
      '........',
      '........',
      '........',
      '........',
      '...b....',
      '........',
      '........',
      '...r....',
    ])
    expect(legalActions(s).every((a) => a.type === 'move' && ownerOf(s.board[(a as { from: number }).from]) === 1)).toBe(true)
  })
})

// ---------------- 吃子与连吃 ----------------

describe('吃子与必须连吃', () => {
  // 黑子 (3,4) 跳过红子 (2,3) 落到 (1,2)
  const CAPTURE_BOARD: State = stateOf([
    '........',
    '........',
    '........',
    '..r.....',
    '...b...b',
    '........',
    '........',
    '........',
  ])
  const FROM = idx(3, 4)
  const MID = idx(2, 3)
  const TO = idx(1, 2)

  it('吃子必须跳过一格，中间的敌子被移除', () => {
    const moves = legalMovesFrom(CAPTURE_BOARD.board, FROM, 1)
    expect(moves.length).toBe(1)
    expect(moves[0].path).toEqual([FROM, TO])
    expect(moves[0].captures).toEqual([MID])
    const next = reduce(stateOf([
      '........',
      '........',
      '........',
      '..r.....',
      '...b....',
      '........',
      '........',
      '........',
    ], 1), moveToAction(moves[0]))
    expect(next.board[MID]).toBe(0)
    expect(next.board[TO]).toBe(1)
    expect(next.board[FROM]).toBe(0)
    expect(next.takenBy1).toBe(1)
  })

  it('有子可吃时不能只走不吃', () => {
    // (7,4) 那颗黑子本来可以走 (6,3)，但因为全局有吃子，必须被排除
    const idle = idx(7, 4)
    const idleMoves = legalMovesFrom(CAPTURE_BOARD.board, idle, 1)
    expect(toPaths(idleMoves)).toEqual([[idle, idx(6, 3)]])
    const all = legalActions(stateOf([
      '........',
      '........',
      '........',
      '..r.....',
      '...b...b',
      '........',
      '........',
      '........',
    ], 1))
    expect(all.length).toBe(1)
    expect((all[0] as { from: number }).from).toBe(FROM)
  })

  it('连吃 2 子：一次 action 走完整条链', () => {
    const s = stateOf([
      '........',
      '........',
      '........',
      '..r.....',
      '........',
      '..r.....',
      '...b....',
      '........',
    ])
    const from = idx(3, 6)
    const moves = legalMovesFrom(s.board, from, 1)
    expect(moves.length).toBe(1)
    expect(moves[0].path).toEqual([from, idx(1, 4), idx(3, 2)])
    expect(moves[0].captures).toEqual([idx(2, 5), idx(2, 3)])
    const next = reduce(s, moveToAction(moves[0]))
    // 两颗红子一次结算
    expect(next.board[idx(2, 5)]).toBe(0)
    expect(next.board[idx(2, 3)]).toBe(0)
    expect(next.board[idx(3, 2)]).toBe(1)
    expect(next.takenBy1).toBe(2)
    expect(next.moves).toBe(1)
    expect(next.last?.captures.length).toBe(2)
    // 连吃途中经过的落点必须腾空：整条链只留下一颗子（棋子总数守恒）
    expect(next.board[idx(1, 4)]).toBe(0)
    expect(next.board[idx(3, 6)]).toBe(0)
    expect(next.board.filter((c) => ownerOf(c) !== 0).length).toBe(1)
  })

  it('连吃链的每一段都是恰好一跳（中间格就是被吃的子）', () => {
    const s = stateOf([
      '........',
      '........',
      '........',
      '..r.....',
      '........',
      '..r.....',
      '...b....',
      '........',
    ])
    expect(legalMovesFrom(s.board, idx(3, 6), 1).length).toBe(1)
    for (const mv of legalMovesFrom(s.board, idx(3, 6), 1)) {
      for (let k = 1; k < mv.path.length; k++) {
        const a = mv.path[k - 1]
        const b = mv.path[k]
        expect(Math.abs(rowOf(b) - rowOf(a))).toBe(2)
        expect(Math.abs(colOf(b) - colOf(a))).toBe(2)
        const mid = idx((colOf(a) + colOf(b)) >> 1, (rowOf(a) + rowOf(b)) >> 1)
        expect(mv.captures[k - 1]).toBe(mid)
        expect(ownerOf(s.board[mid])).toBe(2)
      }
    }
  })

  it('同一颗子不能被吃两次：path 不重复、captures 不重复', () => {
    const positions: State[] = [
      stateOf([
        '........',
        '........',
        '........',
        '..r.....',
        '........',
        '..r.....',
        '...b....',
        '........',
      ]),
      playout(5, 30),
      playout(11, 45),
    ]
    for (const s of positions) {
      for (const mv of legalMoves(s)) {
        expect(new Set(mv.captures).size).toBe(mv.captures.length)
        expect(new Set(mv.path).size).toBe(mv.path.length)
        expect(mv.path[0]).toBe(mv.from)
        // 走法要么是 2 格平移（不吃子），要么每一跳都对应一颗被吃的子
        expect(mv.captures.length === 0 ? mv.path.length === 2 : mv.path.length === mv.captures.length + 1).toBe(true)
      }
    }
  })

  it('不能落回本步的起点格（王绕圈吃回来被禁止）', () => {
    // 黑王 (2,1)：跳过 (3,2) 的红子落到 (4,3)；若允许落回起点，就能再绕一圈
    const s = stateOf([
      '........',
      '..B.....',
      '...r....',
      '..r.....',
      '........',
      '........',
      '........',
      '........',
    ])
    const moves = legalMovesFrom(s.board, idx(2, 1), 1)
    expect(moves.length).toBe(1)
    expect(moves[0].path).toEqual([idx(2, 1), idx(4, 3)])
    expect(moves[0].captures).toEqual([idx(3, 2)])
    // 起点只出现在 path[0]：不允许绕回来再吃一次同一颗子
    expect(moves[0].path.filter((x) => x === idx(2, 1)).length).toBe(1)
  })

  it('连吃途中可以分叉，生成的多条链都各自合法', () => {
    // 黑王 (0,1) 先跳 (1,2) 到 (2,3)，再分别跳 (1,4) 与 (3,4)
    const s = stateOf([
      '........',
      'B.......',
      '.r......',
      '........',
      '.r.r....',
      '........',
      '........',
      '........',
    ])
    const moves = legalMovesFrom(s.board, idx(0, 1), 1)
    expect(moves.length).toBe(2)
    for (const mv of moves) {
      expect(mv.path[0]).toBe(idx(0, 1))
      expect(mv.path[1]).toBe(idx(2, 3))
      expect(mv.captures.length).toBe(2)
    }
    expect(toPaths(moves)).toEqual([
      [idx(0, 1), idx(2, 3), idx(0, 5)],
      [idx(0, 1), idx(2, 3), idx(4, 5)],
    ])
  })
})

// ---------------- 王 ----------------

describe('王（king）', () => {
  it('王可以后退，四个方向都能走一格', () => {
    const s = stateOf([
      '........',
      '........',
      '........',
      '........',
      '...B....',
      '........',
      '........',
      '........',
    ])
    const lands = toPaths(legalMovesFrom(s.board, idx(3, 4), 1)).map((p) => p[p.length - 1]).sort((a, b) => a - b)
    expect(lands).toEqual([idx(2, 3), idx(2, 5), idx(4, 3), idx(4, 5)].sort((a, b) => a - b))
  })

  it('王可以一次飞吃多子（连吃 2 颗）', () => {
    const s = stateOf([
      '........',
      'B.......',
      '.r......',
      '........',
      '.r......',
      '........',
      '........',
      '........',
    ])
    const moves = legalMovesFrom(s.board, idx(0, 1), 1)
    expect(moves.length).toBe(1)
    expect(moves[0].path).toEqual([idx(0, 1), idx(2, 3), idx(0, 5)])
    expect(moves[0].captures).toEqual([idx(1, 2), idx(1, 4)])
    const next = reduce(s, moveToAction(moves[0]))
    expect(next.board[idx(0, 5)]).toBe(2)
    expect(next.takenBy1).toBe(2)
  })

  it('王也能吃子时，同样必须吃而不只是走', () => {
    // 王 (0,1) 有平走机会，但旁边有可吃的子，所以只给连吃
    const s = stateOf([
      '........',
      'B.......',
      '.r......',
      '........',
      '........',
      '..r.....',
      '........',
      '........',
    ])
    const moves = legalMovesFrom(s.board, idx(0, 1), 1)
    expect(moves.every((m) => m.captures.length > 0)).toBe(true)
  })
})

// ---------------- 升变 ----------------

describe('升变', () => {
  it('普通子抵达对方底线升变为王', () => {
    const s = stateOf([
      '........',
      '..b.....',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ])
    const next = reduce(s, { type: 'move', from: idx(2, 1), path: [idx(2, 1), idx(1, 0)] })
    expect(next.board[idx(1, 0)]).toBe(2)
    expect(next.last?.promoted).toBe(true)
  })

  it('红子抵达 row 7 升变为红王', () => {
    const s = stateOf(
      [
        '........',
        '........',
        '........',
        '........',
        '........',
        '........',
        '.r......',
        '........',
      ],
      2,
    )
    const next = reduce(s, { type: 'move', from: idx(1, 6), path: [idx(1, 6), idx(2, 7)] })
    expect(next.board[idx(2, 7)]).toBe(4)
    expect(next.last?.promoted).toBe(true)
    expect(isKing(next.board[idx(2, 7)])).toBe(true)
  })

  it('连吃两跳后停在对方底线才升变', () => {
    const s = stateOf([
      '........',
      '..r.....',
      '........',
      '....r...',
      '.....b..',
      '........',
      '........',
      '........',
    ])
    const moves = legalMovesFrom(s.board, idx(5, 4), 1)
    expect(moves.length).toBe(1)
    expect(moves[0].path).toEqual([idx(5, 4), idx(3, 2), idx(1, 0)])
    expect(moves[0].promoted).toBe(true)
    const next = reduce(s, moveToAction(moves[0]))
    // 路径中途（row 2 / row 1）没有留子、也没有升变，只有最终落点 row 0 升变
    expect(next.board[idx(3, 2)]).toBe(0)
    expect(next.board[idx(5, 4)]).toBe(0)
    expect(next.board[idx(1, 0)]).toBe(2)
    expect(next.board.filter((c) => ownerOf(c) === 0).length).toBe(CELL_COUNT - 1)
  })

  it('没有停在底线就不升变（升变只看最终落点）', () => {
    const s = stateOf([
      '........',
      '........',
      '........',
      '........',
      '...b....',
      '........',
      '........',
      '........',
    ])
    const next = reduce(s, { type: 'move', from: idx(3, 4), path: [idx(3, 4), idx(2, 3)] })
    expect(next.board[idx(2, 3)]).toBe(1)
    expect(next.last?.promoted).toBe(false)
    expect(isBackRank(1, idx(2, 3))).toBe(false)
    expect(isBackRank(1, idx(1, 0))).toBe(true)
  })

  it('promoted 恒等于「普通子且停在对方底线」，与路径长度无关', () => {
    for (const s of [create(1), playout(3, 24), playout(21, 40)]) {
      for (const mv of legalMoves(s)) {
        const land = mv.path[mv.path.length - 1]
        expect(mv.promoted).toBe(!isKing(s.board[mv.from]) && isBackRank(s.turn, land))
      }
    }
  })

  it('已经是王的子再抵达底线仍然是王（不会重复升变）', () => {
    const s = stateOf([
      '........',
      '..B.....',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ])
    const next = reduce(s, { type: 'move', from: idx(2, 1), path: [idx(2, 1), idx(1, 0)] })
    expect(next.board[idx(1, 0)]).toBe(2)
    expect(next.last?.promoted).toBe(false)
  })
})

// ---------------- 胜负 ----------------

describe('胜负判定', () => {
  it('无子可走判负：对方走完一手后本方无路可走', () => {
    // 黑子 (1,0) 已到顶，既不能走也不能吃；红子 (0,1) 走完即判黑负
    const s = stateOf(['.b......', 'r.......', '........', '........', '........', '........', '........', '........'], 2)
    expect(hasLegalMove(s.board, 1)).toBe(false)
    const next = reduce(s, { type: 'move', from: idx(0, 1), path: [idx(0, 1), idx(1, 2)] })
    expect(next.over).toBe(true)
    expect(next.winner).toBe(2)
    expect(legalActions(next)).toEqual([])
  })

  it('子被吃光同样判负', () => {
    // 红子 (2,3) 跳过黑子 (3,4) 吃掉最后一颗黑子
    const s = stateOf([
      '........',
      '........',
      '........',
      '..r.....',
      '...b....',
      '........',
      '........',
      '........',
    ], 2)
    const next = reduce(s, { type: 'move', from: idx(2, 3), path: [idx(2, 3), idx(4, 5)] })
    expect(next.board.filter((c) => ownerOf(c) === 1).length).toBe(0)
    expect(next.over).toBe(true)
    expect(next.winner).toBe(2)
  })

  it('结束后的状态拒绝任何走子', () => {
    const s = stateOf(['.b......', 'r.......', '........', '........', '........', '........', '........', '........'], 2)
    const over = reduce(s, { type: 'move', from: idx(0, 1), path: [idx(0, 1), idx(1, 2)] })
    expect(reduce(over, { type: 'move', from: idx(1, 2), path: [idx(1, 2), idx(2, 3)] })).toBe(over)
    expect(legalActions(over)).toEqual([])
    expect(aiAction(over)).toBeNull()
  })

  it('随机对局 200 手内状态始终自洽（模糊测试）', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = playout(seed * 31, 200)
      expect(s.moves).toBeGreaterThan(0)
      // 子只会站在深色格上
      for (let i = 0; i < CELL_COUNT; i++) if (s.board[i] !== 0) expect(isDarkSquare(i)).toBe(true)
      // 已走完的对局一定有胜者；未走完则当前方还有路可走
      if (s.over) expect([1, 2]).toContain(s.winner)
      else expect(legalActions(s).length).toBeGreaterThan(0)
      // 吃子总数不超过对方初始 12 枚
      expect(s.takenBy1).toBeLessThanOrEqual(PIECES_EACH)
      expect(s.takenBy2).toBeLessThanOrEqual(PIECES_EACH)
      expect(s.takenBy1 + s.takenBy2 + s.board.filter((c) => ownerOf(c) !== 0).length).toBe(PIECES_EACH * 2)
    }
  })

  it('一整局对局会走到终局（无子可走判负）', () => {
    for (const seed of [31, 62, 93, 124]) {
      const s = playout(seed, 600)
      expect(s.over).toBe(true)
      expect([1, 2]).toContain(s.winner)
      expect(s.moves).toBeLessThan(600)
    }
  })
})

// ---------------- 输入相关的 action ----------------

describe('选中与提示', () => {
  it('select 只接受自己可动的子', () => {
    const s = stateOf([
      '........',
      '........',
      '........',
      '........',
      '...b....',
      '...r....',
      '........',
      '........',
    ])
    expect(reduce(s, { type: 'select', square: idx(3, 4) }).selected).toBe(idx(3, 4))
    // 红子选不了
    expect(reduce(s, { type: 'select', square: idx(3, 5) })).toBe(s)
    // 空格选不了
    expect(reduce(s, { type: 'select', square: idx(0, 0) })).toBe(s)
  })

  it('再点同一颗子取消选中，clear 也能取消', () => {
    const s = stateOf([
      '........',
      '........',
      '........',
      '........',
      '...b....',
      '........',
      '........',
      '........',
    ])
    const sel = reduce(s, { type: 'select', square: idx(3, 4) })
    expect(reduce(sel, { type: 'select', square: idx(3, 4) }).selected).toBe(-1)
    expect(reduce(sel, { type: 'clear' }).selected).toBe(-1)
  })

  it('bestMoveFrom 能把落点解析成一条具体走法', () => {
    const s = stateOf([
      '........',
      'B.......',
      '.r......',
      '........',
      '.r.r....',
      '........',
      '........',
      '........',
    ])
    const mv = bestMoveFrom(s, idx(0, 1), idx(0, 5))
    expect(mv).not.toBeNull()
    expect(mv?.path).toEqual([idx(0, 1), idx(2, 3), idx(0, 5)])
    expect(mv?.captures.length).toBe(2)
    // 落回起点不是合法落点
    expect(bestMoveFrom(s, idx(0, 1), idx(0, 1))).toBeNull()
    // 没有连到该落点的走法
    expect(bestMoveFrom(s, idx(0, 1), idx(7, 7))).toBeNull()
  })

  it('hint 走可播种随机：同 seed 同结果，且选中的一定是可动的子', () => {
    const s = { ...create(7), turn: 1 as Player }
    const a = reduce(s, { type: 'hint' })
    const b = reduce(s, { type: 'hint' })
    expect(a.selected).toBe(b.selected)
    expect(a.selected).toBeGreaterThanOrEqual(0)
    expect(legalMoves(a).some((m) => m.from === a.selected)).toBe(true)
    expect(a.rng).not.toBe(s.rng)
  })

  it('非玩家回合的 hint 不改变状态', () => {
    const s = { ...create(7), turn: 2 as Player }
    expect(reduce(s, { type: 'hint' })).toBe(s)
  })
})

// ---------------- 纯函数约束 ----------------

describe('纯函数约束', () => {
  const SAMPLE = stateOf([
    '........',
    '........',
    '........',
    '..r.....',
    '...b....',
    '........',
    '........',
    '...r....',
  ])

  it('reduce 不修改入参（棋盘与计数都不动）', () => {
    const s = stateOf([
      '........',
      '........',
      '........',
      '..r.....',
      '...b....',
      '........',
      '........',
      '........',
    ], 2)
    const before = JSON.stringify(s)
    reduce(s, { type: 'move', from: idx(2, 3), path: [idx(2, 3), idx(4, 5)] })
    reduce(s, { type: 'select', square: idx(2, 3) })
    expect(JSON.stringify(s)).toBe(before)
  })

  it('相同输入两次调用结果完全相等（连吃链也一致）', () => {
    const a = reduce(SAMPLE, { type: 'move', from: idx(3, 4), path: [idx(3, 4), idx(2, 3)] })
    const b = reduce(SAMPLE, { type: 'move', from: idx(3, 4), path: [idx(3, 4), idx(2, 3)] })
    expect(a).toEqual(b)
    expect(a.board).toEqual(b.board)
  })

  it('applyChain 不修改入参棋盘', () => {
    const before = SAMPLE.board.slice()
    const mv = legalMoves(SAMPLE)[0]
    applyChain(SAMPLE.board, mv, 1)
    expect(SAMPLE.board).toEqual(before)
  })

  it('legalMoves / legalActions 不修改入参棋盘', () => {
    const before = SAMPLE.board.slice()
    legalMoves(SAMPLE)
    legalActions(SAMPLE)
    expect(SAMPLE.board).toEqual(before)
  })

  it('非法走法不改变状态', () => {
    // 横着走 2 格不是合法走法（只能斜走 1 格或斜跳 2 格）
    expect(reduce(SAMPLE, { type: 'move', from: idx(3, 4), path: [idx(3, 4), idx(5, 4)] })).toBe(SAMPLE)
    // 在合法连吃链后面多挂一段平移，整条走法作废
    expect(reduce(SAMPLE, { type: 'move', from: idx(3, 4), path: [idx(3, 4), idx(1, 2), idx(2, 1)] })).toBe(SAMPLE)
    expect(reduce(SAMPLE, { type: 'move', from: idx(0, 0), path: [idx(0, 0), idx(1, 1)] })).toBe(SAMPLE)
    expect(reduce(SAMPLE, { type: 'move', from: idx(3, 4), path: [idx(3, 4)] })).toBe(SAMPLE)
    expect(reduce(SAMPLE, { type: 'move', from: -1, path: [-1, 5] })).toBe(SAMPLE)
    // 不能落到有子的格子：红子必须留在原地
    expect(reduce(SAMPLE, { type: 'move', from: idx(3, 4), path: [idx(3, 4), idx(2, 3)] }).board[idx(2, 3)]).toBe(3)
  })

  it('轮到红方时黑子的走法无效', () => {
    const s = { ...SAMPLE, turn: 2 as Player }
    expect(reduce(s, { type: 'move', from: idx(3, 4), path: [idx(3, 4), idx(2, 3)] })).toBe(s)
  })

  it('opponent 互为对方', () => {
    expect(opponent(1)).toBe(2)
    expect(opponent(2)).toBe(1)
  })
})

// ---------------- AI ----------------

describe('AI', () => {
  it('玩家回合返回 null', () => {
    expect(aiAction(create(1))).toBeNull()
    expect(aiSearch(create(1))).toBeNull()
  })

  it('AI 的每个 action 都来自 legalActions', () => {
    const spots: State[] = [aiTurn(create(1)), aiTurn(playout(3, 26)), aiTurn(playout(17, 42)), aiTurn(playout(29, 60))]
    for (const s of spots) {
      if (s.over || legalActions(s).length === 0) continue
      const a = aiAction(s)
      expect(a).not.toBeNull()
      const act = a as { type: string; from: number; path: number[] }
      const legal = legalActions(s) as Array<{ from: number; path: number[] }>
      expect(
        legal.some((m) => m.from === act.from && m.path.length === act.path.length && m.path.every((v, i) => v === act.path[i])),
      ).toBe(true)
    }
  })

  it('相同状态总是返回相同动作（可复盘）', () => {
    const s = aiTurn(playout(13, 32))
    expect(aiAction(s)).toEqual(aiAction(s))
  })

  it('自对弈必然终局，且每一步都合法', () => {
    // 电脑方走 aiSearch，玩家方随便挑一条合法走法（模拟真人对局）
    const r = new Rng(0xc0ffee)
    for (let seed = 1; seed <= 3; seed++) {
      let s = create(seed)
      let guard = 0
      while (!s.over && guard++ < 300) {
        let action: Action | null
        if (s.turn === AI) {
          const info = aiSearch(s, 2)
          expect(info).not.toBeNull()
          if (info === null) break
          action = info.action
          expect(legalActions(s)).toContainEqual(action)
        } else {
          const legal = legalActions(s)
          expect(legal.length).toBeGreaterThan(0)
          if (legal.length === 0) break
          action = legal[r.int(legal.length)]
        }
        s = reduce(s, action)
      }
      expect(s.over).toBe(true)
      expect([1, 2]).toContain(s.winner)
    }
  })

  it('深度落在设定范围内，且节点数受上限约束', () => {
    const s = aiTurn(create(1))
    const info = aiSearch(s)
    expect(info).not.toBeNull()
    expect(SEARCH_DEPTHS).toContain(info?.depth)
    expect(info?.nodes).toBeLessThanOrEqual(NODE_BUDGET[SEARCH_DEPTHS.length - 1])
    expect(info?.nodes).toBeGreaterThan(0)
  })

  it('maxDepth=2 只搜 2 层', () => {
    const info = aiSearch(aiTurn(create(1)), 2)
    expect(info?.depth).toBe(2)
    expect(info?.nodes).toBeLessThanOrEqual(NODE_BUDGET[0])
  })

  it('节点上限兜底：极端局面也会按时返回并给出合法走法', () => {
    // 满盘王，连吃分支极多
    const rows: string[] = []
    for (let row = 0; row < SIZE; row++) {
      let line = ''
      for (let col = 0; col < SIZE; col++) {
        const dark = isDark(col, row)
        if (!dark) {
          line += '.'
          continue
        }
        if ((row + col) % 3 === 0) line += 'b'
        else if ((row + col) % 3 === 1) line += 'r'
        else line += '.'
      }
      rows.push(line)
    }
    const s = aiTurn(stateOf(rows))
    const t0 = Date.now()
    const info = aiSearch(s)
    const cost = Date.now() - t0
    expect(info).not.toBeNull()
    expect(legalActions(s)).toContainEqual(info?.action)
    expect(cost).toBeLessThan(1000)
    console.log(`[checkers] 极端满盘局面：depth=${info?.depth} nodes=${info?.nodes} aborted=${info?.aborted} 耗时 ${cost}ms`)
  })

  it('节点上限兜底：预算耗尽时退回上一层的最佳着法且仍然合法', () => {
    const s = aiTurn(create(1))
    // 深度 2 给足预算，深度 3/4 各只给 3 个节点 —— 必然被截断
    const info = aiSearch(s, 4, [10_000, 3, 3])
    expect(info).not.toBeNull()
    expect(info?.depth).toBe(2)
    expect(info?.aborted).toBe(true)
    expect(legalActions(s)).toContainEqual(info?.action)
    // 连根节点都超限时，至少还能给出排序第一的合法走法
    const tiny = aiSearch(s, 4, [1, 1, 1])
    expect(tiny?.action).toEqual(legalActions(s)[0])
    expect(tiny?.depth).toBe(0)
  })

  it('单步决策耗时实测（目标 < 200ms）', () => {
    // 开阔王局面：8 颗王各走各的，没有任何强制吃子，分支因子最大
    const OPEN_KINGS = stateOf([
      '........',
      'B...B...',
      '........',
      '..R...R.',
      '........',
      'B...B...',
      '..R...R.',
      '........',
    ])
    const cases: Array<[string, State]> = [
      ['开局', aiTurn(create(1))],
      ['中局(24 手)', aiTurn(playout(3, 24))],
      ['中局(40 手)', aiTurn(playout(17, 40))],
      ['残局(90 手)', aiTurn(playout(41, 90))],
      ['开阔王(8 子)', aiTurn(OPEN_KINGS)],
    ]
    let worst = 0
    let worstBranch = 0
    for (const [name, s] of cases) {
      if (s.over || legalActions(s).length === 0) continue
      const branch = legalActions(s).length
      const t0 = Date.now()
      const info = aiSearch(s)
      const cost = Date.now() - t0
      worst = Math.max(worst, cost)
      worstBranch = Math.max(worstBranch, branch)
      console.log(
        `[checkers] AI ${name}：depth=${info?.depth} nodes=${info?.nodes} aborted=${info?.aborted} 耗时 ${cost}ms 分支=${branch}`,
      )
      expect(info).not.toBeNull()
      expect(legalActions(s)).toContainEqual(info?.action)
    }
    console.log(`[checkers] AI 单步最差耗时 ${worst}ms（最大分支 ${worstBranch}）`)
    expect(worst).toBeLessThan(200)
  })

  it('AI 优先吃子（走法排序 + 评估生效）', () => {
    // 红方：(2,1) 可跳 (3,2) 的黑子；(6,1) 只能平走 —— 必须选吃子那条
    const s = aiTurn(
      stateOf([
        '........',
        '..r...r.',
        '...b.....',
        '........',
        '........',
        '........',
        '........',
        '........',
      ]),
    )
    const legal = legalMoves(s)
    // 全盘强制吃子：(6,1) 虽然还能平走，但只要有子能吃就一律不许走
    expect(legal.length).toBe(1)
    expect(legal[0].captures.length).toBe(1)
    const a = aiAction(s) as { from: number; path: number[] }
    expect(a.from).toBe(idx(2, 1))
    const mv = legal.find((m) => m.from === a.from && m.path.length === a.path.length && m.path.every((v, i) => v === a.path[i]))
    expect(mv?.captures.length).toBe(1)
  })
})

// ---------------- 对局记录 ----------------

describe('状态字段', () => {
  it('last 记录完整连吃链，供渲染层逐格播放', () => {
    const s = stateOf([
      '........',
      '........',
      '........',
      '..r.....',
      '........',
      '..r.....',
      '...b....',
      '........',
    ])
    const next = reduce(s, { type: 'move', from: idx(3, 6), path: [idx(3, 6), idx(1, 4), idx(3, 2)] })
    expect(next.last).toEqual({
      player: 1,
      from: idx(3, 6),
      path: [idx(3, 6), idx(1, 4), idx(3, 2)],
      captures: [idx(2, 5), idx(2, 3)],
      victims: [3, 3],
      promoted: false,
    })
  })

  it('每走一手 moves 加一、换边、清空选中', () => {
    const s = stateOf([
      '........',
      '........',
      '........',
      '........',
      '...b....',
      '........',
      '........',
      '........',
    ])
    const sel = reduce(s, { type: 'select', square: idx(3, 4) })
    const next = reduce(sel, { type: 'move', from: idx(3, 4), path: [idx(3, 4), idx(2, 3)] })
    expect(next.moves).toBe(1)
    expect(next.turn).toBe(2)
    expect(next.selected).toBe(-1)
  })

  it('未知 action 不改变状态', () => {
    const s = create(1)
    expect(reduce(s, { type: 'nope' } as unknown as Action)).toBe(s)
  })
})
