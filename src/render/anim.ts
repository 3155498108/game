/**
 * 动画旁路缓存：动画状态放在 render 之外，不进入 reduce。
 * render 可通过 key 读取平滑过渡值，站点壳据 anyActive() 决定是否继续重绘。
 */
import { ease } from './draw'

type EaseFn = (t: number) => number

interface Tween {
  from: number
  to: number
  start: number
  dur: number
  fn: EaseFn
}

const tweens = new Map<string, Tween>()
const marks = new Map<string, { sig: string; at: number }>()
let lastActive = 0

export function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0
}

/** 让 key 对应的值平滑过渡到 target，返回当前插值 */
export function tweenTo(key: string, target: number, dur = 220, fn: EaseFn = ease.outCubic): number {
  const t = now()
  let tw = tweens.get(key)
  if (!tw) {
    tw = { from: target, to: target, start: t - dur, dur, fn }
    tweens.set(key, tw)
    return target
  }
  if (tw.to !== target) {
    const cur = valueOf(tw, t)
    tw = { from: cur, to: target, start: t, dur, fn }
    tweens.set(key, tw)
  }
  const v = valueOf(tw, t)
  if (t - tw.start < tw.dur) lastActive = t
  return v
}

function valueOf(tw: Tween, t: number): number {
  const p = tw.dur <= 0 ? 1 : Math.min(1, (t - tw.start) / tw.dur)
  return tw.from + (tw.to - tw.from) * tw.fn(p)
}

/**
 * 记录「某事件签名」发生的时刻，返回距今毫秒数。
 * 例如 elapsedSince('drop', `${lastMove}`) 可得到最近一次落子后的动画进度。
 * duration 内会标记为活跃，促使站点壳持续重绘。
 */
export function elapsedSince(key: string, sig: string, duration = 400): number {
  const t = now()
  const m = marks.get(key)
  if (!m || m.sig !== sig) {
    marks.set(key, { sig, at: t })
    lastActive = t
    return 0
  }
  const e = t - m.at
  if (e < duration) lastActive = t
  return e
}

/** 0→1 的进度（带缓动） */
export function progressSince(key: string, sig: string, duration = 400, fn: EaseFn = ease.outCubic): number {
  const e = elapsedSince(key, sig, duration)
  return fn(Math.min(1, e / duration))
}

/** 请求持续重绘一段时间（用于循环动画，如呼吸灯） */
export function keepAlive(): void {
  lastActive = now()
}

export function anyActive(): boolean {
  return now() - lastActive < 50
}

export function resetAnims(): void {
  tweens.clear()
  marks.clear()
}

/** 循环相位 0..1，便于呼吸/闪烁效果（会让画面持续重绘） */
export function pulse(periodMs = 1200): number {
  keepAlive()
  return (Math.sin((now() / periodMs) * Math.PI * 2) + 1) / 2
}
