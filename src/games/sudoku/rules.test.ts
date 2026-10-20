import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng'
import {
  CELLS,
  SIDE,
  TARGET_BLANKS,
  blankCount,
  colOf,
  computeConflicts,
  countSolutions,
  create,
  digPuzzle,
  difficultyOf,
  filledCount,
  generateSolution,
  hasUniqueSolution,
  isRed,
  isSolved,
  reduce,
  rowOf,
  scoreOf,
  solve,
  type State,
} from './rules'

/** 经典的一个完整合法解（当求解器的输入） */
const SOLUTION_TEXT =
  '534678912' +
  '672195348' +
  '198342567' +
  '859761423' +
  '426853791' +
  '713924856' +
  '961537284' +
  '287419635' +
  '345286179'

const SOLUTION: number[] = SOLUTION_TEXT.split('').map((c) => Number(c))

/** 全空盘面 */
const EMPTY: number[] = new Array(CELLS).fill(0)

/** 几个共享的开局状态（reduce 是纯函数，共享不会互相污染） */
const S1 = create(20260920)
const S2 = create(4242)

/** 用标准解把整张盘面填满 */
function fillAll(s: State): State {
  let cur = s
  for (let i = 0; i < CELLS; i++) {
    if (cur.given[i]) continue
    cur = reduce(cur, { type: 'select', index: i })
    cur = reduce(cur, { type: 'place', value: cur.solution[i] })
  }
  return cur
}

/** 在 state 里找一个「填下去就会重复」的落点（同一行/列/宫里已经有这个数字） */
function conflictSetup(s: State, scope: 'row' | 'col' | 'box'): { index: number; value: number } {
  const at = (g: number, k: number): number => {
    if (scope === 'row') return g * SIDE + k
    if (scope === 'col') return k * SIDE + g
    return (Math.floor(g / 3) * 3 + Math.floor(k / 3)) * SIDE + (g % 3) * 3 + (k % 3)
  }
  for (let g = 0; g < SIDE; g++) {
    const digits = new Set<number>()
    for (let k = 0; k < SIDE; k++) {
      const i = at(g, k)
      if (s.given[i]) digits.add(s.values[i])
    }
    if (digits.size === 0) continue
    const value = [...digits][0]
    for (let k = 0; k < SIDE; k++) {
      const i = at(g, k)
      if (!s.given[i]) return { index: i, value }
    }
  }
  throw new Error(`找不到 ${scope} 冲突的落点`)
}

/** 选中并填入一个数字 */
function put(s: State, index: number, value: number): State {
  return reduce(reduce(s, { type: 'select', index }), { type: 'place', value })
}

// ---------------- 出题 ----------------

describe('出题器', () => {
  it('题面长度 81、取值只在 0~9 之间', () => {
    expect(S1.puzzle.length).toBe(CELLS)
    expect(S1.solution.length).toBe(CELLS)
    expect(S1.puzzle.every((v) => Number.isInteger(v) && v >= 0 && v <= 9)).toBe(true)
  })

  it('题面一定有解：求解器能解出来，且解与 solution 一致', () => {
    const got = solve(S1.puzzle)
    expect(got).not.toBeNull()
    expect(got).toEqual(S1.solution)
  })

  it('solution 本身是合法解：每行每列每宫都是 1~9 各一次', () => {
    const seen = (cells: number[]): boolean[] => {
      const out = new Array<boolean>(CELLS).fill(false)
      for (const i of cells) out[i] = true
      return out
    }
    for (let r = 0; r < SIDE; r++) {
      const row: number[] = []
      for (let c = 0; c < SIDE; c++) row.push(r * SIDE + c)
      const got = new Set(S1.solution.filter((_, i) => seen(row)[i]))
      expect(got.size).toBe(SIDE)
    }
    for (let c = 0; c < SIDE; c++) {
      const col: number[] = []
      for (let r = 0; r < SIDE; r++) col.push(r * SIDE + c)
      const got = new Set(S1.solution.filter((_, i) => seen(col)[i]))
      expect(got.size).toBe(SIDE)
    }
    for (let b = 0; b < SIDE; b++) {
      const box: number[] = []
      for (let k = 0; k < SIDE; k++) {
        box.push((Math.floor(b / 3) * 3 + Math.floor(k / 3)) * SIDE + (b % 3) * 3 + (k % 3))
      }
      const got = new Set(S1.solution.filter((_, i) => seen(box)[i]))
      expect(got.size).toBe(SIDE)
    }
  })

  it('挖空后解唯一', () => {
    expect(hasUniqueSolution(S1.puzzle)).toBe(true)
    expect(hasUniqueSolution(S2.puzzle)).toBe(true)
  })

  it('同种子生成的题面完全相同', () => {
    const a = create(31337)
    const b = create(31337)
    expect(a.puzzle).toEqual(b.puzzle)
    expect(a.solution).toEqual(b.solution)
    expect(a).toEqual(b)
  })

  it('不同种子题面不同', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 8; seed++) seen.add(create(seed * 7919).puzzle.join(''))
    expect(seen.size).toBe(8)
  })

  it('空格数落在合理区间，难度能被分档', () => {
    const blanks = blankCount(S1.puzzle)
    expect(blanks).toBeGreaterThanOrEqual(25)
    expect(blanks).toBeLessThanOrEqual(TARGET_BLANKS)
    expect(['入门', '简单', '中等']).toContain(difficultyOf(S1.puzzle))
  })

  it('给定格与题面一致，玩家盘面初值就是题面', () => {
    for (let i = 0; i < CELLS; i++) {
      expect(S1.given[i]).toBe(S1.puzzle[i] !== 0)
      expect(S1.values[i]).toBe(S1.puzzle[i])
    }
  })

  it('generateSolution 产出的一定是合法解', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const sol = generateSolution(new Rng(seed * 104729))
      expect(sol.length).toBe(CELLS)
      expect(sol.every((v) => v >= 1 && v <= 9)).toBe(true)
      expect(solve(sol)).toEqual(sol)
    }
  })

  it('digPuzzle 挖空之后依然有唯一解', () => {
    const r = new Rng(99)
    const sol = generateSolution(r)
    const puzzle = digPuzzle(r, sol, 20)
    expect(blankCount(puzzle)).toBeGreaterThan(0)
    expect(hasUniqueSolution(puzzle)).toBe(true)
  })
})

// ---------------- 求解器 ----------------

describe('求解器', () => {
  it('合法解能解出来，且与原盘面一致', () => {
    expect(solve(SOLUTION)).toEqual(SOLUTION)
  })

  it('空盘面能解出（不卡死）', () => {
    const got = solve(EMPTY)
    expect(got).not.toBeNull()
    expect(got!.length).toBe(CELLS)
  })

  it('同行重复的盘面返回 null', () => {
    const board = SOLUTION.slice()
    board[1] = board[0] // 第 0 行放两个 5
    expect(solve(board)).toBeNull()
  })

  it('同列重复的盘面返回 null', () => {
    const board = SOLUTION.slice()
    board[9] = board[0] // 第 0 列放两个 5
    expect(solve(board)).toBeNull()
  })

  it('同宫重复的盘面返回 null', () => {
    const board = SOLUTION.slice()
    board[1] = board[0] // 左上宫里放两个 5
    expect(solve(board)).toBeNull()
  })

  it('solve 不修改入参', () => {
    const board = SOLUTION.slice()
    board[40] = 0
    const copy = board.slice()
    solve(board)
    expect(board).toEqual(copy)
  })

  it('countSolutions 能数出多个解', () => {
    expect(countSolutions(EMPTY, 2)).toBe(2)
  })

  it('hasUniqueSolution 对多解盘面返回 false', () => {
    expect(hasUniqueSolution(EMPTY)).toBe(false)
  })

  it('hasUniqueSolution 对唯一解盘面返回 true', () => {
    expect(hasUniqueSolution(S1.puzzle)).toBe(true)
  })

  it('求解器给出的解是合法盘面：行、列、宫都不重复，且与题面一致', () => {
    const got = solve(S1.puzzle)!
    expect(got.length).toBe(CELLS)
    for (let i = 0; i < CELLS; i++) {
      expect(S1.puzzle[i] === 0 || S1.puzzle[i] === got[i]).toBe(true)
      const r = rowOf(i)
      const c = colOf(i)
      for (let k = 0; k < SIDE; k++) {
        const sameRow = r * SIDE + k
        const sameCol = k * SIDE + c
        if (sameRow !== i) expect(got[sameRow]).not.toBe(got[i])
        if (sameCol !== i) expect(got[sameCol]).not.toBe(got[i])
      }
      const br = r - (r % 3)
      const bc = c - (c % 3)
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          const j = (br + dr) * SIDE + bc + dc
          if (j !== i) expect(got[j]).not.toBe(got[i])
        }
      }
    }
  })

  it('求解器不会死循环：多种盘面都在有限时间内返回', () => {
    const t0 = Date.now()
    solve(EMPTY)
    solve(S1.puzzle)
    solve(SOLUTION)
    countSolutions(EMPTY, 2)
    expect(Date.now() - t0).toBeLessThan(5000)
  })
})

// ---------------- 填数 ----------------

describe('填数', () => {
  it('place 会更新 values', () => {
    const spot = conflictSetup(S1, 'row')
    const n = put(S1, spot.index, spot.value)
    expect(n.values[spot.index]).toBe(spot.value)
    expect(S1.values[spot.index]).toBe(0) // 入参没被改
  })

  it('题面给定的格子不能被改', () => {
    const givenIndex = S1.given.findIndex((g) => g)
    expect(givenIndex).toBeGreaterThanOrEqual(0)
    const n = reduce(reduce(S1, { type: 'select', index: givenIndex }), { type: 'place', value: 7 })
    expect(n.values[givenIndex]).toBe(S1.values[givenIndex])
  })

  it('再点一次同样的数字会清空', () => {
    const spot = conflictSetup(S1, 'row')
    const once = put(S1, spot.index, spot.value)
    const twice = reduce(once, { type: 'place', value: spot.value })
    expect(twice.values[spot.index]).toBe(0)
  })

  it('place 0 是擦除', () => {
    const spot = conflictSetup(S1, 'row')
    const once = put(S1, spot.index, spot.value)
    const cleared = reduce(once, { type: 'place', value: 0 })
    expect(cleared.values[spot.index]).toBe(0)
  })

  it('非法数字（10 / -1 / 1.5）不改变状态', () => {
    const s = reduce(S1, { type: 'select', index: 5 })
    expect(reduce(s, { type: 'place', value: 10 })).toBe(s)
    expect(reduce(s, { type: 'place', value: -1 })).toBe(s)
    expect(reduce(s, { type: 'place', value: 1.5 })).toBe(s)
  })

  it('没有选中格时 place 是空操作', () => {
    expect(reduce(S1, { type: 'place', value: 5 })).toBe(S1)
  })

  it('select 会切换选中的格子', () => {
    const n = reduce(S1, { type: 'select', index: 42 })
    expect(n.selected).toBe(42)
  })

  it('越界 select 是空操作', () => {
    expect(reduce(S1, { type: 'select', index: -1 })).toBe(S1)
    expect(reduce(S1, { type: 'select', index: CELLS })).toBe(S1)
    expect(reduce(S1, { type: 'select', index: 1.5 })).toBe(S1)
  })
})

// ---------------- 笔记 ----------------

describe('笔记', () => {
  it('toggleNote 会切换候选数字', () => {
    const s = reduce(S1, { type: 'select', index: 12 })
    const n = reduce(s, { type: 'toggleNote', value: 3 })
    expect(n.notes[12]).toEqual([3])
  })

  it('toggleNote 不影响 values', () => {
    const s = reduce(S1, { type: 'select', index: 12 })
    const n = reduce(s, { type: 'toggleNote', value: 3 })
    expect(n.values).toEqual(s.values)
  })

  it('再点一次同样的候选就取消', () => {
    const s = reduce(S1, { type: 'select', index: 12 })
    const on = reduce(s, { type: 'toggleNote', value: 3 })
    const off = reduce(on, { type: 'toggleNote', value: 3 })
    expect(off.notes[12]).toEqual([])
  })

  it('多个候选会排好序', () => {
    let s = reduce(S1, { type: 'select', index: 12 })
    s = reduce(s, { type: 'toggleNote', value: 7 })
    s = reduce(s, { type: 'toggleNote', value: 2 })
    s = reduce(s, { type: 'toggleNote', value: 5 })
    expect(s.notes[12]).toEqual([2, 5, 7])
  })

  it('给定的格子不能记笔记', () => {
    const givenIndex = S1.given.findIndex((g) => g)
    const s = reduce(S1, { type: 'select', index: givenIndex })
    expect(reduce(s, { type: 'toggleNote', value: 3 })).toBe(s)
  })

  it('非法候选值不改变状态', () => {
    const s = reduce(S1, { type: 'select', index: 12 })
    expect(reduce(s, { type: 'toggleNote', value: 0 })).toBe(s)
    expect(reduce(s, { type: 'toggleNote', value: 10 })).toBe(s)
  })

  it('填入数字会清掉该格的候选', () => {
    let s = reduce(S1, { type: 'select', index: 12 })
    s = reduce(s, { type: 'toggleNote', value: 3 })
    s = reduce(s, { type: 'place', value: 5 })
    expect(s.notes[12]).toEqual([])
  })
})

// ---------------- 冲突检测 ----------------

describe('冲突检测', () => {
  it('同一行出现重复数字时，两格都标红', () => {
    const spot = conflictSetup(S1, 'row')
    const n = put(S1, spot.index, spot.value)
    expect(isRed(n, spot.index)).toBe(true)
    expect(n.conflict[spot.index]).toBe(true)
  })

  it('同一列出现重复数字时标红', () => {
    const spot = conflictSetup(S1, 'col')
    const n = put(S1, spot.index, spot.value)
    expect(isRed(n, spot.index)).toBe(true)
  })

  it('同一宫出现重复数字时标红', () => {
    const spot = conflictSetup(S1, 'box')
    const n = put(S1, spot.index, spot.value)
    expect(isRed(n, spot.index)).toBe(true)
  })

  it('擦掉重复的那个数字后，冲突消失', () => {
    const spot = conflictSetup(S1, 'row')
    const once = put(S1, spot.index, spot.value)
    const twice = reduce(once, { type: 'place', value: spot.value })
    expect(isRed(twice, spot.index)).toBe(false)
  })

  it('computeConflicts 能直接算出重复格', () => {
    const board = SOLUTION.slice()
    board[1] = board[0]
    const flags = computeConflicts(board)
    expect(flags[0]).toBe(true)
    expect(flags[1]).toBe(true)
    expect(flags[2]).toBe(false)
  })

  it('没有重复时不会有冲突', () => {
    expect(computeConflicts(SOLUTION).some((f) => f)).toBe(false)
  })
})

// ---------------- 提示 ----------------

describe('提示', () => {
  it('hint 填入的数字一定与 solution 一致', () => {
    const n = reduce(S1, { type: 'hint' })
    const idx = n.values.findIndex((v, i) => v !== S1.values[i])
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(n.values[idx]).toBe(S1.solution[idx])
  })

  it('hint 会让提示次数 +1', () => {
    expect(reduce(S1, { type: 'hint' }).hints).toBe(S1.hints + 1)
  })

  it('hint 会重算冲突', () => {
    const n = reduce(S1, { type: 'hint' })
    expect(n.conflict.some((f) => f)).toBe(false)
  })

  it('hint 会清掉被填那一格的候选', () => {
    let s = reduce(S1, { type: 'select', index: 20 })
    s = reduce(s, { type: 'toggleNote', value: 4 })
    const n = reduce(s, { type: 'hint' })
    const target = n.values.findIndex((v, i) => v !== s.values[i])
    expect(target).toBeGreaterThanOrEqual(0)
    expect(n.notes[target]).toEqual([])
  })

  it('盘面已经全对时 hint 是空操作', () => {
    const won = fillAll(S1)
    expect(won.over).toBe(true)
    expect(reduce(won, { type: 'hint' })).toBe(won)
  })
})

// ---------------- 检查 ----------------

describe('检查', () => {
  it('check 会把错填的格子标出来', () => {
    const spot = conflictSetup(S1, 'row')
    const filled = put(S1, spot.index, spot.value)
    const n = reduce(filled, { type: 'check' })
    expect(n.wrong[spot.index]).toBe(true)
    expect(isRed(n, spot.index)).toBe(true)
  })

  it('check 不会把正确的格子标错', () => {
    const n = reduce(S1, { type: 'check' })
    expect(n.wrong.some((f) => f)).toBe(false)
  })

  it('check 不会结束游戏', () => {
    const n = reduce(S1, { type: 'check' })
    expect(n.over).toBe(false)
  })

  it('check 不会改动 values', () => {
    const n = reduce(S1, { type: 'check' })
    expect(n.values).toEqual(S1.values)
  })

  it('改掉那一格之后，「检查」的标记被清掉', () => {
    const spot = conflictSetup(S1, 'row')
    const filled = put(S1, spot.index, spot.value)
    const checked = reduce(filled, { type: 'check' })
    const fixed = reduce(checked, { type: 'place', value: 0 })
    expect(fixed.wrong[spot.index]).toBe(false)
  })
})

// ---------------- 通关判定 ----------------

describe('通关判定', () => {
  it('所有空格都填对 → over 为 true', () => {
    const won = fillAll(S1)
    expect(won.over).toBe(true)
    expect(isSolved(won.values, won.solution, won.given)).toBe(true)
  })

  it('填错时不算通关', () => {
    let cur = S1
    for (let i = 0; i < CELLS; i++) {
      if (cur.given[i]) continue
      cur = reduce(cur, { type: 'select', index: i })
      const wrongValue = (cur.solution[i] % 9) + 1
      cur = reduce(cur, { type: 'place', value: wrongValue })
    }
    expect(cur.over).toBe(false)
  })

  it('通关后不再接受任何动作', () => {
    const won = fillAll(S1)
    expect(reduce(won, { type: 'select', index: 3 })).toBe(won)
    expect(reduce(won, { type: 'place', value: 5 })).toBe(won)
    expect(reduce(won, { type: 'toggleNote', value: 5 })).toBe(won)
    expect(reduce(won, { type: 'toggleNoteMode' })).toBe(won)
    expect(reduce(won, { type: 'check' })).toBe(won)
    expect(reduce(won, { type: 'hint' })).toBe(won)
  })

  it('通关后 filledCount 等于空格总数', () => {
    const won = fillAll(S1)
    expect(filledCount(won)).toBe(blankCount(S1.puzzle))
  })
})

// ---------------- 复盘性 ----------------

describe('复盘性', () => {
  it('同种子 + 同操作序列 → 完全相同的 values', () => {
    const run = (): State => {
      let s = create(777)
      s = reduce(s, { type: 'select', index: 30 })
      s = reduce(s, { type: 'place', value: 5 })
      s = reduce(s, { type: 'toggleNote', value: 3 })
      s = reduce(s, { type: 'toggleNoteMode' })
      s = reduce(s, { type: 'check' })
      s = reduce(s, { type: 'hint' })
      return s
    }
    expect(run().values).toEqual(run().values)
    expect(run()).toEqual(run())
  })

  it('create 对同一 seed 完全一致', () => {
    expect(create(8888)).toEqual(create(8888))
  })

  it('reduce 不修改入参', () => {
    const empty = S1.given.findIndex((g) => !g)
    const s = reduce(S1, { type: 'select', index: empty })
    const values = s.values.slice()
    const notes = s.notes.map((n) => n.slice())
    const rng = s.rng
    const n = reduce(s, { type: 'place', value: 5 })
    expect(s.values).toEqual(values)
    expect(s.notes).toEqual(notes)
    expect(s.rng).toBe(rng)
    expect(n).not.toBe(s)
  })

  it('newGame 会换一题并重置进度', () => {
    const n = reduce(S1, { type: 'newGame' })
    expect(n.puzzle).not.toEqual(S1.puzzle)
    expect(n.hints).toBe(0)
    expect(n.selected).toBe(-1)
    expect(n.over).toBe(false)
  })

  it('newGame 之后 rng 继续推进，再换一题还是不同的题', () => {
    const a = reduce(S1, { type: 'newGame' })
    const b = reduce(a, { type: 'newGame' })
    expect(b.puzzle).not.toEqual(a.puzzle)
  })
})

// ---------------- 分数 ----------------

describe('分数', () => {
  it('分数随提示次数下降', () => {
    const noHint = scoreOf(S1)
    const withHint = scoreOf(reduce(S1, { type: 'hint' }))
    expect(withHint).toBeLessThan(noHint)
  })

  it('分数是有限正数', () => {
    expect(Number.isFinite(scoreOf(S1))).toBe(true)
    expect(scoreOf(S1)).toBeGreaterThan(0)
  })
})

// ---------------- 坐标换算 ----------------

describe('坐标换算', () => {
  it('rowOf / colOf 覆盖 0~80', () => {
    for (let i = 0; i < CELLS; i++) {
      expect(rowOf(i)).toBe(Math.floor(i / SIDE))
      expect(colOf(i)).toBe(i % SIDE)
      expect(rowOf(i) * SIDE + colOf(i)).toBe(i)
    }
  })
})
