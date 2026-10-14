import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng'
import {
  CELLS,
  COLOR_COUNT,
  COLS,
  ROWS,
  canDrop,
  countBalls,
  create,
  drop,
  idx,
  isCol,
  isFullRow,
  isTopOut,
  landingRow,
  reduce,
  scoreGain,
  stackHeight,
  type State,
} from './rules'

// ---------------- 构造工具 ----------------

function blank(): number[] {
  return new Array<number>(CELLS).fill(0)
}

/** 给某一列的 [fromRow, toRow] 区间填上球 */
function fillCol(grid: number[], col: number, fromRow: number, toRow: number, color = 1): void {
  for (let r = fromRow; r <= toRow; r++) grid[idx(col, r)] = color
}

/** 填满某行，但 exceptCol 那一格留空 */
function fillRowExcept(grid: number[], row: number, exceptCol: number, color = 2): void {
  for (let c = 0; c < COLS; c++) if (c !== exceptCol) grid[idx(c, row)] = color
}

/** 填满某一行 */
function fillRow(grid: number[], row: number, color = 2): void {
  for (let c = 0; c < COLS; c++) grid[idx(c, row)] = color
}

/** 用给定棋盘造一个状态，其余字段取 create 的默认值 */
function stateOf(grid: readonly number[], extra: Partial<State> = {}): State {
  return { ...create(1), grid: grid.slice(), over: false, ...extra }
}

/** 每列自底向上必须连续堆叠，中间不能有空洞 */
function expectNoHole(grid: readonly number[]): void {
  for (let c = 0; c < COLS; c++) {
    let n = 0
    for (let r = ROWS - 1; r >= 0; r--) {
      if (grid[idx(c, r)] === 0) break
      n++
    }
    for (let r = ROWS - 1 - n; r >= 0; r--) expect(grid[idx(c, r)]).toBe(0)
  }
}

/** 棋盘上不应残留任何满行（消行总是立即发生的） */
function expectNoFullRow(grid: readonly number[]): void {
  for (let r = 0; r < ROWS; r++) expect(isFullRow(grid, r)).toBe(false)
}

const ALL_COLS = Array.from({ length: COLS }, (_, c) => c)

// ---------------- 网格与初始状态 ----------------

describe('网格尺寸与开局', () => {
  it('网格是 8 列 × 12 行', () => {
    expect(COLS).toBe(8)
    expect(ROWS).toBe(12)
    expect(CELLS).toBe(96)
  })

  it('开局棋盘长 CELLS 且全为空', () => {
    const s = create(42)
    expect(s.grid.length).toBe(CELLS)
    expect(s.grid.every((v) => v === 0)).toBe(true)
    expect(countBalls(s.grid)).toBe(0)
  })

  it('开局其余字段全部归零', () => {
    const s = create(7)
    expect(s.score).toBe(0)
    expect(s.bestClear).toBe(0)
    expect(s.cleared).toBe(0)
    expect(s.drops).toBe(0)
    expect(s.over).toBe(false)
    expect(s.hover).toBe(-1)
    expect(s.lastDrop).toBeNull()
    expect(s.lastClear).toBeNull()
    expect(s.seq).toBe(0)
  })

  it('首颗球的颜色取自 seed，落在 1..COLOR_COUNT 内', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = create(seed)
      expect(Number.isInteger(s.nextColor)).toBe(true)
      expect(s.nextColor).toBeGreaterThanOrEqual(1)
      expect(s.nextColor).toBeLessThanOrEqual(COLOR_COUNT)
    }
  })

  it('create 对同一 seed 完全一致（可复盘）', () => {
    for (const seed of [1, 999, -12345, 20260913]) expect(create(seed)).toEqual(create(seed))
  })

  it('不同 seed 会产生不同的球色序列', () => {
    const firsts = new Set<number>()
    for (let seed = 1; seed <= 300; seed++) firsts.add(create(seed).nextColor)
    expect(firsts.size).toBeGreaterThan(1)
    expect(firsts.size).toBeLessThanOrEqual(COLOR_COUNT)
  })

  it('同 seed 走同一串落子，得到完全相同的终局', () => {
    const play = (seed: number) => {
      const r = new Rng(seed)
      let s = create(seed)
      for (let i = 0; i < 300 && !s.over; i++) s = drop(s, r.int(COLS))
      return s
    }
    expect(play(1234)).toEqual(play(1234))
  })
})

// ---------------- 落子规则（逐列下落，不做物理） ----------------

describe('逐列下落', () => {
  it('空列落到底部行', () => {
    const s = drop(create(1), 3)
    expect(s.grid[idx(3, ROWS - 1)]).not.toBe(0)
    expect(s.grid[idx(3, ROWS - 2)]).toBe(0)
    expect(s.drops).toBe(1)
  })

  it('同一列连落两颗，一格一格往上叠', () => {
    let s = drop(create(1), 2)
    s = drop(s, 2)
    expect(s.grid[idx(2, ROWS - 1)]).not.toBe(0)
    expect(s.grid[idx(2, ROWS - 2)]).not.toBe(0)
    expect(s.grid[idx(2, ROWS - 3)]).toBe(0)
    expect(s.drops).toBe(2)
  })

  it('下方被占时停在上方一格', () => {
    let s = drop(create(1), 0) // 落在底行
    s = drop(s, 1) // 另一列也落在底行
    s = drop(s, 0) // 第 0 列底行已被占，停在其上方
    expect(s.grid[idx(0, ROWS - 1)]).not.toBe(0)
    expect(s.grid[idx(0, ROWS - 2)]).not.toBe(0)
    expect(s.grid[idx(0, ROWS - 3)]).toBe(0)
  })

  it('落点恒等于「该列最底下的空格」', () => {
    let s = create(5)
    const r = new Rng(99)
    for (let i = 0; i < 60 && !s.over; i++) {
      const col = r.int(COLS)
      const expectRow = landingRow(s.grid, col)
      const next = drop(s, col)
      if (expectRow < 0) {
        expect(next.over).toBe(true)
        continue
      }
      expect(expectRow).toBe(ROWS - 1 - stackHeight(s.grid, col))
      // 落点判定本身与消行无关；但这一球若恰好填满整行，会随该行一起被消除。
      // 由于每列恒为「自底连续堆叠」（落点永远是最底下的空格），落点之上不会有悬空球，
      // 因此该行被消除后此格必为空。
      const cleared = next.lastClear !== null && next.lastClear.rows.includes(expectRow)
      if (cleared) expect(next.grid[idx(col, expectRow)]).toBe(0)
      else expect(next.grid[idx(col, expectRow)]).not.toBe(0)
      s = next
    }
  })

  it('落子推进 rng 与下一个球色，且不消耗非法操作', () => {
    const s = create(77)
    const n = drop(s, 0)
    expect(n.rng).not.toBe(s.rng)
    expect(n.nextColor).toBeGreaterThanOrEqual(1)
    expect(n.nextColor).toBeLessThanOrEqual(COLOR_COUNT)
    const bad = drop(s, COLS)
    expect(bad.rng).toBe(s.rng)
    expect(bad.nextColor).toBe(s.nextColor)
  })

  it('落子的球色就是落子前 state 里的 nextColor', () => {
    const s = create(20260913)
    expect(drop(s, 5).grid[idx(5, ROWS - 1)]).toBe(s.nextColor)
  })

  it('记录了本次落子的列与最终落点行（不含时间戳）', () => {
    let s = drop(create(3), 1)
    expect(s.lastDrop).toEqual({ col: 1, row: ROWS - 1 })
    expect(s.seq).toBe(1)
    s = drop(s, 1)
    expect(s.lastDrop).toEqual({ col: 1, row: ROWS - 2 })
    expect(s.seq).toBe(2)
  })
})

describe('非法列与满列', () => {
  it('越界列被拒绝（返回同一引用，不改任何字段）', () => {
    const s = create(5)
    for (const bad of [-1, COLS, 999, 1.5, NaN, Infinity]) {
      expect(drop(s, bad)).toBe(s)
    }
  })

  it('isCol 判定与越界一致', () => {
    expect(isCol(0)).toBe(true)
    expect(isCol(COLS - 1)).toBe(true)
    expect(isCol(-1)).toBe(false)
    expect(isCol(COLS)).toBe(false)
    expect(isCol(0.5)).toBe(false)
    expect(isCol(NaN)).toBe(false)
    expect(landingRow(blank(), -1)).toBe(-1)
  })

  it('该列已满时判游戏结束，球不写入、棋盘原样保留', () => {
    const g = blank()
    fillCol(g, 0, 0, ROWS - 1)
    const s = stateOf(g)
    expect(landingRow(s.grid, 0)).toBe(-1)
    expect(canDrop(s.grid, 0)).toBe(false)
    const n = drop(s, 0)
    expect(n.over).toBe(true)
    expect(n.grid).toEqual(g)
    expect(n.grid).toBe(s.grid)
    expect(n.score).toBe(s.score)
    expect(n.drops).toBe(s.drops)
    expect(n.seq).toBe(s.seq)
    expect(n.rng).toBe(s.rng)
    expect(n.lastDrop).toBe(s.lastDrop)
  })

  it('多列里只有目标列满时，仍只判结束、不影响其它列', () => {
    const g = blank()
    fillCol(g, 4, 0, ROWS - 1)
    const s = stateOf(g, { score: 12, drops: 9 })
    const n = drop(s, 4)
    expect(n.over).toBe(true)
    expect(n.grid).toEqual(g)
    expect(n.score).toBe(12)
    expect(n.drops).toBe(9)
  })
})

// ---------------- 消除 ----------------

describe('满行消除与重力', () => {
  it('填满一整行即消除', () => {
    const g = blank()
    fillRowExcept(g, ROWS - 1, COLS - 1)
    const s = stateOf(g)
    const n = drop(s, COLS - 1)
    expect(isFullRow(n.grid, ROWS - 1)).toBe(false)
    expect(n.grid.every((v) => v === 0)).toBe(true)
    expect(n.cleared).toBe(COLS)
    expect(n.score).toBe(scoreGain(1))
    expect(n.bestClear).toBe(COLS)
  })

  it('消除后该行上方的球整体下移一格', () => {
    const g = blank()
    fillRowExcept(g, ROWS - 1, COLS - 1)
    fillCol(g, 3, ROWS - 2, ROWS - 2, 5) // 倒数第二行只有第 3 列有球
    const n = drop(stateOf(g), COLS - 1)
    expect(n.grid[idx(3, ROWS - 1)]).toBe(5)
    expect(n.grid[idx(3, ROWS - 2)]).toBe(0)
  })

  it('一次消除多行：同时满的两行一起消掉', () => {
    const g = blank()
    fillRow(g, ROWS - 1) // 底行已满
    fillRowExcept(g, ROWS - 2, 0) // 倒数第二行差第 0 列
    const s = stateOf(g)
    expect(landingRow(s.grid, 0)).toBe(ROWS - 2) // 球落在倒数第二行
    const n = drop(s, 0)
    expect(isFullRow(n.grid, ROWS - 1)).toBe(false)
    expect(isFullRow(n.grid, ROWS - 2)).toBe(false)
    expect(n.grid.every((v) => v === 0)).toBe(true)
    expect(n.cleared).toBe(COLS * 2)
    expect(n.score).toBe(scoreGain(2))
    expect(n.bestClear).toBe(COLS * 2)
    expect(n.lastClear?.rows).toEqual([ROWS - 2, ROWS - 1])
  })

  it('三行同时满时按三行结算', () => {
    const g = blank()
    fillRow(g, ROWS - 1)
    fillRow(g, ROWS - 2)
    fillRowExcept(g, ROWS - 3, 0)
    const n = drop(stateOf(g), 0)
    expect(n.cleared).toBe(COLS * 3)
    expect(n.score).toBe(scoreGain(3))
    expect(n.bestClear).toBe(COLS * 3)
    expect(n.lastClear?.rows.length).toBe(3)
  })

  it('严格「整体下移一格」：正常对局本就没有空洞，下移一格即等于落到底', () => {
    const g = blank()
    fillRowExcept(g, ROWS - 1, COLS - 1)
    fillCol(g, 0, ROWS - 4, ROWS - 4, 5) // 人为造一个悬空球
    const n = drop(stateOf(g), COLS - 1)
    expect(n.grid[idx(0, ROWS - 3)]).toBe(5)
    expect(n.grid[idx(0, ROWS - 2)]).toBe(0)
    expect(n.grid[idx(0, ROWS - 1)]).toBe(0)
  })

  it('消除后棋盘不残留满行', () => {
    const r = new Rng(4242)
    let s = create(4242)
    for (let i = 0; i < 80 && !s.over; i++) {
      s = drop(s, r.int(COLS))
      expectNoFullRow(s.grid)
    }
  })

  it('消除时记录 lastClear，无消除时置 null', () => {
    let s = drop(create(11), 0)
    expect(s.lastClear).toBeNull()
    const g = s.grid.slice()
    fillRowExcept(g, ROWS - 1, 1)
    const n = drop(stateOf(g, { seq: s.seq, drops: s.drops }), 1)
    expect(n.lastClear).not.toBeNull()
    expect(n.lastClear?.rows).toEqual([ROWS - 1])
    expect(n.lastClear?.count).toBe(COLS)
  })
})

// ---------------- 结束判定 ----------------

describe('堆到顶部', () => {
  it('球落到顶行且该行没满 → 判结束', () => {
    const g = blank()
    fillCol(g, 0, 1, ROWS - 1)
    const s = stateOf(g)
    expect(landingRow(s.grid, 0)).toBe(0)
    const n = drop(s, 0)
    expect(n.grid[idx(0, 0)]).not.toBe(0)
    expect(n.over).toBe(true)
  })

  it('最后一球填满一整行并被消除时不算堆到顶，可继续', () => {
    const g = blank()
    fillCol(g, 0, 1, ROWS - 1)
    fillRowExcept(g, 0, 0) // 顶行只差第 0 列
    const s = stateOf(g)
    const n = drop(s, 0)
    expect(n.over).toBe(false)
    expect(n.cleared).toBe(COLS)
    expect(isTopOut(n.grid)).toBe(false)
    expect(n.grid[idx(0, 0)]).toBe(0)
  })

  it('先消行、再判顶，顺序不会写反', () => {
    const g = blank()
    fillCol(g, 2, 1, ROWS - 1)
    fillRowExcept(g, 0, 2)
    // 顶行第 2 列是唯一空格，补上即消行
    const s = stateOf(g)
    // 关键前提：消行「之前」顶行确实有球，若先判顶就会误判为结束
    expect(isTopOut(s.grid)).toBe(true)

    const n = drop(s, 2)
    expect(n.over).toBe(false)
    expect(n.cleared).toBe(COLS)
    // 消行是底部锚定压缩：被消的是顶行，其下方没有行需要下落，故原地不动、顶行腾空
    expect(isTopOut(n.grid)).toBe(false)
    expect(n.grid[idx(2, 0)]).toBe(0)
    // 只剩第 2 列 rows 1..ROWS-1 的球
    expect(countBalls(n.grid)).toBe(ROWS - 1)
    expect(n.grid[idx(2, ROWS - 1)]).not.toBe(0)
  })

  it('结束之后不再接受任何落子', () => {
    const g = blank()
    fillCol(g, 0, 0, ROWS - 1)
    const done = drop(stateOf(g), 0)
    expect(done.over).toBe(true)
    for (const c of ALL_COLS) expect(drop(done, c)).toBe(done)
    expect(reduce(done, { type: 'hover', col: 1 })).toBe(done)
  })

  it('isTopOut 判定顶行是否有球', () => {
    const g = blank()
    expect(isTopOut(g)).toBe(false)
    g[idx(4, 0)] = 1
    expect(isTopOut(g)).toBe(true)
  })
})

// ---------------- 计分 ----------------

describe('计分', () => {
  it('scoreGain = 消除球数 × 消除行数', () => {
    expect(scoreGain(1)).toBe(8)
    expect(scoreGain(2)).toBe(32)
    expect(scoreGain(3)).toBe(72)
    expect(scoreGain(0)).toBe(0)
  })

  it('得分与统计跨多次消除累加', () => {
    let s = create(2024)
    const r = new Rng(7)
    for (let i = 0; i < 120 && !s.over; i++) s = drop(s, r.int(COLS))
    expect(s.score).toBeGreaterThan(0)
    expect(s.bestClear).toBeGreaterThanOrEqual(COLS)
    expect(s.bestClear).toBeLessThanOrEqual(CELLS)
    expect(s.cleared).toBeGreaterThanOrEqual(s.bestClear)
    expect(s.cleared % COLS).toBe(0)
    expect(s.drops).toBeGreaterThan(0)
  })

  it('bestClear 只记录最高的那一次', () => {
    const g = blank()
    fillRowExcept(g, ROWS - 1, COLS - 1)
    fillRowExcept(g, ROWS - 2, COLS - 1)
    let s = stateOf(g, { bestClear: 40, cleared: 40, score: 999 })
    s = drop(s, COLS - 1) // 只消掉一整行
    expect(s.cleared).toBe(40 + COLS)
    expect(s.bestClear).toBe(40)
    expect(s.score).toBe(999 + scoreGain(1))
  })

  it('单次消除更多时刷新 bestClear', () => {
    const g = blank()
    fillRow(g, ROWS - 1)
    fillRowExcept(g, ROWS - 2, 0)
    const n = drop(stateOf(g, { bestClear: 8 }), 0)
    expect(n.bestClear).toBe(COLS * 2)
  })
})

// ---------------- 悬停 ----------------

describe('悬停', () => {
  it('可落子的列接受悬停，leave 清除', () => {
    const s = create(9)
    const h = reduce(s, { type: 'hover', col: 2 })
    expect(h.hover).toBe(2)
    expect(reduce(h, { type: 'hover', col: 2 })).toBe(h)
    expect(reduce(h, { type: 'leave' }).hover).toBe(-1)
    expect(reduce(s, { type: 'leave' })).toBe(s)
  })

  it('已满的列不接受悬停，越界列也不接受', () => {
    const g = blank()
    fillCol(g, 3, 0, ROWS - 1)
    const s = stateOf(g)
    expect(reduce(s, { type: 'hover', col: 3 })).toBe(s)
    expect(reduce(s, { type: 'hover', col: -1 })).toBe(s)
    expect(reduce(s, { type: 'hover', col: COLS })).toBe(s)
    expect(reduce(s, { type: 'hover', col: 1.5 })).toBe(s)
  })

  it('落子后悬停被清掉', () => {
    const s = reduce(create(4), { type: 'hover', col: 6 })
    expect(drop(s, 1).hover).toBe(-1)
  })
})

// ---------------- 纯函数约束 ----------------

describe('纯函数与动画旁路', () => {
  it('reduce 不修改入参的任何字段', () => {
    let s = create(20260913)
    for (let i = 0; i < 40 && !s.over; i++) s = drop(s, (i * 3) % COLS)
    const snapGrid = s.grid.slice()
    const snap = {
      nextColor: s.nextColor,
      score: s.score,
      bestClear: s.bestClear,
      cleared: s.cleared,
      drops: s.drops,
      over: s.over,
      hover: s.hover,
      lastDrop: s.lastDrop ? { ...s.lastDrop } : null,
      lastClear: s.lastClear ? { rows: s.lastClear.rows.slice(), count: s.lastClear.count } : null,
      seq: s.seq,
      rng: s.rng,
    }
    reduce(s, { type: 'drop', col: 0 })
    reduce(s, { type: 'drop', col: COLS })
    reduce(s, { type: 'hover', col: 1 })
    reduce(s, { type: 'leave' })
    expect(s.grid).toEqual(snapGrid)
    expect(s.nextColor).toBe(snap.nextColor)
    expect(s.score).toBe(snap.score)
    expect(s.bestClear).toBe(snap.bestClear)
    expect(s.cleared).toBe(snap.cleared)
    expect(s.drops).toBe(snap.drops)
    expect(s.over).toBe(snap.over)
    expect(s.hover).toBe(snap.hover)
    expect(s.lastDrop).toEqual(snap.lastDrop)
    expect(s.lastClear).toEqual(snap.lastClear)
    expect(s.seq).toBe(snap.seq)
    expect(s.rng).toBe(snap.rng)
  })

  it('相同输入两次调用结果完全相等', () => {
    let s = create(4242)
    for (let i = 0; i < 12 && !s.over; i++) s = drop(s, i % COLS)
    const a = reduce(s, { type: 'drop', col: 5 })
    const b = reduce(s, { type: 'drop', col: 5 })
    expect(a).toEqual(b)
    expect(a.grid).not.toBe(s.grid)
    expect(reduce(s, { type: 'hover', col: 2 })).toEqual(reduce(s, { type: 'hover', col: 2 }))
  })

  it('state 里不含任何计时/动画字段', () => {
    const s = drop(create(8), 1)
    for (const k of Object.keys(s)) {
      expect(k).not.toMatch(/time|clock|stamp|at$|dur|anim|elapsed|tick/i)
    }
    expect(Object.keys(s.lastDrop ?? {}).sort()).toEqual(['col', 'row'])
    if (s.lastClear) expect(Object.keys(s.lastClear).sort()).toEqual(['count', 'rows'])
  })

  it('动画签名只用 seq，不含时间：同一状态重复读取结果一致', () => {
    const s = drop(create(3), 1)
    expect(String(s.seq)).toBe(String(drop(create(3), 1).seq))
  })
})

// ---------------- 随机多局模拟 ----------------

describe('随机模拟', () => {
  it('200 局随机落子不会崩溃，且一定会分出胜负', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = new Rng(seed * 7919)
      let s = create(seed * 7919)
      let steps = 0
      while (!s.over && steps < 600) {
        s = drop(s, r.int(COLS))
        steps++
      }
      expect(s.over).toBe(true)
      expect(s.grid.length).toBe(CELLS)
      expect(s.score).toBeGreaterThanOrEqual(0)
      expect(s.drops).toBeGreaterThan(0)
    }
  })

  it('模拟过程中网格不变量始终成立', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = new Rng(seed)
      let s = create(seed)
      while (!s.over) {
        expectNoHole(s.grid)
        const col = r.int(COLS)
        const row = landingRow(s.grid, col)
        s = drop(s, col)
        expect(s.grid.length).toBe(CELLS)
        if (row < 0) {
          expect(s.over).toBe(true)
          break
        }
        expectNoHole(s.grid)
        expectNoFullRow(s.grid)
      }
    }
  })

  it('只往同一列堆球时必定堆到顶结束', () => {
    let s = create(1)
    for (let i = 0; i < ROWS && !s.over; i++) s = drop(s, 2)
    expect(s.over).toBe(true)
    expect(s.drops).toBe(ROWS)
  })
})