import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng'
import {
  GONE,
  KINDS,
  LEVELS,
  MAX_GEN_ATTEMPTS,
  adjacentLayout,
  canConnect,
  countTiles,
  create,
  faceCounts,
  generateFaces,
  hasAnyMove,
  hasAnyMoveIn,
  isFreeAt,
  isSolvable,
  partnerOf,
  pick,
  reduce,
  validIndex,
  type Action,
  type State,
} from './rules'

/** 描述串转牌面：'A' 表示牌面 0，'.' 表示空格（GONE）。例：'ABAB.BABA' 是 2×4 的死局 */
function parse(spec: string): number[] {
  return spec.split('').map((c) => (c === '.' ? GONE : c.charCodeAt(0) - 65))
}

/** 用给定牌面造一个 state（其余字段保持初始值） */
function stateWith(faces: number[], cols: number, rows: number, level = 0): State {
  const base = create(11)
  return {
    ...base,
    level,
    cols,
    rows,
    faces,
    first: -1,
    second: -1,
    pending: false,
    matched: [],
    moves: 0,
    pairs: 0,
    totalMoves: 0,
    totalPairs: 0,
    clears: 0,
    lastFlip: -1,
    hover: -1,
    levelClear: false,
    dead: false,
    allDone: false,
    bestMoves: LEVELS.map(() => -1),
  }
}

const clone = (s: State): State => JSON.parse(JSON.stringify(s)) as State

/** 找出当前任意一对可消的牌 */
function findPair(s: State): [number, number] | null {
  for (let i = 0; i < s.faces.length; i++) {
    if (s.faces[i] === GONE) continue
    const j = partnerOf(s, i)
    if (j > i) return [i, j]
  }
  return null
}

/** 一路只挑可消的对子，把本关消完 */
function autoClear(s: State): State {
  let cur = s
  let guard = 0
  while (!cur.levelClear && guard++ < 200) {
    const pair = findPair(cur)
    if (!pair) break
    cur = pick(pick(cur, pair[0]), pair[1])
  }
  return cur
}

/** 从第 1 关打通到第 3 关 */
function playAll(seed: number): State {
  let s = create(seed)
  let guard = 0
  while (!s.allDone && guard++ < 10) {
    s = autoClear(s)
    if (!s.levelClear) break
    s = reduce(s, { type: 'next' })
  }
  return s
}

describe('关卡设计', () => {
  it('三关牌阵逐关变大，牌数恒为偶数且递增', () => {
    const counts = LEVELS.map((lv) => lv.cols * lv.rows)
    expect(counts).toEqual([8, 16, 24])
    for (const n of counts) expect(n % 2).toBe(0)
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1])
    expect(LEVELS.length).toBe(3)
  })

  it('初始局面与关卡 1 一致，牌面各出现 2 次', () => {
    const s = create(42)
    expect(s.level).toBe(0)
    expect(s.cols).toBe(LEVELS[0].cols)
    expect(s.rows).toBe(LEVELS[0].rows)
    expect(s.faces.length).toBe(8)
    const counts = faceCounts(s.faces, KINDS.length)
    expect(counts.filter((c) => c > 0).length).toBe(4)
    expect(counts.every((c) => c === 0 || c === 2)).toBe(true)
    expect(s.first).toBe(-1)
    expect(s.second).toBe(-1)
    expect(s.pending).toBe(false)
    expect(s.moves).toBe(0)
    expect(s.pairs).toBe(0)
    expect(s.levelClear).toBe(false)
    expect(s.dead).toBe(false)
    expect(s.allDone).toBe(false)
  })

  it('同 seed 完全可复盘，不同 seed 仍是合法局面', () => {
    expect(create(123)).toEqual(create(123))
    expect(create(123).rng).toBe(create(123).rng)
    expect(create(1).faces).not.toEqual(create(2).faces)
    for (const seed of [0, 5, 999, -7]) {
      const s = create(seed)
      expect(countTiles(s.faces)).toBe(8)
      expect(faceCounts(s.faces, KINDS.length).every((c) => c % 2 === 0)).toBe(true)
    }
  })

  it('同一串动作可以完整复盘', () => {
    const play = (): State => {
      let s = create(555)
      s = pick(s, 0)
      s = pick(s, 1)
      s = reduce(s, { type: 'settle' })
      s = pick(s, 0)
      s = reduce(s, { type: 'next' })
      return s
    }
    expect(play()).toEqual(play())
  })
})

describe('连通判定', () => {
  it('直线相邻可以连通', () => {
    const f = parse('AA......')
    expect(canConnect(f, 4, 2, 0, 1)).toBe(true)
  })

  it('同行隔空（中间全被消除）可以连通', () => {
    const f = parse('A...A..B')
    expect(canConnect(f, 4, 2, 0, 4)).toBe(true)
  })

  it('L 形 1 次拐弯可以连通', () => {
    // (0,0) → 拐点 (0,3) → (1,3)，两段都畅通
    const f = parse('A......A')
    expect(canConnect(f, 4, 2, 0, 7)).toBe(true)
  })

  it('两个拐点都被挡住时不可连通', () => {
    const f = parse('ABBBB..A')
    expect(canConnect(f, 4, 2, 0, 7)).toBe(false)
  })

  it('同行被两张牌堵死时不可连通', () => {
    // A 在 (0,0) 与 (0,3)，中间的 B 堵住直路，两个拐点 (0,3)/(1,0) 也被 B 占
    const f = parse('ABBA B..B'.replace(/ /g, ''))
    expect(canConnect(f, 4, 2, 0, 3)).toBe(false)
    // 同一张牌阵里，B 的两张 (0,1)/(0,2) 相邻，仍可连通
    expect(canConnect(f, 4, 2, 1, 2)).toBe(true)
    // B 的 (1,0) 与 (1,3) 同列直路，中间为空
    expect(canConnect(f, 4, 2, 4, 7)).toBe(true)
  })

  it('牌面不同一律不可连通（哪怕路径畅通）', () => {
    const f = parse('AB.......')
    expect(canConnect(f, 4, 2, 0, 7)).toBe(false)
    expect(canConnect(f, 4, 2, 0, 1)).toBe(false)
  })

  it('已消除的牌、越界索引、下标相同都不可连通', () => {
    const f = parse('A.B.A..B')
    // 同列隔空：中间全是已消除的空格，可连通
    expect(canConnect(f, 4, 2, 0, 4)).toBe(true)
    // 空格本身不参与连通
    expect(canConnect(f, 4, 2, 1, 2)).toBe(false)
    expect(canConnect(f, 4, 2, 3, 2)).toBe(false)
    expect(canConnect(f, 4, 2, 0, 0)).toBe(false)
    expect(canConnect(f, 4, 2, 0, 8)).toBe(false)
    expect(canConnect(f, 4, 2, -1, 2)).toBe(false)
    expect(canConnect(f, 4, 2, 0, 2.5)).toBe(false)
    expect(validIndex(7, 4, 2)).toBe(true)
    expect(validIndex(8, 4, 2)).toBe(false)
    expect(validIndex(1.5, 4, 2)).toBe(false)
  })

  it('牌阵外扩一圈视为空格，再往外一格不参与判定', () => {
    const f = parse('ABBAB..B') // 2 行 4 列
    // 盘外那一圈：pr ∈ {0, rows+1}、pc ∈ {0, cols+1} 都算空
    expect(isFreeAt(f, 4, 2, 0, 0)).toBe(true)
    expect(isFreeAt(f, 4, 2, 0, 2)).toBe(true)
    expect(isFreeAt(f, 4, 2, 3, 0)).toBe(true)
    expect(isFreeAt(f, 4, 2, 1, 5)).toBe(true)
    expect(isFreeAt(f, 4, 2, 2, 5)).toBe(true)
    // 比这一圈更远 → 不算空
    expect(isFreeAt(f, 4, 2, -1, 0)).toBe(false)
    expect(isFreeAt(f, 4, 2, 4, 0)).toBe(false)
    expect(isFreeAt(f, 4, 2, 0, -1)).toBe(false)
    expect(isFreeAt(f, 4, 2, 0, 6)).toBe(false)
    // 盘内：有牌为不空，空牌（已消除）为空
    expect(isFreeAt(f, 4, 2, 1, 2)).toBe(false)
    expect(isFreeAt(f, 4, 2, 2, 4)).toBe(false)
    expect(isFreeAt(f, 4, 2, 2, 3)).toBe(true)
    expect(isFreeAt(f, 4, 2, 2, 2)).toBe(true)
  })

  it('绕出盘面需要 2 次拐弯，本规则判为不可消（≤1 拐弯的边界）', () => {
    // 2×4 全部占满且没有两张同牌相邻：没有任何 ≤1 拐弯的通路。
    // 宽松版（不限拐弯）本可沿盘外绕过去，但本规则只允许 1 次拐弯，因此判不可消。
    const full = parse('ABABBABA')
    expect(countTiles(full)).toBe(8)
    expect(hasAnyMoveIn(full, 4, 2)).toBe(false)
    for (let i = 0; i < full.length; i++) {
      for (let j = i + 1; j < full.length; j++) {
        if (full[i] !== full[j]) continue
        expect(canConnect(full, 4, 2, i, j)).toBe(false)
      }
    }
  })

  it('可解性判定：贪心能消完才算可解', () => {
    expect(isSolvable(parse('AA......'), 4, 2)).toBe(true)
    expect(isSolvable(parse('ABABBABA'), 4, 2)).toBe(false)
    expect(isSolvable(parse('A........'), 4, 2)).toBe(false)
  })
})

describe('翻牌与消除', () => {
  it('翻第一张：只翻开它自己，不计步', () => {
    const s = stateWith(parse('AABBABBA'), 4, 2)
    const n = pick(s, 0)
    expect(n.first).toBe(0)
    expect(n.second).toBe(-1)
    expect(n.pending).toBe(false)
    expect(n.moves).toBe(0)
    expect(n.pairs).toBe(0)
    expect(n.faces).toEqual(s.faces)
  })

  it('两张连通且牌面相同 → 消除，步数 +1、牌数 -2', () => {
    const s = stateWith(parse('AABBABBA'), 4, 2)
    const n = pick(pick(s, 0), 1)
    expect(n.first).toBe(-1)
    expect(n.pending).toBe(false)
    expect(n.matched).toEqual([0, 1])
    expect(n.moves).toBe(1)
    expect(n.pairs).toBe(1)
    expect(n.totalMoves).toBe(1)
    expect(n.totalPairs).toBe(1)
    expect(n.clears).toBe(1)
    expect(countTiles(n.faces)).toBe(6)
    expect(n.faces[0]).toBe(GONE)
    expect(n.faces[1]).toBe(GONE)
    expect(n.faces.length).toBe(s.faces.length)
  })

  it('牌面不同 → 盖回待确认，步数不变', () => {
    const s = pick(stateWith(parse('AABBABBA'), 4, 2), 0)
    const n = pick(s, 5) // 5 号是 B，与 0 号的 A 不同
    expect(n.pending).toBe(true)
    expect(n.second).toBe(5)
    expect(n.moves).toBe(0)
    expect(n.pairs).toBe(0)
    expect(countTiles(n.faces)).toBe(8)
  })

  it('牌面相同但连不通 → 同样盖回且不计步', () => {
    const s = pick(stateWith(parse('ABBB B..A'.replace(/ /g, '')), 4, 2), 0)
    const n = pick(s, 7)
    expect(n.pending).toBe(true)
    expect(n.moves).toBe(0)
    expect(n.matched).toEqual([])
  })

  it('盖回后可以继续翻牌，步数只在成功消除时累计', () => {
    let s = pick(stateWith(parse('AABBABBA'), 4, 2), 0)
    s = pick(s, 5)
    expect(s.moves).toBe(0)
    s = reduce(s, { type: 'settle' })
    expect(s.pending).toBe(false)
    expect(s.first).toBe(-1)
    expect(s.second).toBe(-1)
    s = pick(s, 0)
    s = pick(s, 1)
    expect(s.moves).toBe(1)
    expect(s.pairs).toBe(1)
    expect(s.moves).toBe(s.pairs)
  })

  it('已消除的牌不能再被选中，也不接受越界下标', () => {
    const s = pick(pick(stateWith(parse('AABBABBA'), 4, 2), 0), 1)
    expect(reduce(s, { type: 'pick', index: 0 })).toBe(s)
    expect(reduce(s, { type: 'pick', index: 1 })).toBe(s)
    expect(reduce(s, { type: 'pick', index: -1 })).toBe(s)
    expect(reduce(s, { type: 'pick', index: 8 })).toBe(s)
    expect(reduce(s, { type: 'pick', index: 2.5 })).toBe(s)
    expect(reduce(s, { type: 'hover', index: 0 })).toBe(s)
  })

  it('待盖回期间不接受第三张牌', () => {
    const s = pick(pick(stateWith(parse('AABBABBA'), 4, 2), 0), 5)
    expect(s.pending).toBe(true)
    expect(reduce(s, { type: 'pick', index: 2 })).toBe(s)
  })

  it('非法动作一律返回同一引用', () => {
    const s = stateWith(parse('AABBABBA'), 4, 2)
    expect(reduce(s, { type: 'settle' })).toBe(s)
    expect(reduce(s, { type: 'next' })).toBe(s)
    expect(reduce(s, { type: 'reshuffle' })).toBe(s)
    expect(reduce(s, { type: 'leave' })).toBe(s)
    expect(reduce(s, { type: 'hover', index: -1 })).toBe(s)
    const first = pick(s, 0)
    expect(reduce(first, { type: 'pick', index: 0 })).toBe(first)
  })

  it('hover / leave 只影响悬停', () => {
    const s = stateWith(parse('AABBABBA'), 4, 2)
    const h = reduce(s, { type: 'hover', index: 3 })
    expect(h.hover).toBe(3)
    expect(h.faces).toEqual(s.faces)
    expect(h.moves).toBe(0)
    expect(reduce(h, { type: 'hover', index: 3 })).toBe(h)
    expect(reduce(h, { type: 'leave' }).hover).toBe(-1)
  })
})

describe('胜负与死局', () => {
  it('全部消除 → 本关完成；三关全清 → allDone', () => {
    let s = stateWith(parse('AABBABBA'), 4, 2)
    s = autoClear(s)
    expect(s.levelClear).toBe(true)
    expect(s.pairs).toBe(4)
    expect(s.moves).toBe(4)
    expect(s.allDone).toBe(false)
    expect(countTiles(s.faces)).toBe(0)

    s = reduce(s, { type: 'next' })
    expect(s.level).toBe(1)
    expect(s.cols).toBe(LEVELS[1].cols)
    expect(s.rows).toBe(LEVELS[1].rows)
    expect(s.moves).toBe(0)
    expect(s.pairs).toBe(0)
    expect(s.bestMoves[0]).toBe(4)

    s = autoClear(s)
    s = reduce(s, { type: 'next' })
    s = autoClear(s)
    expect(s.allDone).toBe(true)
    expect(s.totalPairs).toBe(4 + 8 + 12)
    expect(s.totalMoves).toBe(24)
  })

  it('本关完成后不再接受翻牌，next 只对已完成关卡生效', () => {
    const done = autoClear(stateWith(parse('AABBABBA'), 4, 2))
    expect(reduce(done, { type: 'pick', index: 0 })).toBe(done)
    expect(reduce(done, { type: 'settle' })).toBe(done)
    expect(reduce(done, { type: 'hover', index: 0 })).toBe(done)
    expect(reduce(done, { type: 'leave' })).toBe(done)
  })

  it('还有牌但无牌可消 → 死局，且可以重排救援', () => {
    // 4×4：顶部两张 X 相邻可消；消完之后剩下底部 2×4 的「ABAB / BABA」满盘，是死局
    const s = stateWith(parse('XX......' + 'ABAB' + 'BABA'), 4, 4)
    expect(s.faces.length).toBe(16)
    const after = pick(pick(s, 0), 1)
    expect(after.pairs).toBe(1)
    expect(after.dead).toBe(true)
    expect(after.levelClear).toBe(false)
    expect(countTiles(after.faces)).toBe(8)
    expect(hasAnyMove(after)).toBe(false)

    const saved = reduce(after, { type: 'reshuffle' })
    expect(saved.dead).toBe(false)
    expect(countTiles(saved.faces)).toBe(8)
    expect(isSolvable(saved.faces, 4, 4)).toBe(true)
    // 重排只改变摆放，不改牌面计数
    expect(faceCounts(saved.faces, KINDS.length)).toEqual(faceCounts(after.faces, KINDS.length))
  })

  it('死局态下不接受普通翻牌，但接受重排', () => {
    const dead = { ...stateWith(parse('XX......' + 'ABAB' + 'BABA'), 4, 4), dead: true }
    expect(reduce(dead, { type: 'pick', index: 4 })).toBe(dead)
    expect(reduce(dead, { type: 'settle' })).toBe(dead)
    expect(reduce(dead, { type: 'reshuffle' })).not.toBe(dead)
  })
})

describe('可解性保证', () => {
  it('兜底布局把同牌面的两张摆成相邻，必然可解', () => {
    const kinds = [0, 1, 2, 3]
    const laid = adjacentLayout([...kinds, ...kinds], 4, 2)
    expect(laid.length).toBe(8)
    expect(countTiles(laid)).toBe(8)
    expect(isSolvable(laid, 4, 2)).toBe(true)
    for (let i = 0; i < laid.length; i += 2) expect(laid[i]).toBe(laid[i + 1])
  })

  it('generateFaces 在 12 个 seed 上都产出可解且成对的牌面', () => {
    for (let seed = 1; seed <= 12; seed++) {
      for (const lv of LEVELS) {
        const r = new Rng(seed * 7919 + lv.cols * 31 + lv.rows)
        const faces = generateFaces(r, lv.cols, lv.rows)
        expect(faces.length).toBe(lv.cols * lv.rows)
        expect(countTiles(faces)).toBe(faces.length)
        expect(isSolvable(faces, lv.cols, lv.rows)).toBe(true)
        const counts = faceCounts(faces, KINDS.length)
        expect(counts.filter((c) => c > 0).length).toBe(faces.length / 2)
        expect(counts.every((c) => c === 0 || c === 2)).toBe(true)
      }
    }
    expect(MAX_GEN_ATTEMPTS).toBeGreaterThanOrEqual(100)
  })

  it('三关在 12 个 seed 上都能一路通关（可解性的端到端验证）', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const done = playAll(seed)
      expect(done.allDone).toBe(true)
      expect(done.totalPairs).toBe(24)
      expect(done.totalMoves).toBe(24)
      expect(countTiles(done.faces)).toBe(0)
      expect(done.bestMoves).toEqual([4, 8, 12])
      // 每关的最少步数恒等于该关的对数（每对恰好一步）
      expect(done.bestMoves[0]).toBe(4)
      expect(done.bestMoves[1]).toBe(8)
      expect(done.bestMoves[2]).toBe(12)
    }
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参（深拷贝快照比对）', () => {
    let s = stateWith(parse('AABBABBA'), 4, 2)
    s = pick(s, 0)
    s = pick(s, 5) // 触发 pending
    const before = JSON.stringify(s)
    const after = reduce(s, { type: 'settle' })
    expect(JSON.stringify(s)).toBe(before)
    expect(s.faces[0]).not.toBe(GONE)
    expect(s.pending).toBe(true)
    expect(s.moves).toBe(0)
    expect(after).not.toBe(s)

    const picked = pick(pick(clone(s), 0), 5)
    const snap = JSON.stringify(picked)
    const cleared = pick(pick(reduce(picked, { type: 'settle' }), 0), 1)
    expect(JSON.stringify(picked)).toBe(snap)
    expect(cleared.faces).not.toBe(picked.faces)
    expect(cleared.moves).toBe(1)
    expect(clone(picked).rng).toBe(picked.rng)
  })

  it('next 换关不会把上一关的牌面数组留在 state 上', () => {
    const done = autoClear(stateWith(parse('AABBABBA'), 4, 2))
    const n = reduce(done, { type: 'next' })
    expect(n.faces).not.toBe(done.faces)
    expect(n.faces.length).toBe(16)
    expect(isSolvable(n.faces, n.cols, n.rows)).toBe(true)
  })

  it('相同输入两次调用结果完全相等', () => {
    const s = stateWith(parse('AABBABBA'), 4, 2)
    expect(reduce(s, { type: 'pick', index: 0 })).toEqual(reduce(s, { type: 'pick', index: 0 }))
    expect(reduce(s, { type: 'next' })).toEqual(reduce(s, { type: 'next' }))
  })
})

describe('随机模拟的不变量（每局 300 步）', () => {
  it('牌面计数守恒、无牌被重复消除、步数与配对数始终一致', () => {
    for (const seed of [1, 7, 42, 2024]) {
      const r = new Rng(seed)
      let s = create(seed)
      let gone = new Set<number>()
      let steps = 0
      const kinds = KINDS.length
      while (steps < 300 && !s.allDone) {
        steps++
        const beforeFaces = s.faces
        const beforeMoves = s.moves
        const beforePairs = s.pairs
        const beforeClears = s.clears
        const beforeLevel = s.level
        const beforeTotal = s.totalMoves
        let action: Action
        if (s.levelClear) action = { type: 'next' }
        else if (s.dead) action = { type: 'reshuffle' }
        else if (s.pending) action = { type: 'settle' }
        else action = { type: 'pick', index: r.int(s.faces.length + 2) }
        s = reduce(s, action)
        // 换关会换一整块牌阵，已消除清单随之作废
        if (s.level !== beforeLevel) {
          gone.clear()
          expect(s.moves).toBe(0)
          expect(s.pairs).toBe(0)
          expect(countTiles(s.faces)).toBe(s.faces.length)
        }
        if (s.faces === beforeFaces) {
          // reduce 没有换牌面时（被拒绝的动作）不应有计数变化
          expect(s.moves).toBe(beforeMoves)
          expect(s.pairs).toBe(beforePairs)
        }
        // 1. 牌面计数守恒且恒为偶数
        const counts = faceCounts(s.faces, kinds)
        expect(counts.every((c) => c % 2 === 0)).toBe(true)
        // 2. 牌数守恒递减：剩余牌数 == 总牌数 − 2 × 配对数
        expect(countTiles(s.faces)).toBe(s.faces.length - 2 * s.pairs)
        // 3. 已消除的牌不会复活，也不会被重复消除
        for (const i of gone) expect(s.faces[i]).toBe(GONE)
        if (s.clears > beforeClears) {
          for (const i of s.matched) {
            expect(gone.has(i)).toBe(false)
            expect(validIndex(i, s.cols, s.rows)).toBe(true)
          }
        }
        // 4. 步数只在成功消除时 +1
        expect(s.moves).toBe(s.pairs)
        expect(s.totalMoves).toBe(s.totalPairs)
        expect(s.totalMoves - beforeTotal).toBeLessThanOrEqual(1)
        expect(s.moves - beforeMoves).toBeLessThanOrEqual(1)
        expect(s.pairs - beforePairs).toBeLessThanOrEqual(1)
        // 5. 新消除的两张立即入列
        for (let i = 0; i < s.faces.length; i++) if (s.faces[i] === GONE) gone.add(i)
      }
      expect(steps).toBeGreaterThan(30)
    }
  })
})