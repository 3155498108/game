/**
 * 全站冒烟测试：44 款一起过一遍**渲染层与接线**。
 *
 * 为什么单测不够：每个游戏的 `rules.test.ts` 只驱动 `rules.ts` 的纯逻辑，
 * 覆盖不到 `index.ts` 这一层 —— `render()` 在真实 ctx 上会不会抛、两个状态之间
 * 的 `effects()` 会不会抛、`controls()` 与画布点击返回的 action 送进 `reduce()`
 * 会不会炸、`outcome()` 能不能算出来。这些只在「按站点壳的方式把游戏跑起来」时暴露。
 *
 * 驱动方式与站点壳一致：轮到电脑用 `aiAction`；轮到玩家先试 `controls()` 里的按钮，
 * **再试画布点击**（棋盘/卡牌类游戏的玩家走子全靠 `input()`，没有按钮）；
 * 实在没动作的实时游戏用 `tick(16)` 推进时间。
 *
 * 所有「试探」都靠**比对 reduce 结果是不是新引用**来判断 —— reduce 是纯函数且不改入参
 * （本项目的硬性契约），所以试着算一次没有任何副作用，这比猜哪个动作「应该有用」可靠得多。
 */
import { describe, expect, it } from 'vitest'
import type { Control, GameMeta, GameModule, Outcome } from './core/types'

const metaModules = import.meta.glob<GameMeta>('./games/*/meta.ts', { eager: true, import: 'meta' })
const gameModules = import.meta.glob<GameModule>('./games/*/index.ts', { import: 'default' })

function idOf(path: string): string {
  return /games\/([^/]+)\//.exec(path)?.[1] ?? path
}

const IDS = Object.keys(gameModules).map(idOf).sort((a, b) => a.localeCompare(b))
const LOADERS = new Map<string, () => Promise<GameModule>>(
  Object.entries(gameModules).map(([p, l]) => [idOf(p), l as () => Promise<GameModule>]),
)

/**
 * 画布替身。
 *
 * 刻意**不用 Proxy**：早先用 Proxy 版本时 pool-lite 一个游戏就跑了 98 秒
 * （每步都要访问几十个属性，而 Proxy 的 getter 是最贵的一环）。
 * 改成「把 2D context 用得到的成员一次性铺好」的普通对象后快两个数量级。
 * 这里只关心「调用链会不会抛」，所以数值属性一律给 0、几何方法一律 no-op。
 *
 * `createPattern` 必须返回真对象：早先返回 null 时 takoyaki 的 render 假阳性地报出
 * 一个「fillRect is not a function」——那是替身缺成员造成的假缺陷，不是游戏的 bug。
 */
function stubCtx(): CanvasRenderingContext2D {
  const noop = (): void => undefined
  const gradient = { addColorStop: noop }
  const ctx: Record<string, unknown> = {
    canvas: { width: 720, height: 1280 },
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
    isPointInPath: () => false,
    getLineDash: () => [],
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    miterLimit: 10, globalAlpha: 1, globalCompositeOperation: 'source-over',
    font: '', textAlign: 'start', textBaseline: 'alphabetic',
    shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
    filter: 'none', imageSmoothingEnabled: true, direction: 'ltr',
  }
  return ctx as unknown as CanvasRenderingContext2D
}

/**
 * 把「撤销 / 重来」类按钮排除在推进动作之外。
 *
 * 这一条是被实测逼出来的：驱动最初固定取 `controls()` 的第 2 个按钮，结果在五子棋上
 * 选中了「悔棋」，于是「落子 → 悔棋 → 落子」无限循环，1500 步打不完一局。
 * 这类按钮不是「推进游戏」的动作，拿来当驱动步会把「驱动推不动」误报成游戏有问题。
 */
const NOT_A_PROGRESS_LABEL = /悔棋|撤销|撤回|重开|重来|再来|重新|重置|重玩|undo|restart|reset/i

function enabledControls(g: GameModule, s: unknown): Control<unknown>[] {
  return (g.controls?.(s as never) ?? []).filter((c: Control<unknown>) => !c.disabled)
}

/**
 * 在画布上粗扫一遍，找第一个**真的会改变状态**的点击点（模拟玩家乱点但总能点中）。
 *
 * `salt` 让扫描起点随步数旋转，这也是实测逼出来的：每步都从左上角起扫的话，
 * 记忆卡牌上 12 步全是 `flip index:0` —— 同一个驱动反复翻同一张牌，永远配不成对。
 * 真人不会只盯着一个位置点，驱动也不该。
 */
function probeClick(g: GameModule, s: unknown, salt: number, accept: (a: unknown) => boolean): unknown {
  if (typeof g.input !== 'function') return null
  const { width: w, height: h } = g.viewport
  const cols = 14
  const rows = 20
  const spanC = cols - 1
  const spanR = rows - 1
  const c0 = salt % spanC
  const r0 = salt % spanR
  for (let dr = 0; dr < spanR; dr++) {
    for (let dc = 0; dc < spanC; dc++) {
      const x = (w * (1 + ((c0 + dc) % spanC))) / cols
      const y = (h * (1 + ((r0 + dr) % spanR))) / rows
      for (const kind of ['down', 'up'] as const) {
        const a = g.input(s as never, { kind, x, y, pressed: kind === 'down' })
        if (a && accept(a)) return a
      }
    }
  }
  return null
}

interface DriveResult {
  state: unknown
  steps: number
  ended: boolean
  /** 每一步的 effects 都算得出来 */
  effectsOk: boolean
  /** 每一步的 render 都画得出来 */
  renderOk: boolean
  /** 出错时的原始报错，直接带进断言消息，省得再写探针复现 */
  renderError: string
  effectsError: string
  /** 至少有一个动作真的改变了状态 */
  moved: boolean
  /** 驱动过程中拿到的控件标签，用于接线检查 */
  controlLabels: string[]
  /** 最后一步的 (prevState, action)，用于复核 reduce 的稳定性 */
  lastAction: unknown
  prevState: unknown
}

function drive(g: GameModule, seed: number, maxSteps: number): DriveResult {
  const ctx = stubCtx()
  /** reduce 是纯函数，所以「试算一次看会不会变引用」没有任何副作用 */
  const changes = (s: unknown, a: unknown): boolean => g.reduce(s as never, a as never) !== s

  let s: unknown = g.create(seed)
  let renderOk = true
  let effectsOk = true
  let renderError = ''
  let effectsError = ''
  try {
    g.render(ctx, s as never)
    g.hint?.(s as never)
    enabledControls(g, s)
  } catch (e) {
    renderOk = false
    renderError = String(e)
  }

  let steps = 0
  let lastAction: unknown = null
  let prevState: unknown = s
  let moved = false
  const controlLabels = new Set<string>()
  let ended = g.outcome?.(s as never) != null

  while (!ended && steps < maxSteps) {
    let a: unknown = null

    if (typeof g.aiAction === 'function') {
      const ai = g.aiAction(s as never)
      if (ai != null && changes(s, ai)) a = ai
    }
    if (a == null) {
      // 挨个试控件，**取第一个真的会改变状态的**。
      // 早期版本固定取第一个可用控件，结果在高尔夫上选中了「对准球洞」——
      // 球本来就对着洞，这一步是幂等空操作，驱动 1500 步也开不了球。
      for (const c of enabledControls(g, s)) {
        controlLabels.add(c.label)
        if (NOT_A_PROGRESS_LABEL.test(c.label)) continue
        if (changes(s, c.action)) {
          a = c.action
          break
        }
      }
    }
    if (a == null) a = probeClick(g, s, steps, (x) => changes(s, x))
    if (a == null && typeof g.tick === 'function') a = g.tick(16)
    if (a == null) break

    // 站点壳是**每帧都发 tick**，不管这一帧有没有别的动作。实时游戏（高尔夫、网球、
    // 钓鱼、轨道车…）的一局是 60~90 秒，光靠「一个动作推一帧」永远走不到限时终局，
    // 所以这里照站点壳的样子，每个驱动步之后连推 10 帧。
    const tick = g.tick
    const repeat = tick ? 10 : 1
    prevState = s
    s = g.reduce(s as never, a as never)
    try {
      g.effects?.(prevState as never, s as never)
    } catch (e) {
      effectsOk = false
      effectsError = String(e)
    }
    for (let i = 1; i < repeat && !ended && tick; i++) {
      const t = tick(16)
      if (t != null) s = g.reduce(s as never, t as never)
    }
    if (s !== prevState) moved = true
    lastAction = a
    steps += 1
    try {
      g.render(ctx, s as never)
    } catch (e) {
      renderOk = false
      renderError = String(e)
    }
    ended = g.outcome?.(s as never) != null
  }
  return {
    state: s,
    steps,
    ended,
    effectsOk,
    renderOk,
    renderError,
    effectsError,
    moved,
    controlLabels: [...controlLabels],
    lastAction,
    prevState,
  }
}

/**
 * 步数预算。
 *
 * 上限存在的意义是把「推不动」暴露出来（4.10 的 tank-duel 互射死循环、驱动误选「悔棋」
 * 的无限撤销，都会在这个上限处被截住）。上限太大则纯属浪费：pool-lite 推不满预算，
 * 每一步都要扫 14×20 个点击点，1500 步就是 74 万次 `input()` 调用，单这一个游戏 103 秒。
 * 900 步足够暴露不收敛，同时把整轮冒烟压到 1 分钟出头。
 */
const BUDGET = 900

/**
 * 规格里的游戏总数。
 *
 * 写成一个具名常量而不是散落的字面量：加游戏时要改的地方只有这一处，漏改了这里就会红，
 * 而不是各处文案悄悄变成「43 款但其实 44 款」。
 */
const GAME_COUNT = 44

/** drive() 的结果按 id 缓存，供后续用例复用（vitest 同一文件内顺序执行） */
const DRIVES = new Map<string, DriveResult>()

describe('全站冒烟：44 款都要能跑起来', () => {
  it('游戏数量与规格一致（44 款）', () => {
    expect(IDS.length).toBe(GAME_COUNT)
  })

  it('元信息齐全：id 与目录名一致、视口固定 720×1280、分类与文案非空', () => {
    const metas = new Map(Object.entries(metaModules).map(([p, m]) => [idOf(p), m]))
    expect(metas.size).toBe(GAME_COUNT)
    for (const id of IDS) {
      const m = metas.get(id)
      expect(m, `${id} 缺少 meta.ts`).toBeDefined()
      if (!m) continue
      expect(m.id).toBe(id)
      expect(m.viewport).toEqual({ width: 720, height: 1280 })
      expect(['portrait', 'landscape', 'both']).toContain(m.orientation)
      expect(['card', 'board', 'puzzle', 'arcade', 'mini']).toContain(m.category)
      expect(m.name.length).toBeGreaterThan(0)
      expect(m.summary.length).toBeGreaterThan(0)
      expect(Array.isArray(m.tags)).toBe(true)
      expect([1, 2, 'ai']).toContain(m.players)
    }
  })

  it('玩法介绍齐全：44 款都写了 howto，每条都是一句能单独看懂的中文', () => {
    const metas = Object.values(metaModules)
    const missing = metas.filter((m) => !m.howto || m.howto.length === 0).map((m) => m.id)
    expect(missing, `这几款没写玩法介绍：${missing.join(' / ')}`).toEqual([])

    for (const m of metas) {
      const steps = m.howto!
      // 3~6 条：太短不算介绍，太长没人看得下去
      expect(steps.length, `${m.id} 的玩法介绍有 ${steps.length} 条`).toBeGreaterThanOrEqual(3)
      expect(steps.length, `${m.id} 的玩法介绍有 ${steps.length} 条`).toBeLessThanOrEqual(6)
      for (const [i, s] of steps.entries()) {
        expect(typeof s, `${m.id} 第 ${i + 1} 条不是字符串`).toBe('string')
        const t = s.trim()
        expect(t.length, `${m.id} 第 ${i + 1} 条是空的`).toBeGreaterThan(6)
        expect(t.length, `${m.id} 第 ${i + 1} 条太长（${t.length} 字）`).toBeLessThanOrEqual(40)
        expect(t.endsWith('。'), `${m.id} 第 ${i + 1} 条应以句号结尾`).toBe(true)
        // 写法是给玩家看的操作说明，不是给维护者看的实现说明
        expect(/[{}<>;]|[_$]\w|=\s*\d/.test(t), `${m.id} 第 ${i + 1} 条混进了实现细节：${t}`).toBe(false)
      }
      // 玩法介绍不能只是把 summary 重抄一遍
      expect(steps.join(''), `${m.id} 的玩法介绍和 summary 完全重复`).not.toBe(m.summary)
    }
  })

  it.each(IDS.map((id) => [id] as const))('回合制游戏：AI 不会替玩家连走（壳层契约）', async (id) => {
    // 契约（core/types.ts 的 aiAction 注释）：**轮到 AI 时才返回动作，否则返回 null**。
    // 违反它的后果是灾难性的：壳层每落一个子就挂一次 AI 定时器，AI 若在玩家回合也出手，
    // 就会两边都替玩家下，玩家从头到尾插不上手（狐犬棋曾因此完全无法操控）。
    //
    // 判据：走完 AI 的第一手之后，**紧接着的第二手必须是 null** ——
    // 只要不是 null，就说明 AI 连着替同一局走了两步，中间没有留出玩家的回合。
    //
    // 实时游戏（导出 tick，没有「回合」这回事）不适用：它们的 AI 本来就每帧出手。
    const g = await LOADERS.get(id)!()
    if (!g.aiAction || g.tick) return

    const s0 = g.create(20260917)
    const a1 = g.aiAction(s0)
    if (a1 === null || a1 === undefined) return // 开局就轮到玩家，天然合规

    const s1 = g.reduce(s0, a1)
    expect(s1).not.toBe(s0)
    const a2 = g.aiAction(s1)
    expect(
      a2,
      `${id}：AI 在开局连走两步（第一步 ${JSON.stringify(a1)}，第二步 ${JSON.stringify(a2)}），玩家没有回合`,
    ).toBeNull()
  })

  it.each(IDS.map((id) => [id] as const))('%s 接线完好：全程不抛错、状态真的在推进', async (id) => {
    const g = await LOADERS.get(id)!()

    // 1) create 必须是纯的：同种子同状态、不同种子也能正常起局
    expect(g.create(4242)).toEqual(g.create(4242))
    expect(g.create(777)).toBeDefined()
    expect(g.viewport).toEqual({ width: 720, height: 1280 })

    const r = drive(g, 4242, BUDGET)
    DRIVES.set(id, r)

    // 2) 渲染与副作用：整局每一步都要画得出来、算得出 effects
    expect(r.renderOk, `${id} 的 render 抛了异常：${r.renderError}`).toBe(true)
    expect(r.effectsOk, `${id} 的 effects 抛了异常：${r.effectsError}`).toBe(true)

    // 3) 控件确实接到了 reduce 上：状态必须真的发生变化，
    //    否则就是「按钮点了没反应 / 动作形状对不上」这类接线错误，单测永远发现不了。
    expect(r.steps, `${id} 一步都推不动`).toBeGreaterThan(0)
    expect(r.moved, `${id} 推了 ${r.steps} 步但状态从未变化（控件没接上 reduce）`).toBe(true)

    // 4) reduce 稳定性：同一 (prev, action) 跑两次结果一致（用真实动作，不用假动作）
    if (r.lastAction !== null) {
      const a = g.reduce(r.prevState as never, r.lastAction as never)
      const b = g.reduce(r.prevState as never, r.lastAction as never)
      expect(a).toEqual(b)
    }

    // 5) 推完了就必须给出合法成绩；推不完不判定（见文件末尾的汇总说明）
    if (r.ended) {
      const out = g.outcome!(r.state as never) as Outcome | null
      expect(out, `${id} 已结束但 outcome() 返回 null`).not.toBeNull()
      expect(Number.isFinite(out!.score), `${id} 的 score 不是有限数`).toBe(true)
      expect(['higher', 'lower']).toContain(out!.better)
      expect(out!.unit.length, `${id} 缺少成绩单位`).toBeGreaterThan(0)
      // 终局后 render 仍要画得出来（很多游戏在这里画终局 banner）
      expect(() => g.render(stubCtx(), r.state as never)).not.toThrow()
    }
  }, 120_000)

  /**
   * 控件连线专项：把每个「可用」按钮的 action 真正送进 reduce。
   *
   * 驱动只会挑「有效」的那一个按钮去按，所以按钮接错线这种缺陷会被它绕过去：
   * 界面上的按钮点了没反应，单测（只测 rules）又看不见。必须逐个点名试一遍。
   * 「幂等空操作」（高尔夫的「对准球洞」在已对准时）不算缺陷，只要求不抛、且画得出来。
   */
  it.each(IDS.map((id) => [id] as const))('%s 每个可用控件都送得进 reduce', async (id) => {
    const g = await LOADERS.get(id)!()
    const r = DRIVES.get(id)
    const ctx = stubCtx()
    const states: unknown[] = [g.create(4242)]
    if (r) states.push(r.prevState, r.state)

    let seen = 0
    for (const s of states) {
      for (const c of enabledControls(g, s)) {
        seen += 1
        expect(typeof c.label, `${id} 有控件没给标签`).toBe('string')
        const next = g.reduce(s as never, c.action as never)
        expect(next, `${id} 控件「${c.label}」送进 reduce 后状态没了`).toBeDefined()
        expect(() => g.render(ctx, next as never), `${id} 控件「${c.label}」改出的状态画不出来`).not.toThrow()
      }
    }
    // 没有控件的游戏是合法的（棋盘/卡牌类走画布点击），但要有别的入口
    expect(seen + Number(typeof g.input === 'function') + Number(typeof g.tick === 'function')).toBeGreaterThan(0)
  }, 60_000)

  it('汇总：通用驱动至少能推完一半以上的游戏', () => {
    // 通用驱动只会「按第一个有效的按钮 / 乱点画布」，不是会下棋的玩家。
    // 「会不会卡死」由每个游戏自己的单测证明（AI 对战必然终局）；
    // 这里只要求它至少能在多数游戏上真的走到终局，否则说明驱动本身退化了。
    const finished = IDS.filter((id) => DRIVES.get(id)?.ended)
    console.log(`[冒烟] 通用驱动推完 ${finished.length}/${GAME_COUNT}：${finished.join(', ')}`)
    expect(finished.length).toBeGreaterThanOrEqual(Math.ceil(GAME_COUNT / 2))
  })
})
