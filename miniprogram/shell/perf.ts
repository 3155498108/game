/**
 * 给小程序补一个 `performance.now()`。
 *
 * 起因是 `render/anim.ts`（与网页版**逐字节共享**的代码）里这一行：
 *
 *   return typeof performance !== 'undefined' ? performance.now() : 0
 *
 * 那个 `0` 兜底在小程序里是**坏的**：小程序没有 `performance` 对象，
 * 于是所有动画都卡在 0 时刻——`tweenTo` 永远插值不动，`elapsedSince` 恒为 0，
 * 过渡效果会整片消失。
 *
 * 两种修法：
 * - 改 `render/anim.ts` → 共享层多出一处「手改副本」，两版从此不再逐字节相同，
 *   以后每次升级都要记得同步，而且同步脚本没法整目录复制。
 * - 在这里补 `performance` → `render/anim.ts` 保持原样，共享层**零差异**。
 *
 * 选后者。共享层能不能整目录复制，是「两版要不要分仓库」这个决定的前置条件：
 * 只要共享层零差异，日后真要拆仓库，复制就是纯机械操作。
 *
 * 顺带解决一个细节：`performance.now()` 是**单调时钟**，`Date.now()` 是**墙钟**——
 * 用户改系统时间或 NTP 校准时墙钟会回拨，动画时长会算出负数。
 * 所以这里做的是「单调化的 Date.now」：只累计向前的时间差，回拨部分直接丢弃。
 */

type Perf = { now(): number }

interface GlobalWithPerf {
  performance?: Perf
}

/**
 * 造一个单调时钟。`clock` 可注入，便于测试里模拟「墙钟回拨」。
 * 起点为 0，与 `performance.now()` 的语义（距页面加载的毫秒数）一致。
 */
export function makePerfShim(clock: () => number = Date.now): Perf {
  let lastWall = clock()
  let mono = 0
  return {
    now(): number {
      const wall = clock()
      const delta = wall - lastWall
      if (delta > 0) {
        // 正常前进：把真实经过的时间累加进单调时钟
        mono += delta
        lastWall = wall
      } else if (delta < 0) {
        // 墙钟回拨（用户改系统时间 / NTP 校时）：**重新定基但不倒计时**。
        // 不能保留「历史最高水位」——那样墙钟被调早 1 小时，时钟就会冻住 1 小时。
        // 重新定基后，接着按新的墙钟正常累加，回拨那一瞬间的时长直接丢弃。
        lastWall = wall
      }
      return mono
    },
  }
}

/**
 * 装上 `performance.now()`。
 *
 * 若目标环境已自带可用的 `performance`（比如较新的基础库）就**保留它自带的**，
 * 不覆盖——那个通常是更标准的实现。
 */
export function installPerfShim(target?: GlobalWithPerf): void {
  const g = (target ?? (globalThis as unknown as GlobalWithPerf)) as GlobalWithPerf
  if (g.performance && typeof g.performance.now === 'function') return
  g.performance = makePerfShim()
}
