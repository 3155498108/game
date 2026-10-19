/**
 * 随机迷宫规则单测。
 *
 * 重点不在「走一步会不会动」，而在**生成器的不变量**：
 * 只要迷宫不是完美迷宫（不连通 / 有环 / 有孤立区域），玩家就会遇到
 * 「看着有路却走不到」或「终点根本去不了」，而这种缺陷在渲染上完全看不出来。
 * 所以下面第一组 describe 逐条穷举尺寸与种子，把生成树性质钉死。
 */
import { describe, expect, it } from 'vitest'
import {
  COIN_PAR,
  DIRS,
  MIN_EXTRA,
  NO_HINT,
  SIDE_MAX,
  SIDE_MIN,
  SLACK_RATE,
  coinsFor,
  create,
  exitCell,
  generateMaze,
  limitFor,
  movesOf,
  nextDir,
  oppositeDir,
  passageCount,
  playerCell,
  reachableCount,
  reduce,
  shortestPath,
  sideForLevel,
  stepCell,
  type Action,
  type State,
} from './rules'

/** 把一批动作依次打进 state，返回终态 */
function run(state: State, actions: Action[]): State {
  return actions.reduce(reduce, state)
}

/** 照着最短路把一关走完，返回终态 */
function solveLevel(state: State): State {
  let s = state
  for (let guard = 0; guard < 10000 && !s.clearedThisLevel && !s.over; guard++) {
    const d = nextDir(s)
    if (d === NO_HINT) break
    s = reduce(s, { type: 'move', dir: d })
  }
  return s
}

describe('生成器：递归回溯产出的是完美迷宫', () => {
  // 逐个尺寸 × 逐个种子穷举。尺寸取实际会用到的全部值（9/11/13/15/17）。
  const CASES: Array<[number, number]> = []
  for (let lv = 1; sideForLevel(lv) < SIDE_MAX; lv++) CASES.push([sideForLevel(lv), 1000 + lv])
  CASES.push([SIDE_MAX, 1007])

  it.each(CASES)('%i×%i 生成树性质：连通且无环（通道数 = 格子数 - 1）', (side, seed) => {
    const cells = generateMaze(side, side, seed)
    expect(cells).toHaveLength(side * side)
    // 完美迷宫 = 生成树，边数恒等于点数 - 1。这一条同时否掉「孤立区域」与「有环」
    expect(passageCount(side, side, cells)).toBe(side * side - 1)
    // 再从连通性一侧独立验一遍，两条互不依赖
    expect(reachableCount(side, side, cells, 0)).toBe(side * side)
  })

  it.each(CASES)('%i×%i 每个格子至少有一条通路，没有死到出不去的孤岛', (side, seed) => {
    const cells = generateMaze(side, side, seed)
    for (let cell = 0; cell < side * side; cell++) {
      let open = 0
      for (let d = 0; d < DIRS.length; d++) if ((cells[cell] & DIRS[d].bit) === 0) open++
      expect(open, `格子 ${cell} 四面全封`).toBeGreaterThan(0)
    }
  })

  it.each(CASES)('%i×%i 起点到终点恰好一条路', (side, seed) => {
    const cells = generateMaze(side, side, seed)
    const exit = side * side - 1
    const path = shortestPath(side, side, cells, 0, exit)
    expect(path).not.toBeNull()
    expect(path![0]).toBe(0)
    expect(path![path!.length - 1]).toBe(exit)
    // 相邻两格之间必须是开着的墙，否则这条「路」是假的
    for (let i = 1; i < path!.length; i++) {
      const from = path![i - 1]
      const to = path![i]
      const back = shortestPath(side, side, cells, to, from)
      expect(back).toHaveLength(2)
    }
  })

  it('拆墙永远是成对的：本格某面开了，邻格对应那面也一定开着', () => {
    for (const side of [9, 11, 13, 17]) {
      const cells = generateMaze(side, side, side * 31 + 5)
      for (let cell = 0; cell < side * side; cell++) {
        for (let d = 0; d < DIRS.length; d++) {
          if ((cells[cell] & DIRS[d].bit) !== 0) continue
          const col = cell % side
          const row = (cell - col) / side
          const nc = col + DIRS[d].dc
          const nr = row + DIRS[d].dr
          if (nc < 0 || nr < 0 || nc >= side || nr >= side) {
            throw new Error(`格子 ${cell} 的方向 ${d} 开着却通到盘外`)
          }
          const other = nr * side + nc
          expect(cells[other] & DIRS[oppositeDir(d)].bit, `格子 ${cell} 与 ${other} 单边开墙`).toBe(0)
        }
      }
    }
  })

  it('同种子必然同迷宫，异种子必然不同迷宫', () => {
    const a = generateMaze(11, 11, 42)
    const b = generateMaze(11, 11, 42)
    const c = generateMaze(11, 11, 43)
    expect(b).toEqual(a)
    expect(c).not.toEqual(a)
    // 注意生成函数不修改入参之外的东西，也不共享内部数组
    expect(a).not.toBe(b)
  })

  it('起点固定左上、终点固定右下', () => {
    const s = create(2024)
    expect(playerCell(s)).toBe(0)
    expect(exitCell(s)).toBe(s.cols * s.rows - 1)
  })
})

describe('关卡规模与步数预算', () => {
  it('边长逐关变大并封顶在 SIDE_MAX', () => {
    expect(sideForLevel(1)).toBe(SIDE_MIN)
    for (let lv = 2; lv <= 12; lv++) {
      expect(sideForLevel(lv)).toBeGreaterThanOrEqual(sideForLevel(lv - 1))
      expect(sideForLevel(lv)).toBeLessThanOrEqual(SIDE_MAX)
    }
    expect(sideForLevel(99)).toBe(SIDE_MAX)
  })

  it('边长取不到非整数（曾经最怕 9 + 2×小数 算出 10.5 格）', () => {
    for (let lv = 1; lv <= 30; lv++) expect(Number.isInteger(sideForLevel(lv))).toBe(true)
  })

  it('步数上限永远宽于最短路，且逐关收紧', () => {
    expect(limitFor(20, 1)).toBeGreaterThan(20)
    for (const par of [8, 20, 57, 120, 300]) {
      // 保底：任何关卡的余量都不会少于 MIN_EXTRA
      expect(limitFor(par, 1)).toBeGreaterThanOrEqual(par + MIN_EXTRA)
      // 第 1 关取「比例余量」与「保底余量」里更宽的那个（par=8 时比例只有 4，会被抬到 5）
      expect(limitFor(par, 1) - par).toBe(Math.max(MIN_EXTRA, Math.ceil(par * SLACK_RATE)))
      // 越往后余量只增不减，直到压在 MIN_EXTRA 上。关数要取得够深，
      // 否则 par=300 这种大迷宫在第 40 关还剩 111 步余量，根本没收到底。
      for (const lv of [2, 5, 10, 20, 40, 80, 160, 320, 1000]) {
        expect(limitFor(par, lv)).toBeLessThanOrEqual(limitFor(par, 1))
        expect(limitFor(par, lv) - par).toBeGreaterThanOrEqual(MIN_EXTRA)
      }
      expect(limitFor(par, 1000) - par).toBe(MIN_EXTRA)
    }
  })

  it('异常入参不会算出 NaN 上限', () => {
    for (const lv of [0, -3, 1.5]) expect(Number.isFinite(limitFor(30, lv))).toBe(true)
  })
})

describe('走子规则', () => {
  it('墙还关着的一步会被挡下，且不改变状态', () => {
    let s = create(7)
    // 找到一个四面全封的方向（一定存在：边角至少有一面是外墙）
    let blocked = -1
    for (let d = 0; d < 4; d++) {
      if ((s.cells[playerCell(s)] & DIRS[d].bit) !== 0) {
        blocked = d
        break
      }
    }
    expect(blocked).toBeGreaterThanOrEqual(0)
    const after = reduce(s, { type: 'move', dir: blocked })
    expect(after).toBe(s)
  })

  it('出界与非法方向一律挡下', () => {
    const s = create(11)
    expect(reduce(s, { type: 'move', dir: 0 })).toBe(s) // 起点在左上，上方出界且是外墙
    expect(reduce(s, { type: 'move', dir: -1 })).toBe(s)
    expect(reduce(s, { type: 'move', dir: 4 })).toBe(s)
    expect(reduce(s, { type: 'move', dir: 1.5 })).toBe(s)
  })

  it('合法的一步：位置与步数同步推进', () => {
    const s = create(3)
    const d = nextDir(s)
    expect(d).not.toBe(NO_HINT)
    const after = reduce(s, { type: 'move', dir: d })
    expect(after).not.toBe(s)
    expect(movesOf(after)).toBe(1)
    expect(after.trail).toHaveLength(2)
    expect(stepCell(s.cols, s.rows, s.cells, playerCell(s), d)).toBe(playerCell(after))
  })

  it('走到终点即过关：clearedThisLevel 置位、成绩 +1，但不自动进入下一关', () => {
    let s = create(9)
    s = solveLevel(s)
    expect(s.clearedThisLevel).toBe(true)
    expect(s.cleared).toBe(1)
    expect(s.level).toBe(1)
    expect(playerCell(s)).toBe(exitCell(s))
    // 过关后不能再走
    expect(reduce(s, { type: 'move', dir: 0 })).toBe(s)
    // 过关后撤销也无效（否则能把「已计分」这一步退掉，白拿一分）
    expect(reduce(s, { type: 'undo' })).toBe(s)
  })

  it('next 进入下一关：规模变大、步数清零、成绩保留', () => {
    const s = run(create(9), [{ type: 'move', dir: 0 }])
    const cleared = solveLevel(s)
    const next = reduce(cleared, { type: 'next' })
    expect(next.level).toBe(2)
    expect(next.cols).toBeGreaterThan(s.cols)
    expect(movesOf(next)).toBe(0)
    expect(next.cleared).toBe(1)
    expect(next.over).toBe(false)
    expect(next.clearedThisLevel).toBe(false)
    expect(playerCell(next)).toBe(0)
  })

  it('正好用掉最后一步踩到终点算过关，不算输', () => {
    // 手造一个「预算刚好够走最短路」的局面：把左列与最下一排的墙成对打通，
    // 最短路就是「沿左列下到底，再沿底排走到头」。
    const base = create(5)
    const cells = base.cells.slice()
    for (let r = 0; r + 1 < base.rows; r++) {
      cells[r * base.cols] &= ~DIRS[2].bit
      cells[(r + 1) * base.cols] &= ~DIRS[0].bit
    }
    for (let c = 0; c + 1 < base.cols; c++) {
      const left = (base.rows - 1) * base.cols + c
      cells[left] &= ~DIRS[1].bit
      cells[left + 1] &= ~DIRS[3].bit
    }
    const path = shortestPath(base.cols, base.rows, cells, 0, exitCell(base))!
    const par = path.length - 1
    // 站在最短路的倒数第二格：下一步正好是第 par 步，也正好是最后一步
    const before: State = { ...base, cells, par, limit: par, trail: path.slice(0, -1) }
    expect(movesOf(before)).toBe(par - 1)

    const after = reduce(before, { type: 'move', dir: nextDir(before) })
    expect(movesOf(after)).toBe(par)
    expect(after.limit).toBe(par)
    expect(after.clearedThisLevel).toBe(true)
    expect(after.over).toBe(false)
  })

  it('步数用光即本局结束', () => {
    // 只给 1 步预算，而终点在 9×9 的对角，一步绝不可能踩到
    const start: State = { ...create(13), limit: 1 }
    let moved = false
    for (let d = 0; d < 4 && !moved; d++) {
      const n = reduce(start, { type: 'move', dir: d })
      if (n === start) continue
      moved = true
      expect(n.over).toBe(true)
      expect(n.clearedThisLevel).toBe(false)
      expect(movesOf(n)).toBe(1)
      // 结束之后任何动作都推不动
      expect(reduce(n, { type: 'move', dir: d })).toBe(n)
      expect(reduce(n, { type: 'undo' })).toBe(n)
    }
    expect(moved, '起点总有一步能走，构造失败').toBe(true)
  })

  it('撤销回退一步，且不额外计步', () => {
    let s = create(21)
    const d0 = nextDir(s)
    s = reduce(s, { type: 'move', dir: d0 })
    const d1 = nextDir(s)
    if (d1 !== NO_HINT && !s.clearedThisLevel) s = reduce(s, { type: 'move', dir: d1 })
    const before = movesOf(s)
    const back = reduce(s, { type: 'undo' })
    expect(movesOf(back)).toBe(before - 1)
    // 撤销之后提示要清掉：原来的方向是针对旧位置算的，留着会误导
    expect(back.hint).toBe(NO_HINT)
  })

  it('站在起点时撤销无效', () => {
    const s = create(1)
    expect(reduce(s, { type: 'undo' })).toBe(s)
  })

  it('重开本关拿到的是同一张迷宫', () => {
    let s = create(33)
    const d = nextDir(s)
    s = reduce(s, { type: 'move', dir: d })
    const again = reduce(s, { type: 'restart' })
    expect(again.cells).toEqual(s.cells)
    expect(again.level).toBe(s.level)
    expect(again.limit).toBe(s.limit)
    expect(movesOf(again)).toBe(0)
    expect(again.trail).toEqual([0])
    // 一步没走就用不上重开
    expect(reduce(create(33), { type: 'restart' })).toEqual(create(33))
  })

  it('重开不会把已计入的成绩退回去', () => {
    const cleared = solveLevel(create(33))
    expect(cleared.cleared).toBe(1)
    expect(reduce(cleared, { type: 'restart' })).toBe(cleared)
  })
})

describe('提示', () => {
  it('提示方向确实是通往终点的正确下一步', () => {
    let s = create(77)
    for (let i = 0; i < 6 && !s.clearedThisLevel; i++) {
      const d = nextDir(s)
      if (d === NO_HINT) break
      s = reduce(s, { type: 'move', dir: d })
    }
    const hinted = reduce(s, { type: 'hint' })
    expect(hinted.hint).toBe(nextDir(s))
    expect(hinted.hintUsed).toBe(true)
    // 照提示走一步，确实更靠近终点
    const after = reduce(hinted, { type: 'move', dir: hinted.hint })
    expect(after.trail).toHaveLength(s.trail.length + 1)
  })

  it('每关只能用一次', () => {
    const s = reduce(create(78), { type: 'hint' })
    expect(reduce(s, { type: 'hint' })).toBe(s)
  })

  it('过关后与结束后不能再提示', () => {
    const cleared = solveLevel(create(79))
    expect(reduce(cleared, { type: 'hint' })).toBe(cleared)
  })

  it('下一关会重置提示次数', () => {
    const hinted = reduce(create(80), { type: 'hint' })
    const cleared = solveLevel(hinted)
    const next = reduce(cleared, { type: 'next' })
    expect(next.hintUsed).toBe(false)
    expect(reduce(next, { type: 'hint' })).not.toBe(next)
  })
})

describe('结局与结算', () => {
  it('只有步数用光才结束，过程中 outcome 为空', () => {
    const s = create(101)
    expect(s.over).toBe(false)
    // 过关但还没点下一关时也不该结算——局还没完
    expect(solveLevel(s).over).toBe(false)
  })

  it('成绩等于通关关数，且随通关累加', () => {
    let s = create(102)
    for (let i = 0; i < 3; i++) {
      s = solveLevel(s)
      expect(s.cleared).toBe(i + 1)
      s = reduce(s, { type: 'next' })
    }
    expect(s.cleared).toBe(3)
  })

  it('结束之后所有动作都被挡下', () => {
    const over: State = { ...create(103), over: true }
    for (const a of [
      { type: 'move', dir: 0 },
      { type: 'undo' },
      { type: 'hint' },
      { type: 'restart' },
      { type: 'next' },
    ] satisfies Action[]) {
      expect(reduce(over, a), `动作 ${a.type} 没有被挡住`).toBe(over)
    }
  })
})

describe('门票制金币换算', () => {
  it('未达保本线要扣注额，达线后按整数倍返还', () => {
    expect(coinsFor(0, 100)).toBe(-100)
    expect(coinsFor(COIN_PAR - 1, 100)).toBe(-100)
    expect(coinsFor(COIN_PAR, 100)).toBe(100)
    expect(coinsFor(COIN_PAR * 3, 100)).toBe(300)
    expect(coinsFor(COIN_PAR * 3 + 1, 100)).toBe(300)
  })

  it('净盈亏严格随注额同比缩放（写死面值会被这条抓住）', () => {
    for (const cleared of [0, 1, 2, 5, 9]) {
      expect(coinsFor(cleared, 500)).toBe(coinsFor(cleared, 10) * 50)
    }
  })

  it('脏输入不吐出 NaN', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(Number.isFinite(coinsFor(bad, 100))).toBe(true)
    }
    expect(coinsFor(Number.NaN, 100)).toBe(0)
  })
})

describe('纯函数契约与可复盘', () => {
  it('reduce 不修改入参', () => {
    const s = create(201)
    const before = JSON.stringify({ ...s, seq: s.seq })
    for (const a of [
      { type: 'move', dir: 1 },
      { type: 'move', dir: 2 },
      { type: 'undo' },
      { type: 'hint' },
    ] satisfies Action[]) {
      reduce(s, a)
    }
    expect(JSON.stringify({ ...s, seq: s.seq })).toBe(before)
  })

  it('相同输入两次调用结果完全一致', () => {
    const s = create(202)
    for (const a of [
      { type: 'move', dir: 1 },
      { type: 'hint' },
      { type: 'undo' },
      { type: 'restart' },
      { type: 'next' },
    ] satisfies Action[]) {
      const x = reduce(s, a)
      const y = reduce(s, a)
      expect(x).toEqual(y)
    }
  })

  it('create 同种子可复盘：整局走下来逐帧一致', () => {
    const script: Action[] = [
      { type: 'move', dir: 1 },
      { type: 'hint' },
      { type: 'move', dir: 2 },
      { type: 'undo' },
      { type: 'move', dir: 0 },
    ]
    expect(run(create(777), script)).toEqual(run(create(777), script))
    expect(create(777)).not.toEqual(create(778))
  })

  it('穷举：前 6 关都能在步数上限内按最短路走通，且正好用 par 步', () => {
    for (let lv = 1; lv <= 6; lv++) {
      let s = create(500 + lv)
      // create 永远从第 1 关起步，要量第 lv 关就得先把前面几关打通
      for (let k = 1; k < lv; k++) {
        s = solveLevel(s)
        expect(s.clearedThisLevel, `第 ${k} 关按最短路走不通（种子 ${500 + lv}）`).toBe(true)
        s = reduce(s, { type: 'next' })
      }
      expect(s.level).toBe(lv)
      expect(movesOf(s)).toBe(0)

      const done = solveLevel(s)
      expect(done.clearedThisLevel, `第 ${lv} 关按最短路都走不通（种子 ${500 + lv}）`).toBe(true)
      // 沿最短路走，用掉的步数必然恰好等于 par，且 par 不会超过上限
      expect(movesOf(done)).toBe(done.par)
      expect(movesOf(done)).toBeLessThanOrEqual(done.limit)
      expect(done.over).toBe(false)
    }
  })

  it('每一关的最短步数确实是唯一解：随便乱走不可能比 par 更短', () => {
    const s = create(999)
    const path = shortestPath(s.cols, s.rows, s.cells, 0, exitCell(s))!
    expect(path.length - 1).toBe(s.par)
    expect(movesOf(s)).toBe(0)
  })
})
