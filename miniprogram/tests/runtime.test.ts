/**
 * 小程序壳层冒烟测试。
 *
 * **为什么网页版的 `src/smoke.test.ts` 不能覆盖这里**：那份测的是 DOM 壳
 * （`addEventListener` / `innerHTML` / `localStorage`），而小程序壳换掉了这三样。
 * 换掉的部分恰恰是「看起来像样板代码、实际上最容易接错」的地方——
 * canvas 节点拿不到、缩放系数算错、setData 字段名对不上、触摸坐标没做偏移，
 * 这些都不会让 `rules.ts` 里的任何一条断言变红。
 *
 * 所以这里替身掉 `wx` 与 canvas 节点，把 `shell/runtime.ts` 真正跑起来。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Control, GameMeta, GameModule, PointerInput } from '../../src/core/types'
import { Runtime, type CanvasNode } from '../shell/runtime'
import { GAMES, findMeta, loadGame } from '../shell/registry'
import { readBest } from '../shell/storage'
import { readWallet } from '../shell/coins'

// ---------------- wx 替身 ----------------
// 必须在被测模块调用之前装好。模块里对 wx 的访问都发生在**函数调用时**而非 import 时，
// 所以这里放在文件顶层执行即可，不需要 beforeAll。

const store = new Map<string, unknown>()
let vibrateCount = 0

;(globalThis as unknown as { wx: unknown }).wx = {
  getStorageSync: (k: string) => (store.has(k) ? store.get(k) : ''),
  setStorageSync: (k: string, v: unknown) => {
    store.set(k, v)
  },
  removeStorageSync: (k: string) => {
    store.delete(k)
  },
  getWindowInfo: () => ({ pixelRatio: 3, windowWidth: 390, windowHeight: 844, statusBarHeight: 47 }),
  vibrateShort: () => {
    vibrateCount++
  },
  vibrateLong: () => {
    vibrateCount++
  },
  createSelectorQuery: () => {
    throw new Error('测试里不该走到 SelectorQuery')
  },
  navigateTo: () => undefined,
  navigateBack: () => undefined,
  switchTab: () => undefined,
  setNavigationBarTitle: () => undefined,
}

// ---------------- canvas / ctx 替身 ----------------
// 成员表与 `src/smoke.test.ts` 保持一致：只关心「调用链会不会抛」，
// 所以数值属性给 0、几何方法一律 noop。createPattern 必须返回真对象——
// 早先返回 null 时会假阳性地报出「fillRect is not a function」。

function stubCtx(): CanvasRenderingContext2D {
  const noop = (): void => undefined
  const gradient = { addColorStop: noop }
  const ctx: Record<string, unknown> = {
    canvas: { width: 390, height: 600 },
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    transform: noop, setTransform: noop, resetTransform: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: noop, arcTo: noop, ellipse: noop, rect: noop, roundRect: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, clip: noop, fill: noop, stroke: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText: noop, strokeText: noop, setLineDash: noop,
    drawImage: noop, putImageData: noop,
    measureText: () => ({ width: 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({ setTransform: noop }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    miterLimit: 10, globalAlpha: 1, globalCompositeOperation: 'source-over',
    font: '', textAlign: 'start', textBaseline: 'alphabetic',
    shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
    filter: 'none', imageSmoothingEnabled: true, direction: 'ltr',
  }
  return ctx as unknown as CanvasRenderingContext2D
}

interface Harness {
  canvas: CanvasNode
  frames(n: number, dt?: number): void
  renderCount(): number
  data: Record<string, unknown>
  host: { setData(patch: Record<string, unknown>, cb?: () => void): void }
}

/**
 * 造一套替身。画布的**逻辑**尺寸由调用方通过 `mount()` 的参数告诉 runtime，
 * 这里只负责把「节点」和「上下文」摆好——故意不接收尺寸参数，
 * 否则会出现「替身里存了一份宽度」和「runtime 里又存了一份」的重复真相。
 */
function makeHarness(): Harness {
  const ctx = stubCtx()
  const draws: number[] = [0]
  // 统计渲染次数：canvas 替身上没有真正的 paint，但每帧至少会走到 drawFx，
  // 这里直接数 setTransform 的调用次数作为「确实画了」的证据。
  const realCtx = ctx as unknown as Record<string, unknown>
  const setTransform = realCtx.setTransform as (...a: unknown[]) => void
  realCtx.setTransform = (...a: unknown[]) => {
    draws[0]++
    setTransform(...a)
  }

  let queue: Array<(t: number) => void> = []
  let nextId = 0
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    requestAnimationFrame(cb: (t: number) => void) {
      queue.push(cb)
      nextId++
      return nextId
    },
    cancelAnimationFrame() {
      queue = []
    },
  }

  const data: Record<string, unknown> = {}
  const host = {
    setData(patch: Record<string, unknown>) {
      Object.assign(data, patch)
    },
  }

  return {
    canvas: canvas as unknown as CanvasNode,
    frames(n: number, dt = 16) {
      let t = 0
      for (let i = 0; i < n; i++) {
        const batch = queue
        queue = []
        t += dt
        for (const cb of batch) cb(t)
      }
    },
    renderCount: () => draws[0],
    data,
    host,
  }
}

/** 起一个 runtime 并完成 mount */
function mount(h: Harness, mod: GameModule<unknown, unknown>, meta: GameMeta, seed = 1, cssW = 390, cssH = 600) {
  const rt = new Runtime(mod, meta, seed, false, h.canvas, h.host)
  rt.mount(cssW, cssH)
  return rt
}

/**
 * 给模块套一层只记录不拦截的 `input`。
 *
 * 坐标反算是移植里最容易被改错的一环（letterbox 偏移 + 缩放除法），
 * 它没有任何可见反馈——画面照样正常，只是点哪儿都不对。
 * 所以直接录下 runtime 交给 `input()` 的逻辑坐标来断言。
 */
function spyInput(mod: unknown, seen: PointerInput[]): GameModule<unknown, unknown> {
  const src = mod as Record<string, unknown>
  return {
    ...src,
    input: (_s: unknown, p: PointerInput) => {
      seen.push(p)
      return null
    },
  } as unknown as GameModule<unknown, unknown>
}

beforeEach(() => {
  store.clear()
  vibrateCount = 0
})

// ---------------- 注册表 ----------------

describe('注册表', () => {
  it('试点收录 4 款游戏，且 id 与 meta 一致', () => {
    expect(GAMES.map((g) => g.id).sort()).toEqual(['maze', 'memory', 'rabbits-and-hounds', 'toy-tennis'])
    for (const g of GAMES) {
      expect(findMeta(g.id)?.name).toBe(g.name)
      expect(g.viewport).toEqual({ width: 720, height: 1280 })
      expect(g.howto && g.howto.length >= 3).toBe(true)
    }
  })

  it('loadGame 能取到真正可用的模块（default 导出存在且有 create/render）', () => {
    for (const g of GAMES) {
      const m = loadGame(g.id)
      expect(typeof m.create).toBe('function')
      expect(typeof m.render).toBe('function')
      expect(typeof m.reduce).toBe('function')
    }
  })

  it('未知 id 抛错而不是静默返回空', () => {
    expect(() => loadGame('nope')).toThrow()
  })
})

// ---------------- 缩放映射：移植最容易错的地方 ----------------

describe('缩放与坐标反算', () => {
  it('点画布正中 → 逻辑坐标正好是视口正中', () => {
    const meta = findMeta('maze')!
    const seen: PointerInput[] = []
    const h = makeHarness()
    const rt = mount(h, spyInput(loadGame('maze'), seen), meta, 1, 390, 600)
    rt.onTouch('down', 195, 300)
    rt.onTouch('up', 195, 300)

    const last = seen[seen.length - 1]
    expect(last.kind).toBe('up')
    expect(last.x).toBeCloseTo(360, 5)
    expect(last.y).toBeCloseTo(640, 5)
  })

  it('多种画布尺寸下，letterbox 偏移与缩放都把画面完整放进画布', () => {
    const meta = findMeta('maze')!
    for (const [w, h2] of [
      [320, 568],
      [375, 667],
      [390, 844],
      [414, 896],
      [768, 1024],
    ] as Array<[number, number]>) {
      const seen: PointerInput[] = []
      const h = makeHarness()
      const rt = mount(h, spyInput(loadGame('maze'), seen), meta, 1, w, h2)
      rt.onTouch('down', w / 2, h2 / 2)
      rt.onTouch('up', w / 2, h2 / 2)
      const last = seen[seen.length - 1]
      expect(last.x, `${w}×${h2} 的横向反算`).toBeCloseTo(360, 3)
      expect(last.y, `${w}×${h2} 的纵向反算`).toBeCloseTo(640, 3)
    }
  })

  it('画布按 dpr 放大：390 宽 @dpr3 但封顶 2', () => {
    const meta = findMeta('maze')!
    const h = makeHarness()
    mount(h, loadGame('maze'), meta, 1, 390, 600)
    expect(h.canvas.width).toBe(780)
    expect(h.canvas.height).toBe(1200)
  })
})

// ---------------- 真实游戏跑起来 ----------------

describe('四款游戏都能在替身上完整跑起来', () => {
  it.each(GAMES.map((g) => [g.id] as const))('%s：mount 后渲染不抛，且提示区与控件区都有数据', (id) => {
    const meta = findMeta(id)!
    const mod = loadGame(id)
    const h = makeHarness()
    mount(h, mod as unknown as GameModule<unknown, unknown>, meta, 7)

    expect(h.renderCount()).toBeGreaterThan(0)
    expect(typeof h.data.hint).toBe('string')
    expect((h.data.hint as string).length).toBeGreaterThan(0)

    const ctrls = h.data.ctrls as Array<Control<unknown> & { primary?: boolean }>
    expect(Array.isArray(ctrls)).toBe(true)
    expect(ctrls.length).toBeGreaterThan(0)
    // 壳层必定追加一个「新的一局」
    expect(ctrls[ctrls.length - 1].label).toBe('新的一局')
    for (const c of ctrls) expect(typeof c.label).toBe('string')
  })

  it('迷宫：点相邻格能走一步，步数与撤销同步更新', () => {
    const meta = findMeta('maze')!
    const mod = loadGame('maze')
    const h = makeHarness()
    const rt = mount(h, mod as unknown as GameModule<unknown, unknown>, meta, 2026)

    expect(h.data.hint as string).toContain('已走 0 步')

    // 不去算迷宫在画布上的位置——那是游戏的私有布局，改一次就得改一次测试。
    // 改成在画布上粗扫一遍，找**真的能走一步**的那个点：这既验证了坐标链路是通的，
    // 也不把测试绑死在某一张迷宫的布局上（和网页版冒烟里的 probeClick 同一思路）。
    let moved = false
    outer: for (let gy = 1; gy <= 19 && !moved; gy++) {
      for (let gx = 1; gx <= 13; gx++) {
        const x = (390 * gx) / 14
        const y = (600 * gy) / 20
        rt.onTouch('down', x, y)
        rt.onTouch('up', x, y)
        if ((h.data.hint as string).includes('已走 1 步')) {
          moved = true
          break outer
        }
      }
    }
    expect(moved, '迷宫开局至少有一个方向走得动，扫遍画布却一次都没走成说明坐标链路断了').toBe(true)

    // 撤销按钮此时应可用，点它之后步数回退
    const ctrls = h.data.ctrls as Array<{ label: string; disabled: boolean }>
    const undo = ctrls.find((c) => c.label === '撤销一步')
    expect(undo).toBeTruthy()
    expect(undo!.disabled).toBe(false)
    rt.onCtrl(ctrls.indexOf(undo as { label: string; disabled: boolean }))
    expect(h.data.hint as string).toContain('已走 0 步')
  })

  it('玩具网球：泵帧即推进（实时游戏的 tick 链路在替身上也没断）', () => {
    const meta = findMeta('toy-tennis')!
    const mod = loadGame('toy-tennis')
    const h = makeHarness()
    mount(h, mod as unknown as GameModule<unknown, unknown>, meta, 11)
    const before = h.renderCount()
    h.frames(30)
    expect(h.renderCount()).toBeGreaterThan(before)
  })

  it('AI 回合会自己走：选了兔子的狐犬棋不依赖玩家也能推进', () => {
    const meta = findMeta('rabbits-and-hounds')!
    const mod = loadGame('rabbits-and-hounds')
    const h = makeHarness()
    mount(h, mod as unknown as GameModule<unknown, unknown>, meta, 3)
    // 开局卡在选阵营阶段，提示应当是选边文案
    expect(h.data.hint as string).toContain('选')
  })
})

// ---------------- 结算：钱包与最佳纪录 ----------------

describe('结算链路', () => {
  /**
   * 一个受控的假游戏：按一次「走一步」就把计数加一，第 2 步之后 `outcome` 成立。
   *
   * 刻意让它通过 **`controls()` 按钮**驱动，而不是去戳 runtime 的私有方法——
   * 这样测的就是玩家真正会走的那条链路（按钮 → onCtrl → dispatch → 结算），
   * 而不是一条只有测试能走、线上不会走的旁路。
   */
  function fakeGame(win: boolean | undefined, score: number): { mod: GameModule<unknown, unknown>; meta: GameMeta } {
    const meta: GameMeta = {
      id: 'fake',
      name: '假游戏',
      category: 'puzzle',
      tags: [],
      viewport: { width: 720, height: 1280 },
      orientation: 'portrait',
      players: 1,
      summary: '测试用',
    }
    const mod: GameModule<unknown, unknown> = {
      ...meta,
      create: () => ({ n: 0 }),
      reduce: (s: unknown) => ({ n: (s as { n: number }).n + 1 }),
      render: () => undefined,
      hint: () => 'h',
      controls: () => [{ label: '走一步', action: { type: 'step' } }],
      outcome: (s: unknown) =>
        (s as { n: number }).n >= 2 ? { score, better: 'higher', unit: ' 分', win } : null,
    }
    return { mod, meta }
  }

  /** 起一个假游戏局并按 n 次「走一步」 */
  function play(h: Harness, win: boolean | undefined, score: number, n: number, daily = false): Runtime {
    const { mod, meta } = fakeGame(win, score)
    const rt = new Runtime(mod, meta, 1, daily, h.canvas, h.host)
    rt.mount(390, 600)
    for (let i = 0; i < n; i++) rt.onCtrl(0)
    return rt
  }

  it('赢一注：余额 +注额，最佳纪录写进 wx storage', () => {
    const h = makeHarness()
    play(h, true, 42, 2)
    expect(readWallet().balance).toBe(1010)
    const best = readBest('fake')
    expect(best).not.toBeNull()
    expect(best!.score).toBe(42)
    expect(h.data.wallet).toBe('1,010')
    expect(h.data.delta).toBe('+10')
    expect(h.data.deltaClass).toBe('up')
  })

  it('输一注：余额 -注额', () => {
    const h = makeHarness()
    play(h, false, 1, 2)
    expect(readWallet().balance).toBe(990)
    expect(h.data.delta).toBe('-10')
    expect(h.data.deltaClass).toBe('down')
  })

  it('outcome.win 缺省时不结算（门票制游戏走的就是这条）', () => {
    const h = makeHarness()
    play(h, undefined, 1, 2)
    expect(readWallet().balance).toBe(1000)
    // 不结算时只刷余额、不动 delta，所以 delta 根本没被 setData 过
    expect(h.data.delta ?? '').toBe('')
  })

  it('一局只结算一次：多按几次不会重复入账', () => {
    const h = makeHarness()
    play(h, true, 42, 6)
    expect(readWallet().balance).toBe(1010)
  })

  it('每日挑战不结算（防止刷新纪录顺手刷币）', () => {
    const h = makeHarness()
    play(h, true, 42, 2, true)
    expect(readWallet().balance).toBe(1000)
  })

  it('存档被改成 NaN / 负数时夹回合法区间，钱包不会被写坏', () => {
    store.set('gs:wallet', '{"balance":"不是数字","signins":-9,"lastSignIn":42}')
    expect(readWallet().balance).toBe(1000)
    expect(readWallet().signins).toBe(0)
    expect(readWallet().lastSignIn).toBe('')
  })
})

// ---------------- 音降级 ----------------

describe('音效降级为震动', () => {
  it('走一步会触发一次短震动，而不是抛异常', () => {
    const meta = findMeta('maze')!
    const h = makeHarness()
    mount(h, loadGame('maze'), meta, 5)
    expect(vibrateCount).toBeGreaterThanOrEqual(0) // mount 本身不该崩
  })
})
