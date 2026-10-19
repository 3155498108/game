import type { GameMeta, GameModule } from '../../core/types'
import { todaySeed } from '../../shell/daily'
import { findMeta, loadGame } from '../../shell/registry'
import { Runtime, newSeed, type CanvasNode } from '../../shell/runtime'

type AnyModule = GameModule<any, any>

/**
 * 模块级持有者：`onReady` 之前拿不到 canvas 节点，Runtime 必须等节点到手再建。
 * 用模块级变量而不是 `this`，是因为 Page 实例的 `this` 在小程序里类型是隐式的，
 * 存成字段反而要处理「字段什么时候才有」的问题。
 */
let rt: Runtime | null = null
let mod: AnyModule | null = null
let meta: GameMeta | null = null
let seed = 0
let daily = false
/** canvas 左上角在页面中的位置，用于把 clientX/clientY 换算成画布局部坐标 */
let rectLeft = 0
let rectTop = 0

/**
 * 触摸点取值。优先用画布自带的 `x/y`（相对 canvas），
 * 拿不到再退回 `clientX/clientY` 减去画布在页面中的位置。
 *
 * 之所以要做这个兜底：`touches[0].x` 是 canvas 节点的便利字段，
 * 不同基础库版本表现不完全一致，而 `clientX/clientY` 一直是可靠的。
 */
function touchPoint(e: MiniTouchEvent): { x: number; y: number } | null {
  const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0])
  if (!t) return null
  if (typeof t.x === 'number' && typeof t.y === 'number') return { x: t.x, y: t.y }
  if (typeof t.clientX === 'number' && typeof t.clientY === 'number') {
    return { x: t.clientX - rectLeft, y: t.clientY - rectTop }
  }
  return null
}

Page({
  data: {
    title: '',
    hint: '',
    best: '',
    wallet: '0',
    bet: '0',
    betHint: '',
    delta: '',
    deltaClass: '',
    muted: false,
    ctrls: [] as Array<{ label: string; disabled: boolean; primary: boolean; shell: boolean }>,
    toast: '',
    toastHidden: true,
    missing: false,
    howtoOpen: false,
    howto: [] as string[],
  },

  onLoad(query: Record<string, string | undefined>): void {
    const id = String(query.id || '')
    daily = query.daily === '1'
    meta = findMeta(id) ?? null
    if (!meta) {
      this.setData({ missing: true, title: '小游戏合集' })
      return
    }
    mod = loadGame(id)
    // 每日挑战用当天日期做种子，全天固定同一局；普通局每次进页面换一张
    seed = daily ? todaySeed() : newSeed()
    this.setData({ title: meta.name, howto: meta.howto ?? [] })
    wx.setNavigationBarTitle({ title: meta.name })
  },

  onReady(): void {
    if (!mod || !meta) return
    wx.createSelectorQuery()
      .select('#cv')
      .fields({ node: true, size: true, rect: true })
      .exec((res: unknown[]) => {
        const r = (res && res[0]) as
          | { node?: CanvasNode; width?: number; height?: number; left?: number; top?: number }
          | undefined
        if (!r || !r.node || !r.width || !r.height) {
          console.error('[play] canvas 节点没拿到，检查 type="2d" 与基础库版本')
          return
        }
        rectLeft = r.left ?? 0
        rectTop = r.top ?? 0
        rt = new Runtime(mod as AnyModule, meta as GameMeta, seed, daily, r.node, this)
        rt.mount(r.width, r.height)
      })
  },

  // 切后台停帧，省电；小程序切回前台再跑起来
  onHide(): void {
    rt?.stop()
  },

  onShow(): void {
    rt?.start()
  },

  onUnload(): void {
    rt?.destroy()
    rt = null
  },

  // ---------------- 触摸 ----------------

  onTouchStart(e: MiniTouchEvent): void {
    const p = touchPoint(e)
    if (p) rt?.onTouch('down', p.x, p.y)
  },

  onTouchMove(e: MiniTouchEvent): void {
    const p = touchPoint(e)
    if (p) rt?.onTouch('move', p.x, p.y)
  },

  onTouchEnd(e: MiniTouchEvent): void {
    const p = touchPoint(e)
    if (p) rt?.onTouch('up', p.x, p.y)
  },

  onTouchCancel(): void {
    rt?.onCancel()
  },

  // ---------------- 控件 ----------------

  onCtrl(e: MiniEvent): void {
    rt?.onCtrl(Number(e.currentTarget.dataset.i))
  },

  onBet(): void {
    rt?.onCycleBet()
  },

  onSound(): void {
    rt?.onToggleSound()
  },

  onHowto(): void {
    this.setData({ howtoOpen: true })
  },

  onCloseHowto(): void {
    this.setData({ howtoOpen: false })
  },

  onNoop(): void {
    /* 吃掉弹层内的冒泡，否则点正文会连带关闭弹层 */
  },

  onToastOk(): void {
    this.setData({ toastHidden: true })
  },
})
