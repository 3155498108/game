import { describe, expect, it } from 'vitest'
import { PALETTE } from '../../render/draw'
import {
  COLOR_STEP,
  MAX_COLORS,
  MAX_TAIL,
  START_COLORS,
  START_TAIL,
  colorCountFor,
  create,
  expected,
  isValidColor,
  next,
  pick,
  ready,
  reduce,
  type Action,
  type State,
} from './rules'
import { VW, segPos, segRadius, swatchRect } from './index'

/** 答对一整题：ask → show → input → 答对，停在结算阶段 */
function answer(s: State): State {
  return pick(ready(ready(s)), expected(s))
}

/** 答对一整题并出下一题，回到出题阶段 */
function playRound(s: State): State {
  return next(answer(s))
}

/** 全程答对，走到终局（应为 won） */
function playPerfect(seed: number): State {
  let s = create(seed)
  let guard = 0
  while (s.phase !== 'won' && s.phase !== 'over' && guard++ < MAX_TAIL + 4) s = playRound(s)
  return s
}

/** 任意一个一定错误的颜色（色板至少 3 色，取 +1 必然落在范围内且不等于答案） */
const wrongColor = (s: State): number => (s.quizColor + 1) % s.colorCount

/** 把题目（round / quizIndex / quizColor / 尾巴长度）记成一串，用于复盘比对 */
function questionLog(seed: number): string[] {
  const log: string[] = []
  let s = create(seed)
  while (s.phase !== 'won' && s.phase !== 'over') {
    log.push(`${s.round}:${s.quizIndex}/${s.quizColor}/${s.tail.length}`)
    s = s.phase === 'settle' ? next(s) : answer(s)
  }
  return log
}

describe('初始状态', () => {
  it('开局尾巴 3 节、处于出题阶段', () => {
    const s = create(42)
    expect(s.tail).toHaveLength(START_TAIL)
    expect(s.phase).toBe('ask')
    expect(s.round).toBe(0)
    expect(s.colorCount).toBe(START_COLORS)
    expect(s.lastPick).toBe(-1)
    expect(s.lastWrong).toBe(false)
  })

  it('答案永远等于被问到那一节的颜色', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = create(seed * 7919)
      expect(s.quizIndex).toBeGreaterThanOrEqual(0)
      expect(s.quizIndex).toBeLessThan(s.tail.length)
      expect(expected(s)).toBe(s.tail[s.quizIndex])
    }
  })

  it('不同种子都给出合法尾巴，颜色落在当回合色板内', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = create(seed * 104729)
      expect(s.tail.every((c) => c >= 0 && c < s.colorCount)).toBe(true)
    }
  })
})

describe('回合阶段机', () => {
  it('ask → show → input 逐级推进', () => {
    const s = create(7)
    const a = ready(s)
    expect(a.phase).toBe('show')
    const b = ready(a)
    expect(b.phase).toBe('input')
    expect(b.quizIndex).toBe(s.quizIndex)
    expect(b.quizColor).toBe(s.quizColor)
  })

  it('只有出题与展示阶段接受 ready，其余阶段返回同一对象', () => {
    const asking = create(7)
    const showing = ready(asking)
    const inputting = ready(showing)
    expect(reduce(inputting, { type: 'ready' })).toBe(inputting)
    const settling = answer(create(11))
    expect(settling.phase).toBe('settle')
    expect(reduce(settling, { type: 'ready' })).toBe(settling)
    expect(reduce(asking, { type: 'next' })).toBe(asking)
    expect(reduce(showing, { type: 'next' })).toBe(showing)
    const over = pick(inputting, wrongColor(inputting))
    expect(over.phase).toBe('over')
    expect(reduce(over, { type: 'ready' })).toBe(over)
    expect(reduce(over, { type: 'next' })).toBe(over)
  })

  it('只有结算阶段能进入下一题', () => {
    const settle = answer(create(11))
    expect(settle.phase).toBe('settle')
    expect(next(settle).phase).toBe('ask')
    expect(next(settle).quizIndex).not.toBe(settle.quizIndex)
  })

  it('出题 / 展示阶段不接受还原', () => {
    const s = create(7)
    const showing = ready(s)
    for (let c = 0; c < s.colorCount; c++) {
      expect(reduce(s, { type: 'pick', color: c })).toBe(s)
      expect(reduce(showing, { type: 'pick', color: c })).toBe(showing)
    }
  })

  it('越界的颜色取值不改变状态', () => {
    const s = ready(ready(create(7)))
    expect(reduce(s, { type: 'pick', color: -1 })).toBe(s)
    expect(reduce(s, { type: 'pick', color: s.colorCount })).toBe(s)
    expect(reduce(s, { type: 'pick', color: 1.5 })).toBe(s)
    expect(isValidColor(s, 0)).toBe(true)
    expect(isValidColor(s, s.colorCount - 1)).toBe(true)
    expect(isValidColor(s, s.colorCount)).toBe(false)
  })
})

describe('还原正确则尾巴加长一节', () => {
  it('答对一次长度 +1，停在结算阶段', () => {
    const s = ready(ready(create(3)))
    const n = pick(s, expected(s))
    expect(n.phase).toBe('settle')
    expect(n.tail).toHaveLength(s.tail.length + 1)
    expect(n.round).toBe(1)
    expect(n.lastWrong).toBe(false)
    expect(n.lastPick).toBe(s.quizColor)
    // 前面的节原封不动，只在尾部增长
    expect(n.tail.slice(0, s.tail.length)).toEqual(s.tail)
  })

  it('连续答对 4 题，每题都 +1', () => {
    let s = create(5)
    for (let i = 0; i < 4; i++) {
      const before = s.tail.length
      s = playRound(s)
      expect(s.tail.length).toBe(before + 1)
      expect(s.round).toBe(i + 1)
    }
    expect(s.tail).toHaveLength(START_TAIL + 4)
  })

  it('尾巴任何时候都不超过上限，且每节颜色都在当回合色板内', () => {
    const s = playPerfect(2026)
    expect(s.tail.length).toBeLessThanOrEqual(MAX_TAIL)
    expect(s.tail.every((c) => c >= 0 && c < s.colorCount)).toBe(true)
  })
})

describe('还原错误立刻终局', () => {
  it('选错颜色 → 立刻结束，长度停在当前值', () => {
    const s = ready(ready(create(9)))
    const n = pick(s, wrongColor(s))
    expect(n.phase).toBe('over')
    expect(n.lastWrong).toBe(true)
    expect(n.lastPick).toBe(wrongColor(s))
    expect(n.tail).toHaveLength(s.tail.length)
    expect(n.round).toBe(s.round)
  })

  it('中途答错会记录当时的尾巴长度', () => {
    let s = playRound(create(4)) // 第 1 题答对，已出第 2 题
    s = ready(ready(s))
    const n = pick(s, wrongColor(s))
    expect(n.phase).toBe('over')
    expect(n.round).toBe(1)
    expect(n.tail).toHaveLength(START_TAIL + 1)
  })

  it('结束后不再接受任何输入', () => {
    const cur = ready(ready(create(9)))
    const over = pick(cur, wrongColor(cur))
    const acts: Action[] = [
      { type: 'ready' },
      { type: 'next' },
      ...Array.from({ length: MAX_COLORS }, (_, i): Action => ({ type: 'pick', color: i })),
    ]
    for (const a of acts) expect(reduce(over, a)).toBe(over)
  })

  /**
   * 还原必须校验「被问到的那一节」：颜色虽然出现在尾巴别处，但那一节颜色不同，同样算错。
   * 否则玩家扫一眼尾巴就能猜中，记忆就失去意义。
   */
  it('颜色对但不是被问的那一节，也判错', () => {
    let checked = 0
    for (let seed = 1; seed <= 300 && checked < 10; seed++) {
      const s = ready(ready(create(seed * 31)))
      // 找一个「尾巴上确实存在、但与答案不同」的颜色
      const other = s.tail.find((c) => c !== s.quizColor)
      if (other === undefined) continue
      checked++
      expect(isValidColor(s, other)).toBe(true)
      expect(pick(s, other).phase).toBe('over')
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('难度曲线', () => {
  it('开局 3 色，每答对 2 题多一种颜色，封顶 8 色', () => {
    expect(colorCountFor(0)).toBe(START_COLORS)
    expect(colorCountFor(COLOR_STEP - 1)).toBe(START_COLORS)
    expect(colorCountFor(COLOR_STEP)).toBe(START_COLORS + 1)
    for (let r = 1; r <= 200; r++) {
      const cur = colorCountFor(r)
      expect(cur).toBeGreaterThanOrEqual(colorCountFor(r - 1))
      expect(cur).toBeLessThanOrEqual(MAX_COLORS)
      expect(cur).toBeGreaterThanOrEqual(START_COLORS)
    }
    expect(colorCountFor(999)).toBe(MAX_COLORS)
  })

  it('颜色数不得超过调色板长度（否则渲染会取不到色）', () => {
    expect(MAX_COLORS).toBeLessThanOrEqual(PALETTE.length)
  })

  it('实局中颜色数随回合单调增长，并在最后一题达到上限', () => {
    let s = create(13)
    let prev = s.colorCount
    while (s.phase !== 'won') {
      expect(s.colorCount).toBeGreaterThanOrEqual(prev)
      prev = s.colorCount
      s = playRound(s)
    }
    expect(s.phase).toBe('won')
    expect(s.colorCount).toBe(MAX_COLORS)
  })
})

describe('终局与可复盘', () => {
  it('全程答对 → 尾巴长到上限后通关', () => {
    const s = playPerfect(1234)
    expect(s.phase).toBe('won')
    expect(s.tail).toHaveLength(MAX_TAIL)
    expect(s.round).toBe(MAX_TAIL - START_TAIL)
    expect(s.lastWrong).toBe(false)
    // 通关时最后一节就是当前题目的答案
    expect(expected(s)).toBe(s.tail[s.quizIndex])
  })

  it('通关后不再接受任何输入', () => {
    const won = playPerfect(1234)
    const acts: Action[] = [{ type: 'ready' }, { type: 'next' }, { type: 'pick', color: 0 }]
    for (const a of acts) expect(reduce(won, a)).toBe(won)
  })

  it('每个种子都能在有限步内分出胜负，不会卡住', () => {
    for (let seed = 1; seed <= 30; seed++) {
      expect(['won', 'over']).toContain(playPerfect(seed * 104729).phase)
    }
  })

  it('故意答错的玩家每一局都会走到终局', () => {
    for (let seed = 1; seed <= 30; seed++) {
      let s = create(seed * 7717)
      s = ready(ready(s))
      const n = pick(s, wrongColor(s))
      expect(n.phase).toBe('over')
    }
  })

  it('同一 seed 的出题序列完全可复现', () => {
    expect(questionLog(20260913)).toEqual(questionLog(20260913))
    expect(create(8888)).toEqual(create(8888))
    // 不同 seed 应当给出不同的题目（否则随机源没接上）
    expect(questionLog(1)).not.toEqual(questionLog(2))
  })

  it('整局重放一致：同样的操作序列得到同样的最终状态', () => {
    const run = (): State => {
      let s = create(31415)
      s = playRound(s)
      s = ready(ready(s))
      return pick(s, wrongColor(s))
    }
    expect(run()).toEqual(run())
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参', () => {
    const s = ready(ready(create(21)))
    const tail = s.tail.slice()
    const rng = s.rng
    const n = pick(s, expected(s))
    expect(s.tail).toEqual(tail)
    expect(s.rng).toBe(rng)
    expect(s.tail).toHaveLength(START_TAIL)
    expect(s.phase).toBe('input')
    expect(n).not.toBe(s)
    expect(n.tail).toHaveLength(START_TAIL + 1)
  })

  it('答错与推进阶段同样不修改入参', () => {
    const s = ready(ready(create(22)))
    const snapshot = JSON.stringify(s)
    pick(s, wrongColor(s))
    ready(ready(s))
    next(answer(create(23)))
    expect(JSON.stringify(s)).toBe(snapshot)
  })

  it('相同输入产生完全相同输出', () => {
    const s = ready(ready(create(21)))
    expect(pick(s, expected(s))).toEqual(pick(s, expected(s)))
    expect(next(answer(create(24)))).toEqual(next(answer(create(24))))
  })
})

describe('布局安全', () => {
  it('所有色块都落在画布内，且触控目标足够大', () => {
    for (let n = START_COLORS; n <= MAX_COLORS; n++) {
      for (let i = 0; i < n; i++) {
        const r = swatchRect(i, n)
        expect(r.x).toBeGreaterThanOrEqual(0)
        expect(r.y).toBeGreaterThanOrEqual(0)
        expect(r.x + r.w).toBeLessThanOrEqual(VW)
        expect(r.y + r.h).toBeLessThanOrEqual(1280)
        expect(r.w).toBeGreaterThanOrEqual(110)
        expect(r.h).toBeGreaterThanOrEqual(110)
      }
    }
  })

  it('色板不与尾巴重叠', () => {
    const tailBottom = Math.max(...Array.from({ length: MAX_TAIL }, (_, i) => segPos(i)[1] + segRadius(i, MAX_TAIL)))
    const paletteTop = Math.min(...Array.from({ length: MAX_COLORS }, (_, i) => swatchRect(i, MAX_COLORS).y))
    expect(paletteTop).toBeGreaterThan(tailBottom)
  })

  it('最长尾巴的每一节都还在画布内', () => {
    for (let i = 0; i < MAX_TAIL; i++) {
      const [x, y] = segPos(i)
      const r = segRadius(i, MAX_TAIL)
      expect(x - r).toBeGreaterThanOrEqual(0)
      expect(x + r).toBeLessThanOrEqual(VW)
      expect(y - r).toBeGreaterThanOrEqual(0)
      expect(y + r).toBeLessThanOrEqual(1280)
    }
  })

  it('尾巴半径由根到尖递减', () => {
    const n = MAX_TAIL
    expect(segRadius(0, n)).toBeGreaterThan(segRadius(n - 1, n))
  })
})
