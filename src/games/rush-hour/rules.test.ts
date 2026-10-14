/**
 * 滑块解锁（Rush Hour）规则单测：纯逻辑，零 DOM。
 *
 * 关卡可解性用 BFS 求解：每条边 = 一步滑动（沿自身方向可跨任意格），
 * 棋盘编码成「每辆车 3 bit 车头位置」的整数，visited 用 Set<number>，
 * 不做任何对象克隆 / JSON 序列化，12 关跑完在 100ms 量级。
 */
import { describe, expect, it } from 'vitest'
import {
  CELLS,
  LEVELS,
  LEVEL_BEST,
  SIZE,
  TARGET_ID,
  TARGET_LEN,
  applySlide,
  canSlide,
  carCells,
  carIdAt,
  create,
  findCar,
  inBoard,
  isSolved,
  isValidLayout,
  levelCars,
  occupiedCells,
  reduce,
  slideRange,
  sweptCells,
  targetCar,
  type Car,
  type State,
} from './rules'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** 造一辆车（颜色只为测试方便；规则只读 id/row/col/len/horiz/target） */
function car(id: string, row: number, col: number, len: number, horiz: boolean): Car {
  return { id, row, col, len, horiz, color: '#888888', target: id === TARGET_ID }
}

/**
 * 基础局面（4 辆车，全部合法）：
 * r 第 2 行 0~1 列（左边是边界、右边被 a 堵死）、a 第 2 行 2~3 列、b 第 4 列 0~1 行、c 第 3 列 4~5 行。
 */
function fixture(): Car[] {
  return [car('r', 2, 0, 2, true), car('a', 2, 2, 2, true), car('b', 0, 4, 2, false), car('c', 4, 3, 2, false)]
}

/** 用给定车数组造一个状态，其余字段取 create 的默认值 */
function stateOf(cars: Car[], over: Partial<State> = {}): State {
  return { ...create(1), cars, ...over }
}

// ---------------- 关卡求解器 ----------------

interface Step {
  id: string
  delta: number
}

interface Solution {
  steps: number
  moves: Step[]
}

/**
 * BFS 求最少步数。每条边代表一次滑动（跨几格都算 1 步），
 * 因此「单格步」与「多格步」的最优值相同，枚举车头能到的全部位置即可。
 * 判定与 rules 严格等价：
 *   - sweptCells：扫过的每一格都不能有别的车（忽略自己原来的格子）；
 *   - inBoard：只校验「车真正延伸的那一轴」——横车查列、竖车查行，
 *     固定轴只要求落在 0..5 内（早期版本两轴都加 len，会把贴边的车误判为死车）。
 */
function solve(start: readonly Car[]): Solution | null {
  const n = start.length
  const horiz = start.map((c) => c.horiz)
  const len = start.map((c) => c.len)
  const ids = start.map((c) => c.id)
  /** 固定轴坐标：横车是所在行，竖车是所在列 */
  const axis = start.map((c) => (c.horiz ? c.row : c.col))
  /** 车头位置占用的 bit 权重（每辆 3 bit，位置 0~5 足够） */
  const unit = start.map((_, i) => 1 << (3 * i))
  /** 固定轴本身就越界的车永远动不了（轴坐标必须在 0..SIZE-1 内） */
  const frozen = axis.map((a) => a >= SIZE || a < 0)
  const targetAt = start.findIndex((c) => c.target)
  if (targetAt < 0) return null

  const occ = new Int8Array(CELLS)
  const pos = new Int8Array(n)

  const decode = (key: number): void => {
    for (let i = 0; i < n; i++) pos[i] = (key >>> (3 * i)) & 7
  }
  /** 车 i 的车头挪到 q 时，新位置是否压到别的车（忽略它自己原来的格子） */
  const blocked = (i: number, q: number): boolean => {
    if (horiz[i]) {
      const b = axis[i] * SIZE
      for (let k = 0; k < len[i]; k++) {
        const o = occ[b + q + k]
        if (o >= 0 && o !== i) return true
      }
    } else {
      const b = axis[i]
      for (let k = 0; k < len[i]; k++) {
        const o = occ[(q + k) * SIZE + b]
        if (o >= 0 && o !== i) return true
      }
    }
    return false
  }
  const fill = (): void => {
    occ.fill(-1)
    for (let i = 0; i < n; i++) {
      if (horiz[i]) {
        const b = axis[i] * SIZE
        for (let k = 0; k < len[i]; k++) {
          const c = b + pos[i] + k
          if (c < CELLS) occ[c] = i
        }
      } else {
        const b = axis[i]
        for (let k = 0; k < len[i]; k++) {
          const c = (pos[i] + k) * SIZE + b
          if (c < CELLS) occ[c] = i
        }
      }
    }
  }

  const startKey = start.reduce((acc, c, i) => acc + (c.horiz ? c.col : c.row) * unit[i], 0)
  const seen = new Set<number>([startKey])
  const back = new Map<number, { from: number; car: number; delta: number }>()
  let frontier = [startKey]
  let depth = 0

  const pathOf = (goal: number): Step[] => {
    const out: Step[] = []
    for (let k = goal; k !== startKey; ) {
      const e = back.get(k)
      if (!e) break
      out.push({ id: ids[e.car], delta: e.delta })
      k = e.from
    }
    return out.reverse()
  }

  while (frontier.length > 0) {
    depth++
    const next: number[] = []
    for (const key of frontier) {
      decode(key)
      if (pos[targetAt] + len[targetAt] === SIZE) return { steps: depth - 1, moves: pathOf(key) }
      fill()
      for (let i = 0; i < n; i++) {
        if (frozen[i]) continue
        let lo = pos[i]
        while (lo > 0 && !blocked(i, lo - 1)) lo--
        let hi = pos[i]
        while (hi + len[i] < SIZE && !blocked(i, hi + 1)) hi++
        // 越界端点不生成：与 rules 的 inBoard(next) 一致（中间过程不受检）
        const hiSafe = Math.min(hi, SIZE - len[i])
        for (let q = lo; q <= hiSafe; q++) {
          if (q === pos[i]) continue
          const nk = key + (q - pos[i]) * unit[i]
          if (seen.has(nk)) continue
          seen.add(nk)
          back.set(nk, { from: key, car: i, delta: q - pos[i] })
          next.push(nk)
        }
      }
    }
    frontier = next
  }
  return null
}

// ---------------- 用例 ----------------

describe('常量与关卡数据', () => {
  it('棋盘是 6×6，目标车约定为长度 2 的红车', () => {
    expect(SIZE).toBe(6)
    expect(CELLS).toBe(36)
    expect(CELLS).toBe(SIZE * SIZE)
    expect(TARGET_ID).toBe('r')
    expect(TARGET_LEN).toBe(2)
  })

  it('至少 12 关，每关都恰好一辆水平红目标车且车长为 2', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(12)
    for (const lv of LEVELS) {
      expect(lv.name.length).toBeGreaterThan(0)
      const targets = lv.cars.filter((c) => c.target)
      expect(targets.length).toBe(1)
      expect(targets[0].id).toBe(TARGET_ID)
      expect(targets[0].len).toBe(TARGET_LEN)
      expect(targets[0].horiz).toBe(true)
    }
  })

  it('关卡内车 id 互不重复', () => {
    for (const lv of LEVELS) expect(new Set(lv.cars.map((c) => c.id)).size).toBe(lv.cars.length)
  })

  it('每关开局都未通关', () => {
    for (let i = 0; i < LEVELS.length; i++) expect(isSolved(levelCars(i))).toBe(false)
  })
})

describe('车占据格推导', () => {
  it('carCells 横车沿 col 递增', () => {
    expect(carCells(car('a', 2, 1, 3, true))).toEqual([13, 14, 15])
  })

  it('carCells 竖车沿 row 递增', () => {
    expect(carCells(car('a', 0, 4, 2, false))).toEqual([4, 10])
    expect(carCells(car('a', 3, 1, 3, false))).toEqual([19, 25, 31])
  })

  it('carCells 长度等于 len', () => {
    for (const lv of LEVELS) {
      for (const c of lv.cars) expect(carCells(c).length).toBe(c.len)
    }
  })

  it('occupiedCells 汇总全部车，skipId 可排除自己', () => {
    const cars = fixture()
    const all = occupiedCells(cars)
    expect(all.size).toBe(2 + 2 + 2 + 2)
    expect(occupiedCells(cars, 'a').has(14)).toBe(false)
    expect(occupiedCells(cars, 'a').size).toBe(all.size - 2)
    expect(occupiedCells(cars, TARGET_ID).size).toBe(all.size - 2)
  })

  it('carIdAt 命中格子上的车，空格返回 null', () => {
    const cars = fixture()
    expect(carIdAt(cars, 12)).toBe('r')
    expect(carIdAt(cars, 15)).toBe('a')
    expect(carIdAt(cars, 4)).toBe('b')
    expect(carIdAt(cars, 5)).toBeNull()
  })

  it('findCar 找不到时返回 null，targetCar 锁定红车', () => {
    const cars = fixture()
    expect(findCar(cars, 'a')?.col).toBe(2)
    expect(findCar(cars, 'zz')).toBeNull()
    expect(targetCar(cars)?.id).toBe(TARGET_ID)
    expect(targetCar([car('a', 0, 0, 2, true)])).toBeNull()
  })
})

describe('边界与滑动路径', () => {
  it('inBoard 接受整体在盘内的车', () => {
    expect(inBoard(car('a', 0, 0, 2, true))).toBe(true)
    expect(inBoard(car('a', 4, 4, 2, true))).toBe(true)
    expect(inBoard(car('a', 4, 0, 2, false))).toBe(true)
  })

  it('inBoard 只校验车真正延伸的那一轴', () => {
    // 横车的长度只吃列数：row 取 0 或 5（贴最上/最下行）都合法
    expect(inBoard(car('a', 5, 0, 2, true))).toBe(true)
    expect(inBoard(car('a', 5, 3, 2, true))).toBe(true)
    expect(inBoard(car('a', 0, 4, 2, true))).toBe(true)
    // 竖车的长度只吃行数：col 取 0 或 5（贴最左/最右列）都合法
    expect(inBoard(car('a', 0, 5, 2, false))).toBe(true)
    expect(inBoard(car('a', 3, 5, 3, false))).toBe(true) // row+len = 6，正好贴住下边界
    expect(inBoard(car('a', 3, 0, 3, false))).toBe(true)
  })

  it('inBoard 对延伸轴越界 / 固定轴越界 / 负数 / 非整数 / 零长一律为 false', () => {
    // 延伸轴超出盘外：横车 col+len>6、竖车 row+len>6
    expect(inBoard(car('a', 0, 5, 2, true))).toBe(false)
    expect(inBoard(car('a', 0, 6, 2, true))).toBe(false)
    expect(inBoard(car('a', 5, 5, 2, false))).toBe(false)
    expect(inBoard(car('a', 6, 0, 2, false))).toBe(false)
    // 固定轴落在盘外（车头本身越界）
    expect(inBoard(car('a', -1, 0, 2, true))).toBe(false)
    expect(inBoard(car('a', 0, -2, 2, false))).toBe(false)
    expect(inBoard(car('a', 6, 0, 2, true))).toBe(false)
    expect(inBoard(car('a', 0, 6, 2, false))).toBe(false)
    // 非整数与零长
    expect(inBoard(car('a', 0.5, 0, 2, true))).toBe(false)
    expect(inBoard(car('a', 0, 0.5, 2, false))).toBe(false)
    expect(inBoard(car('a', 0, 0, 0, true))).toBe(false)
  })

  it('sweptCells 在 delta=0 时为空', () => {
    expect(sweptCells(car('a', 2, 1, 2, true), 0)).toEqual([])
  })

  it('sweptCells 横车覆盖起点到终点的整条行（含原占用格）', () => {
    expect(sweptCells(car('a', 2, 1, 2, true), 2)).toEqual([13, 14, 15, 16])
    expect(sweptCells(car('a', 2, 1, 2, true), -1)).toEqual([12, 13, 14])
  })

  it('sweptCells 竖车覆盖整列', () => {
    expect(sweptCells(car('a', 1, 3, 2, false), 2)).toEqual([9, 15, 21, 27])
    expect(sweptCells(car('a', 1, 3, 2, false), -1)).toEqual([3, 9, 15])
  })

  it('slideRange 两侧都被挡时返回原位', () => {
    const cars = [car('a', 2, 2, 2, true), car('b', 2, 0, 2, true), car('c', 2, 4, 2, true)]
    expect(slideRange(cars, cars[0])).toEqual([2, 2])
  })

  it('slideRange 横车可滑到边界与障碍前一格', () => {
    const cars = [car('a', 0, 0, 2, true), car('b', 0, 3, 2, true)]
    expect(slideRange(cars, cars[0])).toEqual([0, 1])
    expect(slideRange(cars, cars[1])).toEqual([2, 4])
  })

  it('slideRange 竖车按 row 计算', () => {
    const cars = [car('a', 0, 1, 2, false), car('b', 3, 1, 2, false)]
    expect(slideRange(cars, cars[0])).toEqual([0, 1])
    const empty = [car('a', 0, 1, 3, false)]
    expect(slideRange(empty, empty[0])).toEqual([0, 3])
  })

  it('slideRange 基础局面下四辆车的可滑区间', () => {
    const cars = fixture()
    expect(slideRange(cars, cars[0])).toEqual([0, 0])
    expect(slideRange(cars, cars[1])).toEqual([2, 4])
    expect(slideRange(cars, cars[2])).toEqual([0, 4])
    expect(slideRange(cars, cars[3])).toEqual([3, 4])
  })

  it('slideRange 红车通路打通时上界正好是出口', () => {
    const cars = [car('r', 2, 0, 2, true)]
    expect(slideRange(cars, cars[0])).toEqual([0, 4])
  })
})

describe('滑动合法性', () => {
  it('canSlide 对合法滑动为 true', () => {
    const cars = fixture()
    expect(canSlide(cars, 'a', 1)).toBe(true)
    expect(canSlide(cars, 'a', 2)).toBe(true)
    expect(canSlide(cars, 'b', 1)).toBe(true)
    expect(canSlide(cars, 'b', 3)).toBe(true)
  })

  it('canSlide 拒绝 delta 为 0 / 非整数 / NaN', () => {
    const cars = fixture()
    expect(canSlide(cars, 'b', 0)).toBe(false)
    expect(canSlide(cars, 'b', 0.5)).toBe(false)
    expect(canSlide(cars, 'b', Number.NaN)).toBe(false)
  })

  it('canSlide 拒绝不存在的车', () => {
    expect(canSlide(fixture(), 'zz', 1)).toBe(false)
  })

  it('canSlide 拒绝出界（含整车越出另一轴）', () => {
    const cars = fixture()
    expect(canSlide(cars, 'r', -1)).toBe(false)
    expect(canSlide(cars, 'b', -1)).toBe(false)
    expect(canSlide(cars, 'c', 1)).toBe(false)
    expect(canSlide(cars, 'c', -2)).toBe(false)
  })

  it('canSlide 拒绝撞车', () => {
    const cars = fixture()
    // 红车右边紧挨着 a，左边是棋盘边界
    expect(canSlide(cars, 'r', 1)).toBe(false)
    expect(canSlide(cars, 'r', 2)).toBe(false)
    // a 往左顶着红车，往右一格没问题、两格也没问题
    expect(canSlide(cars, 'a', -1)).toBe(false)
    expect(canSlide(cars, 'a', 1)).toBe(true)
    // c 往上最多到第 3 行（第 2 行被 a 占着）
    expect(canSlide(cars, 'c', -2)).toBe(false)
  })

  it('canSlide 拒绝正前方被挡：只能贴到障碍前一格', () => {
    const cars = [car('a', 0, 4, 2, false), car('b', 3, 4, 2, true)]
    expect(slideRange(cars, cars[0])).toEqual([0, 1])
    expect(canSlide(cars, 'a', 1)).toBe(true)
    expect(canSlide(cars, 'a', 2)).toBe(false)
    expect(canSlide(cars, 'a', 3)).toBe(false)
  })

  it('applySlide 返回新数组，未动的车保持同一引用，入参不被修改', () => {
    const cars = fixture()
    const snapshot = clone(cars)
    const next = applySlide(cars, 'b', 1) as Car[]
    expect(findCar(next, 'b')?.row).toBe(1)
    expect(findCar(next, 'r')).toBe(cars[0])
    expect(findCar(next, 'a')).toBe(cars[1])
    expect(findCar(next, 'c')).toBe(cars[3])
    expect(cars).toEqual(snapshot)
  })

  it('applySlide 非法时返回 null', () => {
    const cars = fixture()
    expect(applySlide(cars, 'r', 1)).toBeNull()
    expect(applySlide(cars, 'zz', 1)).toBeNull()
    expect(applySlide(cars, 'c', 1)).toBeNull()
    expect(applySlide(cars, 'r', -1)).toBeNull()
  })

  it('applySlide 不改动车的朝向、长度与所在列', () => {
    const cars = fixture()
    const b = findCar(applySlide(cars, 'b', 1) as Car[], 'b') as Car
    expect(b.row).toBe(1)
    expect(b.col).toBe(cars[2].col)
    expect(b.len).toBe(2)
    expect(b.horiz).toBe(false)
  })
})

describe('胜利与布局合法性', () => {
  it('红车贴到最右列即通关', () => {
    expect(isSolved([car('r', 2, 4, 2, true)])).toBe(true)
    expect(isSolved([car('r', 2, 3, 2, true)])).toBe(false)
  })

  it('没有目标车时不算通关', () => {
    expect(isSolved([car('a', 0, 4, 2, true)])).toBe(false)
    expect(isSolved([])).toBe(false)
  })

  it('isValidLayout 接受不重叠且都在盘内的局面', () => {
    expect(isValidLayout(fixture())).toBe(true)
    expect(isValidLayout([car('r', 2, 4, 2, true)])).toBe(true)
  })

  it('isValidLayout 拒绝重叠 / 出界 / 缺目标车', () => {
    // 重叠：两辆横车在第 2 行的 1~2 列相交
    expect(isValidLayout([car('r', 2, 0, 2, true), car('a', 2, 1, 2, true)])).toBe(false)
    // 出界：横车 col+len 超出 6
    expect(isValidLayout([car('r', 2, 0, 2, true), car('a', 0, 5, 2, true)])).toBe(false)
    // 出界：竖车 row+len 超出 6
    expect(isValidLayout([car('r', 2, 0, 2, true), car('a', 5, 0, 2, false)])).toBe(false)
    // 缺目标车
    expect(isValidLayout([car('a', 0, 0, 2, true)])).toBe(false)
    // 空盘
    expect(isValidLayout([])).toBe(false)
  })
})

describe('关卡与初始状态', () => {
  it('levelCars 返回关卡的深拷贝，不与常量共享引用', () => {
    const cars = levelCars(0)
    expect(cars).toEqual(LEVELS[0].cars)
    expect(cars[0]).not.toBe(LEVELS[0].cars[0])
    cars[0].col = 9
    expect(LEVELS[0].cars[0].col).not.toBe(9)
  })

  it('levelCars 下标越界会被钳制', () => {
    expect(levelCars(-5)).toEqual(levelCars(0))
    expect(levelCars(LEVELS.length + 7)).toEqual(levelCars(LEVELS.length - 1))
  })

  it('同 seed 的 create 产出完全一致的初始状态', () => {
    const a = create(12345)
    const b = create(12345)
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a.cars).not.toBe(b.cars)
    expect(a.cars[0]).not.toBe(b.cars[0])
  })

  it('开局是第 1 关、0 步、未通关、无纪录', () => {
    const s = create(7)
    expect(s.level).toBe(0)
    expect(s.moves).toBe(0)
    expect(s.solved).toBe(false)
    expect(s.selected).toBeNull()
    expect(s.lastMove).toBeNull()
    expect(s.seq).toBe(0)
    expect(s.records).toEqual(LEVELS.map(() => -1))
    expect(s.rng).toBe(7)
  })

  it('不同 seed 只影响 rng（关卡是静态常量）', () => {
    const a = create(1)
    const b = create(2)
    expect(a.cars).toEqual(b.cars)
    expect(a.rng).not.toBe(b.rng)
  })
})

describe('reduce：选中与滑动', () => {
  it('select 选中存在的车；重复选中与不存在的车都保持原状态', () => {
    const s = create(1)
    const a = reduce(s, { type: 'select', id: 'a' })
    expect(a.selected).toBe('a')
    expect(reduce(a, { type: 'select', id: 'a' })).toBe(a)
    expect(reduce(s, { type: 'select', id: 'zz' })).toBe(s)
  })

  it('slide 成功后累计步数并记录位移与序号', () => {
    const s = stateOf(fixture())
    const n = reduce(s, { type: 'slide', id: 'b', delta: 1 })
    expect(findCar(n.cars, 'b')?.row).toBe(1)
    expect(n.moves).toBe(1)
    expect(n.selected).toBe('b')
    expect(n.lastMove).toEqual({ id: 'b', from: 0, to: 1 })
    expect(n.seq).toBe(s.seq + 1)
    expect(n.solved).toBe(false)
  })

  it('横车的 lastMove 记录的是 col', () => {
    const cars = [car('r', 0, 0, 2, true), car('a', 4, 0, 2, true)]
    const n = reduce(stateOf(cars), { type: 'slide', id: 'a', delta: 3 })
    expect(n.lastMove).toEqual({ id: 'a', from: 0, to: 3 })
    expect(findCar(n.cars, 'a')?.col).toBe(3)
  })

  it('非法 slide（撞车 / 出界 / 非整数 / 不存在的车）保持引用相等', () => {
    const s = stateOf(fixture())
    expect(reduce(s, { type: 'slide', id: 'r', delta: 1 })).toBe(s)
    expect(reduce(s, { type: 'slide', id: 'r', delta: -1 })).toBe(s)
    expect(reduce(s, { type: 'slide', id: 'c', delta: 1 })).toBe(s)
    expect(reduce(s, { type: 'slide', id: 'zz', delta: 1 })).toBe(s)
    expect(reduce(s, { type: 'slide', id: 'b', delta: 1.5 })).toBe(s)
    expect(reduce(s, { type: 'slide', id: 'b', delta: Number.NaN })).toBe(s)
  })

  it('红车到达最右列即置 solved 并写入本关纪录', () => {
    const cars = [car('r', 2, 3, 2, true)]
    const n = reduce(stateOf(cars), { type: 'slide', id: 'r', delta: 1 })
    expect(n.solved).toBe(true)
    expect(n.moves).toBe(1)
    expect(n.records[0]).toBe(1)
  })

  it('通关后不再接受任何滑动', () => {
    const cars = [car('r', 2, 3, 2, true)]
    const won = reduce(stateOf(cars), { type: 'slide', id: 'r', delta: 1 })
    expect(reduce(won, { type: 'slide', id: 'r', delta: -1 })).toBe(won)
    expect(reduce(won, { type: 'select', id: 'r' })).toBe(won)
  })

  it('更差的步数不覆盖本关纪录，且入参 records 不变', () => {
    const cars = [car('r', 2, 3, 2, true), car('a', 0, 0, 2, true)]
    const base = create(1)
    // 先手动带上「本关最佳 1 步」的纪录，再走 2 步通关
    const s = stateOf(cars, { records: base.records.map((v, i) => (i === 0 ? 1 : v)) })
    const worse = reduce(reduce(s, { type: 'slide', id: 'a', delta: 1 }), { type: 'slide', id: 'r', delta: 1 })
    expect(worse.moves).toBe(2)
    expect(worse.solved).toBe(true)
    expect(worse.records[0]).toBe(1)
    expect(s.records[0]).toBe(1)
    expect(s.moves).toBe(0)
  })
})

describe('reduce：换关', () => {
  it('换到别的关会重置棋盘、步数与选中，并保留纪录表', () => {
    const s = reduce(stateOf(fixture()), { type: 'slide', id: 'b', delta: 1 })
    const n = reduce(s, { type: 'level', index: 3 })
    expect(n.level).toBe(3)
    expect(n.cars).toEqual(levelCars(3))
    expect(n.moves).toBe(0)
    expect(n.solved).toBe(false)
    expect(n.selected).toBeNull()
    expect(n.lastMove).toBeNull()
    expect(n.seq).toBe(s.seq + 1)
    expect(n.records).toEqual(s.records)
  })

  it('下标越界会被钳制，非有限下标保持原状态', () => {
    const s = create(1)
    expect(reduce(s, { type: 'level', index: -3 }).level).toBe(0)
    expect(reduce(s, { type: 'level', index: 999 }).level).toBe(LEVELS.length - 1)
    expect(reduce(s, { type: 'level', index: Number.NaN })).toBe(s)
  })

  it('下标等于当前关：全新局面返回原引用，有进度则重开本关', () => {
    const fresh = create(1)
    expect(reduce(fresh, { type: 'level', index: 0 })).toBe(fresh)

    const played = reduce(fresh, { type: 'select', id: 'a' })
    const restarted = reduce(played, { type: 'level', index: 0 })
    expect(restarted).not.toBe(played)
    expect(restarted.level).toBe(0)
    expect(restarted.moves).toBe(0)
    expect(restarted.selected).toBeNull()
    expect(restarted.cars).toEqual(levelCars(0))
  })
})

describe('reduce 纯度', () => {
  const cases: Array<{ name: string; state: State; action: Parameters<typeof reduce>[1] }> = [
    { name: 'select', state: create(1), action: { type: 'select', id: 'a' } },
    { name: 'slide 合法', state: create(1), action: { type: 'slide', id: 'b', delta: 1 } },
    { name: 'slide 非法', state: create(1), action: { type: 'slide', id: 'b', delta: -9 } },
    { name: 'level 换关', state: create(1), action: { type: 'level', index: 5 } },
    { name: 'level 重开本关', state: stateOf(fixture(), { moves: 3 }), action: { type: 'level', index: 0 } },
  ]

  for (const { name, state, action } of cases) {
    it(`${name} 不修改入参`, () => {
      const snapshot = clone(state)
      reduce(state, action)
      expect(state).toEqual(snapshot)
      expect(clone(state)).toEqual(snapshot)
    })
  }
})

describe('关卡可解性', () => {
  it('12 关全部有解', () => {
    const unsolvable: string[] = []
    for (let i = 0; i < LEVELS.length; i++) if (solve(levelCars(i)) === null) unsolvable.push(`第${i + 1}关`)
    expect(unsolvable).toEqual([])
  })

  LEVELS.forEach((lv, i) => {
    it(`第 ${i + 1} 关「${lv.name}」BFS 可解，最优步数与重放一致`, () => {
      const sol = solve(levelCars(i))
      expect(sol).not.toBeNull()
      const found = sol as Solution
      expect(found.steps).toBeGreaterThan(0)

      // BFS 给出的序列必须每一步都通过 rules 的合法性判定
      let s = reduce(create(1), { type: 'level', index: i })
      for (const m of found.moves) {
        expect(canSlide(s.cars, m.id, m.delta)).toBe(true)
        s = reduce(s, { type: 'slide', id: m.id, delta: m.delta })
      }
      expect(s.moves).toBe(found.steps)
      expect(s.solved).toBe(true)
      expect(isSolved(s.cars)).toBe(true)
      // 通关时写入的本关纪录应等于最优步数
      expect(s.records[i]).toBe(found.steps)
    })
  })

  it('同一初始局面两次求解结果一致', () => {
    for (let i = 0; i < LEVELS.length; i++) {
      const a = solve(levelCars(i))
      const b = solve(levelCars(i))
      expect(a).not.toBeNull()
      expect(b?.steps).toBe(a?.steps)
    }
  })
})

describe('关卡数据完整性', () => {
  it('12 关的 isValidLayout 全部为 true', () => {
    const bad: string[] = []
    for (let i = 0; i < LEVELS.length; i++) {
      if (!isValidLayout(levelCars(i))) bad.push(`第${i + 1}关`)
    }
    expect(bad).toEqual([])
    expect(LEVELS).toHaveLength(12)
  })

  it('每辆车的车头与长度都在棋盘内', () => {
    const bad: string[] = []
    for (let i = 0; i < LEVELS.length; i++) {
      const over = levelCars(i).filter((c) => !inBoard(c)).map((c) => c.id)
      if (over.length > 0) bad.push(`第${i + 1}关:${over.join(',')}`)
    }
    expect(bad).toEqual([])
  })

  it('不存在互相重叠的车', () => {
    const bad: string[] = []
    for (let i = 0; i < LEVELS.length; i++) {
      const seen = new Set<number>()
      const hit: string[] = []
      for (const c of levelCars(i)) {
        for (const cell of carCells(c)) {
          if (seen.has(cell)) hit.push(c.id)
          seen.add(cell)
        }
      }
      if (hit.length > 0) bad.push(`第${i + 1}关:${[...new Set(hit)].join(',')}`)
    }
    expect(bad).toEqual([])
  })

  it('12 关全部可解，且 LEVEL_BEST 与 BFS 实测的最短步数一致', () => {
    const measured: number[] = []
    for (let i = 0; i < LEVELS.length; i++) {
      const sol = solve(levelCars(i))
      expect(sol, `第${i + 1}关「${LEVELS[i].name}」应当有解`).not.toBeNull()
      measured.push((sol as Solution).steps)
    }
    expect(measured).toEqual([...LEVEL_BEST])
    expect(LEVEL_BEST).toHaveLength(LEVELS.length)
  })

  it('applySlide 与 canSlide 一样拒绝 delta=0，0 位移不会被算作一步', () => {
    const cars = fixture()
    expect(canSlide(cars, 'b', 0)).toBe(false)
    expect(applySlide(cars, 'b', 0)).toBeNull()

    const s = stateOf(fixture())
    const n = reduce(s, { type: 'slide', id: 'b', delta: 0 })
    expect(n).toBe(s)
    expect(n.moves).toBe(0)
    expect(n.lastMove).toBeNull()
  })
})
