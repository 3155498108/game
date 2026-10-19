/**
 * 可播种随机数：mulberry32。
 * 游戏逻辑中禁止使用 Math.random()，统一把 rng 状态（一个 32 位整数）放进游戏 State。
 */

/** 纯函数单步：输入当前状态，返回 [0,1) 随机数与下一个状态 */
export function rngStep(a: number): [number, number] {
  const next = (a + 0x6d2b79f5) | 0
  let t = Math.imul(next ^ (next >>> 15), 1 | next)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next]
}

/** 经典闭包形式的 mulberry32(seed) */
export function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    const [v, n] = rngStep(a)
    a = n
    return v
  }
}

/**
 * 局部可变的随机数游标。用法（在 reduce 内）：
 *   const r = new Rng(state.rng)
 *   const x = r.int(6)
 *   return { ...state, rng: r.s }
 * 对外依然是纯函数：相同输入 → 相同输出。
 */
export class Rng {
  s: number
  constructor(state: number) {
    this.s = state | 0
  }
  /** [0,1) */
  next(): number {
    const [v, n] = rngStep(this.s)
    this.s = n
    return v
  }
  /** [0, n) 的整数 */
  int(n: number): number {
    return Math.floor(this.next() * n)
  }
  /** [min, max] 闭区间整数 */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1)
  }
  /** [min, max) 浮点数 */
  float(min: number, max: number): number {
    return min + this.next() * (max - min)
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]
  }
  /** Fisher–Yates，返回新数组，不修改入参 */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1)
      const tmp = out[i]
      out[i] = out[j]
      out[j] = tmp
    }
    return out
  }
}

/** 骰子：Math.floor(random * 6) + 1 的可播种版本 */
export function rollDie(r: Rng): number {
  return Math.floor(r.next() * 6) + 1
}

/** 把任意整数打散成较好的初始种子 */
export function hashSeed(n: number): number {
  let h = (n ^ 0x9e3779b9) | 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) | 0
}
