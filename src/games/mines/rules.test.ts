import { describe, expect, it } from 'vitest'
import game, { meta } from './index'
import {
  CELL_COUNT,
  COLS,
  DEFAULT_MINE_COUNT,
  MINE_OPTIONS,
  ROWS,
  cellCol,
  cellIndex,
  cellRow,
  create,
  formatMultiple,
  liveMultiple,
  mineProbability,
  netMultiple,
  payoutFor,
  reduce,
  safeCount,
} from './rules'
import type { Action, State } from './rules'

/** 深冻结：freeze 之后若 reduce 试图改入参会直接抛错 */
function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const k of Object.keys(v as Record<string, unknown>)) {
      deepFreeze((v as Record<string, unknown>)[k])
    }
  }
  return v
}

function start(seed: number, count: number = DEFAULT_MINE_COUNT): State {
  let s = create(seed)
  if (count !== DEFAULT_MINE_COUNT) s = reduce(s, { type: 'setMineCount', count })
  return reduce(s, { type: 'start' })
}

function reveal(s: State, index: number): State {
  return reduce(s, { type: 'reveal', col: cellCol(index), row: cellRow(index) })
}

/** 按格序返回全部安全格 */
function safeCells(s: State): number[] {
  const out: number[] = []
  for (let i = 0; i < CELL_COUNT; i++) if (!s.mines.includes(i)) out.push(i)
  return out
}

function firstMine(s: State): number {
  return s.mines[0]
}

/** 终局成绩：断言非空后返回，便于直接喂给 coins() */
function outcomeOf(s: State) {
  const o = game.outcome!(s)
  if (!o) throw new Error('预期已结束的对局才有成绩')
  return o
}

describe('扫雷赌局 meta', () => {
  it('meta 同时具名导出与默认导出，且 id 等于目录名', () => {
    expect(meta.id).toBe('mines')
    expect(meta.viewport).toEqual({ width: 720, height: 1280 })
    expect(game.id).toBe('mines')
    expect(meta.name).toBe('扫雷赌局')
  })
})

describe('扫雷赌局 状态', () => {
  it('create 产出 setup 阶段：没有雷、没有翻牌、收益为 0', () => {
    const s = create(1)
    expect(s.phase).toBe('setup')
    expect(s.mines).toEqual([])
    expect(s.opened).toEqual([])
    expect(s.hit).toBe(-1)
    expect(s.cleared).toBe(false)
    expect(netMultiple(s)).toBe(0)
    expect(liveMultiple(s)).toBe(0)
  })

  it('create 是纯函数：同种子两次调用完全一致', () => {
    expect(create(2024)).toEqual(create(2024))
    expect(JSON.stringify(create(7))).toBe(JSON.stringify(create(7)))
  })

  it('选雷数只接受 3 / 5 / 10，非法值原样返回', () => {
    const s = create(3)
    for (const n of [3, 5, 10]) expect(reduce(s, { type: 'setMineCount', count: n }).mineCount).toBe(n)
    for (const bad of [0, 1, 4, 7, 11, 25, -3, 2.5]) {
      const after = reduce(s, { type: 'setMineCount', count: bad })
      expect(after).toBe(s)
      expect(after.mineCount).toBe(DEFAULT_MINE_COUNT)
    }
    expect(MINE_OPTIONS).toEqual([3, 5, 10])
  })

  it('开局后不能再改雷数', () => {
    const s = start(11, 3)
    expect(reduce(s, { type: 'setMineCount', count: 10 })).toBe(s)
    expect(s.mineCount).toBe(3)
  })

  it('开局埋雷数量固定、互不重复、且落在 0..24', () => {
    for (const n of MINE_OPTIONS) {
      for (const seed of [1, 2, 3, 99, 12345]) {
        const s = start(seed, n)
        expect(s.mines).toHaveLength(n)
        expect(new Set(s.mines).size).toBe(n)
        for (const m of s.mines) {
          expect(Number.isInteger(m)).toBe(true)
          expect(m).toBeGreaterThanOrEqual(0)
          expect(m).toBeLessThan(CELL_COUNT)
        }
      }
    }
  })

  it('同种子雷位完全一致', () => {
    for (const seed of [42, 777, 20260916]) {
      expect(start(seed, 5).mines).toEqual(start(seed, 5).mines)
      expect(start(seed, 3).mines).toEqual(start(seed, 3).mines)
      expect(start(seed, 10).mines).toEqual(start(seed, 10).mines)
    }
  })

  it('翻牌过程不重新洗雷位', () => {
    const s0 = start(555, 5)
    const snapshot = s0.mines.slice()
    let s = s0
    for (const cell of safeCells(s0).slice(0, 10)) s = reveal(s, cell)
    expect(s.mines).toEqual(snapshot)
    expect(s.opened).toHaveLength(10)
    // 再翻到终局，雷位依旧不变
    for (const cell of safeCells(s0)) s = reveal(s, cell)
    expect(s.mines).toEqual(snapshot)
    expect(s.phase).toBe('done')
  })
})

describe('扫雷赌局 翻牌', () => {
  it('翻开安全格后仍在进行中，并累积更高倍数', () => {
    const s0 = start(9, 3)
    const cell = safeCells(s0)[0]
    const s = reveal(s0, cell)
    expect(s.phase).toBe('playing')
    expect(s.opened).toEqual([cell])
    expect(liveMultiple(s)).toBe(payoutFor(3, 1))
    expect(liveMultiple(s)).toBeGreaterThan(0)
  })

  it('踩雷立刻结束：终局、标记正确、收益归零', () => {
    const s0 = start(31, 5)
    const s = reveal(s0, firstMine(s0))
    expect(s.phase).toBe('done')
    expect(s.hit).toBe(s0.mines[0])
    expect(s.cleared).toBe(false)
    expect(netMultiple(s)).toBe(-1)
    expect(s.rounds).toBe(1)
  })

  it('安全格全部翻完 = 通关，领取累积收益', () => {
    for (const n of MINE_OPTIONS) {
      const s0 = start(64, n)
      let s = s0
      for (const cell of safeCells(s0)) s = reveal(s, cell)
      expect(s.phase).toBe('done')
      expect(s.cleared).toBe(true)
      expect(s.hit).toBe(-1)
      expect(s.opened).toHaveLength(safeCount(n))
      expect(netMultiple(s)).toBe(payoutFor(n, safeCount(n)))
      expect(s.best).toBe(payoutFor(n, safeCount(n)))
    }
  })

  it('踩雷后继续翻格不会改变终局', () => {
    const s0 = start(88, 5)
    const hit = reveal(s0, firstMine(s0))
    const other = safeCells(s0)[0]
    expect(reveal(hit, other)).toBe(hit)
  })

  it('通关后不能再翻格', () => {
    const s0 = start(88, 3)
    let s = s0
    for (const cell of safeCells(s0)) s = reveal(s, cell)
    expect(reduce(s, { type: 'reveal', col: 0, row: 0 })).toBe(s)
  })

  it('游戏必有明确终局：一路翻下去最多 25 步必定结束', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s0 = start(seed, 10)
      let s = s0
      let steps = 0
      while (s.phase === 'playing' && steps <= CELL_COUNT) {
        const next = safeCells(s).find((c) => !s.opened.includes(c))
        if (next === undefined) break
        s = reveal(s, next)
        steps++
      }
      expect(s.phase).toBe('done')
      expect(s.cleared || s.hit >= 0).toBe(true)
    }
  })
})

describe('扫雷赌局 收益', () => {
  it('收益倍数随翻开格数严格单调递增（三档雷数都成立）', () => {
    for (const n of MINE_OPTIONS) {
      let prev = payoutFor(n, 0)
      for (let k = 1; k <= safeCount(n); k++) {
        const cur = payoutFor(n, k)
        expect(cur).toBeGreaterThan(prev)
        prev = cur
      }
    }
  })

  it('未翻格收益为 0，翻格数超出安全格数时按表尾计', () => {
    expect(payoutFor(5, 0)).toBe(0)
    expect(payoutFor(5, 21)).toBe(payoutFor(5, 20))
    expect(payoutFor(5, 99)).toBe(payoutFor(5, 20))
  })

  it('同一局内收益随翻牌实时递增', () => {
    const s0 = start(2024, 5)
    let s = s0
    let prev = liveMultiple(s)
    for (const cell of safeCells(s0).slice(0, 12)) {
      s = reveal(s, cell)
      expect(liveMultiple(s)).toBeGreaterThan(prev)
      prev = liveMultiple(s)
    }
  })

  it('每格雷概率 = 雷数 / 25', () => {
    expect(mineProbability(3)).toBeCloseTo(3 / 25, 10)
    expect(mineProbability(5)).toBeCloseTo(5 / 25, 10)
    expect(mineProbability(10)).toBeCloseTo(10 / 25, 10)
  })

  it('3000 个种子下每格埋雷频率收敛到 N/25', () => {
    const trials = 3000
    const count = new Array<number>(CELL_COUNT).fill(0)
    for (let seed = 1; seed <= trials; seed++) {
      for (const m of start(seed, 5).mines) count[m]++
    }
    for (let i = 0; i < CELL_COUNT; i++) {
      expect(Math.abs(count[i] / trials - 5 / 25)).toBeLessThan(0.03)
    }
  })

  it('formatMultiple 大额压缩为「万」', () => {
    expect(formatMultiple(1.5)).toBe('1.50')
    expect(formatMultiple(161.35)).toBe('161')
    expect(formatMultiple(31380)).toBe('3.1万')
  })
})

describe('扫雷赌局 非法输入', () => {
  it('越界坐标不改状态', () => {
    const s = start(13, 5)
    const bad: Action[] = [
      { type: 'reveal', col: -1, row: 0 },
      { type: 'reveal', col: COLS, row: 0 },
      { type: 'reveal', col: 0, row: -1 },
      { type: 'reveal', col: 0, row: ROWS },
      { type: 'reveal', col: 2.5, row: 1 },
      { type: 'reveal', col: Number.NaN, row: 0 },
    ]
    for (const a of bad) expect(reduce(s, a)).toBe(s)
    expect(cellIndex(-1, 0)).toBeNull()
    expect(cellIndex(COLS, 0)).toBeNull()
    expect(cellIndex(0, ROWS)).toBeNull()
    expect(cellIndex(1.5, 2)).toBeNull()
    expect(cellIndex(4, 4)).toBe(24)
  })

  it('非法动作不改状态', () => {
    const setup = create(5)
    expect(reduce(setup, { type: 'reveal', col: 0, row: 0 })).toBe(setup)
    expect(reduce(setup, { type: 'start' }).phase).toBe('playing')

    const playing = start(5, 5)
    const opened = safeCells(playing)[0]
    const after = reveal(playing, opened)
    expect(reduce(after, { type: 'reveal', col: cellCol(opened), row: cellRow(opened) })).toBe(after)
    expect(reduce(playing, { type: 'start' })).toBe(playing)
    expect(reduce(setup, { type: 'bogus' } as unknown as Action)).toBe(setup)
  })

  it('reduce 不修改入参（深冻结后可安全推进）', () => {
    const s0 = deepFreeze(start(314, 5))
    const before = JSON.stringify(s0)
    let s = s0
    const cells = safeCells(s0)
    s = reveal(s, cells[0])
    s = reveal(s, cells[1])
    s = reveal(s, firstMine(s0))
    expect(s.phase).toBe('done')
    expect(JSON.stringify(s0)).toBe(before)
    expect(Object.isFrozen(s0.opened)).toBe(true)
    expect(Object.isFrozen(s0.mines)).toBe(true)
  })
})

describe('扫雷赌局 结算', () => {
  it('outcome：未结束为 null，结束后结构正确', () => {
    const s0 = start(404, 3)
    expect(game.outcome!(s0)).toBeNull()
    let s = s0
    for (const cell of safeCells(s0)) s = reveal(s, cell)
    expect(game.outcome!(s)).toEqual({
      score: payoutFor(3, safeCount(3)),
      better: 'higher',
      unit: '金币',
      win: true,
    })
    const lost = reveal(start(404, 3), firstMine(start(404, 3)))
    expect(game.outcome!(lost)).toEqual({ score: -1, better: 'higher', unit: '金币', win: false })
  })

  it('coins 按注额倍数换算：通关随注额等比缩放', () => {
    const s0 = start(515, 3)
    let s = s0
    for (const cell of safeCells(s0)) s = reveal(s, cell)
    const o = outcomeOf(s)
    const mult = netMultiple(s)
    expect(mult).toBe(payoutFor(3, safeCount(3)))
    for (const bet of [1, 5, 10, 100, 7]) {
      expect(game.coins!(s, o, bet)).toBe(Math.round(mult * bet))
      // 等比缩放：相对误差仅来自四舍五入
      expect(Math.abs(game.coins!(s, o, bet) / bet / mult - 1)).toBeLessThan(1e-4)
    }
    expect(game.coins!(s, o, 10)).toBe(10 * mult)
  })

  it('coins 对大额倍数仍按注额精确取整', () => {
    const s0 = start(515, 5)
    let s = s0
    for (const cell of safeCells(s0)) s = reveal(s, cell)
    const o = outcomeOf(s)
    const mult = netMultiple(s)
    for (const bet of [1, 10, 100]) expect(game.coins!(s, o, bet)).toBe(Math.round(mult * bet))
  })

  it('coins 踩雷 = 输掉全部注额', () => {
    const s0 = start(616, 10)
    const s = reveal(s0, firstMine(s0))
    const o = outcomeOf(s)
    expect(game.coins!(s, o, 10)).toBe(-10)
    expect(game.coins!(s, o, 100)).toBe(-100)
  })

  it('controls：setup 提供选雷数与开始，进行中禁用开始', () => {
    const setup = create(9)
    const cs = game.controls!(setup)
    expect(cs.map((c) => c.label)).toEqual(['3 雷', '5 雷', '10 雷', '开始'])
    expect(cs.every((c) => !c.disabled)).toBe(true)
    const playing = start(9, 5)
    const cp = game.controls!(playing)
    expect(cp.every((c) => c.disabled)).toBe(true)
    const done = reveal(playing, firstMine(playing))
    expect(game.controls!(done).some((c) => c.label === '再来一局')).toBe(true)
  })

  it('effects：翻牌有反馈，踩雷有失败反馈，通关有胜利反馈', () => {
    const s0 = start(717, 5)
    const cell = safeCells(s0)[0]
    const opened = reveal(s0, cell)
    expect(game.effects!(s0, opened).some((e) => e.kind === 'sound' && e.name === 'flip')).toBe(true)
    const lost = reveal(opened, firstMine(s0))
    const loseFx = game.effects!(opened, lost)
    expect(loseFx.some((e) => e.kind === 'sound' && e.name === 'lose')).toBe(true)
    expect(loseFx.some((e) => e.kind === 'shake')).toBe(true)

    const s1 = start(717, 3)
    const safe = safeCells(s1)
    let mid = s1
    for (const c of safe.slice(0, -1)) mid = reveal(mid, c)
    const win = reveal(mid, safe[safe.length - 1])
    expect(win.cleared).toBe(true)
    expect(game.effects!(mid, win).some((e) => e.kind === 'sound' && e.name === 'win')).toBe(true)
  })

  it('可从终局再来一局：雷位重埋、计数累加', () => {
    const s0 = start(808, 5)
    const lost = reveal(s0, firstMine(s0))
    const next = reduce(lost, { type: 'start' })
    expect(next.phase).toBe('playing')
    expect(next.opened).toEqual([])
    expect(next.hit).toBe(-1)
    expect(next.mines).toHaveLength(5)
    expect(next.rounds).toBe(1)
    expect(next.best).toBe(0)
    const again = reveal(next, firstMine(next))
    expect(again.rounds).toBe(2)
    expect(again.phase).toBe('done')
  })
})
