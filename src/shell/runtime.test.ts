/**
 * 网页版壳层运行时的测试。
 *
 * ## 为什么需要它
 *
 * 移植到小程序之后，玩法侧逻辑在 `miniprogram/tests/runtime.test.ts` 里
 * 已经有 69 例覆盖；**网页版这份 `shell/runtime.ts` 却一行测试都没有**。
 * 后果很具体：网页版「点得动」「键盘能操作」「输了会扣币」这些事，
 * 到今天为止都只有「代码看起来对」，没有「跑一下证明对」。
 *
 * ## 怎么测：不引入 jsdom
 *
 * 项目不新增依赖（README 里的硬约束），所以这里**手写一套最小 DOM 替身**：
 * 元素、画布、2D 上下文、window/document、requestAnimationFrame、定时器。
 * 只实现运行时真正用到的那几个 API——多写一个，就多一个
 * 「替身和真实浏览器不一致」的风险。
 *
 * 替身只负责**接住**调用；断言的是**运行时传下去的东西**：
 * 坐标怎么换算、动作怎么派发、钱怎么结算、方向对不对时要不要拦。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Control, Effect, GameMeta, GameModule, Outcome, Orientation, PointerInput } from '../core/types'
import type { PlayElements } from './runtime'
import { clearFx, fxActive } from '../render/fx'
import { resetAnims } from '../render/anim'

// ==================================================================
// 假 DOM
// ==================================================================

type Listener = (e: any) => void

class FakeEl {
  tagName = 'DIV'
  textContent = ''
  innerHTML = ''
  hidden = false
  title = ''
  disabled = false
  dataset: Record<string, string> = {}
  attrs: Record<string, string> = {}
  style: Record<string, unknown> & { setProperty: (k: string, v: string) => void } = {
    setProperty: (_k: string, _v: string): void => {},
  }
  rect = { left: 0, top: 0, width: 0, height: 0 }
  parentElement: FakeEl | null = null
  querySelectorResult: FakeEl | null = null
  /** 运行时只用到 `classList.toggle`（盈亏的涨跌配色） */
  classList = {
    toggle: (_cls: string, _on?: boolean): void => {},
    add: (_cls: string): void => {},
    remove: (_cls: string): void => {},
  }
  private listeners = new Map<string, Listener[]>()

  addEventListener(type: string, fn: Listener): void {
    const arr = this.listeners.get(type) ?? []
    arr.push(fn)
    this.listeners.set(type, arr)
  }

  removeEventListener(type: string, fn: Listener): void {
    const arr = this.listeners.get(type)
    if (!arr) return
    const i = arr.indexOf(fn)
    if (i >= 0) arr.splice(i, 1)
  }

  /** 触发一个事件；`target` 默认是自己 */
  fire(type: string, e: Record<string, unknown> = {}): void {
    const ev = e as Record<string, any>
    if (typeof ev.preventDefault !== 'function') ev.preventDefault = (): void => {}
    if (ev.target === undefined) ev.target = this
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(ev)
  }

  listenerCount(type: string): number {
    return (this.listeners.get(type) ?? []).length
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return this.rect
  }

  setAttribute(k: string, v: string): void {
    this.attrs[k] = v
  }

  /** 只认 `button[data-i]`——正好够运行时那一句 `closest('button[data-i]')` 用 */
  closest(sel: string): FakeEl | null {
    return sel === 'button[data-i]' && this.tagName === 'BUTTON' ? this : null
  }

  querySelector(_sel: string): FakeEl | null {
    return this.querySelectorResult
  }
}

class FakeCanvas extends FakeEl {
  tagName = 'CANVAS'
  width = 0
  height = 0
  ctx = new FakeCtx()

  getContext(_type: string): FakeCtx {
    return this.ctx
  }

  setPointerCapture(_id: number): void {
    /* 替身不做指针捕获 */
  }
}

/** 只实现运行时与特效层真正碰到的那些 2D 上下文方法 */
class FakeCtx {
  fillStyle = ''
  globalAlpha = 1
  transforms: number[][] = []
  ops: string[] = []

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.transforms.push([a, b, c, d, e, f])
    this.ops.push('setTransform')
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.ops.push(`fillRect(${x},${y},${w},${h})`)
  }
  save(): void {
    this.ops.push('save')
  }
  restore(): void {
    this.ops.push('restore')
  }
  beginPath(): void {
    this.ops.push('beginPath')
  }
  rect(..._a: number[]): void {
    this.ops.push('rect')
  }
  clip(): void {
    this.ops.push('clip')
  }
  arc(..._a: number[]): void {
    this.ops.push('arc')
  }
  fill(): void {
    this.ops.push('fill')
  }
  fillText(..._a: unknown[]): void {
    /* 替身不排版 */
  }
  measureText(): { width: number } {
    return { width: 0 }
  }
  createLinearGradient(): { addColorStop: (o: number, c: string) => void } {
    return { addColorStop: (): void => {} }
  }
}

/** 手动推进的 rAF：一次 tick 走一帧 */
class FakeRaf {
  private cbs = new Map<number, (t: number) => void>()
  private next = 1

  request = (cb: (t: number) => void): number => {
    const id = this.next++
    this.cbs.set(id, cb)
    return id
  }

  cancel = (id: number): void => {
    this.cbs.delete(id)
  }

  /** 执行当前挂起的帧回调（回调里通常会再挂一个，于是形成连续帧） */
  tick(t: number): void {
    const list = [...this.cbs.values()]
    this.cbs.clear()
    for (const cb of list) cb(t)
  }

  get pending(): number {
    return this.cbs.size
  }
}

/** 假装有 ResizeObserver：能验证「挂上了、也能被叫醒」 */
class FakeRO {
  static instances: FakeRO[] = []
  private cb: () => void

  constructor(cb: () => void) {
    this.cb = cb
    FakeRO.instances.push(this)
  }
  observe(_t: unknown): void {
    /* 替身不真的观察 */
  }
  disconnect(): void {
    /* 替身不真的断开 */
  }
  trigger(): void {
    this.cb()
  }
}

// ==================================================================
// 假游戏
// ==================================================================

const META: GameMeta = {
  id: 'test-game',
  name: '测试游戏',
  category: 'mini',
  tags: [],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '给壳层测试用的假游戏',
}

interface Spec {
  aiAction?: (s: any) => any
  aiDelay?: number
  tick?: (dt: number) => any
  outcome?: (s: any) => Outcome | null
  effects?: (p: any, n: any) => Effect[]
  coins?: (s: any, o: Outcome, bet: number) => number
  controls?: (s: any) => Control<any>[]
  hint?: (s: any) => string
  input?: (s: any, p: PointerInput) => any
  key?: (s: any, k: string) => any
  reduce?: (s: any, a: any) => any
  create?: (seed: number) => any
  render?: (ctx: any, s: any) => void
}

interface Recorder {
  inputs: PointerInput[]
  keys: string[]
  ticks: number[]
  aiStates: any[]
  /** 每次 reduce 收到的动作——用来分辨「AI 走的是哪一步」 */
  actions: any[]
  renders: number
  creates: number
}

function makeGame(spec: Spec = {}): { mod: GameModule<any, any>; rec: Recorder } {
  const rec: Recorder = { inputs: [], keys: [], ticks: [], aiStates: [], actions: [], renders: 0, creates: 0 }
  const mod: GameModule<any, any> = {
    ...META,
    create: (seed: number) => {
      rec.creates++
      return spec.create ? spec.create(seed) : { seed, n: 0, last: null }
    },
    reduce: (s: any, a: any) => {
      rec.actions.push(a)
      return spec.reduce ? spec.reduce(s, a) : { ...s, n: s.n + 1, last: a }
    },
    render: (ctx: any, s: any) => {
      rec.renders++
      spec.render?.(ctx, s)
    },
    // 提示区文字是观察内部状态的窗口：state 是私有的，提示却是公开的
    hint: (s: any) => (spec.hint ? spec.hint(s) : `n=${s.n}`),
  }
  if (spec.input) mod.input = (s, p) => { rec.inputs.push(p); return spec.input!(s, p) }
  else mod.input = (_s, p) => { rec.inputs.push(p); return 'tap' }
  if (spec.key) mod.key = (s, k) => { rec.keys.push(k); return spec.key!(s, k) }
  if (spec.aiAction) {
    mod.aiAction = (s) => { rec.aiStates.push(s); return spec.aiAction!(s) }
    mod.aiDelay = spec.aiDelay ?? 500
  }
  if (spec.tick) mod.tick = (dt) => { rec.ticks.push(dt); return spec.tick!(dt) }
  if (spec.outcome) mod.outcome = spec.outcome
  if (spec.effects) mod.effects = spec.effects
  if (spec.coins) mod.coins = spec.coins
  if (spec.controls) mod.controls = spec.controls
  return { mod, rec }
}

// ==================================================================
// 假环境
// ==================================================================

interface Harness {
  win: any
  doc: any
  raf: FakeRaf
  ls: Map<string, string>
  els: PlayElements
  raw: {
    stage: FakeEl
    canvas: FakeCanvas
    hint: FakeEl
    best: FakeEl
    ctrls: FakeEl
    rotate: FakeEl
    toast: FakeEl
    sound: FakeEl
    wallet: FakeEl
    delta: FakeEl
    betBox: FakeEl
    dismiss: FakeEl
  }
}

interface EnvOpts {
  winW?: number
  winH?: number
  coarse?: boolean
  dpr?: number
  stageW?: number
  stageH?: number
}

function setupEnv(opts: EnvOpts = {}): Harness {
  const ls = new Map<string, string>()
  const localStorage = {
    getItem: (k: string): string | null => (ls.has(k) ? ls.get(k)! : null),
    setItem: (k: string, v: string): void => { ls.set(k, v) },
    removeItem: (k: string): void => { ls.delete(k) },
  }

  const win: any = new FakeEl()
  win.tagName = 'WINDOW'
  win.innerWidth = opts.winW ?? 420
  win.innerHeight = opts.winH ?? 900
  win.devicePixelRatio = opts.dpr ?? 1
  win.localStorage = localStorage
  // 动态转发到 globalThis：fake timers 换掉 globalThis.setTimeout 之后，
  // 这里跟着一起换，不用重装环境。
  win.setTimeout = (fn: () => void, ms?: number): number =>
    globalThis.setTimeout(fn as unknown as TimerHandler, ms) as unknown as number
  win.clearTimeout = (id: number): void => { globalThis.clearTimeout(id) }

  const doc: any = new FakeEl()
  doc.tagName = 'DOCUMENT'
  doc.hidden = false

  const raf = new FakeRaf()
  FakeRO.instances = []

  const g = globalThis as unknown as Record<string, unknown>
  g.window = win
  g.document = doc
  g.requestAnimationFrame = raf.request
  g.cancelAnimationFrame = raf.cancel
  g.matchMedia = (q: string) => ({ matches: !!opts.coarse, media: q })
  g.ResizeObserver = FakeRO

  const play = new FakeEl()
  const stage = new FakeEl()
  stage.parentElement = play
  const canvas = new FakeCanvas()
  const hint = new FakeEl()
  const best = new FakeEl()
  const ctrls = new FakeEl()
  const rotate = new FakeEl()
  // 真实标记里这个层是 `<div class="rotate-tip" hidden>`——**天生就藏着**。
  // 运行时只在「显示状态发生变化」时才写 `hidden`，
  // 所以替身必须一开始就还原成藏着，否则第一次判定「不弹」就会读出 false。
  rotate.hidden = true
  const dismiss = new FakeEl()
  dismiss.tagName = 'BUTTON'
  rotate.querySelectorResult = dismiss
  const toast = new FakeEl()
  const sound = new FakeEl()
  const wallet = new FakeEl()
  const delta = new FakeEl()
  const betBox = new FakeEl()

  const w = opts.stageW ?? 720
  const h = opts.stageH ?? 1280
  stage.rect = { left: 0, top: 0, width: w, height: h }
  canvas.rect = { left: 0, top: 0, width: w, height: h }

  const els: PlayElements = {
    stage: stage as unknown as HTMLElement,
    canvas: canvas as unknown as HTMLCanvasElement,
    hint: hint as unknown as HTMLElement,
    best: best as unknown as HTMLElement,
    ctrls: ctrls as unknown as HTMLElement,
    rotate: rotate as unknown as HTMLElement,
    toast: toast as unknown as HTMLElement,
    sound: sound as unknown as HTMLButtonElement,
    wallet: wallet as unknown as HTMLElement,
    delta: delta as unknown as HTMLElement,
    betBox: betBox as unknown as HTMLElement,
  }

  return {
    win, doc, raf, ls, els,
    raw: { stage, canvas, hint, best, ctrls, rotate, toast, sound, wallet, delta, betBox, dismiss },
  }
}

// ------------------------------------------------------------------
// 壳层模块必须在全局环境摆好之后才 import：
// `shell/storage.ts` 在模块顶层就要用 `window.localStorage`。
// ------------------------------------------------------------------
const bootstrap = globalThis as unknown as Record<string, unknown>
bootstrap.window = { localStorage: { getItem: (): null => null, setItem: (): void => {} } }
bootstrap.document = { hidden: false, addEventListener: (): void => {}, removeEventListener: (): void => {} }

const { Runtime, newSeed } = await import('./runtime')
const { installLocalBackend } = await import('./storage')

// ==================================================================
// 工具
// ==================================================================

function pointerEv(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    button: 0,
    buttons: 1,
    preventDefault: (): void => {},
    ...over,
  }
}

/** 从控件区的 innerHTML 里解析出按钮（运行时就是用 innerHTML 渲染的） */
function ctrlButtons(ctrls: FakeEl): Array<{ i: number; label: string; disabled: boolean }> {
  const out: Array<{ i: number; label: string; disabled: boolean }> = []
  const re = /<button[^>]*data-i="(\d+)"([^>]*)>([^<]*)<\/button>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(ctrls.innerHTML)) !== null) {
    out.push({ i: Number(m[1]), label: m[3], disabled: /\bdisabled\b/.test(m[2]) })
  }
  return out
}

function clickCtrl(ctrls: FakeEl, i: number): void {
  const btn = new FakeEl()
  btn.tagName = 'BUTTON'
  btn.dataset.i = String(i)
  ctrls.fire('click', { target: btn })
}

let h: Harness

function mount(
  g: { mod: GameModule<any, any> },
  opts: { daily?: boolean; orientation?: Orientation } = {},
): InstanceType<typeof Runtime> {
  const meta: GameMeta = opts.orientation ? { ...META, orientation: opts.orientation } : META
  return new Runtime(g.mod, meta, 12345, opts.daily ?? false, h.els)
}

beforeEach(() => {
  // rAF 不进 fake timers：它由 FakeRaf 手动推进，测试要能精确控制「走一帧」
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  h = setupEnv()
  installLocalBackend()
  clearFx()
  resetAnims()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ==================================================================
// 用例
// ==================================================================

describe('缩放与坐标反算', () => {
  it('点画布正中 → 逻辑坐标正好是视口正中', () => {
    const g = makeGame()
    mount(g)
    h.raw.canvas.fire('pointerdown', pointerEv({ clientX: 360, clientY: 640 }))
    const p = g.rec.inputs[0]
    expect(p.x).toBeCloseTo(360)
    expect(p.y).toBeCloseTo(640)
  })

  it('画布比视口宽：横向留边要从点击位置里减掉', () => {
    h = setupEnv({ stageW: 1200, stageH: 1280 })
    installLocalBackend()
    const g = makeGame()
    mount(g)
    // scale = min(1200/720, 1280/1280) = 1，左右各留 240
    h.raw.canvas.fire('pointerdown', pointerEv({ clientX: 600, clientY: 640 }))
    expect(g.rec.inputs[0].x).toBeCloseTo(360)
    expect(g.rec.inputs[0].y).toBeCloseTo(640)
  })

  it('画布比视口高：纵向留边要从点击位置里减掉', () => {
    h = setupEnv({ stageW: 720, stageH: 1600 })
    installLocalBackend()
    const g = makeGame()
    mount(g)
    // scale = min(1, 1600/1280) = 1，上下各留 160
    h.raw.canvas.fire('pointerdown', pointerEv({ clientX: 360, clientY: 800 }))
    expect(g.rec.inputs[0].x).toBeCloseTo(360)
    expect(g.rec.inputs[0].y).toBeCloseTo(640)
  })

  it('画布按 dpr 放大，但封顶 2（不让 3x/4x 手机烧内存）', () => {
    h = setupEnv({ dpr: 3, stageW: 390, stageH: 844 })
    installLocalBackend()
    const g = makeGame()
    mount(g)
    expect(h.raw.canvas.width).toBe(390 * 2)
    expect(h.raw.canvas.height).toBe(844 * 2)
  })
})

describe('指针事件', () => {
  it('按下之后的移动带 pressed=true，抬起之后为 false', () => {
    const g = makeGame()
    mount(g)
    h.raw.canvas.fire('pointerdown', pointerEv({ clientX: 10, clientY: 20 }))
    h.raw.canvas.fire('pointermove', pointerEv({ clientX: 30, clientY: 40 }))
    expect(g.rec.inputs[1].pressed).toBe(true)
    h.raw.canvas.fire('pointerup', pointerEv({ clientX: 30, clientY: 40 }))
    h.raw.canvas.fire('pointermove', pointerEv({ clientX: 50, clientY: 60 }))
    expect(g.rec.inputs[3].pressed).toBe(false)
  })

  it('第二根手指的按下被忽略：一根手指在拖的时候不能有第二只手插进来', () => {
    const g = makeGame()
    mount(g)
    h.raw.canvas.fire('pointerdown', pointerEv({ pointerId: 1 }))
    h.raw.canvas.fire('pointerdown', pointerEv({ pointerId: 2 }))
    expect(g.rec.inputs.length).toBe(1)
  })

  it('pointercancel 当作抬起处理：手指被系统打断时不能一直按着', () => {
    const g = makeGame()
    mount(g)
    h.raw.canvas.fire('pointerdown', pointerEv())
    h.raw.canvas.fire('pointercancel', pointerEv())
    expect(g.rec.inputs[1].kind).toBe('up')
  })

  it('旋转提示层挡着的时候不吃指针输入', () => {
    // 竖屏游戏 + 横屏窗口 → 弹出旋转提示
    h = setupEnv({ winW: 800, winH: 400, coarse: true })
    installLocalBackend()
    const g = makeGame()
    mount(g)
    expect(h.raw.rotate.hidden).toBe(false)
    // 提示层是全屏遮罩，正常情况下事件到不了画布；
    // 但指针捕获会让已按下的手指继续把事件发给画布——那一下就是误触。
    h.raw.canvas.fire('pointerdown', pointerEv({ clientX: 100, clientY: 100 }))
    expect(g.rec.inputs.length).toBe(0)
  })
})

describe('键盘', () => {
  it('按键派发成动作', () => {
    const g = makeGame({ key: () => 'key-act' })
    mount(g)
    h.win.fire('keydown', { key: 'ArrowLeft' })
    expect(g.rec.keys).toEqual(['ArrowLeft'])
    expect(h.raw.hint.textContent).toBe('n=1')
  })

  it('输入框里的按键不触发游戏动作', () => {
    const g = makeGame({ key: () => 'key-act' })
    mount(g)
    h.win.fire('keydown', { key: 'a', target: { tagName: 'INPUT' } })
    expect(g.rec.keys).toEqual([])
  })

  it('旋转提示层挡着的时候键盘也不响应', () => {
    h = setupEnv({ winW: 800, winH: 400, coarse: true })
    installLocalBackend()
    const g = makeGame({ key: () => 'key-act' })
    mount(g)
    h.win.fire('keydown', { key: 'ArrowLeft' })
    expect(g.rec.keys).toEqual([])
  })
})

describe('控件区', () => {
  it('控件渲染成按钮，禁用的那个带 disabled', () => {
    const g = makeGame({
      controls: () => [
        { label: '走一步', action: 'step' },
        { label: '不可用', action: 'x', disabled: true },
      ],
    })
    mount(g)
    const btns = ctrlButtons(h.raw.ctrls)
    expect(btns.map((b) => b.label)).toEqual(['走一步', '不可用', '新的一局'])
    expect(btns[1].disabled).toBe(true)
    expect(btns[0].disabled).toBe(false)
  })

  it('点按钮派发对应动作', () => {
    const g = makeGame({ controls: () => [{ label: '走一步', action: 'step' }] })
    mount(g)
    clickCtrl(h.raw.ctrls, 0)
    expect(h.raw.hint.textContent).toBe('n=1')
  })

  it('「新的一局」重开一局；每日挑战时文案不一样', () => {
    const g = makeGame()
    mount(g)
    expect(ctrlButtons(h.raw.ctrls).pop()!.label).toBe('新的一局')
    clickCtrl(h.raw.ctrls, 0)
    expect(g.rec.creates).toBe(2)

    const g2 = makeGame()
    mount(g2, { daily: true })
    expect(ctrlButtons(h.raw.ctrls).pop()!.label).toBe('重新挑战')
  })
})

describe('状态推进与容错', () => {
  it('reduce 抛错时不崩，状态也不变', () => {
    const g = makeGame({
      reduce: (s) => {
        if (s.n === 0) throw new Error('炸了')
        return { ...s, n: s.n + 1 }
      },
    })
    mount(g)
    expect(() => h.raw.canvas.fire('pointerdown', pointerEv())).not.toThrow()
    expect(h.raw.hint.textContent).toBe('n=0')
    expect(console.error).toHaveBeenCalled()
  })

  it('reduce 返回同一个引用时不重绘', () => {
    const g = makeGame({ reduce: (s) => s })
    mount(g)
    h.raf.tick(16) // 先把 dirty 落下去
    const before = g.rec.renders
    h.raw.canvas.fire('pointerdown', pointerEv())
    h.raf.tick(32)
    expect(g.rec.renders).toBe(before)
  })

  it('effects 派生的副作用真的被执行了', () => {
    const g = makeGame({ effects: () => [{ kind: 'flash', color: '#fff' }] })
    mount(g)
    expect(fxActive()).toBe(false)
    h.raw.canvas.fire('pointerdown', pointerEv())
    expect(fxActive()).toBe(true)
  })
})

describe('AI 与实时帧', () => {
  it('AI 延迟到 aiDelay 之后才动手', () => {
    const g = makeGame({ aiAction: () => 'ai-move', aiDelay: 300 })
    mount(g)
    expect(g.rec.aiStates.length).toBe(1)
    expect(h.raw.hint.textContent).toBe('n=0')
    vi.advanceTimersByTime(299)
    expect(h.raw.hint.textContent).toBe('n=0')
    vi.advanceTimersByTime(2)
    expect(h.raw.hint.textContent).toBe('n=1')
  })

  it('延迟期间局面变了 → AI 按新状态重新决策', () => {
    let calls = 0
    const g = makeGame({
      aiAction: () => `ai-${++calls}`,
      aiDelay: 300,
      key: () => 'player-move',
    })
    mount(g)
    h.win.fire('keydown', { key: 'x' }) // 玩家抢先走了一步
    expect(calls).toBe(1) // 决策只在排程时做一次
    vi.advanceTimersByTime(300)
    // 局面变了，之前算好的那一步作废 → AI 重新决策并走新的一步
    expect(g.rec.actions).toEqual(['player-move', 'ai-2'])
  })

  it('局面没变 → AI 直接用已经算好的那一步，不在回调里重算', () => {
    let calls = 0
    const g = makeGame({ aiAction: () => `ai-${++calls}`, aiDelay: 300 })
    mount(g)
    vi.advanceTimersByTime(300)
    // 走的是排程时就定下来的 ai-1，不是回调里重算出来的 ai-2
    expect(g.rec.actions).toEqual(['ai-1'])
  })

  it('tick 拿到的 dt 被夹在 0..50 之间', () => {
    const g = makeGame({ tick: () => 'tick' })
    mount(g)
    h.raf.tick(16)
    h.raf.tick(1000) // 真实间隔 984ms，必须被夹住
    h.raf.tick(1020)
    h.raf.tick(900) // 时间倒流，dt 夹到 0
    expect(g.rec.ticks).toEqual([16, 50, 20, 0])
  })

  it('aiDelay=0 的实时游戏：每帧同步决策一次', () => {
    const g = makeGame({ aiAction: () => 'ai-move', aiDelay: 0 })
    mount(g)
    h.raf.tick(16)
    expect(g.rec.aiStates.length).toBe(1)
    h.raf.tick(32)
    expect(g.rec.aiStates.length).toBe(2)
  })
})

describe('结算链路', () => {
  const winOutcome = (s: any): Outcome | null =>
    s.n >= 1 ? { score: 100, better: 'higher', unit: '分', win: true } : null

  it('赢一注：余额 +注额', () => {
    const g = makeGame({ outcome: winOutcome })
    mount(g)
    h.raw.canvas.fire('pointerdown', pointerEv())
    expect(h.raw.wallet.textContent).toBe('🪙 1,010')
    expect(h.raw.delta.textContent).toBe('+10')
  })

  it('输一注：余额 -注额', () => {
    const g = makeGame({
      outcome: (s: any): Outcome | null =>
        s.n >= 1 ? { score: 0, better: 'higher', unit: '分', win: false } : null,
    })
    mount(g)
    h.raw.canvas.fire('pointerdown', pointerEv())
    expect(h.raw.wallet.textContent).toBe('🪙 990')
    expect(h.raw.delta.textContent).toBe('-10')
  })

  it('outcome.win 缺省时不结算（门票制游戏走的就是这条）', () => {
    const g = makeGame({
      outcome: (s: any): Outcome | null =>
        s.n >= 1 ? { score: 100, better: 'higher', unit: '分' } : null,
    })
    mount(g)
    h.raw.canvas.fire('pointerdown', pointerEv())
    expect(h.raw.wallet.textContent).toBe('🪙 1,000')
    expect(h.raw.delta.textContent).toBe('')
  })

  it('一局只结算一次：再点几下也不会重复入账', () => {
    const g = makeGame({ outcome: winOutcome })
    mount(g)
    h.raw.canvas.fire('pointerdown', pointerEv())
    h.raw.canvas.fire('pointerdown', pointerEv())
    h.raw.canvas.fire('pointerdown', pointerEv())
    expect(h.raw.wallet.textContent).toBe('🪙 1,010')
  })

  it('每日挑战不结算（防止刷新纪录顺手刷币）', () => {
    const g = makeGame({ outcome: winOutcome })
    mount(g, { daily: true })
    h.raw.canvas.fire('pointerdown', pointerEv())
    expect(h.raw.wallet.textContent).toBe('🪙 1,000')
  })

  it('破纪录：写进 localStorage 并更新最佳成绩', () => {
    const g = makeGame({ outcome: winOutcome })
    mount(g)
    h.raw.canvas.fire('pointerdown', pointerEv())
    const raw = h.ls.get('gs:test-game:best')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw as string)).toMatchObject({ score: 100, unit: '分', better: 'higher' })
    expect(h.raw.best.textContent).toBe('最佳 100分')
    // 「新纪录」的提示会被紧接着的金币提示顶掉——两端目前都是这个行为
    // （结算在破纪录提示之后，toast 是单条，后写的赢），见 DECISIONS 4.42
    expect(h.raw.toast.textContent).toBe('+10 金币')
  })

  it('注额可以切换，新注额参与结算', () => {
    const g = makeGame({ outcome: winOutcome })
    mount(g)
    h.raw.betBox.fire('click')
    expect(h.raw.betBox.textContent).toBe('注 50')
    expect(h.ls.get('gs:wallet:bet')).toBe('50')
    h.raw.canvas.fire('pointerdown', pointerEv())
    expect(h.raw.wallet.textContent).toBe('🪙 1,050')
  })
})

describe('横竖屏与旋转提示层', () => {
  it('竖屏游戏 + 竖屏窗口：不弹提示', () => {
    h = setupEnv({ winW: 400, winH: 800, coarse: true })
    installLocalBackend()
    mount(makeGame())
    expect(h.raw.rotate.hidden).toBe(true)
  })

  it('竖屏游戏 + 横屏窗口：弹提示并停帧', () => {
    h = setupEnv({ winW: 800, winH: 400, coarse: true })
    installLocalBackend()
    mount(makeGame())
    expect(h.raw.rotate.hidden).toBe(false)
    expect(h.raf.pending).toBe(0)
  })

  it('桌面浏览器（pointer: fine）不弹提示', () => {
    // 桌面鼠标能横着玩竖屏游戏，硬拦只会让人没法玩
    h = setupEnv({ winW: 1400, winH: 800, coarse: false })
    installLocalBackend()
    mount(makeGame())
    expect(h.raw.rotate.hidden).toBe(true)
    expect(h.raf.pending).toBe(1)
  })

  it('点「仍然继续」之后不再拦', () => {
    h = setupEnv({ winW: 800, winH: 400, coarse: true })
    installLocalBackend()
    mount(makeGame())
    h.raw.dismiss.fire('click')
    expect(h.raw.rotate.hidden).toBe(true)
    expect(h.raf.pending).toBe(1)
  })

  it('转回正确方向：提示层自动解除', () => {
    h = setupEnv({ winW: 400, winH: 800, coarse: true })
    installLocalBackend()
    mount(makeGame())
    expect(h.raw.rotate.hidden).toBe(true)
    h.win.innerWidth = 800
    h.win.innerHeight = 400
    h.win.fire('resize')
    expect(h.raw.rotate.hidden).toBe(false)
    h.win.innerWidth = 400
    h.win.innerHeight = 800
    h.win.fire('resize')
    expect(h.raw.rotate.hidden).toBe(true)
  })
})

describe('生命周期', () => {
  it('destroy 之后停帧并且解绑事件', () => {
    const g = makeGame()
    const rt = mount(g)
    expect(h.raf.pending).toBe(1)
    rt.destroy()
    expect(h.raf.pending).toBe(0)
    expect(h.raw.canvas.listenerCount('pointerdown')).toBe(0)
  })

  it('页面切走停帧，切回来恢复', () => {
    mount(makeGame())
    expect(h.raf.pending).toBe(1)
    h.doc.hidden = true
    h.doc.fire('visibilitychange')
    expect(h.raf.pending).toBe(0)
    h.doc.hidden = false
    h.doc.fire('visibilitychange')
    expect(h.raf.pending).toBe(1)
  })

  it('音效按钮切静音并落盘', () => {
    mount(makeGame())
    expect(h.raw.sound.textContent).toBe('🔊')
    h.raw.sound.fire('click')
    expect(h.raw.sound.textContent).toBe('🔇')
    expect(h.ls.get('gs:settings:muted')).toBe('true')
  })
})

describe('种子', () => {
  it('newSeed 返回 32 位无符号整数', () => {
    const s = newSeed()
    expect(Number.isInteger(s)).toBe(true)
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThan(2 ** 32)
  })

  it('没有 crypto 时退回 Date.now（老浏览器不至于开天窗）', () => {
    vi.stubGlobal('crypto', undefined)
    const now = Date.now() >>> 0
    expect(newSeed()).toBe(now)
  })
})
