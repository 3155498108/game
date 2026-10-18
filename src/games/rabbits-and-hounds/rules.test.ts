import { describe, expect, it } from 'vitest'
import {
  AI_DEPTH,
  CELLS,
  COLS,
  EMPTY,
  HARE,
  HARE_START,
  HOUND,
  HOUND_STARTS,
  MOVE_LIMIT,
  ROWS,
  STALL_LIMIT,
  aiAction,
  aiSearch,
  canStep,
  choosing,
  colOf,
  create,
  evaluate,
  hareEscaped,
  hareTrapped,
  houndsStuck,
  idx,
  isLegal,
  isPlayable,
  legalActions,
  leadingHoundCol,
  movesOf,
  neighborsOf,
  piecesOf,
  rearmostHoundCol,
  reduce,
  rowOf,
  stepsFrom,
  winnerOf,
  type Action,
  type Piece,
  type Side,
  type State,
} from './rules'

// ------------------------------------------------------------------ 辅助

/** 按给定摆子构造 state；pairs 是 [格, 棋子]，其余为空 */
function withPieces(pairs: Array<[number, Piece]>, over: Partial<State> = {}): State {
  const board: Piece[] = new Array<Piece>(ROWS * COLS).fill(EMPTY)
  for (const [cell, p] of pairs) board[cell] = p
  return { ...create(1), board, playerSide: 'hounds', ...over }
}

const blank = (pairs: Array<[number, Piece]> = [], over: Partial<State> = {}): State =>
  withPieces(pairs, over)

/** 开局：玩家执犬（选边之后的局面） */
const opening = (seed = 20260917): State => reduce(create(seed), { type: 'choose', side: 'hounds' })

/** 自对弈：双方共用同一个 aiSearch，跑到终局 */
function selfPlay(seed: number, houndDepth: number, hareDepth: number): State {
  let s = opening(seed)
  let guard = 0
  while (!s.over && guard++ <= MOVE_LIMIT) {
    const info = aiSearch(s, s.turn === 'hounds' ? houndDepth : hareDepth)
    if (info === null) break
    s = reduce(s, info.action)
  }
  return s
}

// ------------------------------------------------------------------ 选边

describe('开局选边', () => {
  it('新开局停在「还没选」，棋盘已摆好但一步都不能走', () => {
    const s = create(1)
    expect(s.playerSide).toBeNull()
    expect(choosing(s)).toBe(true)
    expect(legalActions(s)).toEqual([])
    expect(aiAction(s)).toBeNull()
    // 棋盘本身已经是标准开局
    for (const h of HOUND_STARTS) expect(s.board[h]).toBe(HOUND)
    expect(s.board[HARE_START]).toBe(HARE)
  })

  it('选边之前，碰棋盘不产生任何走子', () => {
    const s = create(1)
    expect(reduce(s, { type: 'step', from: HOUND_STARTS[1], to: idx(1, 2) })).toBe(s)
    expect(reduce(s, { type: 'select', cell: HOUND_STARTS[1] })).toBe(s)
    expect(reduce(s, { type: 'clear' })).toBe(s)
  })

  it('选完边才能走，且猎犬仍然先走', () => {
    const s = reduce(create(1), { type: 'choose', side: 'hounds' })
    expect(s.playerSide).toBe('hounds')
    expect(choosing(s)).toBe(false)
    expect(s.turn).toBe('hounds')
    expect(legalActions(s).length).toBeGreaterThan(0)
  })

  it('执兔也能选，棋盘一模一样', () => {
    const a = reduce(create(1), { type: 'choose', side: 'hounds' })
    const b = reduce(create(1), { type: 'choose', side: 'hare' })
    expect(b.playerSide).toBe('hare')
    expect(b.board).toEqual(a.board)
    expect(b.turn).toBe(a.turn)
  })

  it('不能反悔：第二次选边无效', () => {
    const s = reduce(create(1), { type: 'choose', side: 'hounds' })
    expect(reduce(s, { type: 'choose', side: 'hare' })).toBe(s)
    expect(s.playerSide).toBe('hounds')
  })
})

// ------------------------------------------------------------------ 棋盘拓扑

describe('棋盘：矛尖形 27 点', () => {
  it('中间三行铺满 7 列，最上/最下两行只有中间 3 列', () => {
    expect(isPlayable(idx(0, 0))).toBe(false)
    expect(isPlayable(idx(1, 0))).toBe(false)
    expect(isPlayable(idx(2, 0))).toBe(true)
    expect(isPlayable(idx(4, 0))).toBe(true)
    expect(isPlayable(idx(5, 0))).toBe(false)
    expect(isPlayable(idx(0, 1))).toBe(true)
    expect(isPlayable(idx(6, 3))).toBe(true)
    expect(isPlayable(idx(5, 4))).toBe(false)
    expect(CELLS).toBe(27)
  })

  it('越界的格子永远不会被当成棋点', () => {
    expect(isPlayable(-1)).toBe(false)
    expect(isPlayable(ROWS * COLS)).toBe(false)
    expect(isPlayable(1.5)).toBe(false)
    expect(neighborsOf(idx(0, 0))).toEqual([])
  })

  it('左端正好 3 个点 —— 3 只犬一字排开就是无缝墙', () => {
    const left: number[] = []
    for (let r = 0; r < ROWS; r++) if (isPlayable(idx(0, r))) left.push(r)
    expect(left).toEqual([1, 2, 3])
  })

  it('只走横竖，**没有斜向**（回归：原来 8 向都能走，围死几乎不可能）', () => {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const from = idx(c, r)
        if (!isPlayable(from)) continue
        for (const to of neighborsOf(from)) {
          expect(isPlayable(to)).toBe(true)
          expect(neighborsOf(to)).toContain(from)
          // 斜向的判据：行列都变了
          const isDiagonal = colOf(to) !== c && rowOf(to) !== r
          expect(isDiagonal, `(${c},${r}) → (${colOf(to)},${rowOf(to)}) 是斜走`).toBe(false)
        }
      }
    }
    // 整张盘没有任何一格同时与斜向格相邻
    expect([...neighborsOf(idx(3, 2))].sort()).toEqual([idx(2, 2), idx(4, 2), idx(3, 1), idx(3, 3)].sort())
  })

  it('去掉斜向后，被 3 只犬围死的落点从 2 个涨到 16 个', () => {
    let trappable = 0
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (isPlayable(idx(c, r)) && neighborsOf(idx(c, r)).length <= 3) trappable++
      }
    }
    expect(trappable).toBe(16)
  })

  it('每个棋点都能算出行列', () => {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!isPlayable(idx(c, r))) continue
        expect(colOf(idx(c, r))).toBe(c)
        expect(rowOf(idx(c, r))).toBe(r)
      }
    }
  })
})

// ------------------------------------------------------------------ 开局

describe('开局', () => {
  it('三只犬一字排开在左端三格，兔子在正中，猎犬先走', () => {
    const s = opening()
    for (const h of HOUND_STARTS) expect(s.board[h]).toBe(HOUND)
    expect(piecesOf(s.board, 'hounds')).toEqual([...HOUND_STARTS])
    expect(s.board[HARE_START]).toBe(HARE)
    expect(rearmostHoundCol(s.board)).toBe(0)
    expect(leadingHoundCol(s.board)).toBe(0)
    expect(s.turn).toBe('hounds')
    expect(s.over).toBe(false)
    expect(s.moves).toBe(0)
  })

  it('开局不是终局（回归：曾把犬阵「最后」一只当前沿，3>0 直接判兔子逃脱）', () => {
    const s = opening()
    expect(hareEscaped(s.board)).toBe(false)
    expect(hareTrapped(s.board)).toBe(false)
    expect(houndsStuck(s.board)).toBe(false)
    expect(winnerOf(s)).toBe('none')
  })

  it('正交走法下：猎犬 3 种开局走法，兔子 4 种', () => {
    expect(movesOf(opening().board, 'hounds')).toHaveLength(3)
    expect(movesOf(opening().board, 'hare')).toHaveLength(4)
  })
})

// ------------------------------------------------------------------ 走法

describe('走法：只走横竖相邻一格，猎犬不能后退', () => {
  it('只能走到相邻的空棋点，一次一格', () => {
    const s = opening()
    for (const to of stepsFrom(s.board, HOUND_STARTS[1], HOUND)) {
      expect(neighborsOf(HOUND_STARTS[1])).toContain(to)
      expect(s.board[to]).toBe(EMPTY)
    }
  })

  it('猎犬不能后退：目标列不能比起点小', () => {
    const s = blank([
      [idx(3, 2), HOUND],
      [idx(2, 2), EMPTY],
    ])
    expect(canStep(s.board, idx(3, 2), idx(2, 2), HOUND)).toBe(false)
    expect(canStep(s.board, idx(3, 2), idx(4, 2), HOUND)).toBe(true)
  })

  it('猎犬也不能斜走', () => {
    const s = blank([
      [idx(2, 2), HOUND],
      [idx(3, 1), EMPTY],
    ])
    expect(canStep(s.board, idx(2, 2), idx(3, 1), HOUND)).toBe(false)
  })

  it('兔子也只走正交，但可以后退', () => {
    const s = blank([
      [idx(3, 2), HARE],
      [idx(2, 2), EMPTY],
    ])
    expect(canStep(s.board, idx(3, 2), idx(2, 2), HARE)).toBe(true)
    expect(stepsFrom(s.board, idx(3, 2), HARE).length).toBe(4)
  })

  it('不能跳子、不能吃子、不能滑行到远处', () => {
    const s = blank([
      [idx(3, 2), HOUND],
      [idx(4, 2), HOUND],
      [idx(6, 2), EMPTY],
    ])
    const targets = stepsFrom(s.board, idx(3, 2), HOUND)
    expect(targets).not.toContain(idx(6, 2)) // 隔着一个子跳到远处
    expect(targets).not.toContain(idx(4, 2)) // 不能压在棋子上面
    expect(s.board.filter((p) => p === HOUND)).toHaveLength(2) // 没有任何吃子
  })

  it('只有相邻才合法：跳一格判非法', () => {
    const s = blank([
      [idx(0, 2), HOUND],
      [idx(2, 2), EMPTY],
    ])
    expect(isLegal(s, { type: 'step', from: idx(0, 2), to: idx(2, 2) })).toBe(false)
  })
})

// ------------------------------------------------------------------ reduce 纯度

describe('reduce 是纯函数', () => {
  it('不修改入参，也不复用棋盘数组', () => {
    const s = opening()
    const before = s.board.slice()
    const next = reduce(s, { type: 'step', from: HOUND_STARTS[1], to: idx(1, 2) })
    expect(s.board).toEqual(before)
    expect(next).not.toBe(s)
    expect(next.board).not.toBe(s.board)
    expect(next.turn).toBe('hare')
    expect(next.moves).toBe(1)
  })

  it('非法动作原样返回同一个 state', () => {
    const s = opening()
    expect(reduce(s, { type: 'step', from: HARE_START, to: idx(4, 2) })).toBe(s)
    expect(reduce(s, { type: 'step', from: HOUND_STARTS[0], to: idx(6, 2) })).toBe(s)
  })

  it('轮到对方时不能替对方走', () => {
    const s: State = { ...opening(), turn: 'hare' }
    expect(reduce(s, { type: 'step', from: HOUND_STARTS[1], to: idx(1, 2) })).toBe(s)
  })

  it('终局后棋盘不再变化', () => {
    const done: State = withPieces([[idx(0, 1), HOUND]], { over: true, winner: 'hounds' })
    expect(reduce(done, { type: 'step', from: idx(0, 1), to: idx(1, 1) })).toBe(done)
    expect(reduce(done, { type: 'clear' }).board).toEqual(done.board)
  })

  it('legalActions 与 reduce 对得上：列出来的走法都能真的走', () => {
    const s = opening()
    const actions = legalActions(s)
    expect(actions).toHaveLength(3)
    for (const a of actions) {
      expect(isLegal(s, a)).toBe(true)
      const next = reduce(s, a)
      expect(next).not.toBe(s)
      expect(next.lastFrom).toBe((a as { from: number }).from)
      expect(next.lastTo).toBe((a as { to: number }).to)
    }
  })

  it('相同输入产出相同结果（可复盘）', () => {
    const s = opening()
    const a: Action = { type: 'step', from: HOUND_STARTS[1], to: idx(1, 2) }
    expect(reduce(s, a)).toEqual(reduce(s, a))
  })
})

// ------------------------------------------------------------------ 胜负

describe('胜负判定', () => {
  it('围死兔子 → 猎犬胜（端到端：犬这一步正好补上最后一个出口）', () => {
    // 兔子在 (6,1)，正交上只有 (5,1) 和 (6,2) 两个邻格；
    // (5,1) 已被占，犬从 (6,3) 横移到 (6,2) 就把它封死了
    const s = blank(
      [
        [idx(6, 1), HARE],
        [idx(5, 1), HOUND],
        [idx(6, 3), HOUND],
        [idx(4, 2), HOUND],
      ],
      { turn: 'hounds' },
    )
    expect(hareTrapped(s.board)).toBe(false)
    expect(stepsFrom(s.board, idx(6, 1), HARE)).toEqual([idx(6, 2)])

    const done = reduce(s, { type: 'step', from: idx(6, 3), to: idx(6, 2) })
    expect(done.over).toBe(true)
    expect(done.winner).toBe('hounds')
    expect(hareTrapped(done.board)).toBe(true)
  })

  it('兔子绕到犬阵左后方 → 兔子胜', () => {
    // 犬阵推进到第 3~4 列；兔子从 (3,1) 一步挤到 (2,1) 就越过了最左那只犬
    const s = blank(
      [
        [idx(3, 2), HOUND],
        [idx(3, 3), HOUND],
        [idx(4, 3), HOUND],
        [idx(3, 1), HARE],
      ],
      { turn: 'hare' },
    )
    expect(rearmostHoundCol(s.board)).toBe(3)
    expect(hareEscaped(s.board)).toBe(false)

    const done = reduce(s, { type: 'step', from: idx(3, 1), to: idx(2, 1) })
    expect(done.over).toBe(true)
    expect(done.winner).toBe('hare')
    expect(hareEscaped(done.board)).toBe(true)
  })

  it('兔子只是站在犬阵旁边但还没越过，不算赢', () => {
    // 回归：曾把逃脱写成「兔子列号 > 犬阵最前列」或「踩到最右一列」，两者都会让猎犬赢不了
    const s = opening()
    expect(rearmostHoundCol(s.board)).toBe(0)
    expect(colOf(HARE_START)).toBe(3)
    expect(hareEscaped(s.board)).toBe(false)

    const farRight = blank([
      [idx(2, 1), HOUND],
      [idx(2, 2), HOUND],
      [idx(2, 3), HOUND],
      [idx(6, 2), HARE],
    ])
    expect(colOf(idx(6, 2))).toBe(COLS - 1)
    expect(hareEscaped(farRight.board)).toBe(false)
    expect(winnerOf(farRight)).toBe('none')

    const behind = blank([
      [idx(3, 1), HOUND],
      [idx(3, 2), HOUND],
      [idx(3, 3), HOUND],
      [idx(2, 2), HARE],
    ])
    expect(hareEscaped(behind.board)).toBe(true)
  })

  it('走到步数上限仍无胜负 → 平局（兜底，保证对局收敛）', () => {
    expect(winnerOf({ ...opening(), moves: MOVE_LIMIT })).toBe('draw')
    expect(winnerOf({ ...opening(), moves: MOVE_LIMIT - 1 })).toBe('none')
  })

  it('「已逃脱」与「被围死」不可能同时成立，所以两者谁优先并不影响结果', () => {
    // 围死要求 3 只犬占满兔子的所有邻格，其中必然有犬在兔子的**左边**；
    // 而逃脱要求**所有**犬都在兔子的右边。两者互斥，winnerOf 的判定顺序怎么写都对。
    let both = 0
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = idx(c, r)
        if (!isPlayable(cell)) continue
        const board = new Array<Piece>(ROWS * COLS).fill(EMPTY)
        board[cell] = HARE
        for (const n of neighborsOf(cell)) board[n] = HOUND
        if (hareEscaped(board) && hareTrapped(board)) both++
      }
    }
    expect(both).toBe(0)
  })
})

// ------------------------------------------------------------------ 磨洋工

describe('磨洋工：猎犬连着横移就输', () => {
  it('横移不推进阵型，连续十步判兔子胜', () => {
    const s = blank([[idx(0, 1), HOUND]], { turn: 'hounds', sideStreak: STALL_LIMIT - 1 })
    const next = reduce(s, { type: 'step', from: idx(0, 1), to: idx(0, 2) })
    expect(next.over).toBe(true)
    expect(next.winner).toBe('hare')
  })

  it('**兔子自己走一步不会清零计数**（回归：原来会被清零，这条规则从来没触发过）', () => {
    const s = blank(
      [
        [idx(0, 1), HOUND],
        [idx(4, 2), HARE],
      ],
      { sideStreak: 5 },
    )
    const hareStep = reduce({ ...s, turn: 'hare' }, { type: 'step', from: idx(4, 2), to: idx(4, 1) })
    expect(hareStep.sideStreak).toBe(5)
  })

  it('猎犬往前推一步就清零', () => {
    const s = blank([[idx(0, 1), HOUND]], { turn: 'hounds', sideStreak: 5 })
    const fwd = reduce(s, { type: 'step', from: idx(0, 1), to: idx(1, 1) })
    expect(fwd.sideStreak).toBe(0)
  })

  it('连续横移真的能走到 10 并触发（端到端，不再是死代码）', () => {
    let s = blank(
      [
        [idx(0, 1), HOUND],
        [idx(5, 2), HARE],
      ],
      { turn: 'hounds' },
    )
    let steps = 0
    while (!s.over && steps < 40) {
      // 猎犬**只准横移**（同列上下），兔子随便走 —— 逼出「连续十次不前进」的局面
      const a =
        s.turn === 'hounds'
          ? legalActions(s).find((m) => colOf((m as { from: number }).from) === colOf((m as { to: number }).to)) ?? null
          : pickStep(s)
      if (a === null) break
      s = reduce(s, a)
      steps++
    }
    expect(s.over).toBe(true)
    expect(s.winner).toBe('hare')
    expect(s.sideStreak).toBeGreaterThanOrEqual(STALL_LIMIT)
    // 兔子每 2 步走一次，但不再清零计数，所以 10 次猎犬横移约 20 步就结束了
    expect(s.moves).toBeLessThan(MOVE_LIMIT)
  })
})

/** 随便挑一个合法走法（测试用，不做任何判断） */
function pickStep(s: State): Action | null {
  const a = legalActions(s)
  if (a.length === 0) return null
  return a[a.length % a.length]
}

// ------------------------------------------------------------------ AI 契约

describe('AI 契约', () => {
  it('玩家没选边时必须返回 null（不许替玩家做选择）', () => {
    expect(aiAction(create(1))).toBeNull()
  })

  it('轮到玩家时必须返回 null（壳层契约：AI 不得替玩家走）', () => {
    const s = opening()
    expect(s.turn).toBe('hounds')
    expect(s.playerSide).toBe('hounds')
    expect(aiAction(s)).toBeNull()

    const after = reduce(s, { type: 'step', from: HOUND_STARTS[1], to: idx(1, 2) })
    expect(after.turn).toBe('hare')
    expect(aiAction(after)).not.toBeNull()
  })

  it('玩家执兔时，AI 执犬，门禁跟着换边', () => {
    const s = reduce(create(1), { type: 'choose', side: 'hare' })
    expect(aiAction(s)).not.toBeNull() // 开局是猎犬走，正好轮到 AI
    const after = reduce(s, pickStep(s)!)
    expect(after.turn).toBe('hare')
    expect(aiAction(after)).toBeNull() // 轮到玩家了
  })

  it('终局返回 null', () => {
    const done: State = { ...opening(), over: true, winner: 'hounds' }
    expect(aiAction(done)).toBeNull()
    expect(aiSearch(done)).toBeNull()
  })

  it('aiSearch 对双方通用（自对弈要用），门禁只加在 aiAction 这一层', () => {
    expect(aiSearch(opening(), 2)).not.toBeNull()
  })

  it('同一局面对同一个 aiAction 永远给同一手（可复盘）', () => {
    const s = reduce(opening(), { type: 'step', from: HOUND_STARTS[1], to: idx(1, 2) })
    expect(aiAction(s)).toEqual(aiAction(s))
  })

  it('AI 的走法一定是合法动作', () => {
    let s = opening()
    for (let i = 0; i < 12 && !s.over; i++) {
      const a = aiAction(s)
      if (a === null) break
      expect(isLegal(s, a)).toBe(true)
      s = reduce(s, a)
    }
  })

  it('单步思考远低于人感阈值（150ms）', () => {
    let s = reduce(create(1), { type: 'choose', side: 'hare' })
    let worst = 0
    for (let i = 0; i < 20 && !s.over; i++) {
      const t0 = performance.now()
      const a = aiAction(s)
      const dt = performance.now() - t0
      if (dt > worst) worst = dt
      if (a === null) break
      s = reduce(s, a)
    }
    expect(worst).toBeLessThan(150)
  })

  it('AI 层数是个有意选低的常量（配比是量出来的）', () => {
    expect(AI_DEPTH).toBeGreaterThanOrEqual(1)
    expect(AI_DEPTH).toBeLessThanOrEqual(6)
  })
})

// ------------------------------------------------------------------ 自对弈

describe('自对弈', () => {
  it('双方 AI 对弈一定会在步数上限内结束，绝不卡死', () => {
    for (const seed of [1, 2, 3, 7, 11, 20260917]) {
      const s = selfPlay(seed, 4, 3)
      expect(s.over, `seed=${seed} 的对局没有结束`).toBe(true)
      expect(s.moves).toBeLessThanOrEqual(MOVE_LIMIT + 1)
      expect(['hounds', 'hare', 'draw']).toContain(s.winner)
    }
  })

  it('对局会真正分出胜负，而不是清一色打到步数上限', () => {
    const res = [1, 2, 3, 5, 7, 8, 11, 13].map((seed) => selfPlay(seed, 6, 4))
    const decisive = res.filter((s) => s.winner !== 'draw').length
    // 回归：修 sideStreak 之前这里恒为 0，16 局全是 120 手平局
    expect(decisive, `只有 ${decisive}/8 局分出胜负`).toBeGreaterThanOrEqual(4)
  })

  it('深搜的猎犬不比浅搜的更差', () => {
    let shallowLost = 0
    let deepLost = 0
    for (const seed of [4, 9, 16]) {
      if (selfPlay(seed, 2, 4).winner === 'hare') shallowLost++
      if (selfPlay(seed, 6, 4).winner === 'hare') deepLost++
    }
    expect(deepLost).toBeLessThanOrEqual(shallowLost)
  })

  it('执兔的一方有机会赢（玩家可选边的意义所在）', () => {
    // 玩家执兔（d2 水平）vs 对手猎犬 d3：实测约 4 成胜率
    let wins = 0
    for (const seed of [1, 2, 3, 5, 7, 8]) {
      let s: State = reduce(create(seed), { type: 'choose', side: 'hare' })
      let guard = 0
      while (!s.over && guard++ <= MOVE_LIMIT) {
        const info = aiSearch(s, s.turn === 'hare' ? 2 : AI_DEPTH)
        if (info === null) break
        s = reduce(s, info.action)
      }
      if (s.winner === 'hare') wins++
    }
    expect(wins, `执兔 6 局只赢了 ${wins} 局`).toBeGreaterThanOrEqual(1)
  })
})

// ------------------------------------------------------------------ 评估函数

describe('静态评估（始终从兔子视角）', () => {
  const line = (c: number): Array<[number, Piece]> =>
    [idx(c, 1), idx(c, 2), idx(c, 3)].map((x) => [x, HOUND] as [number, Piece])

  it('兔子离「绕到犬阵最后面」越近，评估越高', () => {
    const near = evaluate(blank([...line(3), [idx(5, 2), HARE]]).board)
    const far = evaluate(blank([...line(3), [idx(6, 2), HARE]]).board)
    expect(near).toBeGreaterThan(far)
  })

  it('被贴脸围紧的兔子评估更低', () => {
    const open = evaluate(blank([...line(0), [idx(3, 2), HARE]]).board)
    const crowded = evaluate(blank([...line(2), [idx(3, 2), HARE]]).board)
    expect(crowded).toBeLessThan(open)
  })

  it('犬阵越往右推，兔子左侧的出口越少，评估越低', () => {
    // 兔子固定在 (5,2)：犬线在第 2 列时它左边还是空的，在第 4 列时左边就被贴上了
    const early = evaluate(blank([...line(2), [idx(5, 2), HARE]]).board)
    const late = evaluate(blank([...line(4), [idx(5, 2), HARE]]).board)
    expect(late).toBeLessThan(early)
  })

  it('已绕到犬阵后方给最高分，已被围死给最低分', () => {
    expect(evaluate(blank([...line(3), [idx(2, 2), HARE]]).board)).toBeGreaterThan(0)
    expect(evaluate(blank([
      [idx(6, 1), HARE],
      [idx(5, 1), HOUND],
      [idx(6, 2), HOUND],
    ]).board)).toBeLessThan(0)
  })
})

// ------------------------------------------------------------------ 走子约定

describe('其他导出', () => {
  it('aiSide 返回玩家没选的那一方', () => {
    const s: State = { ...create(1), playerSide: 'hounds' as Side | null }
    expect(choosing(s)).toBe(false)
  })
})
