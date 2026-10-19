/**
 * 小程序播放页的测试。
 *
 * 播放页是**页面层与运行时之间那根接线**所在：
 *
 *   WXML 的 `bindtouch*` 事件 → 换算成画布局部坐标 → runtime.onTouch
 *   SelectorQuery 量到的画布 → runtime.mount
 *   屏幕旋转 → 重新量 → runtime.resize
 *   onHide / onShow / onUnload → runtime.stop / start / destroy
 *
 * 这些活此前**一行测试都没有**（`pages/` 整个目录没测试），
 * 而它们错起来全是**静默**的：坐标少减一个画布偏移，玩家的每一次点击都落在错的地方，
 * 画面照样正常，只是「点哪儿都不对」——没有任何报错能提示你。
 *
 * 所以这里把 `shell/runtime` 替身掉：页面层要干的事很单纯——
 * 「到底把什么值传给了 runtime」可以被精确断言。
 * runtime 自身的逻辑另有 69 条用例覆盖，两边不重复。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { todaySeed } from '../shell/daily'

interface Call {
  name: string
  args: unknown[]
}

/**
 * `vi.mock` 的工厂会被提升到文件最上方，早于普通变量的初始化。
 * 所以记录用的数组必须用 `vi.hoisted` 在最前面建好，
 * 否则工厂里引用它们会撞上 TDZ。
 */
const { calls, ctorArgs } = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown[] }>,
  ctorArgs: [] as Array<{
    mod: unknown
    meta: unknown
    seed: number
    daily: boolean
    canvas: unknown
    host: unknown
  }>,
}))

vi.mock('../shell/runtime', () => {
  class FakeRuntime {
    constructor(
      mod: unknown,
      meta: unknown,
      seed: number,
      daily: boolean,
      canvas: unknown,
      host: unknown,
    ) {
      ctorArgs.push({ mod, meta, seed, daily, canvas, host })
      calls.push({ name: 'ctor', args: [] })
    }
    mount(w: number, h: number) {
      calls.push({ name: 'mount', args: [w, h] })
    }
    resize(w: number, h: number) {
      calls.push({ name: 'resize', args: [w, h] })
    }
    start() {
      calls.push({ name: 'start', args: [] })
    }
    stop() {
      calls.push({ name: 'stop', args: [] })
    }
    destroy() {
      calls.push({ name: 'destroy', args: [] })
    }
    onTouch(kind: string, x: number, y: number) {
      calls.push({ name: 'onTouch', args: [kind, x, y] })
    }
    onCancel() {
      calls.push({ name: 'onCancel', args: [] })
    }
    onCtrl(i: number) {
      calls.push({ name: 'onCtrl', args: [i] })
    }
    onCycleBet() {
      calls.push({ name: 'onCycleBet', args: [] })
    }
    onToggleSound() {
      calls.push({ name: 'onToggleSound', args: [] })
    }
    onDismissRotate() {
      calls.push({ name: 'onDismissRotate', args: [] })
    }
  }
  // 固定种子：页面每次「普通局」都会换一个随机种子，测试需要可复现
  return { Runtime: FakeRuntime, newSeed: () => 424242 }
})

// ---------------- 替身 ----------------

const store = new Map<string, unknown>()
let pageOptions: Record<string, any> | null = null
let navTitle = ''
let resizeCb: ((res: { size: { windowWidth: number; windowHeight: number } }) => void) | null = null
const win = { pixelRatio: 3, windowWidth: 390, windowHeight: 844, statusBarHeight: 47 }

/** 画布在页面中的位置与尺寸——页面坐标 ↔ 画布局部坐标这层换算的输入 */
let rect = { left: 0, top: 0, width: 390, height: 600 }

const fakeCanvas = {
  width: 0,
  height: 0,
  getContext: () => ({}) as CanvasRenderingContext2D,
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => undefined,
}

;(globalThis as unknown as { wx: unknown }).wx = {
  getStorageSync: (k: string) => (store.has(k) ? store.get(k) : ''),
  setStorageSync: (k: string, v: unknown) => {
    store.set(k, v)
  },
  removeStorageSync: (k: string) => {
    store.delete(k)
  },
  getWindowInfo: () => ({ ...win }),
  onWindowResize: (cb: (res: { size: { windowWidth: number; windowHeight: number } }) => void) => {
    resizeCb = cb
  },
  offWindowResize: (cb?: (res: { size: { windowWidth: number; windowHeight: number } }) => void) => {
    if (cb && resizeCb === cb) resizeCb = null
  },
  createSelectorQuery: () => ({
    select: (_sel: string) => ({
      fields: () => ({
        exec: (cb: (res: unknown[]) => void) => {
          cb([
            {
              node: fakeCanvas,
              width: rect.width,
              height: rect.height,
              left: rect.left,
              top: rect.top,
            },
          ])
        },
      }),
    }),
    selectViewport: () => ({ exec: (cb: (res: unknown[]) => void) => cb([{}]) }),
  }),
  vibrateShort: () => undefined,
  vibrateLong: () => undefined,
  setNavigationBarTitle: (o: { title: string }) => {
    navTitle = o.title
  },
  navigateTo: () => undefined,
}

;(globalThis as unknown as { Page: unknown }).Page = (o: unknown) => {
  pageOptions = o as Record<string, any>
}

// 页面模块在 import 时就调用 Page({...})，所以只能动态 import
await import('../pages/play/play')

interface FakePage {
  data: Record<string, any>
  setData(patch: Record<string, unknown>): void
  onLoad(query: Record<string, string | undefined>): void
  onReady(): void
  onShow(): void
  onHide(): void
  onUnload(): void
  onTouchStart(e: unknown): void
  onTouchMove(e: unknown): void
  onTouchEnd(e: unknown): void
  onCtrl(e: unknown): void
  onBet(): void
  onSound(): void
  onHowto(): void
  onCloseHowto(): void
  onDismissRotate(): void
}

function makePage(): FakePage {
  if (!pageOptions) throw new Error('页面模块没有注册 Page({...})')
  const inst = {
    ...pageOptions,
    data: JSON.parse(JSON.stringify(pageOptions.data)) as Record<string, any>,
  } as FakePage
  inst.setData = (patch: Record<string, unknown>) => {
    Object.assign(inst.data, patch)
  }
  return inst
}

function names(): string[] {
  return calls.map((c) => c.name)
}

function first(name: string): Call | undefined {
  return calls.find((c) => c.name === name)
}

/** 造一个触摸事件。`x/y` 是画布自带的相对坐标，`clientX/clientY` 是页面坐标 */
function touchEvent(x?: number, y?: number, clientX?: number, clientY?: number): unknown {
  const t: Record<string, number> = {}
  if (x !== undefined) t.x = x
  if (y !== undefined) t.y = y
  if (clientX !== undefined) t.clientX = clientX
  if (clientY !== undefined) t.clientY = clientY
  return { type: 'touchstart', touches: [t], changedTouches: [t], timeStamp: 0 }
}

beforeEach(() => {
  // 播放页把 runtime 挂在**模块级**变量上（因为 onReady 之前拿不到 canvas 节点）。
  // 所以每条用例前先把上一条留下的 runtime 卸掉，否则它会继续收到触摸。
  makePage().onUnload()
  calls.length = 0
  ctorArgs.length = 0
  store.clear()
  resizeCb = null
  navTitle = ''
  rect = { left: 0, top: 0, width: 390, height: 600 }
  win.pixelRatio = 3
  win.windowWidth = 390
  win.windowHeight = 844
})

// ---------------- onLoad ----------------

describe('播放页 onLoad', () => {
  it('游戏 id 不存在时给出「找不到」状态，并且不建 runtime', () => {
    const p = makePage()
    p.onLoad({ id: '根本没有这个游戏' })
    expect(p.data.missing).toBe(true)
    expect(p.data.title).toBe('小游戏合集')
    expect(() => p.onReady()).not.toThrow()
    expect(ctorArgs.length).toBe(0)
  })

  it('正常 id：标题、玩法说明、方向都对，导航栏标题也跟着换', () => {
    const p = makePage()
    p.onLoad({ id: 'maze' })
    expect(p.data.missing).toBe(false)
    expect(p.data.title).toBe('随机迷宫')
    expect(p.data.orientation).toBe('portrait')
    expect(p.data.want).toBe('竖屏')
    expect((p.data.howto as string[]).length).toBeGreaterThan(0)
    expect(navTitle).toBe('随机迷宫')
  })

  it('横屏游戏：方向与提示文案都换成横屏', () => {
    const p = makePage()
    p.onLoad({ id: 'toy-tennis' })
    expect(p.data.orientation).toBe('landscape')
    expect(p.data.want).toBe('横屏')
  })

  it('每日挑战：用当天日期做种子，两次进来是同一局', () => {
    const p = makePage()
    p.onLoad({ id: 'maze', daily: '1' })
    p.onReady()
    expect(ctorArgs[0].daily).toBe(true)
    expect(ctorArgs[0].seed).toBe(todaySeed())
  })

  it('普通局：每次换一颗新种子', () => {
    const p = makePage()
    p.onLoad({ id: 'maze' })
    p.onReady()
    expect(ctorArgs[0].daily).toBe(false)
    expect(ctorArgs[0].seed).toBe(424242) // 替身里固定的 newSeed()
  })
})

// ---------------- 画布接线 ----------------

describe('播放页与画布的接线', () => {
  it('onReady：量到画布尺寸后建 runtime 并 mount', () => {
    rect = { left: 12, top: 34, width: 390, height: 600 }
    const p = makePage()
    p.onLoad({ id: 'maze' })
    p.onReady()

    expect(ctorArgs.length).toBe(1)
    expect(ctorArgs[0].canvas).toBe(fakeCanvas)
    expect(ctorArgs[0].host).toBe(p) // 页面自己当 host，runtime 靠它 setData
    expect(first('mount')!.args).toEqual([390, 600])
  })

  it('屏幕旋转：重新量画布并 resize', () => {
    const p = makePage()
    p.onLoad({ id: 'maze' })
    p.onReady()
    calls.length = 0

    // 转屏后画布在页面里换了个尺寸
    rect = { left: 0, top: 0, width: 844, height: 390 }
    win.windowWidth = 844
    win.windowHeight = 390
    expect(resizeCb).toBeTruthy()
    resizeCb!({ size: { windowWidth: 844, windowHeight: 390 } })

    expect(first('resize')!.args).toEqual([844, 390])
  })
})

// ---------------- 坐标换算（最容易静默出错的一环） ----------------

describe('触摸坐标换算', () => {
  /** 页面坐标 → 画布局部坐标：要减掉画布在页面中的位置 */
  it('clientX/clientY 要减掉画布在页面中的位置', () => {
    rect = { left: 120, top: 260, width: 390, height: 600 }
    const p = makePage()
    p.onLoad({ id: 'maze' })
    p.onReady()
    calls.length = 0

    p.onTouchStart(touchEvent(undefined, undefined, 300, 500))
    p.onTouchEnd(touchEvent(undefined, undefined, 300, 500))

    const ts = calls.filter((c) => c.name === 'onTouch')
    expect(ts.length).toBe(2)
    expect(ts[0].args).toEqual(['down', 180, 240])
    expect(ts[1].args).toEqual(['up', 180, 240])
  })

  it('优先用画布自带的 x/y：有它就不该再减偏移', () => {
    rect = { left: 120, top: 260, width: 390, height: 600 }
    const p = makePage()
    p.onLoad({ id: 'maze' })
    p.onReady()
    calls.length = 0

    p.onTouchStart(touchEvent(30, 40, 999, 999))
    expect(first('onTouch')!.args).toEqual(['down', 30, 40])
  })

  it('触摸事件没有坐标时忽略，不乱发', () => {
    const p = makePage()
    p.onLoad({ id: 'maze' })
    p.onReady()
    calls.length = 0

    p.onTouchStart({ type: 'touchstart', touches: [], changedTouches: [], timeStamp: 0 })
    expect(calls.filter((c) => c.name === 'onTouch').length).toBe(0)
  })

  it('移动事件也走同一套换算', () => {
    rect = { left: 10, top: 20, width: 390, height: 600 }
    const p = makePage()
    p.onLoad({ id: 'maze' })
    p.onReady()
    calls.length = 0

    p.onTouchMove(touchEvent(undefined, undefined, 100, 200))
    expect(first('onTouch')!.args).toEqual(['move', 90, 180])
  })
})

// ---------------- 生命周期 ----------------

describe('播放页生命周期', () => {
  it('切后台停帧、切回前台续上、卸载时销毁并解绑转屏回调', () => {
    const p = makePage()
    p.onLoad({ id: 'maze' })
    p.onReady()
    calls.length = 0

    p.onHide()
    expect(names()).toContain('stop')

    p.onShow()
    expect(names()).toContain('start')

    p.onUnload()
    expect(names()).toContain('destroy')
    // 转屏回调必须解绑：不解绑的话，页面销毁后转屏还会去动一个已经没用的 runtime
    expect(resizeCb).toBeNull()
  })

  it('控件、注额、静音、旋转提示「仍要继续」都转发给 runtime', () => {
    const p = makePage()
    p.onLoad({ id: 'maze' })
    p.onReady()
    calls.length = 0

    p.onCtrl({ currentTarget: { dataset: { i: 2 } } })
    p.onBet()
    p.onSound()
    p.onDismissRotate()

    expect(first('onCtrl')!.args).toEqual([2])
    expect(names()).toContain('onCycleBet')
    expect(names()).toContain('onToggleSound')
    expect(names()).toContain('onDismissRotate')
  })

  it('玩法弹层：开与关', () => {
    const p = makePage()
    p.onLoad({ id: 'maze' })
    p.onHowto()
    expect(p.data.howtoOpen).toBe(true)
    p.onCloseHowto()
    expect(p.data.howtoOpen).toBe(false)
  })
})
