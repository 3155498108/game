/**
 * 小程序版音效占位。
 *
 * 网页版用 WebAudio 振荡器现场合成音效（零音频文件、零体积），**小程序没有这个能力**：
 * `wx.createWebAudioContext()` 只能播放已加载的音频文件，不能像振荡器那样现场造波形。
 * 要还原同样的音色就得把 9 个音效预渲染成音频文件塞进包里——那与本项目
 * 「零资源、程序绘制」的前提相悖，也会吃掉小程序 2MB 主包的一小块。
 *
 * 所以这里保留**完全相同的接口与静音开关**（`runtime.ts` 一行都不用改），
 * 实现退化为震动反馈：`click` / `place` / `flip` 这类轻反馈给一个短震动，
 * `win` / `lose` / `error` 给长震动。玩家拿到的反馈通道还在，只是从耳朵换到了手。
 *
 * 如果以后要真音效：把网页版 `SOUNDS` 表按同样的参数离线渲染成 wav，
 * 用 `wx.createInnerAudioContext()` 播放即可，表结构不需要变。
 */
import type { SoundName } from '../core/types'

let muted = false

export function setMuted(m: boolean): void {
  muted = m
}

export function isMuted(): boolean {
  return muted
}

/** 小程序不需要「解锁音频」这一步（没有自动播放限制），保留接口是为了让 runtime 无分支 */
export function unlockAudio(): void {
  /* noop */
}

/** 短震动 = 轻反馈，长震动 = 胜负/错误这类需要被注意到的反馈 */
const LONG: ReadonlySet<SoundName> = new Set<SoundName>(['win', 'lose', 'error', 'score'])

export function play(name: SoundName): void {
  if (muted) return
  try {
    if (LONG.has(name)) wx.vibrateLong()
    else wx.vibrateShort({ type: 'light' })
  } catch {
    // 某些机型或开发者工具里震动不可用，静默忽略——音效是锦上添花，不该让游戏崩
  }
}
