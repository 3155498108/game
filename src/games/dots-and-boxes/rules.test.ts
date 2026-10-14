import { describe, expect, it } from 'vitest'
import {
  BOX_COUNT,
  BOXES,
  DOTS,
  EDGE_COUNT,
  H_COUNT,
  V_COUNT,
  aiAction,
  boxEdgeCount,
  boxEdges,
  boxIndex,
  boxesOfEdge,
  chainBoxes,
  create,
  draw,
  edgeAt,
  edgeIndex,
  freeEdges,
  hIndex,
  legalActions,
  reduce,
  vIndex,
  winnerOf,
  type Dir,
  type Player,
  type State,
} from './rules'

/** 依次画完一批边（顺序由测试指定） */
function play(order: number[]): State {
  let s = create(7)
  for (const e of order) s = draw(s, e)
  return s
}

/**
 * 构造一个「已经占好若干条边」的局：
 * 描述串形如 'h:1:0'（横边 r=1 c=0），结尾加 '#' 表示这条边归玩家 2。
 */
function stateWith(specs: string[], turn: Player, seed = 7): State {
  let s: State = { ...create(seed), turn }
  for (const raw of specs) {
    const mine = raw.endsWith('#')
    const [dir, r, c] = (mine ? raw.slice(0, -1) : raw).split(':')
    const e = edgeIndex(Number(r), Number(c), dir as Dir)
    if (e < 0) throw new Error(`非法边描述：${raw}`)
    const edges = s.edges.slice()
    edges[e] = mine ? 2 : 1
    s = { ...s, edges }
  }
  return s
}

const clone = (s: State): State => JSON.parse(JSON.stringify(s)) as State

// 盒 (0,0) 的四条边；盒 (2,2) 的四条边
const BOX00 = ['h:0:0', 'h:1:0', 'v:0:0', 'v:0:1']
const BOX22 = ['h:2:2', 'h:3:2', 'v:2:2', 'v:2:3']

describe('边索引与布局', () => {
  it('5×5 点阵共 40 条边：横边 20 + 竖边 20，互不重叠', () => {
    expect(H_COUNT).toBe(20)
    expect(V_COUNT).toBe(20)
    expect(EDGE_COUNT).toBe(40)
    expect(BOX_COUNT).toBe(16)
    const all = new Set<number>()
    for (let r = 0; r < DOTS; r++) {
      for (let c = 0; c < DOTS; c++) {
        if (c < DOTS - 1) all.add(hIndex(r, c))
        if (r < DOTS - 1) all.add(vIndex(r, c))
      }
    }
    expect(all.size).toBe(EDGE_COUNT)
  })

  it('越界或非法坐标的边索引返回 -1', () => {
    expect(hIndex(0, 4)).toBe(-1)
    expect(hIndex(5, 0)).toBe(-1)
    expect(hIndex(-1, 0)).toBe(-1)
    expect(hIndex(0.5, 0)).toBe(-1)
    expect(vIndex(4, 0)).toBe(-1)
    expect(vIndex(0, 5)).toBe(-1)
    expect(vIndex(0, -1)).toBe(-1)
    expect(edgeIndex(1, 1, 'h')).toBeGreaterThanOrEqual(0)
    expect(edgeIndex(1, 1, 'v')).toBeGreaterThanOrEqual(0)
  })

  it('edgeAt 与 edgeIndex 互为逆映射，覆盖全部 40 条边', () => {
    for (let i = 0; i < EDGE_COUNT; i++) {
      const at = edgeAt(i)
      expect(at).not.toBeNull()
      expect(edgeIndex(at!.r, at!.c, at!.dir)).toBe(i)
    }
    expect(edgeAt(-1)).toBeNull()
    expect(edgeAt(EDGE_COUNT)).toBeNull()
  })

  it('盒 (r,c) 的四条边 = 上、下、左、右', () => {
    expect(boxEdges(0, 0)).toEqual([hIndex(0, 0), hIndex(1, 0), vIndex(0, 0), vIndex(0, 1)])
    expect(boxEdges(3, 3)).toEqual([hIndex(3, 3), hIndex(4, 3), vIndex(3, 3), vIndex(3, 4)])
    expect(boxEdges(1, 2)).toEqual([hIndex(1, 2), hIndex(2, 2), vIndex(1, 2), vIndex(1, 3)])
    expect(boxIndex(1, 2)).toBe(1 * BOXES + 2)
  })

  it('一条边邻接的盒子：内部边 2 个，最外侧 1 个', () => {
    // 中间横边 H[1][1]：上方是盒 (0,1)，下方是盒 (1,1)
    expect(boxesOfEdge(hIndex(1, 1))).toEqual([boxIndex(0, 1), boxIndex(1, 1)])
    // 最上一排横边 H[0][0] 只有下方一个盒子
    expect(boxesOfEdge(hIndex(0, 0))).toEqual([boxIndex(0, 0)])
    // 内部竖边 V[1][1]
    expect(boxesOfEdge(vIndex(1, 1))).toEqual([boxIndex(1, 0), boxIndex(1, 1)])
    // 最左一列竖边 V[0][0]
    expect(boxesOfEdge(vIndex(0, 0))).toEqual([boxIndex(0, 0)])
  })

  it('boxEdgeCount 统计盒子已占边数', () => {
    const s = stateWith(['h:0:0', 'h:1:0', 'v:0:0'], 1)
    expect(boxEdgeCount(s.edges, boxIndex(0, 0))).toBe(3)
    expect(boxEdgeCount(s.edges, boxIndex(3, 3))).toBe(0)
  })
})

describe('开局', () => {
  it('初始 40 条边全空、16 个盒子无主、0:0、玩家先手', () => {
    const s = create(42)
    expect(s.edges.length).toBe(EDGE_COUNT)
    expect(s.edges.every((v) => v === 0)).toBe(true)
    expect(s.owners.length).toBe(BOX_COUNT)
    expect(s.owners.every((v) => v === 0)).toBe(true)
    expect(s.scores).toEqual([0, 0])
    expect(s.turn).toBe(1)
    expect(s.over).toBe(false)
    expect(s.winner).toBe(0)
    expect(s.moves).toBe(0)
    expect(s.lastEdge).toBe(-1)
    expect(freeEdges(s.edges).length).toBe(EDGE_COUNT)
    expect(legalActions(s).length).toBe(EDGE_COUNT)
  })

  it('create 对同一 seed 完全一致', () => {
    expect(create(123)).toEqual(create(123))
    expect(create(123).rng).toBe(123)
  })
})

describe('画边与计分', () => {
  it('画一条边会被正确标记，且不得分时换人', () => {
    const s = draw(create(1), hIndex(2, 1))
    expect(s.edges[hIndex(2, 1)]).toBe(1)
    expect(s.moves).toBe(1)
    expect(s.lastEdge).toBe(hIndex(2, 1))
    expect(s.turn).toBe(2)
    expect(s.scores).toEqual([0, 0])
  })

  it('已被占的边不能重复画', () => {
    const s = draw(create(1), vIndex(1, 2))
    const next = draw(s, vIndex(1, 2))
    expect(next).toBe(s)
  })

  it('越界 / 非整数的边索引被拒绝', () => {
    const s = create(1)
    expect(draw(s, -1)).toBe(s)
    expect(draw(s, EDGE_COUNT)).toBe(s)
    expect(draw(s, 1.5)).toBe(s)
  })

  it('四条边围成盒子，盒子归最后画边的那一方（哪怕另外三条是对手的）', () => {
    // 盒 (0,0) 的三条边属于玩家 1，最后一条由玩家 2 补上 → 盒子归玩家 2
    const s = draw(stateWith([BOX00[0], BOX00[1], BOX00[2]], 2), vIndex(0, 1))
    expect(s.owners[boxIndex(0, 0)]).toBe(2)
    expect(s.scores).toEqual([0, 1])
    expect(s.lastBoxes).toEqual([boxIndex(0, 0)])
    expect(s.over).toBe(false)
  })

  it('围成盒子得 1 分且 turn 不翻转（再走一步）', () => {
    const s = draw(stateWith([BOX00[0], BOX00[1], BOX00[2]], 1), vIndex(0, 1))
    expect(s.scores).toEqual([1, 0])
    expect(s.turn).toBe(1)
  })

  it('连着两步都得分，仍由同一个人走', () => {
    const specs = [BOX00[0], BOX00[1], BOX00[2], BOX22[0], BOX22[1], BOX22[2]]
    const s1 = draw(stateWith(specs, 1), vIndex(0, 1))
    expect(s1.turn).toBe(1)
    const s2 = draw(s1, vIndex(2, 3))
    expect(s2.scores).toEqual([2, 0])
    expect(s2.turn).toBe(1)
    expect(s2.moves).toBe(2)
  })

  it('一手最多围成 2 个盒子（盘面中间的边）', () => {
    // 左盒 (1,0) 与右盒 (1,1) 各差最后一条边，两盒共用竖边 V[1][1]
    const s = draw(
      stateWith(['h:1:0', 'h:2:0', 'v:1:0', 'h:1:1', 'h:2:1', 'v:1:2'], 1),
      vIndex(1, 1),
    )
    expect(s.scores).toEqual([2, 0])
    expect(s.lastBoxes.sort()).toEqual([boxIndex(1, 0), boxIndex(1, 1)].sort())
    expect(s.turn).toBe(1)
  })

  it('占掉「已有 3 条边」的盒子的最后一条边也算得分并再走一步', () => {
    // 三条边全是对手画的，玩家补最后一条 → 得分并继续走
    const s = draw(stateWith([`${BOX00[0]}#`, `${BOX00[1]}#`, `${BOX00[2]}#`], 1), vIndex(0, 1))
    expect(s.scores).toEqual([1, 0])
    expect(s.owners[boxIndex(0, 0)]).toBe(1)
    expect(s.turn).toBe(1)
  })

  it('把对手的 3 边盒子留着不算得分，换人走', () => {
    // 盘面留一个 3 边盒子，本步随便画一条无关边：不得分 → turn 翻转
    const s = draw(stateWith([`${BOX00[0]}#`, `${BOX00[1]}#`, `${BOX00[2]}#`], 1), hIndex(3, 3))
    expect(s.scores).toEqual([0, 0])
    expect(s.turn).toBe(2)
    expect(chainBoxes(s)).toBe(1)
  })

  it('chainBoxes 统计「只剩 1 条边」的盒子', () => {
    expect(chainBoxes(create(1))).toBe(0)
    expect(chainBoxes(stateWith(['h:0:0', 'h:1:0', 'v:0:0'], 1))).toBe(1)
    expect(chainBoxes(draw(stateWith(['h:0:0', 'h:1:0', 'v:0:0'], 1), vIndex(0, 1)))).toBe(0)
  })
})

describe('结束与胜负', () => {
  it('40 条边全占后结束，比分之和为 16', () => {
    const s = play([...Array(EDGE_COUNT).keys()])
    expect(s.over).toBe(true)
    expect(s.moves).toBe(EDGE_COUNT)
    expect(s.scores[0] + s.scores[1]).toBe(BOX_COUNT)
    expect(s.edges.every((v) => v !== 0)).toBe(true)
  })

  it('顺序走完 0..39 恰好 8:8，判平局', () => {
    const s = play([...Array(EDGE_COUNT).keys()])
    expect(s.scores).toEqual([8, 8])
    expect(s.winner).toBe(0)
  })

  it('盒子数多者胜', () => {
    const s = play([31, 23, 28, 38, 27, 33, 25, 21, 17, 39, 13, 3, 30, 8, 10, 2, 5, 32, 35, 4, 11, 15, 29, 20, 24, 6, 22, 16, 34, 7, 37, 0, 18, 36, 12, 1, 26, 19, 14, 9])
    expect(s.over).toBe(true)
    expect(s.scores).toEqual([13, 3])
    expect(s.winner).toBe(1)
  })

  it('winnerOf：多者胜、落后判负、相同判平局', () => {
    expect(winnerOf([9, 7])).toBe(1)
    expect(winnerOf([7, 9])).toBe(2)
    expect(winnerOf([8, 8])).toBe(0)
    expect(winnerOf([0, 0])).toBe(0)
  })

  it('结束后不再接受画边', () => {
    const s = play([...Array(EDGE_COUNT).keys()])
    expect(draw(s, 0)).toBe(s)
    expect(reduce(s, { type: 'hover', edge: 0 })).toBe(s)
  })

  it('结束后 aiAction 返回 null', () => {
    expect(aiAction(play([...Array(EDGE_COUNT).keys()]))).toBeNull()
  })
})

describe('悬停', () => {
  it('hover 不改变盘面与步数', () => {
    const s = reduce(create(1), { type: 'hover', edge: hIndex(1, 1) })
    expect(s.hover).toBe(hIndex(1, 1))
    expect(s.edges).toEqual(create(1).edges)
    expect(s.moves).toBe(0)
  })

  it('hover 到已占边或非法索引时归 -1', () => {
    const s = stateWith(['h:1:1'], 1)
    expect(reduce(s, { type: 'hover', edge: hIndex(1, 1) }).hover).toBe(-1)
    expect(reduce(s, { type: 'hover', edge: 999 }).hover).toBe(-1)
    expect(reduce(s, { type: 'leave' }).hover).toBe(-1)
  })

  it('画掉悬停的那条边后悬停自动清除', () => {
    const s = reduce(stateWith([], 1), { type: 'hover', edge: vIndex(2, 2) })
    const n = draw(s, vIndex(2, 2))
    expect(n.hover).toBe(-1)
  })
})

describe('AI', () => {
  it('轮到玩家时返回 null', () => {
    expect(aiAction(create(1))).toBeNull()
    expect(aiAction(stateWith([], 1))).toBeNull()
  })

  it('能收盒时一定先收盒', () => {
    // 盒 (0,0) 三条边都是自己的，电脑补最后一条即可得分
    const s = stateWith([`${BOX00[0]}#`, `${BOX00[1]}#`, `${BOX00[2]}#`], 2)
    const a = aiAction(s)
    expect(a).toEqual({ type: 'draw', edge: vIndex(0, 1) })
    expect(reduce(s, a!).scores).toEqual([0, 1])
  })

  it('有安全手时不去制造「只剩 1 条边」的盒子（那等于送给对手连吃）', () => {
    // 盒 (2,2) 已有 2 条边（都是玩家画的）：电脑若补上第 3 条，玩家下一步就能吃它并连走
    const s = stateWith([BOX22[0], BOX22[1]], 2)
    const a = aiAction(s)
    expect(a).not.toBeNull()
    expect([vIndex(2, 2), vIndex(2, 3)]).not.toContain((a as { edge: number }).edge)
  })

  it('所有落点都从未占边中选，且整局必然终局', () => {
    for (let seed = 1; seed <= 25; seed++) {
      let s = create(seed * 7919)
      let guard = 0
      while (!s.over && guard++ < EDGE_COUNT + 5) {
        const free = freeEdges(s.edges)
        if (s.turn === 2) {
          const a = aiAction(s)
          expect(a).not.toBeNull()
          expect(free).toContain((a as { edge: number }).edge)
          s = draw(s, (a as { edge: number }).edge)
        } else {
          expect(aiAction(s)).toBeNull()
          s = draw(s, free[seed % free.length])
        }
      }
      expect(s.over).toBe(true)
      expect(s.moves).toBe(EDGE_COUNT)
      expect(s.scores[0] + s.scores[1]).toBe(BOX_COUNT)
      expect(s.winner).toBe(winnerOf(s.scores))
    }
  })

  it('相同状态总是返回相同动作（可复盘）', () => {
    const s = stateWith(['h:0:0', 'h:1:1', 'v:2:3'], 2, 99)
    expect(aiAction(s)).toEqual(aiAction(s))
  })

  it('不同 seed 的开局 AI 走法可以不同（可播种随机已生效）', () => {
    const moves = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) moves.add(JSON.stringify(aiAction({ ...create(seed), turn: 2 })))
    expect(moves.size).toBeGreaterThan(1)
  })

  it('AI 单步耗时远低于 100ms（打印实测值）', () => {
    let worst = 0
    let total = 0
    let n = 0
    for (let seed = 1; seed <= 20; seed++) {
      let s = create(seed * 104729)
      let guard = 0
      while (!s.over && guard++ < EDGE_COUNT + 5) {
        if (s.turn !== 2) {
          const free = freeEdges(s.edges)
          s = draw(s, free[seed % free.length])
          continue
        }
        const t0 = performance.now()
        const a = aiAction(s)
        const dt = performance.now() - t0
        worst = Math.max(worst, dt)
        total += dt
        n++
        s = draw(s, (a as { edge: number }).edge)
      }
    }
    const avg = total / n
    console.log(`[AI 耗时] 决策 ${n} 次，平均 ${avg.toFixed(4)}ms，最差 ${worst.toFixed(4)}ms`)
    expect(worst).toBeLessThan(100)
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参（边数组最容易被就地改）', () => {
    const s = stateWith([BOX00[0], BOX00[1], BOX00[2]], 1)
    const before = clone(s)
    const n = draw(s, vIndex(0, 1))
    expect(s).toEqual(before)
    expect(n).not.toBe(s)
    expect(n.edges).not.toBe(s.edges)
    expect(n.scores).not.toBe(s.scores)
  })

  it('相同输入两次调用结果完全相等', () => {
    const s = stateWith([BOX00[0], BOX00[1], BOX00[2]], 1)
    expect(draw(s, vIndex(0, 1))).toEqual(draw(s, vIndex(0, 1)))
  })

  it('连续多步 reduce 不会污染最初的 state', () => {
    const s0 = create(5)
    const snap = clone(s0)
    let s = s0
    for (let i = 0; i < EDGE_COUNT; i++) s = draw(s, i)
    expect(s0).toEqual(snap)
    expect(s.over).toBe(true)
  })
})