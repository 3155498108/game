import { describe, expect, it } from 'vitest'
import {
  DIR_ORDER,
  LEVELS,
  type Action,
  type Dir,
  type Level,
  type State,
  applyMove,
  clearedCount,
  create,
  isComplete,
  isStuck,
  levelBestMoves,
  parseLevel,
  reduce,
  remainingBoxes,
  solve,
  step,
} from './rules'

/**
 * 造一个「正在进行某一关」的状态。
 *
 * 不用 `create()`：它会按 seed **打乱关卡顺序**（每日挑战需要这个），
 * 所以基于固定关卡的断言必须自己搭状态，不能依赖 create 的结果。
 */
function stateOf(level: Level, levelId = 0): State {
  const p = parseLevel(level)
  return {
    order: [levelId],
    levelIndex: 0,
    level: p,
    levelId,
    player: p.player,
    boxes: p.boxes.slice(),
    moves: 0,
    pushes: 0,
    history: [],
    phase: 'play',
    hint: null,
    rng: 0,
  }
}

/** 用求解器给出的最短解法把当前这一关打通 */
function playSolution(s: State): State {
  const sol = solve(s.level, s.player, s.boxes)
  if (!sol) throw new Error('这一关无解')
  let cur = s
  for (const d of sol.dirs) cur = reduce(cur, { type: 'move', dir: d })
  return cur
}

/** 一关推一步就赢的最小局面 */
const EASY: Level = {
  name: '测试关',
  rows: ['#######', '#     #', '# @$ .#', '#     #', '#######'],
}

/** 玩家正上方是墙 */
const BLOCKED: Level = {
  name: '撞墙关',
  rows: ['#####', '#@$ #', '#   #', '#  .#', '#####'],
}

describe('关卡解析', () => {
  it('字符含义：墙 / 目标 / 箱子 / 玩家 / 箱子在目标上', () => {
    const p = parseLevel({
      name: 'x',
      rows: ['#######', '#. $@ *#', '#      #', '#######'],
    })
    expect(p.w).toBe(8)
    expect(p.h).toBe(4)
    expect(p.walls[0]).toBe(true)
    expect(p.walls[9]).toBe(false)
    // 目标：'.' 与 '*' → (1,1) (6,1)
    expect(p.targets).toEqual([9, 14])
    // 箱子：'$' 与 '*' → (3,1) (6,1)
    expect(p.boxes).toEqual([11, 14])
    // 玩家：'@' → (4,1)
    expect(p.player).toBe(12)
  })

  it("'+' = 玩家站在目标点上：既算玩家也算目标", () => {
    const p = parseLevel({ name: 'x', rows: ['#####', '#+  #', '#####'] })
    expect(p.player).toBe(6)
    expect(p.targets).toEqual([6])
  })

  it('行宽不等时按最宽的一行补墙，不会越界', () => {
    const p = parseLevel({ name: 'x', rows: ['###', '#@#', '#$#.'] })
    expect(p.w).toBe(4)
    expect(p.h).toBe(3)
    expect(p.walls[3]).toBe(true)
    expect(p.walls[7]).toBe(true)
  })

  it('步出边界返回 -1（不会从一边绕到另一边）', () => {
    const p = parseLevel(EASY)
    expect(step(p, 0, 'left')).toBe(-1)
    expect(step(p, 0, 'up')).toBe(-1)
    expect(step(p, p.w * p.h - 1, 'right')).toBe(-1)
    expect(step(p, p.w * p.h - 1, 'down')).toBe(-1)
  })
})

describe('每一关都是活的（求解器验证）', () => {
  it('全部关卡都可解，且最短步数递增（难度曲线）', () => {
    const best = LEVELS.map((lv) => {
      const m = levelBestMoves(lv)
      expect(m, `关卡「${lv.name}」无解`).not.toBeNull()
      return m as number
    })
    for (let i = 1; i < best.length; i++) {
      expect(best[i], `第 ${i + 1} 关比前一关还简单`).toBeGreaterThanOrEqual(best[i - 1])
    }
  })

  it('每关的箱子数与目标数一致，且玩家存在', () => {
    for (const lv of LEVELS) {
      const p = parseLevel(lv)
      expect(p.boxes.length, `关卡「${lv.name}」箱子数与目标数不等`).toBe(p.targets.length)
      expect(p.player, `关卡「${lv.name}」没有玩家`).toBeGreaterThanOrEqual(0)
    }
  })

  it('求解器给出的解法真的能把箱子推到目标上', () => {
    for (const lv of LEVELS) {
      const p = parseLevel(lv)
      const sol = solve(p, p.player, p.boxes)
      expect(sol, `关卡「${lv.name}」无解`).not.toBeNull()
      let cur = { player: p.player, boxes: p.boxes.slice() }
      for (const d of sol!.dirs) {
        const r = applyMove(p, cur.player, cur.boxes, d)
        expect(r.moved, `关卡「${lv.name}」的解法里有一步走不通`).toBe(true)
        cur = { player: r.player, boxes: r.boxes }
      }
      expect(isComplete(cur.boxes, p.targets), `关卡「${lv.name}」走完还没通关`).toBe(true)
    }
  })
})

describe('移动', () => {
  const p = parseLevel(EASY)

  it('走进空格：玩家前进，箱子不动', () => {
    const r = applyMove(p, p.player, p.boxes, 'left')
    expect(r.moved).toBe(true)
    expect(r.pushed).toBe(false)
    expect(r.player).toBe(p.player - 1)
  })

  it('撞墙不动', () => {
    const bp = parseLevel(BLOCKED)
    const r = applyMove(bp, bp.player, bp.boxes, 'up')
    expect(r.moved).toBe(false)
    expect(r.player).toBe(bp.player)
  })

  it('推箱子：箱子前进一格，玩家跟进', () => {
    const r = applyMove(p, p.player, p.boxes, 'right')
    expect(r.moved).toBe(true)
    expect(r.pushed).toBe(true)
    expect(r.boxes).toEqual([p.boxes[0] + 1])
    expect(r.player).toBe(p.player + 1)
  })

  it('箱子后面是墙：推不动，玩家也不动', () => {
    const blocked: Level = {
      name: 'x',
      rows: ['#######', '#     #', '#@$#  #', '#     #', '#######'],
    }
    const bp = parseLevel(blocked)
    const r = applyMove(bp, bp.player, bp.boxes, 'right')
    expect(r.moved).toBe(false)
    expect(r.boxes).toEqual(bp.boxes)
  })

  it('箱子后面是另一个箱子：推不动', () => {
    const two: Level = { name: 'x', rows: ['#######', '#     #', '#@$$  #', '#     #', '#######'] }
    const tp = parseLevel(two)
    const r = applyMove(tp, tp.player, tp.boxes, 'right')
    expect(r.moved).toBe(false)
  })

  it('箱子列表始终保持升序（状态比较与去重依赖这一点）', () => {
    const wide: Level = { name: 'x', rows: ['#########', '#       #', '#@$ $  .#', '#       #', '#########'] }
    const wp = parseLevel(wide)
    const r = applyMove(wp, wp.player, wp.boxes, 'right')
    expect(r.boxes).toEqual([...r.boxes].sort((a, b) => a - b))
  })
})

describe('通关判定与死局', () => {
  it('所有箱子都在目标上 = 通关', () => {
    const p = parseLevel(EASY)
    expect(isComplete([p.targets[0]], p.targets)).toBe(true)
    expect(isComplete([p.boxes[0]], p.targets)).toBe(false)
  })

  it('箱子数与目标数不等时不算通关', () => {
    const p = parseLevel(EASY)
    expect(isComplete([p.targets[0], p.targets[0]], p.targets)).toBe(false)
  })

  it('箱子被顶在墙角（且不在目标上）= 死局', () => {
    const walled: Level = { name: 'x', rows: ['#####', '#$  #', '##  #', '#.  #', '#####'] }
    const p = parseLevel(walled)
    // 箱子在 (1,1)：左边是墙，下面 (1,2) 是墙 → 死角
    expect(isStuck(p, p.boxes)).toBe(true)
  })

  it('箱子在开阔处不算死局', () => {
    const p = parseLevel(EASY)
    expect(isStuck(p, p.boxes)).toBe(false)
  })

  it('箱子已经在目标点上时不算死局', () => {
    const lv: Level = { name: 'x', rows: ['#####', '#*  #', '##  #', '#   #', '#####'] }
    const p = parseLevel(lv)
    expect(isStuck(p, p.boxes)).toBe(false)
  })
})

describe('状态迁移', () => {
  it('开局：第 1 关、步数 0、推箱 0', () => {
    const s = create(42)
    expect(s.levelIndex).toBe(0)
    expect(s.moves).toBe(0)
    expect(s.pushes).toBe(0)
    expect(s.phase).toBe('play')
    expect(clearedCount(s)).toBe(0)
    expect(s.history.length).toBe(0)
    expect(s.order.length).toBe(LEVELS.length)
  })

  it('走一步：步数 +1，推箱数按需 +1', () => {
    const s = stateOf(EASY)
    const next = reduce(s, { type: 'move', dir: 'right' })
    expect(next.moves).toBe(1)
    expect(next.pushes).toBe(1)
    expect(next.player).not.toBe(s.player)
  })

  it('撞墙：状态完全不变（引用也相同）', () => {
    const s = stateOf(BLOCKED)
    expect(reduce(s, { type: 'move', dir: 'up' })).toBe(s)
  })

  it('撤销：回到上一步', () => {
    let s = stateOf(EASY)
    s = reduce(s, { type: 'move', dir: 'right' })
    s = reduce(s, { type: 'move', dir: 'right' })
    const back = reduce(s, { type: 'undo' })
    expect(back.moves).toBe(1)
    expect(back.pushes).toBe(1)
    expect(back.history.length).toBe(1)
  })

  it('没有历史时撤销是空操作', () => {
    const s = stateOf(EASY)
    expect(reduce(s, { type: 'undo' })).toBe(s)
  })

  it('重开：恢复本关初始局面，步数归零', () => {
    let s = stateOf(EASY)
    s = reduce(s, { type: 'move', dir: 'right' })
    s = reduce(s, { type: 'move', dir: 'right' })
    const fresh = reduce(s, { type: 'reset' })
    expect(fresh.moves).toBe(0)
    expect(fresh.pushes).toBe(0)
    expect(fresh.player).toBe(fresh.level.player)
    expect(fresh.boxes).toEqual(fresh.level.boxes)
    expect(fresh.history.length).toBe(0)
  })

  it('通关后进入 won，且通关数 +1', () => {
    const won = playSolution(stateOf(EASY))
    expect(won.phase).toBe('won')
    expect(clearedCount(won)).toBe(1)
    expect(remainingBoxes(won)).toBe(0)
  })

  it('通关后可以撤销：玩家想刷更少的步数时不能被卡住', () => {
    const won = playSolution(stateOf(EASY))
    expect(won.phase).toBe('won')
    const back = reduce(won, { type: 'undo' })
    expect(back.phase).toBe('play')
    expect(back.moves).toBe(won.moves - 1)
    expect(clearedCount(back)).toBe(0)
  })

  it('通关后「重打本关」真的能重开（按钮摆在那儿却没反应是最糟的 bug）', () => {
    const won = playSolution(stateOf(EASY))
    const fresh = reduce(won, { type: 'reset' })
    expect(fresh.phase).toBe('play')
    expect(fresh.moves).toBe(0)
    expect(fresh.pushes).toBe(0)
    expect(fresh.boxes).toEqual(fresh.level.boxes)
    expect(clearedCount(fresh)).toBe(0)
  })

  it('通关后不能再走棋', () => {
    const won = playSolution(stateOf(EASY))
    expect(reduce(won, { type: 'move', dir: 'left' })).toBe(won)
  })

  it('没通关时不能进下一关', () => {
    const s = stateOf(EASY)
    expect(reduce(s, { type: 'next' })).toBe(s)
  })

  it('下一关：换到新关卡，通关数保留', () => {
    const won = playSolution(create(42))
    const next = reduce(won, { type: 'next' })
    expect(next.levelIndex).toBe(1)
    expect(next.phase).toBe('play')
    expect(clearedCount(next)).toBe(1)
    expect(next.moves).toBe(0)
  })

  it('最后一关之后进入 allclear', () => {
    const s = create(42)
    const last: State = { ...s, levelIndex: s.order.length - 1, phase: 'won' }
    const done = reduce(last, { type: 'next' })
    expect(done.phase).toBe('allclear')
  })
})

describe('提示', () => {
  it('给出一个合法的下一步', () => {
    const s = stateOf(EASY)
    const hinted = reduce(s, { type: 'hint' })
    expect(hinted.hint).not.toBeNull()
    expect(DIR_ORDER).toContain(hinted.hint as Dir)
    const moved = reduce(hinted, { type: 'move', dir: hinted.hint as Dir })
    expect(moved.moves).toBe(1)
  })

  it('提示的方向真的在往解上走（按提示走，最短解法会变短）', () => {
    const s = stateOf(EASY)
    const hinted = reduce(s, { type: 'hint' })
    const moved = reduce(hinted, { type: 'move', dir: hinted.hint as Dir })
    const after = solve(moved.level, moved.player, moved.boxes)
    const before = solve(s.level, s.player, s.boxes)
    expect(after).not.toBeNull()
    expect(before).not.toBeNull()
    expect(after!.moves).toBeLessThan(before!.moves)
  })

  it('走了一步之后旧的提示会被清掉', () => {
    const s = stateOf(EASY)
    const hinted = reduce(s, { type: 'hint' })
    const moved = reduce(hinted, { type: 'move', dir: hinted.hint as Dir })
    expect(moved.hint).toBeNull()
  })

  it('已经无解的局面给不出提示', () => {
    // 把箱子推死角之后整局不可解
    const walled: Level = { name: 'x', rows: ['#####', '#@$ #', '#   #', '#  .#', '#####'] }
    const s = stateOf(walled)
    const dead = reduce(s, { type: 'move', dir: 'right' })
    expect(dead.moves).toBe(1)
    expect(reduce(dead, { type: 'hint' }).hint).toBeNull()
  })
})

describe('复盘性', () => {
  it('同 seed + 同操作序列 → 完全相同的结果', () => {
    const ops: Action[] = [
      { type: 'move', dir: 'right' },
      { type: 'move', dir: 'right' },
      { type: 'move', dir: 'down' },
      { type: 'move', dir: 'left' },
    ]
    const run = () => {
      let s = create(2026)
      for (const o of ops) s = reduce(s, o)
      return s
    }
    const a = run()
    const b = run()
    expect(a.player).toBe(b.player)
    expect(a.boxes).toEqual(b.boxes)
    expect(a.moves).toBe(b.moves)
    expect(a.pushes).toBe(b.pushes)
    expect(a.order).toEqual(b.order)
  })

  it('不同 seed → 关卡顺序不同（每日挑战不会和普通局一样）', () => {
    const a = create(1).order
    const b = create(2).order
    const same = a.every((v, i) => v === b[i])
    expect(same).toBe(false)
  })
})
