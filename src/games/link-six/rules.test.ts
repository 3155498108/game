/**
 * 6 连珠规则单测（纯逻辑，node 环境，不触碰 DOM）。
 *
 * 约定：
 * - 随机一律走 core/rng 的 Rng（不使用 Math.random），同 seed 可完整复盘；
 * - 连线守卫覆盖四层：同色、不走空格、不重复走格、几何不自交且不成环
 *   （后两层由 rules.ts 的 pathIsValid 实现，见「连线合法性」describe）。
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng'
import {
  CELL_COUNT,
  COLORS,
  COLS,
  EMPTY,
  MATCH_MIN,
  ROWS,
  SHUFFLE_LIMIT,
  cellOf,
  colOf,
  colorQuota,
  create,
  ensureSolvable,
  hasAnyMove,
  hasAnyMoveIn,
  inBounds,
  neighbors,
  pathIsValid,
  reduce,
  refillFromTop,
  rowOf,
  scoreOf,
  shuffleBoard,
  snapTarget,
  type Action,
  type State,
} from './rules'

// ---------------- 构造与断言工具 ----------------

const clone = (s: State): State => JSON.parse(JSON.stringify(s)) as State

function blank(): number[] {
  return new Array<number>(CELL_COUNT).fill(EMPTY)
}

/** 字符画描述棋盘：'.' / '0' 为空，'1'..'6' 为球色；数组从上到下、每行从左到右 */
function board(rows: string[]): number[] {
  const cells = blank()
  for (let r = 0; r < Math.min(rows.length, ROWS); r++) {
    const line = rows[r].padEnd(COLS, '.')
    for (let c = 0; c < COLS; c++) {
      const ch = line[c]
      cells[cellOf(c, r)] = ch === '.' || ch === '0' ? EMPTY : Number(ch)
    }
  }
  return cells
}

/** 用指定盘面造一个状态，其余字段取固定默认值（保证可复盘） */
function stateOf(cells: readonly number[], extra: Partial<State> = {}): State {
  return {
    ...create(1),
    cells: cells.slice(),
    path: [],
    hoverCell: -1,
    lastCleared: [],
    over: false,
    rng: 20260913,
    ...extra,
  }
}

/** 逐色计数，下标 0 为空位、1..COLORS 为球色 */
function countBy(cells: readonly number[]): number[] {
  const out = new Array<number>(COLORS + 1).fill(0)
  for (const v of cells) out[v]++
  return out
}

/** 盘面取值合法：长度 CELL_COUNT、取值都是 0..COLORS 的整数 */
function expectBallRange(cells: readonly number[]): void {
  expect(cells.length).toBe(CELL_COUNT)
  for (const v of cells) {
    expect(Number.isInteger(v)).toBe(true)
    expect(v).toBeGreaterThanOrEqual(EMPTY)
    expect(v).toBeLessThanOrEqual(COLORS)
  }
}

/**
 * 连线合法性：不同色、不走空格、不重复走格、几何不自交、不成环。
 * 自交与成环由 rules.ts 的 pathIsValid 统一判定。
 */
function expectLegalPath(s: State): void {
  const { path } = s
  expect(new Set(path).size).toBe(path.length)
  if (path.length >= 2) expect(path[0]).not.toBe(path[path.length - 1])
  const color = path.length > 0 ? s.cells[path[0]] : EMPTY
  for (const i of path) {
    expect(inBounds(i)).toBe(true)
    expect(s.cells[i]).toBe(color)
    expect(s.cells[i]).not.toBe(EMPTY)
  }
  expect(pathIsValid(path)).toBe(true)
}

/** 两条单位线段是否在内部交叉（端点相同不算交叉） */
function segmentsCross(a: number, b: number, c: number, d: number): boolean {
  const x1 = colOf(a)
  const y1 = rowOf(a)
  const x2 = colOf(b)
  const y2 = rowOf(b)
  const x3 = colOf(c)
  const y3 = rowOf(c)
  const x4 = colOf(d)
  const y4 = rowOf(d)
  const d1 = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1)
  const d2 = (x2 - x1) * (y4 - y1) - (y2 - y1) * (x4 - x1)
  const d3 = (x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)
  const d4 = (x4 - x3) * (y2 - y3) - (y4 - y3) * (x2 - x3)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** 把 path 里的球逐个往外「再点一次」：任何一个都不该被重新选中 */
function expectNoCellReselectable(s: State): void {
  for (const used of s.path) {
    for (const pointer of neighbors(used)) {
      expect(snapTarget(s, pointer)).not.toBe(used)
    }
  }
}

/**
 * 保证死盘：按「行奇偶 × 列奇偶」把格子分成 4 类，类内任意两格都不八邻接；
 * 再把其中两类各拆成两色。于是每种颜色的球两两不相邻，必不存在 4 连块。
 */
function deadCheckerboard(): number[] {
  const cells = blank()
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const even = (r % 2) * 2 + (c % 2) // 0..3
      let color: number
      if (even === 0) color = (r + c) % 4 === 0 ? 1 : 2
      else if (even === 1) color = 3
      else if (even === 2) color = 4
      else color = (r + c) % 4 === 2 ? 5 : 6
      cells[cellOf(c, r)] = color
    }
  }
  return cells
}

/** 每色只有 MATCH_MIN-1 = 3 个球：无论怎么重排都不可能有 4 连块 */
function hopelessBoard(): number[] {
  const cells = blank()
  for (let c = 0; c < COLORS; c++) {
    for (let t = 0; t < MATCH_MIN - 1; t++) cells[cellOf(c, t * 3)] = c + 1
  }
  return cells
}

/** 上方两行各摆 4 个 1 色球，其余全 2 色：可连续消两次，用来验证 combo */
function twoRowsOfFour(): number[] {
  return board([
    '1111...',
    '2222222',
    '1111...',
    '2222222',
    '2222222',
    '2222222',
    '2222222',
    '2222222',
    '2222222',
  ])
}

/** 把某些格子刷成 1 色、其余刷成 2 色的满盘 */
function solidWith(ones: readonly number[]): number[] {
  const cells = blank().fill(2)
  for (const i of ones) cells[i] = 1
  return cells
}

/** 依次执行 down + 若干 move */
function drag(s: State, pointers: readonly number[]): State {
  let cur = reduce(s, { type: 'down', cell: pointers[0] })
  for (let k = 1; k < pointers.length; k++) cur = reduce(cur, { type: 'move', cell: pointers[k] })
  return cur
}

/**
 * 依次把指定的几颗球接进路径。
 * 吸附取的是「指针格八邻域内第一颗同色线外球」，所以指针格不必、也常常不是那颗球本身；
 * 这里为每颗目标球自动找一个能把它吸附进来的指针格。
 */
function connect(s: State, balls: readonly number[]): State {
  let cur = reduce(s, { type: 'down', cell: balls[0] })
  expect(cur.path).toEqual([balls[0]])
  for (let k = 1; k < balls.length; k++) {
    let pointer = -1
    for (let p = 0; p < CELL_COUNT; p++) {
      const n = reduce(cur, { type: 'move', cell: p })
      if (n.path.length === k + 1 && n.path[k] === balls[k]) {
        pointer = p
        break
      }
    }
    expect(pointer).toBeGreaterThanOrEqual(0) // 该球必须能被吸附进来
    cur = reduce(cur, { type: 'move', cell: pointer })
  }
  return cur
}

// ---------------- 网格与索引工具 ----------------

describe('网格尺寸与索引工具', () => {
  it('常量与规格一致：7 列 × 9 行 = 63 格、6 色、4 连消、空格 0、洗牌上限 12', () => {
    expect(COLS).toBe(7)
    expect(ROWS).toBe(9)
    expect(CELL_COUNT).toBe(63)
    expect(COLORS).toBe(6)
    expect(MATCH_MIN).toBe(4)
    expect(EMPTY).toBe(0)
    expect(SHUFFLE_LIMIT).toBe(12)
  })

  it('cellOf / colOf / rowOf 互为逆映射，覆盖全部 63 格', () => {
    for (let i = 0; i < CELL_COUNT; i++) {
      expect(cellOf(colOf(i), rowOf(i))).toBe(i)
      expect(rowOf(i)).toBeGreaterThanOrEqual(0)
      expect(rowOf(i)).toBeLessThan(ROWS)
      expect(colOf(i)).toBeGreaterThanOrEqual(0)
      expect(colOf(i)).toBeLessThan(COLS)
    }
    expect(cellOf(0, 0)).toBe(0)
    expect(cellOf(COLS - 1, 0)).toBe(COLS - 1)
    expect(cellOf(0, ROWS - 1)).toBe(COLS * (ROWS - 1))
  })

  it('inBounds 排除负数、越界、小数与 NaN', () => {
    expect(inBounds(0)).toBe(true)
    expect(inBounds(CELL_COUNT - 1)).toBe(true)
    for (const bad of [-1, CELL_COUNT, 999, 1.5, NaN, Infinity, -Infinity]) {
      expect(inBounds(bad)).toBe(false)
    }
  })

  it('neighbors 是八邻域：内部 8 个、边 5 个、角落 3 个', () => {
    // 注意：rules.ts 用的是八邻域（斜边也吸），不是四邻域
    expect(neighbors(cellOf(0, 0)).length).toBe(3)
    expect(neighbors(cellOf(COLS - 1, 0)).length).toBe(3)
    expect(neighbors(cellOf(0, ROWS - 1)).length).toBe(3)
    expect(neighbors(cellOf(COLS - 1, ROWS - 1)).length).toBe(3)
    expect(neighbors(cellOf(3, 0)).length).toBe(5)
    expect(neighbors(cellOf(0, 4)).length).toBe(5)
    expect(neighbors(cellOf(COLS - 1, 4)).length).toBe(5)
    expect(neighbors(cellOf(3, ROWS - 1)).length).toBe(5)
    expect(neighbors(cellOf(3, 3)).length).toBe(8)
    expect(neighbors(cellOf(1, 4)).length).toBe(8)
  })

  it('全盘邻接度分布：4 个角 3 邻、24 个边 5 邻、35 个内部 8 邻', () => {
    const degree = new Map<number, number>()
    for (let i = 0; i < CELL_COUNT; i++) degree.set(neighbors(i).length, (degree.get(neighbors(i).length) ?? 0) + 1)
    expect(degree.get(3)).toBe(4)
    expect(degree.get(5)).toBe(24)
    expect(degree.get(8)).toBe(35)
    expect([...degree.keys()].sort()).toEqual([3, 5, 8])
  })

  it('neighbors 顺序固定（保证吸附可复盘），且不含自己、不重复、对称', () => {
    expect(neighbors(cellOf(3, 3))).toEqual([
      cellOf(2, 2),
      cellOf(3, 2),
      cellOf(4, 2),
      cellOf(2, 3),
      cellOf(4, 3),
      cellOf(2, 4),
      cellOf(3, 4),
      cellOf(4, 4),
    ])
    expect(neighbors(cellOf(0, 0))).toEqual([cellOf(1, 0), cellOf(0, 1), cellOf(1, 1)])
    for (let i = 0; i < CELL_COUNT; i++) {
      const ns = neighbors(i)
      expect(ns).toEqual(neighbors(i)) // 纯函数、顺序稳定
      expect(ns).not.toContain(i)
      expect(new Set(ns).size).toBe(ns.length)
      for (const n of ns) {
        expect(inBounds(n)).toBe(true)
        expect(neighbors(n)).toContain(i) // 对称
      }
    }
  })
})

// ---------------- 配额与开局 ----------------

describe('colorQuota 与开局', () => {
  it('配额总和恰好等于 CELL_COUNT，且前 3 色各 11、后 3 色各 10', () => {
    const q = colorQuota()
    expect(q.length).toBe(COLORS)
    expect(q).toEqual([11, 11, 11, 10, 10, 10])
    expect(q.reduce((a, b) => a + b, 0)).toBe(CELL_COUNT)
  })

  it('每种颜色的球数都够凑出一次消除（≥ MATCH_MIN）', () => {
    expect(colorQuota().every((v) => v >= MATCH_MIN)).toBe(true)
  })

  it('colorQuota 每次调用都返回内容相同的新数组', () => {
    expect(colorQuota()).toEqual(colorQuota())
    expect(colorQuota()).not.toBe(colorQuota())
  })

  it('create 对同一 seed 完全一致（可复盘）', () => {
    for (const seed of [1, 42, 999, -12345, 20260913]) expect(create(seed)).toEqual(create(seed))
  })

  it('create 铺满 63 格、无空位，逐色计数严格等于配额', () => {
    const quota = colorQuota()
    for (const seed of [1, 7, 20260913]) {
      const s = create(seed)
      expectBallRange(s.cells)
      expect(s.cells.every((v) => v !== EMPTY)).toBe(true)
      const byColor = countBy(s.cells)
      expect(byColor[EMPTY]).toBe(0)
      for (let c = 0; c < COLORS; c++) expect(byColor[c + 1]).toBe(quota[c])
    }
  })

  it('create 其余字段全部归零，rng 是已推进的整数', () => {
    const s = create(5)
    expect(s.path).toEqual([])
    expect(s.hoverCell).toBe(-1)
    expect(s.lastCleared).toEqual([])
    expect(s.clears).toBe(0)
    expect(s.combo).toBe(0)
    expect(s.bestCombo).toBe(0)
    expect(s.score).toBe(0)
    expect(s.shuffles).toBe(0)
    expect(s.shuffleTries).toBe(0)
    expect(s.over).toBe(false)
    expect(Number.isInteger(s.rng)).toBe(true)
  })

  it('开局盘面直接就存在可消除的连线（无需先洗牌）', () => {
    for (let seed = 1; seed <= 80; seed++) expect(hasAnyMove(create(seed))).toBe(true)
  })

  it('不同 seed 会给出不同盘面（种子确实生效）', () => {
    const boards = new Set<string>()
    for (let seed = 1; seed <= 60; seed++) boards.add(create(seed).cells.join(''))
    expect(boards.size).toBeGreaterThan(50)
  })
})

// ---------------- 连线合法性：每条约束各一个独立用例 ----------------

describe('连线合法性', () => {
  it('自交被拒：指针同时挨着两个「已在线上」的球时，一个都不能再选中，路径原样保留', () => {
    // 0=(0,0) 1=(1,0) 2=(2,0) 三个 1 色球已成线；8=(1,1) 是它们共同邻格但本身 2 色
    const s = stateOf(solidWith([0, 1, 2]), { path: [0, 1, 2], hoverCell: 2 })
    expect(snapTarget(s, cellOf(1, 1))).toBe(-1)
    const n = reduce(s, { type: 'move', cell: cellOf(1, 1) })
    expect(n.path).toEqual([0, 1, 2])
    expect(n.hoverCell).toBe(cellOf(1, 1))
    expectLegalPath(n)
  })

  it('成环被拒：想把线首尾相接闭合，起点已在路径中，无法被重新选中', () => {
    // 0=(0,0)、7=(0,1)、8=(1,1) 三个 1 色球已成线，8 与起点 0 相邻（几何上已经能闭环）
    const path = [0, cellOf(0, 1), cellOf(1, 1)]
    const s = stateOf(solidWith(path), { path, hoverCell: path[path.length - 1] })
    expect(neighbors(0)).toContain(path[path.length - 1])
    // 指针落在起点 0 上：邻域内三颗 1 色球都已在线上，接不回起点
    expect(snapTarget(s, 0)).toBe(-1)
    // 指针落在中间的球上：同样接不到新的球
    expect(snapTarget(s, cellOf(1, 0))).toBe(-1)
    const n = reduce(s, { type: 'move', cell: 0 })
    expect(n.path).toEqual(path)
    expectNoCellReselectable(s)
  })

  it('重复走格被拒：线上任意一颗球都不能被再次选中', () => {
    const path = [0, cellOf(0, 1), cellOf(1, 1)] // 0 → 7 → 8，全 1 色
    const s = stateOf(solidWith(path), { path, hoverCell: path[path.length - 1] })
    expectNoCellReselectable(s)
    // 指针落在中间那颗球的邻域里，也只会拿到线外的球（这里是 0 色以外 → 没有）
    expect(snapTarget(s, cellOf(1, 0))).toBe(-1)
    const n = reduce(s, { type: 'move', cell: cellOf(1, 0) })
    expect(n.path).toEqual(path)
  })

  it('长度不足 4 被拒：松手不消除、不断盘，只丢掉路径并清掉连击', () => {
    const prevCleared = [3, 4]
    const s = stateOf(solidWith([0, 1, 2]), {
      path: [0, 1, 2],
      combo: 3,
      bestCombo: 3,
      score: 100,
      lastCleared: prevCleared,
      rng: 77,
    })
    const n = reduce(s, { type: 'up' })
    expect(n.path).toEqual([])
    expect(n.combo).toBe(0)
    expect(n.clears).toBe(0)
    expect(n.score).toBe(100)
    expect(n.cells).toBe(s.cells)
    // 上一帧的消除特效也要一并清掉，否则放弃连线后特效会残留一拍
    expect(n.lastCleared).toEqual([])
  })

  it('几何自交被拒：两条斜边构成 2×2 对角线的折线连不出来', () => {
    // 2×2 全 1 色块：1=(1,0) 8=(1,1) 9=(2,1) 2=(2,0)
    // 完整折线 1→9→2→8 中，段(1,0)→(2,1) 与段(2,0)→(1,1) 是同一个 2×2 方块的
    // 两条对角线，在方块正中相交但四个端点互不相同 ——「同格不重入」拦不住它。
    const ones = [cellOf(1, 0), cellOf(2, 0), cellOf(1, 1), cellOf(2, 1)]
    // 指针序列：先连到 9，再想从 9 连到 2（竖直向下，不相交），最后想从 2 连到 8
    const s = drag(stateOf(solidWith(ones)), [cellOf(1, 0), cellOf(3, 2), cellOf(3, 1), cellOf(2, 2)])
    // 最后那颗 8 因与首段交叉而接不上，折线停在长度 3
    expect(s.path).toEqual([cellOf(1, 0), cellOf(2, 1), cellOf(2, 0)])
    expect(s.path).not.toContain(cellOf(1, 1))
    expect(s.path.length).toBeLessThan(MATCH_MIN)
    // 证明这确实是真实交叉，而不是实现随便截断了
    const full = [cellOf(1, 0), cellOf(2, 1), cellOf(2, 0), cellOf(1, 1)]
    expect(segmentsCross(full[0], full[1], full[2], full[3])).toBe(true)
    // 而前 3 段本身必须合法，说明拦的是「交叉」而不是「斜线」
    expect(pathIsValid(s.path)).toBe(true)
  })

  it('成环被拒：连满 4 球后再绕回起点旁的那一球接不上', () => {
    // 2×3 全 1 色块。连到第 4 球时路径合法；第 5 球若与起点相邻即闭合成环。
    const ones = [0, cellOf(1, 0), cellOf(2, 0), cellOf(0, 1), cellOf(1, 1), cellOf(2, 1)]
    const s = drag(stateOf(solidWith(ones)), [
      0,
      cellOf(0, 2), // 吸附 (0,1)
      cellOf(1, 2), // 吸附 (1,1)
      cellOf(2, 2), // 吸附 (2,1) —— 此刻 4 连，合法
    ])
    expect(s.path).toEqual([0, cellOf(0, 1), cellOf(1, 1), cellOf(2, 1)])
    expect(s.path.length).toBe(MATCH_MIN)

    // 再把指针移回起点所在格：会尝试吸附 (1,0) 或 (2,0)，两者都与起点 0 相邻 → 成环
    const after = reduce(s, { type: 'move', cell: 0 })
    expect(after.path).toEqual(s.path)
    // 该状态确实构成过一条合法 4 连，松手应当消除
    expect(pathIsValid(after.path)).toBe(true)
    expect(reduce(after, { type: 'up' }).clears).toBe(1)
  })

  it('成环判定只拦「够消除的闭环」，2~3 球绕回起点旁仍可连', () => {
    // 3 球路径的末球与起点相邻并非闭环，L 形折线必须照常能连出来
    const path = [cellOf(0, 0), cellOf(1, 0), cellOf(1, 1)]
    expect(neighbors(path[0])).toContain(path[2]) // 末球确实挨着起点
    expect(pathIsValid(path)).toBe(true) // 但只有 3 球，不构成闭环
    // 再加一球：若第 4 球也挨着起点就会成环
    expect(pathIsValid(path.concat(cellOf(0, 1)))).toBe(false)
    // 换一颗不挨起点的第 4 球（2,1) 与起点 (0,0) 八邻域不邻接 → 仍合法
    expect(pathIsValid(path.concat(cellOf(2, 1)))).toBe(true)
  })
})

// ---------------- 补球 ----------------

describe('refillFromTop', () => {
  it('补球后空格全部补齐、盘面恢复满格、球色落在 1..COLORS', () => {
    const cells = board(['1111...', '2222222', '1111...', '.......', '2222.22'])
    const before = cells.slice()
    const r = new Rng(7)
    const out = refillFromTop(cells, r)
    expectBallRange(out)
    expect(out.every((v) => v !== EMPTY)).toBe(true)
    expect(out).not.toBe(cells)
    expect(cells).toEqual(before) // 入参不被修改
  })

  it('只写空格，已有球一格不动：新球数量恰好等于空位数量', () => {
    const cells = board(['1111...', '2222222', '1111...', '.......', '2222.22'])
    const emptyBefore = cells.filter((v) => v === EMPTY).length
    const out = refillFromTop(cells, new Rng(7))
    for (let i = 0; i < CELL_COUNT; i++) if (cells[i] !== EMPTY) expect(out[i]).toBe(cells[i])
    expect(emptyBefore).toBeGreaterThan(0)
    expect(out.filter((v) => v !== EMPTY).length - (CELL_COUNT - emptyBefore)).toBe(emptyBefore)
  })

  it('空盘补球 = 从头铺满一整盘', () => {
    const out = refillFromTop(blank(), new Rng(3))
    expect(out.length).toBe(CELL_COUNT)
    expect(out.every((v) => v >= 1 && v <= COLORS)).toBe(true)
    expectBallRange(out)
  })

  it('同一 rng 状态补出同一结果（可复盘）', () => {
    const cells = board(['.......', '1111...', '.......', '2222.22'])
    expect(refillFromTop(cells, new Rng(11))).toEqual(refillFromTop(cells, new Rng(11)))
  })

  it('随机多组：补球只动空位，补出来的球不改变任何已有球的颜色', () => {
    const r = new Rng(20260913)
    for (let t = 0; t < 40; t++) {
      const cells = board(['.......', '2222.22', '.111111', '.......', '2.2222.'])
      const before = cells.slice()
      const out = refillFromTop(cells, r)
      expectBallRange(out)
      for (let i = 0; i < CELL_COUNT; i++) if (before[i] !== EMPTY) expect(out[i]).toBe(before[i])
    }
  })
})

// ---------------- 有无解判定 ----------------

describe('hasAnyMoveIn / hasAnyMove', () => {
  it('空盘为 false', () => {
    expect(hasAnyMoveIn(blank())).toBe(false)
    expect(hasAnyMove(stateOf(blank()))).toBe(false)
  })

  it('只有一个孤立球时为 false', () => {
    const cells = blank()
    cells[cellOf(3, 4)] = 1
    expect(hasAnyMoveIn(cells)).toBe(false)
  })

  it('每色各 3 个球（怎么重排都凑不出 4 连）时为 false', () => {
    expect(hasAnyMoveIn(hopelessBoard())).toBe(false)
  })

  it('3 连为 false，4 连为 true（横 / 竖 / 斜都算）', () => {
    expect(hasAnyMoveIn(board(['111....', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......']))).toBe(false)
    expect(hasAnyMoveIn(board(['1111...', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......']))).toBe(true)
    const vertical = blank()
    for (let r = 0; r < MATCH_MIN; r++) vertical[cellOf(2, r)] = 5
    expect(hasAnyMoveIn(vertical)).toBe(true)
    const vertical3 = blank()
    for (let r = 0; r < MATCH_MIN - 1; r++) vertical3[cellOf(2, r)] = 5
    expect(hasAnyMoveIn(vertical3)).toBe(false)
    const diagonal = board(['1......', '.1.....', '..1....', '...1...', '.......', '.......', '.......', '.......', '.......'])
    expect(hasAnyMoveIn(diagonal)).toBe(true) // 斜线也是八邻域
  })

  it('不同色挨在一起不算一连（每色只有 2 个球）', () => {
    expect(
      hasAnyMoveIn(
        board(['1122...', '.......', '..3344.', '.......', '5.....5', '.......', '.......', '.......', '.......']),
      ),
    ).toBe(false)
  })

  it('常规开局盘面为 true，hasAnyMove 只是 hasAnyMoveIn 的包装', () => {
    const s = create(31415)
    expect(hasAnyMove(s)).toBe(true)
    expect(hasAnyMove(s)).toBe(hasAnyMoveIn(s.cells))
    expect(hasAnyMoveIn(deadCheckerboard())).toBe(false)
  })
})

// ---------------- 洗牌 ----------------

describe('shuffleBoard', () => {
  it('重排后逐色计数完全守恒（含空位数量）', () => {
    for (const seed of [1, 42, 20260913]) {
      const s = create(seed)
      const n = shuffleBoard(s)
      expect(countBy(n.cells)).toEqual(countBy(s.cells))
      expectBallRange(n.cells)
    }
  })

  it('带空位的盘面重排后空位数量也不变', () => {
    const s = stateOf(board(['1111...', '.......', '2222.22']))
    const n = shuffleBoard(s)
    expect(countBy(n.cells)).toEqual(countBy(s.cells))
    expect(n.cells).not.toBe(s.cells)
  })

  it('洗牌计数：shuffles + 1、shuffleTries + 1、清空 lastCleared、推进 rng', () => {
    const s = stateOf(create(9).cells, { lastCleared: [1, 2, 3], shuffles: 4, shuffleTries: 5 })
    const before = clone(s)
    const n = shuffleBoard(s)
    expect(s).toEqual(before) // 入参不被修改
    expect(n.cells).not.toBe(s.cells)
    expect(n.shuffles).toBe(5)
    expect(n.shuffleTries).toBe(6)
    expect(n.lastCleared).toEqual([])
    expect(n.over).toBe(false)
    expect(n.rng).not.toBe(s.rng)
  })

  it('同状态洗牌两次结果一致（可复盘）', () => {
    const s = stateOf(create(123).cells)
    expect(shuffleBoard(s).cells).toEqual(shuffleBoard(s).cells)
  })
})

// ---------------- 无解兜底 ----------------

describe('ensureSolvable', () => {
  it('已经有解且 shuffleTries 为 0 时原样返回（同一引用）', () => {
    const s = stateOf(create(2024).cells)
    expect(hasAnyMove(s)).toBe(true)
    expect(ensureSolvable(s)).toBe(s)
  })

  it('已经有解但 shuffleTries 非 0 时归零，不洗牌', () => {
    const s = stateOf(create(2024).cells, { shuffleTries: 3 })
    const n = ensureSolvable(s)
    expect(n).not.toBe(s)
    expect(n.shuffleTries).toBe(0)
    expect(n.cells).toBe(s.cells)
    expect(n.shuffles).toBe(0) // 只把重试计数归零，并没有真的洗牌
  })

  it('必定死局的盘面被修复成有解，且球色计数守恒', () => {
    const dead = stateOf(deadCheckerboard())
    expect(hasAnyMove(dead)).toBe(false)
    const fixed = ensureSolvable(dead)
    expect(hasAnyMove(fixed)).toBe(true)
    expect(fixed.over).toBe(false)
    expect(fixed.shuffles).toBeGreaterThan(0)
    expect(fixed.shuffles).toBeLessThanOrEqual(SHUFFLE_LIMIT)
    expect(countBy(fixed.cells)).toEqual(countBy(dead.cells))
    expect(dead.shuffles).toBe(0) // 入参不被修改
  })

  it('重洗用尽仍无解则判本局结束（每色只有 3 个球，永远凑不出 4 连）', () => {
    const dead = stateOf(hopelessBoard())
    const n = ensureSolvable(dead)
    expect(n.over).toBe(true)
    expect(n.shuffles).toBe(SHUFFLE_LIMIT)
    expect(n.shuffleTries).toBe(SHUFFLE_LIMIT)
    expect(hasAnyMove(n)).toBe(false)
    expect(countBy(n.cells)).toEqual(countBy(dead.cells))
  })

  it('已经结束的局面不再被修复（同一引用）', () => {
    const done = stateOf(hopelessBoard(), { over: true })
    expect(ensureSolvable(done)).toBe(done)
  })
})

// ---------------- 吸附 ----------------

describe('snapTarget', () => {
  it('空路径返回 -1', () => {
    const s = stateOf(solidWith([0, 1, 2, 3]))
    expect(snapTarget(s, cellOf(1, 0))).toBe(-1)
    expect(snapTarget(s, -1)).toBe(-1)
  })

  it('路径末球是空格时返回 -1', () => {
    const cells = solidWith([0, 1, 2, 3])
    cells[cellOf(3, 0)] = EMPTY
    const s = stateOf(cells, { path: [cellOf(3, 0)] })
    expect(snapTarget(s, cellOf(2, 0))).toBe(-1)
  })

  it('吸附指针八邻域内、同色且未在线上的球', () => {
    const s = stateOf(solidWith([0, 1, 2]), { path: [0] })
    // 指针落在 (1,1)：邻域里第一颗线外同色球是 (1,0)
    expect(snapTarget(s, cellOf(1, 1))).toBe(cellOf(1, 0))
    // 指针落在球 (1,0) 自己身上：扫过已在线上的 (0,0) 后取到 (2,0)
    expect(snapTarget(s, cellOf(1, 0))).toBe(cellOf(2, 0))
    expect(snapTarget(s, cellOf(5, 5))).toBe(-1) // 邻域内没有同色球
  })

  it('候选球已在线上时被跳过，继续找下一颗；全在线上则返回 -1', () => {
    const path = [0, cellOf(0, 1), cellOf(1, 1)]
    const s = stateOf(solidWith([...path, cellOf(2, 0)]), { path })
    // 指针 cellOf(2,0) 的邻域里，(0,0)/(0,1)/(1,1) 都已在线上，唯一可选的是自己
    expect(snapTarget(s, cellOf(2, 0))).toBe(-1)
    expectNoCellReselectable(s)
  })

  it('指针越界时被吸附到合法落点，绝不返回越界格', () => {
    const s = stateOf(solidWith([0, 1, 2, 3]), { path: [1] }) // 末球 (1,0) 是 1 色
    for (const pointer of [-1, -8, -CELL_COUNT, CELL_COUNT, CELL_COUNT + 1, 999, 2.5, NaN]) {
      const t = snapTarget(s, pointer)
      if (t === -1) continue
      expect(Number.isInteger(t)).toBe(true)
      expect(inBounds(t)).toBe(true)
      expect(s.cells[t]).toBe(s.cells[1])
      expect(s.path.indexOf(t)).toBeLessThan(0)
    }
    expect(snapTarget(s, -1)).toBe(cellOf(0, 0)) // 界外指针的邻域落到合法格 (0,0)
    expect(snapTarget(s, -8)).toBe(-1) // 邻域完全在界外
    expect(snapTarget(s, CELL_COUNT)).toBe(-1) // 邻域里有球，但不是同色
    expect(snapTarget(s, 999)).toBe(-1)
    expect(snapTarget(s, 2.5)).toBe(-1)
    expect(snapTarget(s, NaN)).toBe(-1)
    // 换个盘面：界外指针的邻域里正好有线外同色球时，落到的是合法格
    const bottom = stateOf(solidWith([cellOf(3, ROWS - 1), cellOf(4, ROWS - 1)]), {
      path: [cellOf(3, ROWS - 1)],
    })
    expect(snapTarget(bottom, CELL_COUNT)).toBe(-1)
    expect(snapTarget(bottom, CELL_COUNT + 3)).toBe(cellOf(4, ROWS - 1))
  })
})

// ---------------- 计分 ----------------

describe('scoreOf', () => {
  it('4 / 5 / 6 连的基础分 = count² × 5', () => {
    expect(scoreOf(MATCH_MIN, 1)).toBe(80)
    expect(scoreOf(5, 1)).toBe(125)
    expect(scoreOf(6, 1)).toBe(180)
    expect(scoreOf(10, 1)).toBe(500)
  })

  it('combo 加成单调递增，每多一级连击固定 +20', () => {
    for (const count of [MATCH_MIN, 5, 6]) {
      for (let combo = 1; combo < 20; combo++) {
        expect(scoreOf(count, combo + 1)).toBe(scoreOf(count, combo) + 20)
      }
    }
    expect(scoreOf(MATCH_MIN, 2)).toBe(100)
    expect(scoreOf(MATCH_MIN, 3)).toBe(120)
  })

  it('球数越多分越高（count ≥ 1 时严格递增）', () => {
    for (let count = 1; count < CELL_COUNT; count++) {
      expect(scoreOf(count + 1, 1)).toBeGreaterThan(scoreOf(count, 1))
    }
  })

  it('边界：count = 0 时只剩连击分；combo < 0 会算出负分（rules.ts 不做兜底）', () => {
    expect(scoreOf(0, 1)).toBe(0)
    expect(scoreOf(0, 0)).toBe(-20)
    expect(scoreOf(0, -1)).toBe(-40)
    expect(scoreOf(MATCH_MIN, 0)).toBe(60)
    expect(scoreOf(MATCH_MIN, -1)).toBe(40)
  })
})

// ---------------- reduce 每个分支 ----------------

describe('reduce · down', () => {
  it('按在球上：以该球为起点新建路径', () => {
    const s = stateOf(solidWith([0, 1, 2, 3]))
    const n = reduce(s, { type: 'down', cell: 2 })
    expect(n.path).toEqual([2])
    expect(n.hoverCell).toBe(2)
    expect(n).not.toBe(s)
  })

  it('按在空格上被拒，返回同一引用', () => {
    const cells = solidWith([0, 1, 2, 3])
    cells[cellOf(4, 0)] = EMPTY
    const s = stateOf(cells)
    expect(reduce(s, { type: 'down', cell: cellOf(4, 0) })).toBe(s)
  })

  it('越界 / 小数 / NaN 的按下被拒，返回同一引用', () => {
    const s = stateOf(solidWith([0, 1, 2, 3]))
    for (const bad of [-1, CELL_COUNT, 999, 1.5, NaN]) {
      expect(reduce(s, { type: 'down', cell: bad })).toBe(s)
    }
  })

  it('已经按在同一颗球上不重开路径，返回同一引用', () => {
    const s = stateOf(solidWith([0, 1, 2, 3]), { path: [2], hoverCell: 2 })
    expect(reduce(s, { type: 'down', cell: 2 })).toBe(s)
  })

  it('连线途中改按另一颗球：丢弃旧路径，以新球重新起线', () => {
    const s = stateOf(solidWith([0, 1, 2, 3]), { path: [0, 1] })
    const n = reduce(s, { type: 'down', cell: 3 })
    expect(n.path).toEqual([3])
    expect(n.hoverCell).toBe(3)
  })
})

describe('reduce · move', () => {
  it('没有连线时只更新 hoverCell', () => {
    const s = stateOf(solidWith([0, 1, 2, 3]))
    const n = reduce(s, { type: 'move', cell: cellOf(3, 1) })
    expect(n.hoverCell).toBe(cellOf(3, 1))
    expect(n.path).toEqual([])
    expect(reduce(n, { type: 'move', cell: cellOf(3, 1) })).toBe(n) // hover 没变则原样返回
  })

  it('没有连线时指针越界 → hoverCell 归 -1', () => {
    const s = stateOf(solidWith([0, 1, 2, 3]))
    const n = reduce(s, { type: 'move', cell: -1 })
    expect(n.hoverCell).toBe(-1)
    expect(reduce(n, { type: 'move', cell: -1 })).toBe(n)
    expect(reduce(s, { type: 'move', cell: 1.5 })).toEqual({ ...s, hoverCell: -1 })
  })

  it('连线中拖回末球本身：只更新 hoverCell，路径不变', () => {
    const s = stateOf(solidWith([0, 1, 2, 3]), { path: [0, 1, 2], hoverCell: cellOf(1, 1) })
    const n = reduce(s, { type: 'move', cell: 2 })
    expect(n.path).toEqual([0, 1, 2])
    expect(n.hoverCell).toBe(2)
    expect(reduce(n, { type: 'move', cell: 2 })).toBe(n)
  })

  it('拖回上一个球：截断路径（回退改错）', () => {
    const s = stateOf(solidWith([0, 1, 2, 3]), { path: [0, 1, 2], hoverCell: 2 })
    const n = reduce(s, { type: 'move', cell: 1 })
    expect(n.path).toEqual([0, 1])
    const n2 = reduce(n, { type: 'move', cell: 0 })
    expect(n2.path).toEqual([0])
    expectNoCellReselectable(n2)
  })

  it('邻域内有同色线外球：路径延长一格', () => {
    const s = stateOf(solidWith([0, 1, 2, 3]))
    const n = connect(s, [0, cellOf(1, 0), cellOf(2, 0)])
    expect(n.path).toEqual([0, 1, 2])
    expectLegalPath(n)
  })

  it('邻域内没有可接的同色球：只更新 hoverCell，路径不变', () => {
    const s = stateOf(solidWith([0, 1, 2, 3]), { path: [0, 1], hoverCell: 1 })
    const n = reduce(s, { type: 'move', cell: cellOf(5, 5) })
    expect(n.path).toEqual([0, 1])
    expect(n.hoverCell).toBe(cellOf(5, 5))
    expect(reduce(n, { type: 'move', cell: cellOf(5, 5) })).toBe(n)
  })

  it('连线中指针越界：hoverCell 归 -1，路径原样保留', () => {
    const s = stateOf(solidWith([0, 1, 2, 3]), { path: [0, 1], hoverCell: 1 })
    const n = reduce(s, { type: 'move', cell: CELL_COUNT })
    expect(n.path).toEqual([0, 1])
    expect(n.hoverCell).toBe(-1)
  })
})

describe('reduce · up', () => {
  it('压根没连线时松手什么都不做（同一引用）', () => {
    const s = stateOf(solidWith([0, 1, 2, 3]))
    expect(reduce(s, { type: 'up' })).toBe(s)
  })

  it('连满 4 个松手：消除、补球、计分、连击 +1，并留下 lastCleared', () => {
    const s = stateOf(twoRowsOfFour())
    const n = connect(s, [0, cellOf(1, 0), cellOf(2, 0), cellOf(3, 0)])
    expect(n.path.length).toBe(MATCH_MIN)
    const done = reduce(n, { type: 'up' })
    expect(done.path).toEqual([])
    expect(done.clears).toBe(1)
    expect(done.combo).toBe(1)
    expect(done.bestCombo).toBe(1)
    expect(done.score).toBe(scoreOf(MATCH_MIN, 1))
    expect(done.lastCleared).toEqual([0, cellOf(1, 0), cellOf(2, 0), cellOf(3, 0)])
    expect(done.shuffleTries).toBe(0)
    // 消除后从顶部补球，盘面重新铺满
    expect(done.cells.length).toBe(CELL_COUNT)
    expect(done.cells.every((v) => v !== EMPTY)).toBe(true)
    expectBallRange(done.cells)
    expectLegalPath(done)
  })

  it('连续两次消除：combo / bestCombo / score 连续累加', () => {
    let s = stateOf(twoRowsOfFour())
    s = reduce(connect(s, [0, cellOf(1, 0), cellOf(2, 0), cellOf(3, 0)]), { type: 'up' })
    expect(s.score).toBe(scoreOf(4, 1))
    s = reduce(
      connect(s, [cellOf(0, 2), cellOf(1, 2), cellOf(2, 2), cellOf(3, 2)]),
      { type: 'up' },
    )
    expect(s.clears).toBe(2)
    expect(s.combo).toBe(2)
    expect(s.bestCombo).toBe(2)
    expect(s.score).toBe(scoreOf(4, 1) + scoreOf(4, 2))
    expectLegalPath(s)
  })

  it('放弃短连线会把连击清零', () => {
    const s = stateOf(twoRowsOfFour(), { combo: 3, bestCombo: 3, score: 300 })
    const n = reduce(connect(s, [0, cellOf(1, 0), cellOf(2, 0)]), { type: 'up' })
    expect(n.path).toEqual([])
    expect(n.combo).toBe(0)
    expect(n.bestCombo).toBe(3) // 历史最高不受影响
    expect(n.clears).toBe(0)
    expect(n.cells).toBe(s.cells)
  })
})

describe('reduce · shuffle 与终局', () => {
  it('主动洗牌：球色守恒、shuffles + 1、清空 lastCleared，且保证仍有解', () => {
    const s = stateOf(create(888).cells, { lastCleared: [0, 1] })
    const n = reduce(s, { type: 'shuffle' })
    expect(countBy(n.cells)).toEqual(countBy(s.cells))
    expect(n.shuffles).toBe(1)
    expect(n.lastCleared).toEqual([])
    expect(hasAnyMove(n)).toBe(true)
    expect(s.shuffles).toBe(0) // 入参不被修改
  })

  it('死盘上洗牌会被 ensureSolvable 兜底修复', () => {
    const n = reduce(stateOf(deadCheckerboard()), { type: 'shuffle' })
    expect(hasAnyMove(n)).toBe(true)
    expect(n.over).toBe(false)
  })

  it('本局结束后任何操作都不再改变状态（同一引用）', () => {
    const done = stateOf(hopelessBoard(), { over: true })
    const actions: Action[] = [
      { type: 'down', cell: cellOf(0, 0) },
      { type: 'move', cell: cellOf(1, 0) },
      { type: 'up' },
      { type: 'shuffle' },
    ]
    for (const a of actions) expect(reduce(done, a)).toBe(done)
  })

  it('未知 action 被丢弃，返回同一引用', () => {
    const s = stateOf(solidWith([0, 1, 2, 3]))
    expect(reduce(s, { type: 'nope' } as unknown as Action)).toBe(s)
  })
})

describe('reduce · 纯函数约束', () => {
  it('每个分支都不修改入参（深拷贝快照比对）', () => {
    const s = stateOf(twoRowsOfFour(), { lastCleared: [5], clears: 2, score: 120, combo: 2, bestCombo: 2 })
    const before = clone(s)
    reduce(s, { type: 'down', cell: cellOf(0, 2) })
    reduce(s, { type: 'move', cell: cellOf(1, 2) })
    reduce(s, { type: 'move', cell: cellOf(1, 0) })
    reduce(s, { type: 'up' })
    reduce(s, { type: 'shuffle' })
    reduce(s, { type: 'down', cell: -1 })
    reduce(s, { type: 'nope' } as unknown as Action)
    expect(s).toEqual(before)
  })

  it('连线拖动整串也不污染原状态', () => {
    const s = stateOf(twoRowsOfFour())
    const before = clone(s)
    const dragged = connect(s, [0, cellOf(1, 0), cellOf(2, 0), cellOf(3, 0)])
    reduce(dragged, { type: 'up' })
    expect(s).toEqual(before)
    expect(s.path).toEqual([])
    expect(s.clears).toBe(0)
  })

  it('相同输入两次调用结果完全相等', () => {
    const s = stateOf(twoRowsOfFour())
    const dragged = connect(s, [0, cellOf(1, 0), cellOf(2, 0), cellOf(3, 0)])
    expect(reduce(dragged, { type: 'up' })).toEqual(reduce(dragged, { type: 'up' }))
    expect(reduce(s, { type: 'shuffle' })).toEqual(reduce(s, { type: 'shuffle' }))
  })
})

// ---------------- 随机模拟不变量 ----------------

describe('随机模拟', () => {
  /** 把整套不变量收成一条断言：随机模拟是逐步热循环，逐格 expect 太慢 */
  function violations(s: State, score: number): string[] {
    const bad: string[] = []
    if (s.cells.length !== CELL_COUNT) bad.push(`格数 ${s.cells.length}`)
    if (s.cells.some((v) => !Number.isInteger(v) || v < EMPTY || v > COLORS)) bad.push('球色越界')
    if (s.cells.some((v) => v === EMPTY)) bad.push('盘面出现空位')
    if (new Set(s.path).size !== s.path.length) bad.push('连线重复走格')
    if (s.path.length >= 2 && s.path[0] === s.path[s.path.length - 1]) bad.push('连线回到起点')
    const color = s.path.length > 0 ? s.cells[s.path[0]] : EMPTY
    if (s.path.some((i) => !inBounds(i) || s.cells[i] !== color)) bad.push('连线颜色不一致或压到空格')
    if (s.path.length > CELL_COUNT) bad.push('连线过长')
    if (s.score < score) bad.push(`分数倒退 ${score}→${s.score}`)
    if (s.combo < 0 || s.combo > s.bestCombo) bad.push('连击计数异常')
    return bad
  }

  /** 按固定权重随机取一个 action：down 10% / move 80% / up 10% */
  function randomAction(r: Rng): Action {
    const k = r.int(10)
    if (k === 0) return { type: 'down', cell: r.int(CELL_COUNT) }
    if (k === 9) return { type: 'up' }
    return { type: 'move', cell: r.int(CELL_COUNT) }
  }

  it('固定种子跑 300 步随机操作：格数恒为 63、球色不越界、连线始终合法、分数单调不减', () => {
    const r = new Rng(20260913)
    let s = create(20260913)
    let score = s.score
    let clears = s.clears
    let shuffles = s.shuffles
    let grew = 0

    for (let step = 0; step < 300 && !s.over; step++) {
      const action = randomAction(r)
      const before = s.path.length
      s = reduce(s, action)
      if (action.type === 'move' && s.path.length === before + 1) {
        grew++
        // 延长一格时，新球一定落在指针格的八邻域内（rules.ts 的吸附定义）
        expect(neighbors(s.hoverCell)).toContain(s.path[s.path.length - 1])
      }
      expect(violations(s, score)).toEqual([])
      expect(s.clears).toBeGreaterThanOrEqual(clears)
      expect(s.shuffles).toBeGreaterThanOrEqual(shuffles)
      score = s.score
      clears = s.clears
      shuffles = s.shuffles
    }

    console.log(`[随机模拟] 300 步：消除 ${s.clears} 次、延长 ${grew} 次、洗牌 ${s.shuffles} 次、得分 ${s.score}`)
    expect(grew).toBeGreaterThan(0)
    expect(s.clears).toBeGreaterThan(0)
    expect(s.over).toBe(false)
    expect(hasAnyMove(s)).toBe(true)
  })

  it('多个种子各跑 150 步都不崩溃，且每步不变量都成立', () => {
    for (const seed of [1, 7919, 20260913]) {
      const r = new Rng(seed)
      let s = create(seed)
      let score = 0
      for (let step = 0; step < 150 && !s.over; step++) {
        s = reduce(s, randomAction(r))
        expect(violations(s, score)).toEqual([])
        score = s.score
      }
    }
  })

  it('同 seed 走同一串操作，终局完全一致（可复盘）', () => {
    const play = (seed: number) => {
      const r = new Rng(seed)
      let s = create(seed)
      for (let i = 0; i < 300 && !s.over; i++) s = reduce(s, randomAction(r))
      return s
    }
    expect(play(4242)).toEqual(play(4242))
  })
})