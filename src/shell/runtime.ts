/**
 * 游戏运行时（站点壳的一部分）：
 * - 逻辑分辨率 → 等比缩放 + 居中 letterbox，画面永不变形
 * - DPR 上限 2
 * - Pointer Events 统一鼠标与触摸
 * - 页面切走时停止 requestAnimationFrame
 * - 横竖屏不符时显示旋转提示层（不硬转 canvas）
 * - 动画/粒子走旁路缓存，reduce 保持纯净
 */
import type { Control, Effect, GameMeta, GameModule, PointerInput } from '../core/types'
import { COLORS } from '../render/draw'
import { anyActive, resetAnims } from '../render/anim'
import { burst, clearFx, drawFx, flash, fxActive, shake, shakeOffset, updateFx } from '../render/fx'
import { isMuted, play, setMuted, unlockAudio } from '../render/audio'
import { formatBest, readBest, readJSON, submitBest, writeJSON } from './storage'

export const DPR_CAP = 2
const MUTE_KEY = 'gs:settings:muted'

export interface PlayElements {
  stage: HTMLElement
  canvas: HTMLCanvasElement
  hint: HTMLElement
  best: HTMLElement
  ctrls: HTMLElement
  rotate: HTMLElement
  toast: HTMLElement
  sound: HTMLButtonElement
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

export class Runtime<S = unknown, A = unknown> {
  private state: S
  private ctx: CanvasRenderingContext2D
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
  private pressed = false
  private activePointer = -1
  private rotateDismissed = false
  private rotateShown = false
  private lastHint = ''
  private lastCtrlSig = ''
  private ctrlList: Array<Control<A> | { label: string; shell: 'restart' }> = []
  private renderErrorLogged = false
  private ro: ResizeObserver | null = null
  private toastTimer = 0
  private disposers: Array<() => void> = []

  constructor(
    private mod: GameModule<S, A>,
    private meta: GameMeta,
    private seed: number,
    private daily: boolean,
    private el: PlayElements,
  ) {
    const ctx = el.canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器不支持 Canvas 2D')
    this.ctx = ctx
    this.state = mod.create(seed)
    setMuted(readJSON<boolean>(MUTE_KEY, false) === true)
    this.bind()
    this.resize()
    this.updateUI(true)
    this.start()
    this.scheduleAI()
  }

  // ---------------- 生命周期 ----------------
  private start(): void {
    if (this.running || this.rotateShown || document.hidden) return
    this.running = true
    this.last = 0
    this.dirty = true
    this.raf = requestAnimationFrame(this.frame)
    this.scheduleAI()
  }

  private stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.raf = 0
    if (this.aiTimer) {
      clearTimeout(this.aiTimer)
      this.aiTimer = 0
    }
  }

  destroy(): void {
    this.stop()
    for (const d of this.disposers) d()
    this.disposers = []
    this.ro?.disconnect()
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

  private on<K extends keyof HTMLElementEventMap>(t: HTMLElement | Window | Document, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions): void {
    const f = fn as unknown as EventListener
    t.addEventListener(type, f, opts)
    this.disposers.push(() => t.removeEventListener(type, f, opts))
  }

  private bind(): void {
    const c = this.el.canvas
    this.on(c, 'pointerdown', (e: PointerEvent) => this.onPointer(e, 'down'), { passive: false })
    this.on(c, 'pointermove', (e: PointerEvent) => this.onPointer(e, 'move'), { passive: false })
    this.on(c, 'pointerup', (e: PointerEvent) => this.onPointer(e, 'up'), { passive: false })
    this.on(c, 'pointercancel', (e: PointerEvent) => this.onPointer(e, 'up'), { passive: false })
    // 阻止双击缩放 / 长按菜单 / iOS 手势缩放
    this.on(c, 'dblclick', (e: Event) => e.preventDefault())
    this.on(c, 'contextmenu', (e: Event) => e.preventDefault())
    this.on(c, 'touchstart', (e: TouchEvent) => e.preventDefault(), { passive: false })
    this.on(document, 'gesturestart', (e: Event) => e.preventDefault())

    this.on(window, 'keydown', (e: KeyboardEvent) => {
      if (!this.mod.key || this.rotateShown) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const a = this.mod.key(this.state, e.key)
      if (a !== null && a !== undefined) {
        e.preventDefault()
        this.dispatch(a)
      }
    })
    this.on(document, 'visibilitychange', () => {
      if (document.hidden) this.stop()
      else this.start()
    })
    this.on(window, 'pagehide', () => this.stop())
    this.on(window, 'resize', () => this.resize())
    this.on(window, 'orientationchange', () => setTimeout(() => this.resize(), 120))
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize())
      this.ro.observe(this.el.stage)
    }

    this.on(this.el.ctrls, 'click', (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest('button[data-i]') as HTMLButtonElement | null
      if (!b || b.disabled) return
      unlockAudio()
      const item = this.ctrlList[Number(b.dataset.i)]
      if (!item) return
      if ('shell' in item) this.restart(this.daily ? this.seed : newSeed())
      else this.dispatch(item.action)
    })
    this.on(this.el.sound, 'click', () => {
      unlockAudio()
      setMuted(!isMuted())
      writeJSON(MUTE_KEY, isMuted())
      this.updateSoundBtn()
    })
    this.updateSoundBtn()
    const dismiss = this.el.rotate.querySelector('button')
    if (dismiss)
      this.on(dismiss as HTMLElement, 'click', () => {
        this.rotateDismissed = true
        this.resize()
      })
  }

  private updateSoundBtn(): void {
    this.el.sound.textContent = isMuted() ? '🔇' : '🔊'
    this.el.sound.setAttribute('aria-label', isMuted() ? '开启音效' : '关闭音效')
  }

  // ---------------- 尺寸与方向 ----------------
  private resize(): void {
    const r = this.el.stage.getBoundingClientRect()
    const cssW = Math.max(1, Math.floor(r.width))
    const cssH = Math.max(1, Math.floor(r.height))
    this.dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1)
    const c = this.el.canvas
    c.style.width = `${cssW}px`
    c.style.height = `${cssH}px`
    const bw = Math.round(cssW * this.dpr)
    const bh = Math.round(cssH * this.dpr)
    if (c.width !== bw) c.width = bw
    if (c.height !== bh) c.height = bh
    const vp = this.meta.viewport
    this.scale = Math.min(cssW / vp.width, cssH / vp.height)
    this.ox = (cssW - vp.width * this.scale) / 2
    this.oy = (cssH - vp.height * this.scale) / 2
    // 把画面实际宽度同步给 CSS：桌面端顶栏与操作区跟着画面居中，
    // 不会出现「窄画面 + 超宽按钮」的割裂感
    const play = this.el.stage.parentElement
    if (play) play.style.setProperty('--game-w', `${Math.round(vp.width * this.scale)}px`)
    this.checkOrientation()
    this.dirty = true
    if (!this.rotateShown) this.draw()
  }

  private checkOrientation(): void {
    const o = this.meta.orientation
    const w = window.innerWidth
    const h = window.innerHeight
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
    const mobile = coarse && Math.min(w, h) < 820
    const landscape = w > h
    const mismatch = mobile && ((o === 'portrait' && landscape) || (o === 'landscape' && !landscape))
    const show = mismatch && !this.rotateDismissed
    if (show !== this.rotateShown) {
      this.rotateShown = show
      this.el.rotate.hidden = !show
      if (show) this.stop()
      else this.start()
    }
  }

  // ---------------- 输入 ----------------
  private onPointer(e: PointerEvent, kind: PointerInput['kind']): void {
    e.preventDefault()
    if (kind === 'down') {
      unlockAudio()
      if (this.activePointer !== -1 && this.activePointer !== e.pointerId) return
      this.activePointer = e.pointerId
      this.pressed = true
      try {
        this.el.canvas.setPointerCapture(e.pointerId)
      } catch {
        /* 忽略 */
      }
    } else if (this.activePointer !== -1 && e.pointerId !== this.activePointer) {
      return
    }
    if (kind === 'up') {
      this.pressed = false
      this.activePointer = -1
    }
    if (!this.mod.input) return
    const rect = this.el.canvas.getBoundingClientRect()
    const p: PointerInput = {
      kind,
      x: (e.clientX - rect.left - this.ox) / this.scale,
      y: (e.clientY - rect.top - this.oy) / this.scale,
      pressed: this.pressed,
    }
    const a = this.mod.input(this.state, p)
    if (a !== null && a !== undefined) this.dispatch(a)
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
    this.aiTimer = window.setTimeout(() => {
      this.aiTimer = 0
      if (!this.running) return
      const act = this.state === snapshot ? a : ai(this.state)
      if (act !== null && act !== undefined) this.dispatch(act)
      this.scheduleAI()
    }, this.mod.aiDelay ?? 500)
  }

  private frame = (t: number): void => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.frame)
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
    c.fillRect(0, 0, this.el.canvas.width, this.el.canvas.height)
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

  // ---------------- 提示区 ----------------
  private updateUI(force: boolean): void {
    const hint = this.mod.hint ? this.mod.hint(this.state) : this.meta.summary
    if (force || hint !== this.lastHint) {
      this.lastHint = hint
      this.el.hint.textContent = hint
    }
    const ctrls: Array<Control<A> | { label: string; shell: 'restart' }> = this.mod.controls ? this.mod.controls(this.state).slice() : []
    ctrls.push({ label: this.daily ? '重新挑战' : '新的一局', shell: 'restart' })
    const sig = ctrls.map((c) => `${c.label}|${'shell' in c ? 's' : c.disabled ? 1 : 0}|${'primary' in c && c.primary ? 1 : 0}`).join(';')
    this.ctrlList = ctrls
    if (force || sig !== this.lastCtrlSig) {
      this.lastCtrlSig = sig
      this.el.ctrls.innerHTML = ctrls
        .map((c, i) => {
          const dis = !('shell' in c) && c.disabled ? ' disabled' : ''
          const cls = 'shell' in c ? 'btn ghost' : c.primary ? 'btn primary' : 'btn'
          return `<button type="button" class="${cls}" data-i="${i}"${dis}>${escapeHtml(c.label)}</button>`
        })
        .join('')
    }
    if (force) this.el.best.textContent = (this.daily ? '每日挑战 · ' : '') + formatBest(readBest(this.meta.id))
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
    this.el.best.textContent = (this.daily ? '每日挑战 · ' : '') + formatBest(readBest(this.meta.id))
    if (record) this.toast(`新纪录！${o.score}${o.unit}`)
  }

  private toast(msg: string): void {
    this.el.toast.textContent = msg
    this.el.toast.hidden = false
    clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => (this.el.toast.hidden = true), 2200)
  }
}

export function newSeed(): number {
  // 站点壳负责生成新种子（游戏逻辑本身只接收 seed，不调用 Math.random）
  const c = typeof crypto !== 'undefined' && 'getRandomValues' in crypto ? crypto.getRandomValues(new Uint32Array(1))[0] : Date.now()
  return c >>> 0
}
