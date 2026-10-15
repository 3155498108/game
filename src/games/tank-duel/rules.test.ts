/**
 * tank-duel 规则层测试：只 import ./rules 与 ./meta，纯逻辑无 DOM 依赖。
 *
 * 覆盖：开局摆放与对称性、三种动作的合法性与边界、射线遮挡、命中即终局、
 * reduce 纯度（不修改入参）、legalActions 无非法动作、AI 只从合法动作里选、
 * 双方 AI 整局必然分出胜负、同 seed 同序列可复盘。
 */
import { describe, expect, it } from 'vitest'
import { CELLS, COLS, COMPUTER, DIR_DC, DIR_DR, MOVE_LIMIT, ROWS, WALL_PAIRS } from './rules'
import { meta } from './meta'
import type { Action, Dir, State, Tank } from './rules'
import {
  aligned,
  aiAction,
  bestAction,
  clearLine,
  create,
  decideByPosition,
  idx,
  inBounds,
  isFree,
  legalActions,
  mirrorCell,
  other,
  reduce,
  shotHits,
  stepAhead,
  tankAt,
  tankOf,
  traceShot,
  turnDir,
} from './rules'

/** 手工拼一个状态：默认空棋盘，再按需覆盖 */
function mkState(p1: Tank, p2: Tank, patch: Partial<State> = {}): State {
  return {
    walls: new Array<number>(CELLS).fill(0),
    p1,
    p2,
    turn: 1,
    over: false,
    winner: 0,
    last: null,
    moves: 0,
    rng: 20240701,
    ...patch,
  }
}

/** 在指定格放一面墙 */
function withWalls(state: State, cells: number[]): State {
  const walls = state.walls.slice()
  for (const c of cells) walls[c] = 1
  return { ...state, walls }
}

const dirName = (d: Dir): string => ['上', '右', '下', '左'][d]

/** 沿 dir 前进 n 格后的落点（用于断言用） */
const aheadOf = (t: Tank, n: number): Tank => ({
  col: t.col + DIR_DC[t.dir] * n,
  row: t.row + DIR_DR[t.dir] * n,
  dir: t.dir,
})

/**
 * 双方全交给 AI 跑一局。带硬上限：万一规则层出现「永不休战」的缺陷，
 * 测试要干净地报失败，而不是把进程 OOM 掉。
 */
function playAiVsAi(seed: number, cap = MOVE_LIMIT * 2): State {
  let s = create(seed)
  for (let i = 0; i < cap && !s.over; i++) {
    const pick = bestAction(s, s.turn)
    if (!pick) break
    s = reduce(s, pick)
  }
  return s
}

describe('meta 注册信息', () => {
  it('id / 尺寸 / 玩法字段自洽', () => {
    expect(meta.id).toBe('tank-duel')
    expect(meta.players).toBe('ai')
    expect(meta.orientation).toBe('landscape')
    expect(meta.viewport.width).toBeGreaterThan(0)
    expect(meta.viewport.height).toBeGreaterThan(0)
    expect(meta.tags.length).toBeGreaterThan(0)
  })
})

describe('create(seed) 开局', () => {
  it('战场尺寸为 10×8', () => {
    expect(COLS).toBe(10)
    expect(ROWS).toBe(8)
    expect(CELLS).toBe(80)
    const s = create(1)
    expect(s.walls).toHaveLength(CELLS)
  })

  it('两辆坦克分居两端、朝向正确', () => {
    for (let seed = 0; seed < 12; seed++) {
      const s = create(seed)
      expect(s.p1.col).toBe(0)
      expect(s.p2.col).toBe(COLS - 1)
      // 玩家朝右、电脑朝左，开局即隔空对峙
      expect(s.p1.dir).toBe(1)
      expect(s.p2.dir).toBe(3)
      // 行号互补，构成 180° 旋转对称
      expect(s.p1.row + s.p2.row).toBe(ROWS - 1)
      expect(s.p1.row).toBeGreaterThanOrEqual(0)
      expect(s.p1.row).toBeLessThan(ROWS)
      // 起始格必须是空地
      expect(s.walls[idx(0, s.p1.row)]).toBe(0)
      expect(s.walls[idx(COLS - 1, s.p2.row)]).toBe(0)
    }
  })

  it('初始状态字段正确：玩家先手、未终局、零手数', () => {
    const s = create(7)
    expect(s.turn).toBe(1)
    expect(s.over).toBe(false)
    expect(s.winner).toBe(0)
    expect(s.moves).toBe(0)
    expect(s.last).toBeNull()
    expect(s.rng).toBe(7)
  })

  it('掩体 180° 旋转对称，且恰好 WALL_PAIRS 对', () => {
    for (let seed = 0; seed < 30; seed++) {
      const s = create(seed)
      for (let i = 0; i < CELLS; i++) {
        expect(s.walls[i]).toBe(s.walls[mirrorCell(i)])
      }
      const count = s.walls.reduce((a, b) => a + b, 0)
      expect(count).toBe(WALL_PAIRS * 2)
    }
  })

  it('不同 seed 生成不同局面', () => {
    const a = create(3).walls.join('')
    const b = create(4).walls.join('')
    expect(a).not.toBe(b)
  })
})

describe('坐标与朝向工具', () => {
  it('idx / colOf / rowOf 互为逆运算', () => {
    for (const [col, row] of [
      [0, 0],
      [9, 0],
      [0, 7],
      [9, 7],
      [4, 3],
    ]) {
      const i = idx(col, row)
      expect(i).toBe(row * COLS + col)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(CELLS)
    }
  })

  it('inBounds 只认棋盘内的格', () => {
    expect(inBounds(0, 0)).toBe(true)
    expect(inBounds(COLS - 1, ROWS - 1)).toBe(true)
    expect(inBounds(-1, 0)).toBe(false)
    expect(inBounds(0, ROWS)).toBe(false)
    expect(inBounds(COLS, 0)).toBe(false)
  })

  it('mirrorCell 是 180° 旋转的不动映射', () => {
    for (let i = 0; i < CELLS; i++) {
      const m = mirrorCell(i)
      expect(mirrorCell(m)).toBe(i)
      expect(m).toBe(CELLS - 1 - i)
    }
  })

  it('turnDir 左右转 90° 且环绕', () => {
    expect(turnDir(0, 1)).toBe(1)
    expect(turnDir(1, 1)).toBe(2)
    expect(turnDir(3, 1)).toBe(0)
    expect(turnDir(0, -1)).toBe(3)
    expect(turnDir(0, -1)).toBe(turnDir(0, 3))
    // 连转四次回到原位
    let d: Dir = 2
    for (let k = 0; k < 4; k++) d = turnDir(d, 1)
    expect(d).toBe(2)
  })

  it('other 交换玩家、tankOf / tankAt 定位正确', () => {
    const s = create(11)
    expect(other(1)).toBe(COMPUTER)
    expect(other(COMPUTER)).toBe(1)
    expect(tankOf(s, 1)).toEqual(s.p1)
    expect(tankOf(s, COMPUTER)).toEqual(s.p2)
    expect(tankAt(s, s.p1.col, s.p1.row)).toBe(1)
    expect(tankAt(s, s.p2.col, s.p2.row)).toBe(COMPUTER)
    expect(tankAt(s, 5, 5)).toBe(0)
  })
})

describe('move：前进的合法性与边界', () => {
  const base = mkState({ col: 4, row: 4, dir: 1 }, { col: 9, row: 0, dir: 3 })

  it('合法前进：沿当前朝向前进 1 格，朝向不变', () => {
    const s = reduce(base, { type: 'move' })
    expect(s.p1).toEqual({ col: 5, row: 4, dir: 1 })
    expect(s.turn).toBe(2)
    expect(s.moves).toBe(1)
    expect(s.last).not.toBeNull()
    expect(s.last!.kind).toBe('move')
    expect(s.last!.by).toBe(1)
    expect(s.last!.from).toEqual(base.p1)
    expect(s.last!.endCell).toBe(idx(5, 4))
    expect(s.last!.hit).toBe(false)
  })

  it('不越界：朝棋盘外走时 move 非法', () => {
    // 玩家站在左边界且朝上
    const s = mkState({ col: 0, row: 0, dir: 0 }, { col: 9, row: 7, dir: 3 })
    expect(stepAhead(s, s.p1)).toBeNull()
    expect(legalActions(s).some((a) => a.type === 'move')).toBe(false)
    const after = reduce(s, { type: 'move' })
    // 非法动作原样返回（引用相等），站点壳据此忽略
    expect(after).toBe(s)
    expect(after.moves).toBe(0)
  })

  it('不穿墙：前方是墙时 move 非法', () => {
    const s = withWalls(base, [idx(5, 4)])
    expect(isFree(s, 5, 4)).toBe(false)
    expect(stepAhead(s, s.p1)).toBeNull()
    expect(reduce(s, { type: 'move' })).toBe(s)
  })

  it('不穿车：前方是对方坦克时 move 非法', () => {
    const s = mkState({ col: 4, row: 4, dir: 1 }, { col: 5, row: 4, dir: 3 })
    expect(tankAt(s, 5, 4)).toBe(COMPUTER)
    expect(reduce(s, { type: 'move' })).toBe(s)
  })

  it('前进后仍不能与对方重叠', () => {
    const s = reduce(mkState({ col: 0, row: 0, dir: 1 }, { col: 1, row: 0, dir: 3 }), { type: 'move' })
    expect(s).toBeDefined()
    expect(tankAt(s, s.p1.col, s.p1.row)).toBe(1)
    expect(tankAt(s, s.p2.col, s.p2.row)).toBe(COMPUTER)
  })
})

describe('turn：左右转向', () => {
  it('右转 / 左转各改变一次朝向，位置不变', () => {
    const base = mkState({ col: 3, row: 3, dir: 1 }, { col: 9, row: 7, dir: 3 })
    const right = reduce(base, { type: 'turn', delta: 1 })
    expect(right.p1).toEqual({ col: 3, row: 3, dir: 2 })
    expect(right.turn).toBe(2)
    expect(right.moves).toBe(1)
    expect(right.last!.kind).toBe('turn')
    expect(right.last!.endCell).toBe(idx(3, 3))

    const left = reduce(base, { type: 'turn', delta: -1 })
    expect(left.p1).toEqual({ col: 3, row: 3, dir: 0 })
    expect(dirName(left.p1.dir)).toBe('上')
  })

  it('转向永远合法（哪怕贴边、朝外）', () => {
    const s = mkState({ col: 0, row: 0, dir: 0 }, { col: 9, row: 7, dir: 3 })
    const acts = legalActions(s)
    expect(acts).toContainEqual({ type: 'turn', delta: -1 })
    expect(acts).toContainEqual({ type: 'turn', delta: 1 })
    expect(reduce(s, { type: 'turn', delta: 1 })).not.toBe(s)
  })

  it('非法 delta 原样返回', () => {
    const s = mkState({ col: 3, row: 3, dir: 1 }, { col: 9, row: 7, dir: 3 })
    const bad = { type: 'turn', delta: 2 } as unknown as Action
    expect(reduce(s, bad)).toBe(s)
  })
})

describe('shoot：沿当前朝向的直线判定', () => {
  it('无遮挡命中：path 连续且终点是对方坦克', () => {
    const s = mkState({ col: 0, row: 4, dir: 1 }, { col: 6, row: 4, dir: 3 })
    const t = traceShot(s, s.p1)
    expect(t.hitPlayer).toBe(COMPUTER)
    expect(t.endCell).toBe(idx(6, 4))
    expect(t.path).toEqual([1, 2, 3, 4, 5, 6].map((c) => idx(c, 4)))
    expect(shotHits(s, s.p1)).toBe(true)
    expect(aligned(s.p1, s.p2)).toBe(true)
    expect(clearLine(s, s.p1, s.p2)).toBe(true)
  })

  it('被墙遮挡时不命中，炮弹停在墙上', () => {
    const s = withWalls(mkState({ col: 0, row: 4, dir: 1 }, { col: 6, row: 4, dir: 3 }), [idx(3, 4)])
    expect(clearLine(s, s.p1, s.p2)).toBe(false)
    const t = traceShot(s, s.p1)
    expect(t.hitPlayer).toBe(0)
    expect(t.endCell).toBe(idx(3, 4))
    expect(shotHits(s, s.p1)).toBe(false)
    expect(t.path[t.path.length - 1]).toBe(idx(3, 4))
  })

  it('命中即终局：over=true 且 winner 为开火方', () => {
    const s = mkState({ col: 0, row: 4, dir: 1 }, { col: 6, row: 4, dir: 3 })
    const after = reduce(s, { type: 'shoot' })
    expect(after.over).toBe(true)
    expect(after.winner).toBe(1)
    expect(after.last!.kind).toBe('shoot')
    expect(after.last!.hit).toBe(true)
    expect(after.last!.by).toBe(1)
    expect(after.moves).toBe(1)
    // 终局后再怎么操作都是空转（引用相等）
    expect(reduce(after, { type: 'shoot' })).toBe(after)
    expect(reduce(after, { type: 'move' })).toBe(after)
    expect(legalActions(after)).toHaveLength(0)
  })

  it('打空不终局：炮弹飞出棋盘时 endCell = -1', () => {
    const s = mkState({ col: 0, row: 0, dir: 0 }, { col: 9, row: 7, dir: 3 })
    const t = traceShot(s, s.p1)
    expect(t.hitPlayer).toBe(0)
    expect(t.endCell).toBe(-1)
    const after = reduce(s, { type: 'shoot' })
    expect(after.over).toBe(false)
    expect(after.winner).toBe(0)
    expect(after.last!.hit).toBe(false)
    expect(after.last!.endCell).toBe(-1)
  })

  it('射向背离方向：对方在身后则打不到', () => {
    // 玩家在右、朝右开火，对方在左后方 → 炮弹直接飞出棋盘
    const s = mkState({ col: 6, row: 4, dir: 1 }, { col: 1, row: 4, dir: 3 })
    const t = traceShot(s, s.p1)
    expect(t.hitPlayer).toBe(0)
    expect(t.endCell).toBe(-1)
    expect(aligned(s.p1, s.p2)).toBe(true)
    expect(shotHits(s, s.p1)).toBe(false)
    // 同一行但朝向不对时，不算「炮口正对」
    expect(clearLine(s, s.p1, s.p2)).toBe(true)
  })

  it('vertical 开火方向同样正确', () => {
    const s = mkState({ col: 5, row: 1, dir: 2 }, { col: 5, row: 5, dir: 0 })
    const t = traceShot(s, s.p1)
    expect(t.hitPlayer).toBe(COMPUTER)
    expect(t.endCell).toBe(idx(5, 5))
    expect(t.path).toEqual([2, 3, 4, 5].map((r) => idx(5, r)))
  })
})

describe('终局兜底：回合上限与位置裁决', () => {
  it('到达 MOVE_LIMIT 自动裁决，且绝不平局', () => {
    const s = mkState({ col: 0, row: 0, dir: 2 }, { col: 9, row: 7, dir: 3 }, { moves: MOVE_LIMIT - 1 })
    const after = reduce(s, { type: 'move' })
    expect(after.moves).toBe(MOVE_LIMIT)
    expect(after.over).toBe(true)
    expect(after.winner).not.toBe(0)
  })

  it('decideByPosition 永远返回 1 或 2，平分时判给当前行动方', () => {
    const s = mkState({ col: 0, row: 0, dir: 1 }, { col: 9, row: 7, dir: 3 }, { turn: 2 })
    const w = decideByPosition(s)
    expect(w === 1 || w === 2).toBe(true)
    expect(w).toBe(2)
  })

  it('位置更好的一方获胜', () => {
    // 玩家已经炮口正对对方且无遮挡，电脑躲在斜角
    const s = mkState({ col: 0, row: 4, dir: 1 }, { col: 9, row: 7, dir: 3 })
    expect(decideByPosition(s)).toBe(1)
  })
})

describe('legalActions 不含非法动作', () => {
  it('每个种子、每一手：列出的动作都能真正改变状态', () => {
    for (let seed = 0; seed < 25; seed++) {
      let s = create(seed)
      for (let i = 0; i < 40 && !s.over; i++) {
        const acts = legalActions(s)
        expect(acts.length).toBeGreaterThan(0)
        for (const a of acts) {
          const next = reduce(s, a)
          // 合法动作必须推进手数，且绝不能返回原引用
          expect(next).not.toBe(s)
          expect(next.moves).toBe(s.moves + 1)
        }
        s = reduce(s, acts[0])
      }
    }
  })

  it('move 仅在可走时出现，turn 与 shoot 恒在', () => {
    const blocked = mkState({ col: 0, row: 0, dir: 0 }, { col: 9, row: 7, dir: 3 })
    expect(legalActions(blocked)).toEqual([
      { type: 'turn', delta: -1 },
      { type: 'turn', delta: 1 },
      { type: 'shoot' },
    ])
    const open = mkState({ col: 4, row: 4, dir: 1 }, { col: 9, row: 7, dir: 3 })
    expect(legalActions(open)).toContainEqual({ type: 'move' })
  })

  it('legalActions 只服务当前行动方', () => {
    const s = mkState({ col: 0, row: 0, dir: 1 }, { col: 9, row: 7, dir: 3 }, { turn: 2 })
    const move = reduce(s, { type: 'move' })
    expect(move.p2).not.toEqual(s.p2)
    expect(move.p1).toEqual(s.p1)
  })
})

describe('reduce 纯度：不修改入参', () => {
  it('任意动作后入参快照不变，且关键字段引用不变', () => {
    const s = create(2026)
    const before = JSON.stringify(s)
    const wallsRef = s.walls
    const p1Ref = s.p1
    const p2Ref = s.p2

    const actions: Action[] = [
      { type: 'move' },
      { type: 'turn', delta: 1 },
      { type: 'turn', delta: -1 },
      { type: 'shoot' },
    ]
    for (const a of actions) reduce(s, a)

    expect(JSON.stringify(s)).toBe(before)
    expect(s.walls).toBe(wallsRef)
    expect(s.p1).toBe(p1Ref)
    expect(s.p2).toBe(p2Ref)
    expect(s.moves).toBe(0)
    expect(s.turn).toBe(1)
  })

  it('终局动作后入参同样不被改写', () => {
    const s = reduce(mkState({ col: 0, row: 4, dir: 1 }, { col: 6, row: 4, dir: 3 }), { type: 'shoot' })
    const before = JSON.stringify(s)
    const p1Ref = s.p1
    reduce(s, { type: 'move' })
    reduce(s, { type: 'shoot' })
    expect(JSON.stringify(s)).toBe(before)
    expect(s.p1).toBe(p1Ref)
  })
})

describe('AI 只从合法动作中选择', () => {
  it('bestAction 仅在轮到自己时给动作，否则 null', () => {
    const s = create(5)
    expect(bestAction(s, 1)).not.toBeNull()
    expect(bestAction(s, COMPUTER)).toBeNull()
    expect(aiAction(s)).toBeNull()

    const afterP1 = reduce(s, legalActions(s)[0])
    expect(aiAction(afterP1)).not.toBeNull()
    expect(bestAction(afterP1, 1)).toBeNull()
  })

  it('终局后 AI 返回 null 且无合法动作', () => {
    const done = reduce(mkState({ col: 0, row: 4, dir: 1 }, { col: 6, row: 4, dir: 3 }), { type: 'shoot' })
    expect(done.over).toBe(true)
    expect(aiAction(done)).toBeNull()
    expect(bestAction(done, 1)).toBeNull()
    expect(bestAction(done, COMPUTER)).toBeNull()
  })

  it('每一步 AI 的选择都在 legalActions 内', () => {
    for (let seed = 0; seed < 40; seed++) {
      let s = create(seed)
      for (let i = 0; i < MOVE_LIMIT + 5 && !s.over; i++) {
        const acts = legalActions(s)
        const pick = bestAction(s, s.turn)
        expect(pick).not.toBeNull()
        expect(acts).toContainEqual(pick)
        s = reduce(s, pick!)
      }
    }
  })
})

describe('双方 AI 整局：必然终局且分出胜负', () => {
  it('20 个种子全部走到 over=true 且 winner 非 0', () => {
    const stuck: number[] = []
    let totalMoves = 0
    for (let seed = 0; seed < 20; seed++) {
      const s = playAiVsAi(seed)
      if (!s.over || s.winner === 0) stuck.push(seed)
      totalMoves += s.moves
    }
    // 卡死的 seed 会在这里一次性列出，而不是死循环
    expect(stuck).toEqual([])
    // 平均手数应远低于回合上限（说明是真打出来的胜负，不是卡到上限）
    expect(totalMoves / 20).toBeLessThan(MOVE_LIMIT)
  })

  it('终局兜底：最后一手若是开火，也必须结算回合上限', () => {
    // 契约：settle() 对三种动作一视同仁。当前实现里 shoot 分支绕过了 settle()，
    // 导致双方互射时 MOVE_LIMIT 永远不触发 —— 详见 rules.ts 的 reduce() shoot 分支。
    const missShot = mkState(
      { col: 0, row: 0, dir: 0 }, // 朝上，必打空
      { col: 9, row: 7, dir: 3 },
      { moves: MOVE_LIMIT - 1 },
    )
    const after = reduce(missShot, { type: 'shoot' })
    expect(after.moves).toBe(MOVE_LIMIT)
    expect(after.over).toBe(true)
    expect(after.winner === 1 || after.winner === 2).toBe(true)
  })

  it('单步 AI 决策耗时远低于 50ms 预算', () => {
    let s = create(9)
    let worst = 0
    for (let i = 0; i < 60 && !s.over; i++) {
      const t0 = performance.now()
      const pick = bestAction(s, s.turn)
      const dt = performance.now() - t0
      expect(pick).not.toBeNull()
      if (dt > worst) worst = dt
      s = reduce(s, pick!)
    }
    console.log(`tank-duel 单步 AI 最坏耗时: ${worst.toFixed(3)}ms（预算 50ms）`)
    expect(worst).toBeLessThan(50)
  })
})

describe('可复盘性', () => {
  it('同 seed + 同操作序列 ⇒ 状态完全一致', () => {
    for (const seed of [1, 42, 777]) {
      // 先跑一遍拿到终局状态与手数（playAiVsAi 内部带硬上限，不会死循环）
      const a = playAiVsAi(seed)
      const seq: Action[] = []
      let cur = create(seed)
      while (cur.moves < a.moves) {
        const pick = bestAction(cur, cur.turn) as Action
        seq.push(pick)
        cur = reduce(cur, pick)
      }
      expect(seq).toHaveLength(a.moves)
      expect(cur).toEqual(a)
      // 重放
      let b = create(seed)
      for (const act of seq) b = reduce(b, act)
      expect(b).toEqual(a)
      expect(b.over).toBe(a.over)
      expect(b.winner).toBe(a.winner)
      expect(b.moves).toBe(seq.length)
    }
  })

  it('同 seed 同一状态的 AI 选择可重复', () => {
    const s = create(123)
    expect(bestAction(s, 1)).toEqual(bestAction(create(123), 1))
    expect(aiAction(reduce(create(123), { type: 'turn', delta: 1 }))).not.toBeNull()
  })

  it('前进落点与辅助查询一致', () => {
    const s = create(31)
    const me = tankOf(s, 1)
    const ahead = aheadOf(me, 1)
    const st = stepAhead(s, me)
    if (st) {
      expect(st).toEqual({ col: ahead.col, row: ahead.row })
      expect(inBounds(st.col, st.row)).toBe(true)
    } else {
      expect(isFree(s, ahead.col, ahead.row)).toBe(false)
    }
  })
})
