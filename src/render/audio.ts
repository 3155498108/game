/** 合成音效（WebAudio 振荡器，无音频文件，零体积） */
import type { SoundName } from '../core/types'

let ac: AudioContext | null = null
let muted = false

export function setMuted(m: boolean): void {
  muted = m
}
export function isMuted(): boolean {
  return muted
}

function ctx(): AudioContext | null {
  if (ac) return ac
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ac = new AC()
  } catch {
    ac = null
  }
  return ac
}

/** 须在用户手势中调用一次以解锁移动端音频 */
export function unlockAudio(): void {
  const a = ctx()
  if (a && a.state === 'suspended') void a.resume().catch(() => undefined)
}

const SOUNDS: Record<SoundName, Array<[number, number, number, OscillatorType]>> = {
  // [频率, 起始(s), 时长(s), 波形]
  click: [[660, 0, 0.05, 'square']],
  place: [[320, 0, 0.08, 'triangle']],
  flip: [[880, 0, 0.04, 'triangle'], [1100, 0.03, 0.04, 'triangle']],
  score: [[740, 0, 0.08, 'sine'], [988, 0.07, 0.12, 'sine']],
  win: [[523, 0, 0.12, 'triangle'], [659, 0.12, 0.12, 'triangle'], [784, 0.24, 0.12, 'triangle'], [1046, 0.36, 0.25, 'triangle']],
  lose: [[392, 0, 0.18, 'sawtooth'], [311, 0.18, 0.18, 'sawtooth'], [233, 0.36, 0.3, 'sawtooth']],
  error: [[180, 0, 0.12, 'square']],
  hit: [[140, 0, 0.09, 'square'], [90, 0.04, 0.08, 'sine']],
  tick: [[1200, 0, 0.02, 'square']],
}

export function play(name: SoundName): void {
  if (muted) return
  const a = ctx()
  if (!a || a.state !== 'running') return
  const t0 = a.currentTime
  for (const [f, st, dur, type] of SOUNDS[name]) {
    const o = a.createOscillator()
    const g = a.createGain()
    o.type = type
    o.frequency.value = f
    g.gain.setValueAtTime(0.0001, t0 + st)
    g.gain.exponentialRampToValueAtTime(0.12, t0 + st + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + st + dur)
    o.connect(g).connect(a.destination)
    o.start(t0 + st)
    o.stop(t0 + st + dur + 0.02)
  }
}
