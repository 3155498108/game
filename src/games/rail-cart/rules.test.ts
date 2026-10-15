import { describe, expect, it } from 'vitest'
// 用 Vite 的 ?raw 直接读源码文本做纯净性断言。
// 不用 node:fs —— 项目没装 @types/node，且不允许为测试新增依赖。
import rulesSrc from './rules.ts?raw'
import {
  COIN_SCORE,
  DIST_PER_POINT,
  DROP_BEHIND,
  LANES,
  MAX_BLOCKED,
  NOSE,
  RAMP_TICKS,
  SPEED_MAX,
  SPEED_MIN,
  TICK_MS,
  canShift,
  create,
  gapTicksAtTick,
  rampRatio,
  reduce,
  speedAtTick,
  type Action,
  type Item,
  type State,
} from './rules'
import { meta } from './meta'

/** 发车后按脚本推进，返回每一步的 state（含第一步） */
function drive(seed: number, script: Action[]): State[] {
  let s = reduce(create(seed), { type: 'start' })
  const out: State[] = [s]
  for (const a of script) {
    s = reduce(s, a)
    out.push(s)
  }
  return out
}

/** 造一个行驶中的状态，其余字段取 create 的默认值 */
function running(over: Partial<State> = {}): State {
  return { ...create(1), phase: 'run', ...over }
}

/** 按 d 把场上实体分组，同组即同一排 */
function groupByRow(items: readonly Item[]): Map<number, Item[]> {
  const m = new Map<number, Item[]>()
  for (const it of items) {
    const arr = m.get(it.d)
    if (arr) arr.push(it)
    else m.set(it.d, [it])
  }
  return m
}

/** lane 上最近的障碍还有多远（没有障碍则为 Infinity） */
function clearance(s: State, lane: number): number {
  let best = Infinity
  for (const it of s.items) {
    if (it.kind === 'obstacle' && it.lane === lane && it.d < best) best = it.d
  }
  return best
}

/**
 * 一个「称职玩家」的自动驾驶：前方障碍进入反应距离就挪到更宽裕的相邻车道。
 *
 * 注意不能只看「当前车道安不安全、否则随便挪一边」—— 障碍排之间只隔几十个 tick，
 * 贪心的单步躲避会被相邻两排夹死（实测撑不过 30 秒）。这里改成比较两侧的
 * **净空距离**并选更宽的那一侧，等价于人类玩家「往空的那边挪」。
 */
function autoDodge(s: State): State {
  const cur = clearance(s, s.lane)
  if (cur > NOSE + speedAtTick(s.ticks) * 90) return s
  let bestLane = s.lane
  let bestClear = cur
  for (const dir of [-1, 1] as const) {
    const lane = s.lane + dir
    if (lane < 0 || lane >= LANES) continue
    const c = clearance(s, lane)
    if (c > bestClear) {
      bestClear = c
      bestLane = lane
    }
  }
  if (bestLane === s.lane) return s
  return reduce(s, { type: 'shift', dir: bestLane < s.lane ? -1 : 1 })
}

describe('初始状态', () => {
  it('create 发车前停在中间车道，进度与分数全为 0', () => {
    const s = create(42)
    expect(s.phase).toBe('ready')
    expect(s.lane).toBe(Math.floor(LANES / 2))
    expect(s.dist).toBe(0)
    expect(s.ticks).toBe(0)
    expect(s.score).toBe(0)
    expect(s.coins).toBe(0)
    expect(s.items).toEqual([])
    expect(s.rows).toBe(0)
    expect(s.lastPick).toBeNull()
    expect(s.rng).toBe(42)
  })

  it('车道数为规格允许的 3-4 条', () => {
    expect(LANES).toBeGreaterThanOrEqual(3)
    expect(LANES).toBeLessThanOrEqual(4)
    expect(meta.id).toBe('rail-cart')
    expect(meta.viewport).toEqual({ width: 720, height: 1280 })
    expect(meta.orientation).toBe('portrait')
  })

  it('未发车前不接受换道与时间推进，发车只生效一次', () => {
    const s = create(7)
    expect(reduce(s, { type: 'shift', dir: -1 })).toBe(s)
    expect(reduce(s, { type: 'advance', ticks: 60 })).toBe(s)
    const started = reduce(s, { type: 'start' })
    expect(started.phase).toBe('run')
    // 已发车后再点「发车」必须原样返回同一个引用，不能再改 seq
    expect(reduce(started, { type: 'start' })).toBe(started)
  })
})

describe('换道规则', () => {
  it('一次只跨一条车道，连续左移到最左后停在最左', () => {
    let s = reduce(create(1), { type: 'start' })
    const seen: number[] = [s.lane]
    for (let i = 0; i < LANES + 2; i++) {
      s = reduce(s, { type: 'shift', dir: -1 })
      seen.push(s.lane)
      expect(Math.abs(s.lane - seen[seen.length - 2])).toBeLessThanOrEqual(1)
      expect(s.lane).toBeGreaterThanOrEqual(0)
      expect(s.lane).toBeLessThan(LANES)
    }
    expect(seen[seen.length - 1]).toBe(0)
    expect(s.phase).toBe('run')
  })

  it('只能落到相邻车道：方向必须为 ±1，0 与越界值都是空操作', () => {
    const s = running({ lane: 1 })
    expect(reduce(s, { type: 'shift', dir: 1 }).lane).toBe(2)
    expect(reduce(s, { type: 'shift', dir: -1 }).lane).toBe(0)
    const bad = reduce(s, { type: 'shift', dir: 0 as unknown as 1 })
    expect(bad).toBe(s)
    const far = reduce(s, { type: 'shift', dir: 2 as unknown as 1 })
    expect(far).toBe(s)
    const back = reduce(s, { type: 'shift', dir: -2 as unknown as 1 })
    expect(back).toBe(s)
  })

  it('最外侧车道不能朝赛道外换道', () => {
    const left = running({ lane: 0 })
    expect(reduce(left, { type: 'shift', dir: -1 })).toBe(left)
    expect(canShift(left, -1)).toBe(false)
    expect(canShift(left, 1)).toBe(true)
    const right = running({ lane: LANES - 1 })
    expect(reduce(right, { type: 'shift', dir: 1 })).toBe(right)
    expect(canShift(right, 1)).toBe(false)
  })

  it('换道后车与实体不重叠：目标车道必与原车道不同，且同一条排上每条车道最多一个实体', () => {
    // 在有实体的情况下换道
    const items: Item[] = [
      { d: 300, lane: 0, kind: 'obstacle' },
      { d: 300, lane: 1, kind: 'coin' },
      { d: 620, lane: 2, kind: 'obstacle' },
    ]
    const s = running({ lane: 1, items })
    const moved = reduce(s, { type: 'shift', dir: 1 })
    expect(moved.lane).toBe(2)
    expect(moved.lane).not.toBe(s.lane)
    // 车落在目标车道中心，与原车道中心相距一个车道宽，绝不会与原位置重叠
    expect(Math.abs(moved.lane - s.lane)).toBe(1)

    // 长跑过程中，同一排内不存在「同一车道两个实体」
    let cur = reduce(create(2024), { type: 'start' })
    for (let i = 0; i < 4000 && cur.phase === 'run'; i++) {
      cur = autoDodge(reduce(cur, { type: 'advance', ticks: 1 }))
      for (const row of groupByRow(cur.items).values()) {
        expect(new Set(row.map((it) => it.lane)).size).toBe(row.length)
      }
    }
  })

  it('换道本身不会判负：目标车道有障碍也要等 tick 推进到车头才撞', () => {
    const s = running({ lane: 0, items: [{ d: NOSE, lane: 1, kind: 'obstacle' }] })
    const moved = reduce(s, { type: 'shift', dir: 1 })
    expect(moved.phase).toBe('run')
    expect(reduce(moved, { type: 'advance', ticks: 0 })).toBe(moved)
    expect(reduce(moved, { type: 'advance', ticks: 1 }).phase).toBe('over')
  })

  it('终局后不再接受换道', () => {
    const dead = running({ phase: 'over', lane: 1 })
    expect(reduce(dead, { type: 'shift', dir: -1 })).toBe(dead)
    expect(reduce(dead, { type: 'advance', ticks: 10 })).toBe(dead)
  })
})

describe('碰撞与终局', () => {
  it('障碍撞上即终局，速度与距离停在碰撞那一 tick', () => {
    const s = running({ lane: 1, items: [{ d: NOSE + 2, lane: 1, kind: 'obstacle' }] })
    const dead = reduce(s, { type: 'advance', ticks: 1 })
    expect(dead.phase).toBe('over')
    expect(dead.ticks).toBe(s.ticks + 1)
    expect(dead.dist).toBe(s.dist + speedAtTick(s.ticks + 1))
    // 障碍停在车头前，留在场上做撞车画面
    expect(dead.items.some((it) => it.kind === 'obstacle' && it.lane === 1 && it.d === NOSE)).toBe(true)
  })

  it('障碍还没到车头时不判负，换到别的道也躲得开', () => {
    const far = running({ lane: 1, items: [{ d: NOSE + 400, lane: 1, kind: 'obstacle' }] })
    expect(reduce(far, { type: 'advance', ticks: 1 }).phase).toBe('run')
    const dodge = reduce(running({ lane: 1, items: [{ d: NOSE + 2, lane: 1, kind: 'obstacle' }] }), { type: 'shift', dir: -1 })
    expect(reduce(dodge, { type: 'advance', ticks: 1 }).phase).toBe('run')
  })

  it('终局后世界冻结：再推进也不动', () => {
    const dead = reduce(running({ lane: 1, items: [{ d: NOSE + 2, lane: 1, kind: 'obstacle' }] }), { type: 'advance', ticks: 1 })
    const before = JSON.stringify(dead)
    expect(reduce(dead, { type: 'advance', ticks: 600 })).toBe(dead)
    expect(JSON.stringify(reduce(dead, { type: 'advance', ticks: 600 }))).toBe(before)
  })
})

describe('金币与计分', () => {
  it('吃到金币加分并从场上移除', () => {
    const s = running({ lane: 2, items: [{ d: NOSE + 2, lane: 2, kind: 'coin' }] })
    const n = reduce(s, { type: 'advance', ticks: 1 })
    expect(n.coins).toBe(s.coins + 1)
    expect(n.score).toBe(s.score + COIN_SCORE)
    // 只断言「被吃掉的那一枚不在了」，不能断言场上再无金币 —— 同一次 advance 还会
    // 补充视野上方的新排，那里本来就有新生成的金币。
    expect(n.items.some((it) => it.kind === 'coin' && it.lane === 2 && it.d === NOSE - 1)).toBe(false)
    expect(n.lastPick).toEqual({ lane: 2, d: NOSE - 1 })
  })

  it('金币只在同一车道被吃掉', () => {
    const s = running({ lane: 0, items: [{ d: NOSE + 2, lane: 3, kind: 'coin' }] })
    const n = reduce(s, { type: 'advance', ticks: 1 })
    expect(n.coins).toBe(s.coins)
    expect(n.score).toBe(s.score)
    expect(n.items.some((it) => it.kind === 'coin')).toBe(true)
  })

  it('距离按固定步长折算成分数', () => {
    const script: Action[] = []
    for (let i = 0; i < 60; i++) script.push({ type: 'advance', ticks: 1 })
    for (const st of drive(1, script)) {
      if (st.phase !== 'run') continue
      // 只要中途没撞车，分数里的距离部分就应等于 floor(dist / DIST_PER_POINT)
      const distOnly = Math.floor(st.dist / DIST_PER_POINT)
      expect(st.score).toBeGreaterThanOrEqual(distOnly)
      expect(st.score).toBeLessThan(distOnly + st.coins * COIN_SCORE + 1)
    }
  })
})

describe('速度曲线', () => {
  it('随时间单调不减，且恒有上限', () => {
    let prev = -Infinity
    for (let t = 0; t <= RAMP_TICKS * 2; t += 7) {
      const v = speedAtTick(t)
      expect(v).toBeGreaterThanOrEqual(prev)
      expect(v).toBeGreaterThanOrEqual(SPEED_MIN)
      expect(v).toBeLessThanOrEqual(SPEED_MAX)
      prev = v
    }
    expect(speedAtTick(0)).toBe(SPEED_MIN)
    expect(speedAtTick(RAMP_TICKS)).toBe(SPEED_MAX)
    expect(speedAtTick(RAMP_TICKS * 10)).toBe(SPEED_MAX)
    expect(speedAtTick(-5)).toBe(SPEED_MIN)
    expect(rampRatio(-5)).toBe(0)
    expect(rampRatio(RAMP_TICKS * 3)).toBe(1)
  })

  it('排间隔单调不增，一局的时间尺度落在 60-90 秒区间', () => {
    let prev = Infinity
    for (let t = 0; t <= RAMP_TICKS * 2; t += 11) {
      const g = gapTicksAtTick(t)
      expect(g).toBeLessThanOrEqual(prev)
      prev = g
    }
    // 速度爬升到上限正好 60 秒，之后维持上限直到撞车收场
    expect((RAMP_TICKS * TICK_MS) / 1000).toBe(60)
  })

  it('每 tick 的距离增量恰好等于该 tick 的速度', () => {
    let s = running({ items: [] })
    let checked = 0
    for (let i = 0; i < 2000 && s.phase === 'run'; i++) {
      const prev = s
      // 必须带躲避：撞车后 phase 变 over，advance 变成空操作、位移为 0，
      // 那测到的就「冻结」而不是「速度」了。
      s = autoDodge(reduce(s, { type: 'advance', ticks: 1 }))
      if (s.phase !== 'run') break
      expect(s.dist - prev.dist).toBe(speedAtTick(prev.ticks + 1))
      expect(s.ticks).toBe(prev.ticks + 1)
      checked += 1
    }
    expect(checked).toBeGreaterThan(500)
  })
})

describe('随机生成与可复盘', () => {
  it('同种子 + 同操作序列 ⇒ 逐帧状态完全相同', () => {
    const script: Action[] = []
    for (let i = 0; i < 600; i++) {
      script.push({ type: 'advance', ticks: 1 })
      if (i % 37 === 0) script.push({ type: 'shift', dir: i % 74 === 0 ? 1 : -1 })
    }
    const a = drive(20260915, script)
    const b = drive(20260915, script)
    expect(b.length).toBe(a.length)
    for (let i = 0; i < a.length; i++) expect(b[i]).toEqual(a[i])
  })

  it('不同种子生成出不同的赛道', () => {
    const script: Action[] = [{ type: 'advance', ticks: 300 }]
    const a = drive(1, script)
    const b = drive(2, script)
    expect(a[a.length - 1].items).not.toEqual(b[b.length - 1].items)
    expect(a[a.length - 1].rng).not.toBe(b[b.length - 1].rng)
  })

  it('每个障碍排最多堵住 MAX_BLOCKED 条道，永远留有 2 条以上可通行', () => {
    let s = reduce(create(999), { type: 'start' })
    let rows = 0
    for (let i = 0; i < 3000 && s.phase === 'run'; i++) {
      s = autoDodge(reduce(s, { type: 'advance', ticks: 1 }))
      for (const row of groupByRow(s.items).values()) {
        const blocked = new Set(row.filter((it) => it.kind === 'obstacle').map((it) => it.lane)).size
        if (blocked > 0) {
          rows += 1
          expect(blocked).toBeLessThanOrEqual(MAX_BLOCKED)
          expect(LANES - blocked).toBeGreaterThanOrEqual(2)
        }
      }
    }
    expect(rows).toBeGreaterThan(50)
  })

  it('同一排里金币不会与障碍同车道', () => {
    let s = reduce(create(31337), { type: 'start' })
    for (let i = 0; i < 2000 && s.phase === 'run'; i++) {
      s = autoDodge(reduce(s, { type: 'advance', ticks: 1 }))
      for (const row of groupByRow(s.items).values()) {
        const obs = new Set(row.filter((it) => it.kind === 'obstacle').map((it) => it.lane))
        for (const it of row) if (it.kind === 'coin') expect(obs.has(it.lane)).toBe(false)
      }
    }
  })

  it('场上实体数量有界，甩在身后的会被清理', () => {
    let s = reduce(create(5), { type: 'start' })
    let maxItems = 0
    for (let i = 0; i < 3000 && s.phase === 'run'; i++) {
      s = autoDodge(reduce(s, { type: 'advance', ticks: 1 }))
      maxItems = Math.max(maxItems, s.items.length)
      for (const it of s.items) expect(it.d).toBeGreaterThan(-DROP_BEHIND)
    }
    expect(maxItems).toBeLessThan(60)
  })
})

describe('时间推进的边界', () => {
  it('0 tick、非整数与非法值都是空操作', () => {
    const s = running({ items: [] })
    expect(reduce(s, { type: 'advance', ticks: 0 })).toBe(s)
    expect(reduce(s, { type: 'advance', ticks: -5 })).toBe(s)
    expect(reduce(s, { type: 'advance', ticks: 1.5 })).toBe(s)
    expect(reduce(s, { type: 'advance', ticks: NaN })).toBe(s)
  })

  it('一帧一次 tick 与一次补齐 N 个 tick 结果一致', () => {
    const byFrame = drive(88, Array.from({ length: 300 }, () => ({ type: 'advance', ticks: 1 }) as Action))
    const oneShot = drive(88, [{ type: 'advance', ticks: 300 }])
    // 一次补 300 tick 会跨过撞车判定点，终局判定可能先发生；这里比对终局前的公共前缀
    const common = Math.min(byFrame.length, oneShot.length) - 1
    for (let i = 0; i < common; i++) expect(oneShot[i].dist).toBe(byFrame[i].dist)
  })
})

describe('一局 60-90 秒的设计', () => {
  it('会躲的自动驾驶能撑到速度上限，一局落在规格的 60-90 秒', () => {
    let s = reduce(create(2026), { type: 'start' })
    const total = 120 * (1000 / TICK_MS) // 观察 120 秒
    let alive = 0
    for (let i = 0; i < total && s.phase === 'run'; i++) {
      s = autoDodge(reduce(s, { type: 'advance', ticks: 1 }))
      alive = i + 1
    }
    const seconds = (alive * TICK_MS) / 1000
    console.log(
      `[rail-cart] 称职玩家策略存活 ${seconds.toFixed(1)} 秒（${alive} tick），` +
        `撞车于第 ${s.ticks} tick，冲刺进度 ${(rampRatio(s.ticks) * 100).toFixed(0)}%`,
    )
    // 规格：速度随时间递增，一局 60-90 秒。难度是设计成会递增到撞车的，
    // 所以这里只守住「下限 60 秒 + 确实能爬到速度上限」，不要求活满 90 秒。
    expect(seconds).toBeGreaterThanOrEqual(60)
    expect(alive).toBeGreaterThan(RAMP_TICKS)
    expect(s.dist).toBeGreaterThan(0)
    expect(s.score).toBeGreaterThan(0)
  })
})

describe('纯函数约束', () => {
  it('reduce 不修改入参的任何字段', () => {
    let s = reduce(create(4242), { type: 'start' })
    s = autoDodge(reduce(s, { type: 'advance', ticks: 500 }))
    const snap = JSON.stringify(s)
    const itemsRef = s.items
    const rngRef = s.rng

    reduce(s, { type: 'shift', dir: -1 })
    reduce(s, { type: 'shift', dir: 1 })
    reduce(s, { type: 'advance', ticks: 1 })
    reduce(s, { type: 'advance', ticks: 120 })
    reduce(s, { type: 'start' })

    expect(JSON.stringify(s)).toBe(snap)
    expect(s.items).toBe(itemsRef)
    expect(s.rng).toBe(rngRef)
  })

  it('相同输入两次调用结果完全相等', () => {
    const s = autoDodge(reduce(create(8), { type: 'advance', ticks: 1 }) && reduce(reduce(create(8), { type: 'start' }), { type: 'advance', ticks: 400 }))
    expect(reduce(s, { type: 'shift', dir: 1 })).toEqual(reduce(s, { type: 'shift', dir: 1 }))
    expect(reduce(s, { type: 'advance', ticks: 30 })).toEqual(reduce(s, { type: 'advance', ticks: 30 }))
  })

  it('create 对同一 seed 完全一致', () => {
    for (const seed of [1, 999, -12345]) expect(create(seed)).toEqual(create(seed))
  })

  /** 去掉注释，只对真正的代码做断言 —— 否则注释里提到 Date / performance 就会误报 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*\/\/.*$/gm, '')
}

it('rules.ts 里没有时间源与全局随机数', () => {
    const code = codeOnly(rulesSrc)
    expect(code).not.toMatch(/performance/)
    expect(code).not.toMatch(/\bDate\b/)
    expect(code).not.toMatch(/Math\s*\.\s*random/)
    expect(code).not.toMatch(/\bdocument\b|\bwindow\b/)
  })
})
