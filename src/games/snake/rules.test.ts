import { describe, expect, it } from 'vitest'
import {
  BASE_TICKS_PER_CELL,
  COLS,
  LENGTH_PER_SPEED_UP,
  MAX_TURN_QUEUE,
  MIN_TICKS_PER_CELL,
  ROWS,
  SCORE_PER_FOOD,
  START_LENGTH,
  create,
  reduce,
  ticksPerCell,
  type Cell,
  type Dir,
  type State,
} from './rules'

/** 造一条「头在 head、身朝反方向排开」的蛇 */
function bodyBehind(head: Cell, dir: Dir, len = START_LENGTH): Cell[] {
  const back: Record<Dir, Cell> = {
    up: { col: 0, row: 1 },
    down: { col: 0, row: -1 },
    left: { col: 1, row: 0 },
    right: { col: -1, row: 0 },
  }
  return Array.from({ length: len }, (_, i) => ({
    col: head.col + back[dir].col * i,
    row: head.row + back[dir].row * i,
  }))
}

/** 造一个完全可控的局面：蛇身、方向、食物都能指定 */
function custom(over: Partial<State> = {}): State {
  const base: State = {
    body: [
      { col: 9, row: 9 },
      { col: 8, row: 9 },
      { col: 7, row: 9 },
    ],
    dir: 'right',
    queue: [],
    food: { col: 0, row: 0 },
    stepAcc: 0,
    eaten: 0,
    score: 0,
    alive: true,
    won: false,
    seed: 1,
    seq: 0,
    rng: 20260920,
  }
  return { ...base, ...over }
}

/** 蛇身是否连成一条（每两节相距一格） */
function contiguous(s: State): boolean {
  for (let i = 1; i < s.body.length; i++) {
    const a = s.body[i - 1]
    const b = s.body[i]
    if (Math.abs(a.col - b.col) + Math.abs(a.row - b.row) !== 1) return false
  }
  return true
}

describe('初始局面', () => {
  it('开局长度 3、朝右、蛇头在棋盘中央', () => {
    const s = create(42)
    expect(s.body.length).toBe(START_LENGTH)
    expect(s.dir).toBe('right')
    expect(s.body[0]).toEqual({ col: Math.floor(COLS / 2), row: Math.floor(ROWS / 2) })
    expect(s.queue).toEqual([])
    expect(s.score).toBe(0)
    expect(s.eaten).toBe(0)
    expect(s.alive).toBe(true)
    expect(s.won).toBe(false)
  })

  it('开局的蛇连成一条直线，方向朝右', () => {
    const s = create(7)
    expect(contiguous(s)).toBe(true)
    expect(s.body[0].col).toBeGreaterThan(s.body[1].col)
    expect(s.body[1].row).toBe(s.body[0].row)
  })

  it('初始食物一定落在空格上（不在蛇身上、也不出界）', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = create(seed * 7919)
      expect(s.food.col).toBeGreaterThanOrEqual(0)
      expect(s.food.col).toBeLessThan(COLS)
      expect(s.food.row).toBeGreaterThanOrEqual(0)
      expect(s.food.row).toBeLessThan(ROWS)
      for (const seg of s.body) expect(s.food).not.toEqual(seg)
    }
  })

  it('不同种子的初始食物位置不同', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) {
      const s = create(seed * 104729)
      seen.add(`${s.food.col},${s.food.row}`)
    }
    expect(seen.size).toBeGreaterThanOrEqual(15)
  })

  it('create 对同一颗种子完全一致（可复盘）', () => {
    expect(create(8888)).toEqual(create(8888))
    expect(create(1).rng).not.toBe(create(2).rng)
  })
})

describe('前进', () => {
  it('长度 3 时要攒够 2 个 tick 才走一格', () => {
    const s = custom()
    const one = reduce(s, { type: 'tick', ticks: 1 })
    expect(one.body).toEqual(s.body)
    expect(one.stepAcc).toBe(1)
    const two = reduce(s, { type: 'tick', ticks: 2 })
    expect(two.body[0]).toEqual({ col: 10, row: 9 })
  })

  it('移动一格后身体各节位置正确', () => {
    const n = reduce(custom(), { type: 'tick', ticks: 2 })
    expect(n.body).toEqual([
      { col: 10, row: 9 },
      { col: 9, row: 9 },
      { col: 8, row: 9 },
    ])
    expect(contiguous(n)).toBe(true)
  })

  it('四个方向的位移都正确', () => {
    const dirs: Array<[Dir, Cell]> = [
      ['up', { col: 9, row: 8 }],
      ['down', { col: 9, row: 10 }],
      ['left', { col: 8, row: 9 }],
      ['right', { col: 10, row: 9 }],
    ]
    for (const [dir, want] of dirs) {
      const s = custom({ dir, body: bodyBehind({ col: 9, row: 9 }, dir) })
      const n = reduce(s, { type: 'tick', ticks: 2 })
      expect(n.body[0], `${dir} 方向走错`).toEqual(want)
      expect(n.dir).toBe(dir)
      expect(n.alive).toBe(true)
    }
  })

  it('走完一格后计数清零，不会一口气连走两格', () => {
    const n = reduce(custom(), { type: 'tick', ticks: 4 })
    expect(n.body[0]).toEqual({ col: 11, row: 9 })
    expect(n.stepAcc).toBe(0)
  })
})

describe('吃食物', () => {
  it('吃到食物：长度 +1、分数 +10', () => {
    const s = custom({ food: { col: 10, row: 9 } })
    const n = reduce(s, { type: 'tick', ticks: 2 })
    expect(n.body.length).toBe(START_LENGTH + 1)
    expect(n.score).toBe(SCORE_PER_FOOD)
    expect(n.eaten).toBe(1)
    expect(n.body[0]).toEqual({ col: 10, row: 9 })
    expect(contiguous(n)).toBe(true)
  })

  it('吃到食物后重新生成一颗，新食物不在蛇身上', () => {
    const n = reduce(custom({ food: { col: 10, row: 9 } }), { type: 'tick', ticks: 2 })
    expect(n.food.col).toBeGreaterThanOrEqual(0)
    expect(n.food.col).toBeLessThan(COLS)
    expect(n.food.row).toBeGreaterThanOrEqual(0)
    expect(n.food.row).toBeLessThan(ROWS)
    for (const seg of n.body) expect(n.food).not.toEqual(seg)
  })

  it('连吃两颗：20 分、身长 5', () => {
    let s = custom({ food: { col: 10, row: 9 } })
    s = reduce(s, { type: 'tick', ticks: 2 })
    expect(s.score).toBe(SCORE_PER_FOOD)
    // 把下一颗放到正前方，再吃一次
    s = { ...s, food: { col: 11, row: 9 } }
    s = reduce(s, { type: 'tick', ticks: 2 })
    expect(s.score).toBe(SCORE_PER_FOOD * 2)
    expect(s.eaten).toBe(2)
    expect(s.body.length).toBe(START_LENGTH + 2)
    expect(contiguous(s)).toBe(true)
  })
})

describe('死亡', () => {
  const walls: Array<[Cell, Dir]> = [
    [{ col: 0, row: 9 }, 'left'],
    [{ col: COLS - 1, row: 9 }, 'right'],
    [{ col: 9, row: 0 }, 'up'],
    [{ col: 9, row: ROWS - 1 }, 'down'],
  ]

  it('撞墙 → alive 变 false（四面墙都撞）', () => {
    for (const [head, dir] of walls) {
      const s = custom({ dir, body: bodyBehind(head, dir) })
      const n = reduce(s, { type: 'tick', ticks: 2 })
      expect(n.alive, `${dir} 方向撞墙没有判死`).toBe(false)
      expect(n.won).toBe(false)
    }
  })

  it('撞墙时身体停在原地，不会穿出棋盘', () => {
    const s = custom({ dir: 'right', body: bodyBehind({ col: COLS - 1, row: 9 }, 'right') })
    const n = reduce(s, { type: 'tick', ticks: 2 })
    expect(n.alive).toBe(false)
    expect(n.body).toEqual(s.body)
  })

  it('咬到自己 → alive 变 false', () => {
    const s = custom({
      dir: 'up',
      body: [
        { col: 5, row: 6 },
        { col: 6, row: 6 },
        { col: 6, row: 5 },
        { col: 5, row: 5 },
        { col: 4, row: 5 },
      ],
    })
    const n = reduce(s, { type: 'tick', ticks: 2 })
    expect(n.alive).toBe(false)
  })

  it('死掉之后不再接受 tick（状态原样返回）', () => {
    const dead = reduce(custom({ dir: 'right', body: bodyBehind({ col: COLS - 1, row: 9 }, 'right') }), {
      type: 'tick',
      ticks: 2,
    })
    expect(dead.alive).toBe(false)
    const after = reduce(dead, { type: 'tick', ticks: 100 })
    expect(after).toBe(dead)
    expect(after.body).toEqual(dead.body)
    expect(after.score).toBe(dead.score)
  })

  it('死掉之后转向也不再生效', () => {
    const dead = reduce(custom({ dir: 'right', body: bodyBehind({ col: COLS - 1, row: 9 }, 'right') }), {
      type: 'tick',
      ticks: 2,
    })
    expect(reduce(dead, { type: 'turn', dir: 'up' })).toBe(dead)
  })
})

describe('转向队列', () => {
  it('180° 掉头指令被拒绝（方向不变）', () => {
    const pairs: Array<[Dir, Dir]> = [
      ['right', 'left'],
      ['left', 'right'],
      ['up', 'down'],
      ['down', 'up'],
    ]
    for (const [dir, back] of pairs) {
      const s = custom({ dir })
      const n = reduce(s, { type: 'turn', dir: back })
      expect(n.dir, `${dir} 掉头没有被拒绝`).toBe(dir)
      expect(n.queue).toEqual([])
    }
  })

  it('转向先进队列，移动时才生效', () => {
    const s = custom()
    const queued = reduce(s, { type: 'turn', dir: 'up' })
    expect(queued.dir).toBe('right')
    expect(queued.queue).toEqual(['up'])
    const moved = reduce(queued, { type: 'tick', ticks: 2 })
    expect(moved.dir).toBe('up')
    expect(moved.queue).toEqual([])
    expect(moved.body[0]).toEqual({ col: 9, row: 8 })
  })

  it('连续快速转向不会自杀：上 → 左 依次生效', () => {
    let s = custom()
    s = reduce(s, { type: 'turn', dir: 'up' })
    s = reduce(s, { type: 'turn', dir: 'left' })
    expect(s.queue).toEqual(['up', 'left'])
    s = reduce(s, { type: 'tick', ticks: 2 })
    expect(s.dir).toBe('up')
    expect(s.queue).toEqual(['left'])
    s = reduce(s, { type: 'tick', ticks: 2 })
    expect(s.dir).toBe('left')
    expect(s.alive).toBe(true)
    expect(s.body[0]).toEqual({ col: 8, row: 8 })
  })

  it('转向队列最多缓存 2 条，多余的丢掉', () => {
    let s = custom()
    s = reduce(s, { type: 'turn', dir: 'up' })
    s = reduce(s, { type: 'turn', dir: 'left' })
    expect(s.queue.length).toBe(MAX_TURN_QUEUE)
    s = reduce(s, { type: 'turn', dir: 'down' })
    expect(s.queue).toEqual(['up', 'left'])
    expect(s.queue.length).toBeLessThanOrEqual(MAX_TURN_QUEUE)
  })

  it('队列非空时，掉头判定以队列最后一条为准', () => {
    const s = custom({ dir: 'right', queue: ['up'] })
    // down 是队列里 up 的反方向：拒绝
    expect(reduce(s, { type: 'turn', dir: 'down' }).queue).toEqual(['up'])
    // left 与 up 差 90°：允许
    expect(reduce(s, { type: 'turn', dir: 'left' }).queue).toEqual(['up', 'left'])
  })

  it('重复的同方向指令是空操作', () => {
    const s = custom({ dir: 'right' })
    expect(reduce(s, { type: 'turn', dir: 'right' })).toBe(s)
  })
})

describe('速度', () => {
  it('每格所需的 tick 数随长度下降', () => {
    expect(ticksPerCell(START_LENGTH)).toBe(BASE_TICKS_PER_CELL)
    expect(ticksPerCell(START_LENGTH + LENGTH_PER_SPEED_UP)).toBe(BASE_TICKS_PER_CELL - 1)
    expect(ticksPerCell(START_LENGTH + LENGTH_PER_SPEED_UP * 3)).toBeLessThan(ticksPerCell(START_LENGTH))
  })

  it('长到 7 节时每格只要 1 个 tick', () => {
    expect(ticksPerCell(7)).toBe(1)
    const long = custom({ body: bodyBehind({ col: 9, row: 9 }, 'right', 7) })
    const n = reduce(long, { type: 'tick', ticks: 1 })
    expect(n.body[0]).toEqual({ col: 10, row: 9 })
  })

  it('速度不会再低于 1 个 tick', () => {
    expect(ticksPerCell(50)).toBe(MIN_TICKS_PER_CELL)
    expect(ticksPerCell(300)).toBe(MIN_TICKS_PER_CELL)
  })
})

describe('可复盘与纯函数', () => {
  it('同一串操作重放两次，身体、食物、分数完全一致', () => {
    const run = (): State => {
      let s = create(20260920)
      s = reduce(s, { type: 'turn', dir: 'up' })
      s = reduce(s, { type: 'tick', ticks: 6 })
      s = reduce(s, { type: 'turn', dir: 'left' })
      s = reduce(s, { type: 'tick', ticks: 10 })
      return s
    }
    const a = run()
    const b = run()
    expect(a.body).toEqual(b.body)
    expect(a.food).toEqual(b.food)
    expect(a.score).toBe(b.score)
    expect(a).toEqual(b)
  })

  it('reduce 不修改入参', () => {
    const s = custom({ food: { col: 10, row: 9 } })
    const body = s.body.slice()
    const n = reduce(s, { type: 'tick', ticks: 2 })
    expect(s.body).toEqual(body)
    expect(s.food).toEqual({ col: 10, row: 9 })
    expect(s.score).toBe(0)
    expect(s.stepAcc).toBe(0)
    expect(n).not.toBe(s)
  })

  it('相同输入产生完全相同输出', () => {
    const s = custom()
    expect(reduce(s, { type: 'turn', dir: 'up' })).toEqual(reduce(s, { type: 'turn', dir: 'up' }))
    expect(reduce(s, { type: 'tick', ticks: 3 })).toEqual(reduce(s, { type: 'tick', ticks: 3 }))
  })

  it('tick 传 0 / 负数 / 非整数时状态不变', () => {
    const s = custom()
    expect(reduce(s, { type: 'tick', ticks: 0 })).toBe(s)
    expect(reduce(s, { type: 'tick', ticks: -5 })).toBe(s)
    expect(reduce(s, { type: 'tick', ticks: 1.5 })).toBe(s)
  })
})

describe('重开', () => {
  it('restart 回到初始盘面：长度 3、朝右、分数清零', () => {
    const played = reduce(custom({ food: { col: 10, row: 9 } }), { type: 'tick', ticks: 2 })
    const fresh = reduce(played, { type: 'restart' })
    expect(fresh.body.length).toBe(START_LENGTH)
    expect(fresh.body[0]).toEqual({ col: 9, row: 9 })
    expect(fresh.dir).toBe('right')
    expect(fresh.queue).toEqual([])
    expect(fresh.score).toBe(0)
    expect(fresh.eaten).toBe(0)
    expect(fresh.alive).toBe(true)
  })

  it('restart 后随机流继续往前走（不是同一个开局）', () => {
    const s = custom()
    const fresh = reduce(s, { type: 'restart' })
    expect(fresh.rng).not.toBe(s.rng)
    expect(fresh.food.col).toBeGreaterThanOrEqual(0)
  })

  it('restart 后对局序号 +1（渲染层据此换动画命名空间）', () => {
    const s = custom()
    expect(reduce(s, { type: 'restart' }).seq).toBe(s.seq + 1)
  })
})
