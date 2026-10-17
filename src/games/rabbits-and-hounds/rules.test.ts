import { describe, expect, it } from 'vitest'
import {
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
  type State,
} from './rules'

// ------------------------------------------------------------------ 辅助

/** 按给定摆子构造 state；pairs 是 [格, 棋子]，其余为空 */
function withPieces(pairs: Array<[number, Piece]>, over: Partial<State> = {}): State {
  const board: Piece[] = new Array<Piece>(ROWS * COLS).fill(EMPTY)
  for (const [cell, p] of pairs) board[cell] = p
  return { ...create(1), board, ...over }
}

const blank = (pairs: Array<[number, Piece]> = [], over: Partial<State> = {}): State =>
  withPieces(pairs, over)

/** 经典开局：犬一字排开在左端，兔在正中，猎犬先走 */
const opening = (): State => create(20260917)

/** 自对弈：双方共用同一个 aiSearch，跑到终局 */
function selfPlay(seed: number, houndDepth: number, hareDepth: number): State {
  let s = create(seed)
  let guard = 0
  while (!s.over && guard++ <= MOVE_LIMIT) {
    const info = aiSearch(s, s.turn === 'hounds' ? houndDepth : hareDepth)
    if (info === null) break
    s = reduce(s, info.action)
  }
  return s
}

// ------------------------------------------------------------------ 棋盘拓扑

describe('棋盘：矛尖形 27 点', () => {
  it('中间三行铺满 7 列，最上/最下两行只有中间 3 列', () => {
    expect(isPlayable(idx(0, 0))).toBe(false)
    expect(isPlayable(idx(1, 0))).toBe(false)
    expect(isPlayable(idx(2, 0))).toBe(true)
    expect(isPlayable(idx(3, 0))).toBe(true)
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

  it('左端正好 3 个点 —— 3 只犬一字排开就是无缝墙，围死才可能成立', () => {
    const left: number[] = []
    for (let r = 0; r < ROWS; r++) if (isPlayable(idx(0, r))) left.push(r)
    expect(left).toEqual([1, 2, 3])
  })

  it('相邻关系对称，且矛尖的角不算相邻棋点', () => {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const from = idx(c, r)
        if (!isPlayable(from)) continue
        for (const to of neighborsOf(from)) {
          expect(isPlayable(to)).toBe(true)
          expect(neighborsOf(to)).toContain(from)
        }
      }
    }
    expect(neighborsOf(idx(2, 0))).not.toContain(idx(1, 0))
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
    expect(leadingHoundCol(s.board)).toBe(0)
    expect(s.turn).toBe('hounds')
    expect(s.over).toBe(false)
    expect(s.moves).toBe(0)
  })

  it('开局不是终局（回归：曾把犬阵「最后」一只当成前沿，3>0 直接判兔子逃脱）', () => {
    const s = opening()
    expect(hareEscaped(s.board)).toBe(false)
    expect(hareTrapped(s.board)).toBe(false)
    expect(houndsStuck(s.board)).toBe(false)
    expect(winnerOf(s)).toBe('none')
  })

  it('猎犬有 7 种开局走法，兔子有 8 种', () => {
    expect(movesOf(opening().board, 'hounds')).toHaveLength(7)
    expect(movesOf(opening().board, 'hare')).toHaveLength(8)
  })
})

// ------------------------------------------------------------------ 走法

describe('走法：只走相邻一格，猎犬不能后退', () => {
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

  it('兔子四面八方都能走，包括后退', () => {
    const s = blank([
      [idx(3, 2), HARE],
      [idx(2, 2), EMPTY],
    ])
    expect(canStep(s.board, idx(3, 2), idx(2, 2), HARE)).toBe(true)
    expect(stepsFrom(s.board, idx(3, 2), HARE).length).toBe(8)
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

  it('legalActions 列出来的走法每一个都能真的走', () => {
    const s = opening()
    const actions = legalActions(s)
    expect(actions).toHaveLength(7)
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
    // 兔子退到 (0,1)，它只剩 (1,2) 一个出口；犬从 (0,3) 斜着补上这一格
    const s = blank(
      [
        [idx(0, 1), HARE],
        [idx(0, 2), HOUND],
        [idx(1, 1), HOUND],
        [idx(0, 3), HOUND],
      ],
      { turn: 'hounds' },
    )
    expect(hareTrapped(s.board)).toBe(false)
    expect(stepsFrom(s.board, idx(0, 1), HARE)).toEqual([idx(1, 2)])

    const done = reduce(s, { type: 'step', from: idx(0, 3), to: idx(1, 2) })
    expect(done.over).toBe(true)
    expect(done.winner).toBe('hounds')
    expect(hareTrapped(done.board)).toBe(true)
  })

  it('兔子绕到犬阵左后方 → 兔子胜（玩家要避免的）', () => {
    // 犬阵推进到第 3~4 列，左边空出两列；兔子两步绕出去
    const s = blank(
      [
        [idx(3, 1), HOUND],
        [idx(3, 2), HOUND],
        [idx(4, 3), HOUND],
        [idx(4, 2), HARE],
      ],
      { turn: 'hare' },
    )
    expect(rearmostHoundCol(s.board)).toBe(3)
    expect(hareEscaped(s.board)).toBe(false)

    // 先往左挪一格：还没绕出去（3 不小于犬阵最后面 3）
    const mid = reduce(s, { type: 'step', from: idx(4, 2), to: idx(3, 3) })
    expect(mid.over).toBe(false)
    expect(mid.winner).toBe('none')

    // 再往左一格就越过犬阵最后面了（轮次回到兔子）
    const done = reduce({ ...mid, turn: 'hare' }, { type: 'step', from: idx(3, 3), to: idx(2, 3) })
    expect(done.over).toBe(true)
    expect(done.winner).toBe('hare')
    expect(hareEscaped(done.board)).toBe(true)
  })

  it('兔子只是站在犬阵左边以外但还在犬阵内，不算赢', () => {
    // 回归：曾把逃脱写成「兔子列号 > 犬阵最前列」——开局犬在第 0 列、兔在第 3 列就直接判兔子胜；
    // 也曾写成「兔子踩到最右一列」——兔子开局领先 3 列、每回合同速，连冲三步必到，犬方永远赢不了。
    const s = opening()
    expect(rearmostHoundCol(s.board)).toBe(0)
    expect(colOf(HARE_START)).toBe(3)
    expect(hareEscaped(s.board)).toBe(false)

    // 兔子在犬阵最右边也不算赢 —— 只有跑到犬阵**左边**才算
    const farRight = blank([
      [idx(2, 1), HOUND],
      [idx(2, 2), HOUND],
      [idx(2, 3), HOUND],
      [idx(6, 2), HARE],
    ])
    expect(colOf(idx(6, 2))).toBe(COLS - 1)
    expect(hareEscaped(farRight.board)).toBe(false)
    expect(winnerOf(farRight)).toBe('none')

    // 兔子绕到犬阵左后方才算
    const behind = blank([
      [idx(3, 1), HOUND],
      [idx(3, 2), HOUND],
      [idx(3, 3), HOUND],
      [idx(2, 2), HARE],
    ])
    expect(hareEscaped(behind.board)).toBe(true)
  })

  it('磨洋工规则：横移不推进阵型，连续十次判兔子胜', () => {
    const s = blank([[idx(0, 1), HOUND]], { turn: 'hounds', sideStreak: STALL_LIMIT - 1 })
    const next = reduce(s, { type: 'step', from: idx(0, 1), to: idx(0, 2) })
    expect(next.over).toBe(true)
    expect(next.winner).toBe('hare')
  })

  it('任何非横移的一步都会清零横移计数', () => {
    const s = blank([[idx(0, 1), HOUND]], { turn: 'hounds', sideStreak: 5 })
    const fwd = reduce(s, { type: 'step', from: idx(0, 1), to: idx(1, 1) })
    expect(fwd.sideStreak).toBe(0)
    const hareStep = reduce({ ...fwd, turn: 'hare' }, { type: 'step', from: idx(4, 2), to: idx(4, 1) })
    expect(hareStep.sideStreak).toBe(0)
  })

  it('走到步数上限仍无胜负 → 平局（兜底，保证对局收敛）', () => {
    expect(winnerOf({ ...opening(), moves: MOVE_LIMIT })).toBe('draw')
    expect(winnerOf({ ...opening(), moves: MOVE_LIMIT - 1 })).toBe('none')
  })
})

// ------------------------------------------------------------------ AI 契约

describe('AI 契约', () => {
  it('不是兔子回合时必须返回 null（壳层契约：AI 不得替玩家走）', () => {
    expect(aiAction(opening())).toBeNull()
    const s = reduce(opening(), { type: 'step', from: HOUND_STARTS[1], to: idx(1, 2) })
    expect(s.turn).toBe('hare')
    expect(aiAction(s)).not.toBeNull()
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
    let s = opening()
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

  it('猎犬方（玩家执子）搜得深时不会输 —— 资料称完美对弈下猎犬必胜', () => {
    for (const seed of [1, 2, 3, 5]) {
      const s = selfPlay(seed, 6, 3)
      expect(s.winner, `seed=${seed} 在第 ${s.moves} 步判 ${s.winner}`).not.toBe('hare')
    }
  })

  it('深搜的猎犬不比浅搜的更差', () => {
    let shallowLost = 0
    let deepLost = 0
    for (const seed of [4, 9, 16]) {
      if (selfPlay(seed, 2, 5).winner === 'hare') shallowLost++
      if (selfPlay(seed, 6, 5).winner === 'hare') deepLost++
    }
    expect(deepLost).toBeLessThanOrEqual(shallowLost)
  })
})

// ------------------------------------------------------------------ 评估函数

describe('静态评估（始终从兔子视角）', () => {
  const line = (c: number): Array<[number, Piece]> => [idx(c, 1), idx(c, 2), idx(c, 3)].map((x) => [x, HOUND] as [number, Piece])

  it('兔子越往左（越接近绕出去）评估越高', () => {
    const near = evaluate(blank([...line(3), [idx(5, 2), HARE]]).board)
    const far = evaluate(blank([...line(3), [idx(6, 2), HARE]]).board)
    expect(near).toBeGreaterThan(far)
  })

  it('猎犬整体推进得越远，兔子左边的空档越大，评估越高', () => {
    const pushed = evaluate(blank([...line(3), [idx(5, 2), HARE]]).board)
    const held = evaluate(blank([...line(1), [idx(5, 2), HARE]]).board)
    expect(pushed).toBeGreaterThan(held)
  })

  it('被贴脸围紧的兔子评估更低', () => {
    const open = evaluate(blank([...line(0), [idx(3, 2), HARE]]).board)
    const crowded = evaluate(blank([...line(2), [idx(3, 2), HARE]]).board)
    expect(crowded).toBeLessThan(open)
  })

  it('已绕到犬阵后方给最高分，已被围死给最低分', () => {
    expect(evaluate(blank([...line(3), [idx(2, 2), HARE]]).board)).toBeGreaterThan(0)
    expect(evaluate(blank([
      [idx(2, 0), HARE],
      [idx(3, 0), HOUND],
      [idx(2, 1), HOUND],
      [idx(3, 1), HOUND],
    ]).board)).toBeLessThan(0)
  })
})
