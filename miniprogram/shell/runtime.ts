/**
 * 小程序版游戏运行时。与网页版 `shell/runtime.ts` **同构**，只换三样东西：
 *
 * | 网页版 | 小程序版 |
 * |---|---|
 * | `HTMLCanvasElement` + `addEventListener('pointer*')` | `canvas` 节点 + WXML 的 `bindtouch*` |
 * | `requestAnimationFrame(window)` | `canvas.requestAnimationFrame` |
 * | `el.hint.textContent = x` | `page.setData({ hint: x })` |
 *
 * 刻意保持同构，是因为**规则侧完全不用改**——`GameModule` 契约一字未动，
 * 这正是 `type="2d"` 的 Canvas 2D 上下文与 Web 标准对齐所带来的红利。
 *
 * 缩放映射也照搬网页版的 `setTransform` 方案：逻辑分辨率 720×1280 等比缩放居中，
 * 多余区域填黑边，画面永不变形；输入坐标用同一个公式反算回逻辑坐标。
 */
import type { Control, Effect, GameMeta, GameModule, Outcome, PointerInput } from '../core/types'
import { COLORS } from '../render/draw'
import { anyActive, resetAnims } from '../render/anim'
import { burst, clearFx, drawFx, flash, fxActive, shake, shakeOffset, updateFx } from '../render/fx'
import { isMuted, play, setMuted, unlockAudio } from '../render/audio'
import { formatBest, readBest, readJSON, submitBest, writeJSON } from './storage'
import { BET_STEPS, formatCoins, formatDelta, readBet, readWallet, settle, writeBet, writeWallet } from './coins'

export const DPR_CAP = 2
const MUTE_KEY = 'gs:settings:muted'

/** 小程序里 canvas 节点的具体类型随基础库版本浮动，这里只用到这几项 */
export interface CanvasNode {
  width: number
  height: number
  getContext(id: '2d'): CanvasRenderingContext2D | null
  requestAnimationFrame(cb: (t: number) => void): number
  cancelAnimationFrame(id: number): void
}

/** 由页面对象实现，runtime 只认这一个方法，不关心是 Page 实例还是别的 */
export interface Host {
  setData(patch: Record<string, unknown>, cb?: () => void): void
}

export interface CtrlView {
  label: string
  disabled: boolean
  primary: boolean
  shell: boolean
}

type CtrlItem<A> = Control<A> | { label: string; shell: 'restart' }

export class Runtime<S = unknown, A = unknown> {
  private state: S
  private ctx: CanvasRenderingContext2D
  private canvas: CanvasNode
  private host: Host
  private raf = 0
  private last = 0
  private running = false
  private dirty = true
  private aiTimer = 0
  private outcomeSaved = false
  private scale = 1
  private ox = 0
  private oy = 0
  private dpr = 1
  private cssW = 1
  private cssH = 1
  private pressed = false
  private active = false
  private rotateShown = false
  private rotateDismissed = false
  private lastHint = ''
  private lastCtrlSig = ''
  private ctrlList: Array<CtrlItem<A>> = []
  private renderErrorLogged = false
  private toastTimer = 0
  private wallet = readWallet()
  private bet = readBet()

  constructor(
    private mod: GameModule<S, A>,
    private meta: GameMeta,
    private seed: number,
    private daily: boolean,
    canvas: CanvasNode,
    host: Host,
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前基础库不支持 Canvas 2D（需要 2.7.0 以上）')
    this.canvas = canvas
    this.ctx = ctx
    this.host = host
    this.state = mod.create(seed)
    setMuted(readJSON<boolean>(MUTE_KEY, false) === true)
  }

  // ---------------- 生命周期 ----------------

  /** 画布拿到尺寸后调用；之后自动开始跑帧 */
  mount(cssW: number, cssH: number): void {
    this.resize(cssW, cssH)
    this.updateUI(true)
    this.start()
    this.scheduleAI()
  }

  start(): void {
    if (this.running || this.rotateShown) return
    this.running = true
    this.last = 0
    this.dirty = true
    this.raf = this.canvas.requestAnimationFrame(this.frame)
    this.scheduleAI()
  }

  stop(): void {
    this.running = false
    this.canvas.cancelAnimationFrame(this.raf)
    this.raf = 0
    if (this.aiTimer) {
      clearTimeout(this.aiTimer)
      this.aiTimer = 0
    }
  }

  destroy(): void {
    this.stop()
    clearTimeout(this.toastTimer)
    clearFx()
    resetAnims()
  }

  restart(seed: number): void {
    if (this.aiTimer) {
      clearTimeout(this.aiTimer)
      this.aiTimer = 0
    }
    this.seed = seed
    this.state = this.mod.create(seed)
    this.outcomeSaved = false
    resetAnims()
    clearFx()
    this.dirty = true
    this.updateUI(true)
    this.scheduleAI()
  }

  // ---------------- 尺寸 ----------------

  /**
   * 小程序没有 `resize` 事件与 ResizeObserver：尺寸由页面在 `onReady` 里
   * 用 SelectorQuery 量到之后调进来，横竖屏切换时页面再调一次。
   */
  resize(cssW: number, cssH: number): void {
    this.cssW = Math.max(1, Math.floor(cssW))
    this.cssH = Math.max(1, Math.floor(cssH))
    this.dpr = Math.min(DPR_CAP, wx.getWindowInfo().pixelRatio || 1)
    this.canvas.width = Math.round(this.cssW * this.dpr)
    this.canvas.height = Math.round(this.cssH * this.dpr)
    const vp = this.meta.viewport
    this.scale = Math.min(this.cssW / vp.width, this.cssH / vp.height)
    this.ox = (this.cssW - vp.width * this.scale) / 2
    this.oy = (this.cssH - vp.height * this.scale) / 2
    this.checkOrientation()
    this.dirty = true
    if (!this.rotateShown) this.draw()
  }

  /**
   * 横竖屏策略（规格第 5 条）。
   *
   * 规则原文：「依据 `orientation` 字段。若当前视口方向与游戏要求不符，显示旋转提示层，
   * **不要硬转 canvas**。」——所以这里只做两件事：判定方向、弹提示，
   * **不碰画布的旋转**。所有游戏的逻辑分辨率都是 720×1280，提示层的作用是
   * 让玩家把设备转成游戏要求的方向，而不是把画面转过来。
   *
   * 「是不是手机」这一项，网页版用 `matchMedia('(pointer: coarse)')` 判粗指针，
   * 小程序没有这个 API——但也不需要：页面里根本没有鼠标，
   * 唯一会被误伤的是开发者工具里被拉成桌面尺寸的模拟器窗口。
   * 这里改用**窗口短边**判定（`< 820` CSS px，与网页版同一个门限）：
   * 真机短边必然远小于 820，而桌面尺寸的模拟器窗口短边会超过它。
   */
  private checkOrientation(): void {
    const o = this.meta.orientation
    const info = wx.getWindowInfo()
    const w = info.windowWidth
    const h = info.windowHeight
    const phoneish = Math.min(w, h) < 820
    const landscape = w > h
    const mismatch = phoneish && ((o === 'portrait' && landscape) || (o === 'landscape' && !landscape))
    const show = mismatch && !this.rotateDismissed
    if (show === this.rotateShown) return
    this.rotateShown = show
    this.host.setData({ rotate: show })
    if (show) this.stop()
    else this.start()
  }

  /** 玩家点了「仍要继续」：记住这次不再拦，按当前方向继续玩 */
  onDismissRotate(): void {
    this.rotateDismissed = true
    this.resize(this.cssW, this.cssH)
  }

  // ---------------- 输入 ----------------

  /**
   * 由 WXML 的 `bindtouch*` 回调进来。`x/y` 是**相对 canvas 左上角的 CSS 像素**，
   * 减去 letterbox 偏移再除以缩放，即为游戏逻辑坐标——和网页版同一套公式。
   */
  onTouch(kind: PointerInput['kind'], x: number, y: number): void {
    // 旋转提示层挡着的时候不吃输入——提示层是全屏遮罩，
    // 不拦住的话玩家隔着遮罩戳一下，游戏就收到了一次误触
    if (this.rotateShown) return
    unlockAudio()
    if (kind === 'down') {
      if (this.active) return
      this.active = true
      this.pressed = true
    } else if (kind === 'up') {
      this.pressed = false
      this.active = false
    }
    if (!this.mod.input) return
    const p: PointerInput = {
      kind,
      x: (x - this.ox) / this.scale,
      y: (y - this.oy) / this.scale,
      pressed: this.pressed,
    }
    const a = this.mod.input(this.state, p)
    if (a !== null && a !== undefined) this.dispatch(a)
  }

  /** 触控目标：画布外侧轻点也算 down（网页版的 pointer 语义），用于点按钮区 */
  onCancel(): void {
    this.pressed = false
    this.active = false
  }

  // ---------------- 状态推进 ----------------

  private dispatch(a: A, quiet = false): void {
    const prev = this.state
    let next: S
    try {
      next = this.mod.reduce(prev, a)
    } catch (err) {
      console.error('[reduce] 出错', err)
      return
    }
    if (next === prev) return
    this.state = next
    this.dirty = true
    if (this.mod.effects) {
      try {
        for (const fx of this.mod.effects(prev, next)) this.runEffect(fx)
      } catch (err) {
        console.error('[effects] 出错', err)
      }
    }
    this.updateUI(false)
    this.checkOutcome()
    if (!quiet) this.scheduleAI()
  }

  private runEffect(e: Effect): void {
    switch (e.kind) {
      case 'sound':
        play(e.name)
        break
      case 'burst':
        burst(e.x, e.y, e.color, e.count)
        break
      case 'flash':
        flash(e.color)
        break
      case 'shake':
        shake(e.power)
        break
    }
  }

  private scheduleAI(): void {
    const ai = this.mod.aiAction
    if (!ai || (this.mod.aiDelay ?? 500) === 0 || this.aiTimer || !this.running) return
    let a: A | null
    try {
      a = ai(this.state)
    } catch (err) {
      console.error('[ai] 出错', err)
      return
    }
    if (a === null || a === undefined) return
    const snapshot = this.state
    this.aiTimer = setTimeout(() => {
      this.aiTimer = 0
      if (!this.running) return
      const act = this.state === snapshot ? a : ai(this.state)
      if (act !== null && act !== undefined) this.dispatch(act)
      this.scheduleAI()
    }, this.mod.aiDelay ?? 500)
  }

  private frame = (t: number): void => {
    if (!this.running) return
    this.raf = this.canvas.requestAnimationFrame(this.frame)
    const dt = this.last ? Math.min(50, Math.max(0, t - this.last)) : 16
    this.last = t
    if (this.mod.tick) this.dispatch(this.mod.tick(dt), true)
    if (this.mod.aiAction && this.mod.aiDelay === 0) {
      const a = this.mod.aiAction(this.state)
      if (a !== null && a !== undefined) this.dispatch(a, true)
    } else if (this.mod.tick && !this.aiTimer && this.mod.aiAction) {
      this.scheduleAI()
    }
    updateFx(dt)
    if (this.dirty || fxActive() || anyActive()) {
      this.draw()
      this.dirty = false
    }
  }

  private draw(): void {
    const c = this.ctx
    const vp = this.meta.viewport
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.fillStyle = COLORS.letterbox
    c.fillRect(0, 0, this.canvas.width, this.canvas.height)
    const [sx, sy] = shakeOffset()
    const k = this.scale * this.dpr
    c.setTransform(k, 0, 0, k, (this.ox + sx * this.scale) * this.dpr, (this.oy + sy * this.scale) * this.dpr)
    c.save()
    c.beginPath()
    c.rect(0, 0, vp.width, vp.height)
    c.clip()
    try {
      this.mod.render(c, this.state)
    } catch (err) {
      if (!this.renderErrorLogged) console.error('[render] 出错', err)
      this.renderErrorLogged = true
    }
    c.restore()
    c.save()
    c.beginPath()
    c.rect(0, 0, vp.width, vp.height)
    c.clip()
    drawFx(c, vp.width, vp.height)
    c.restore()
  }

  // ---------------- 提示区 / 控件区 ----------------

  private updateUI(force: boolean): void {
    const hint = this.mod.hint ? this.mod.hint(this.state) : this.meta.summary
    const patch: Record<string, unknown> = {}

    if (force || hint !== this.lastHint) {
      this.lastHint = hint
      patch.hint = hint
    }

    const ctrls: CtrlItem<A>[] = this.mod.controls ? this.mod.controls(this.state).slice() : []
    ctrls.push({ label: this.daily ? '重新挑战' : '新的一局', shell: 'restart' })
    const sig = ctrls.map((c) => `${c.label}|${'shell' in c ? 's' : c.disabled ? 1 : 0}|${'primary' in c && c.primary ? 1 : 0}`).join(';')
    this.ctrlList = ctrls
    if (force || sig !== this.lastCtrlSig) {
      this.lastCtrlSig = sig
      patch.ctrls = ctrls.map((c): CtrlView => ({
        label: c.label,
        disabled: !('shell' in c) && c.disabled === true,
        primary: !('shell' in c) && c.primary === true,
        shell: 'shell' in c,
      }))
    }

    if (force) {
      patch.best = (this.daily ? '每日挑战 · ' : '') + formatBest(readBest(this.meta.id))
      patch.wallet = formatCoins(this.wallet.balance)
      patch.bet = formatCoins(this.bet)
      patch.betHint = `点击切换下注额（${BET_STEPS.map(formatCoins).join(' / ')}）`
    }

    if (Object.keys(patch).length > 0) this.host.setData(patch)
  }

  /** 控件按钮被点了 */
  onCtrl(i: number): void {
    unlockAudio()
    const item = this.ctrlList[i]
    if (!item) return
    if ('shell' in item) this.restart(this.daily ? this.seed : newSeed())
    else this.dispatch(item.action)
  }

  private checkOutcome(): void {
    if (!this.mod.outcome) return
    const o = this.mod.outcome(this.state)
    if (!o) {
      this.outcomeSaved = false
      return
    }
    if (this.outcomeSaved) return
    this.outcomeSaved = true
    const record = submitBest(this.meta.id, o)
    this.host.setData({ best: (this.daily ? '每日挑战 · ' : '') + formatBest(readBest(this.meta.id)) })
    if (record) this.toast(`新纪录！${o.score}${o.unit}`)
    this.settleCoins(o)
  }

  /** 一局只结算一次，与 `submitBest` 同触发点、同受 `outcomeSaved` 保护 */
  private settleCoins(o: Outcome): void {
    if (this.daily) return
    const r = settle(this.mod, this.state, o, this.wallet, this.bet)
    if (r.delta === 0) {
      this.host.setData({ wallet: formatCoins(this.wallet.balance) })
      return
    }
    this.wallet = { ...this.wallet, balance: r.balance }
    writeWallet(this.wallet)
    this.host.setData({
      wallet: formatCoins(this.wallet.balance),
      delta: formatDelta(r.delta),
      deltaClass: r.delta > 0 ? 'up' : 'down',
    })
    this.toast(`${formatDelta(r.delta)} 金币`)
    if (this.wallet.balance <= 0) this.toast('金币输光了 · 回首页每日签到可以再领一笔')
  }

  /** 切到下一档注额；余额不够下一档时也允许切——结算时按余额夹住 */
  onCycleBet(): void {
    const i = BET_STEPS.indexOf(this.bet as (typeof BET_STEPS)[number])
    this.bet = BET_STEPS[(i + 1) % BET_STEPS.length]
    writeBet(this.bet)
    this.host.setData({ bet: formatCoins(this.bet) })
    this.toast(`本局注 ${formatCoins(this.bet)} 金币`)
  }

  onToggleSound(): void {
    unlockAudio()
    setMuted(!isMuted())
    writeJSON(MUTE_KEY, isMuted())
    this.host.setData({ muted: isMuted() })
  }

  private toast(msg: string): void {
    this.host.setData({ toast: msg, toastHidden: false })
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => this.host.setData({ toastHidden: true }), 2200) as unknown as number
  }
}

/**
 * 新种子。小程序没有 `crypto.getRandomValues`，用时间戳混一个随机量即可——
 * 这里是**壳层**，不是 `rules.ts`，不受「随机必须可播种」的约束
 * （那条约束针对的是游戏逻辑本身，壳层只需要一个互不相同的新局面）。
 */
export function newSeed(): number {
  return (Date.now() ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0
}
