/**
 * 玩具棒球（toy-baseball）· 规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 玩法：每局 10 球，一球一个回合。
 *   1. 投球：由 state.rng 生成的随机参数（窗口中心 tick、好球带横向位置、弯曲、深度）决定这一球的轨迹；
 *   2. 球进入击球区时，好球带（判定窗口）在 state.pitch.t ∈ [center - half, center + half] 期间亮起；
 *   3. 玩家点击挥棒：偏差 = 挥棒 tick - 窗口中心 tick，**只看偏差绝对值**，早挥与晚挥受罚完全对称；
 *   4. 10 球用尽即终局，结算累计安打数与总分。
 *
 * 时间推进：逐 tick 定步（tick action），本文件不读真实时间、不用全局随机数、不碰 DOM，
 * 同种子 + 同 action 序列必得同一局。
 */
import { Rng } from '../../core/rng'

/** 每局球数 */
export const TOTAL_PITCHES = 10
/** 一个 tick 的时长（毫秒）。渲染层用真实 dt 折算成整数 tick 通过 tick action 推进 */
export const TICK_MS = 40
/** 一球从出手到越过本垒的总 tick 数 */
export const PITCH_TICKS = 52
/** 出手后判定窗口尚未开启的预备 tick 数 */
export const WINDUP_TICKS = 10
/** 完美时机：|偏差| ≤ 2 tick → 全垒打 */
export const PERFECT_TICK = 2
/** 判定窗口（好球带）半宽：|偏差| ≤ 5 tick → 界内安打 */
export const WINDOW_HALF = 5
/** 窗口外一点：|偏差| ≤ 8 tick → 界外高飞 */
export const FLY_HALF = 8
/** 界外上限：|偏差| ≤ 12 tick → 界外擦棒，超过即挥空 */
export const FOUL_HALF = 12
/** 每球结算后停留的 tick 数（留给结果展示） */
export const RESULT_HOLD_TICKS = 34
/** 判定窗口中心的最早 / 最晚 tick，保证 ±FOUL_HALF 的挥棒都落在球还在场的范围内 */
export const CENTER_MIN = WINDUP_TICKS + WINDOW_HALF + 1
export const CENTER_MAX = PITCH_TICKS - FOUL_HALF - 2
/** 判定为「表现出色」的分数线（outcome.win 仅展示用） */
export const GREAT_SCORE = 20
/** 单个 tick action 最多推进的 tick 数，防止壳一次灌入超大 dt */
export const MAX_TICKS_PER_ACTION = 600

/** 一球的击球结果类型 */
export type HitKind = 'homeRun' | 'inPlay' | 'fly' | 'foul' | 'miss' | 'take'

/** 结算界面文案 */
export const RESULT_LABEL: Record<HitKind, string> = {
  homeRun: '全垒打！',
  inPlay: '界内安打',
  fly: '界外高飞',
  foul: '界外擦棒',
  miss: '挥棒落空',
  take: '没出手',
}

/** 每种结果带来的安打数与分数 */
export const RESULT_GAIN: Record<HitKind, { hits: number; points: number }> = {
  homeRun: { hits: 2, points: 3 },
  inPlay: { hits: 1, points: 1 },
  fly: { hits: 0, points: 0 },
  foul: { hits: 0, points: 0 },
  miss: { hits: 0, points: 0 },
  take: { hits: 0, points: 0 },
}

/**
 * 由挥棒偏差（tick）判定击球质量。**只看绝对值**，因此挥早与挥挥晚严格对称。
 *   |偏差| ≤ PERFECT_TICK  → 全垒打
 *   |偏差| ≤ WINDOW_HALF   → 界内安打（判定窗口内）
 *   |偏差| ≤ FLY_HALF      → 界外高飞
 *   |偏差| ≤ FOUL_HALF     → 界外擦棒（判定窗口外）
 *   其余                  → 挥棒落空
 */
export function judge(offset: number): HitKind {
  const a = Math.abs(offset)
  if (a <= PERFECT_TICK) return 'homeRun'
  if (a <= WINDOW_HALF) return 'inPlay'
  if (a <= FLY_HALF) return 'fly'
  if (a <= FOUL_HALF) return 'foul'
  return 'miss'
}

/** 当前这一球的实时参数（每球生成一次） */
export interface Pitch {
  /** 0 基的本局球序号 */
  index: number
  /** 当前已推进的 tick，0..PITCH_TICKS */
  t: number
  /** 判定窗口中心所在 tick */
  center: number
  /** 好球带半宽（本规则恒为 WINDOW_HALF） */
  half: number
  /** 好球带横向中心（逻辑坐标），决定这一球偏高 / 偏低 / 偏左 / 偏右 */
  laneX: number
  /** 飞行中的横向弯曲量（逻辑坐标） */
  curve: number
  /** 出球深度系数，影响视觉大小 */
  depth: number
  /** 本球是否已挥棒 */
  swung: boolean
  /** 挥棒发生的 tick，未挥棒为 -1 */
  swingTick: number
}

/** 已结算的一球 */
export interface PitchResult {
  kind: HitKind
  /** 挥棒偏差 tick；没挥棒为 0 */
  offset: number
  hits: number
  points: number
}

export type Phase = 'pitch' | 'result' | 'over'

export interface State {
  phase: Phase
  /** 当前球 */
  pitch: Pitch
  /** 已投出的球数 0..TOTAL_PITCHES */
  pitchNo: number
  /** 结果展示剩余 tick */
  hold: number
  /** 已结算的每一球 */
  results: PitchResult[]
  /** 最近一次结算结果，供渲染直接取用 */
  last: PitchResult | null
  /** 累计安打数 */
  hits: number
  /** 总分 */
  score: number
  /** 界外 / 挥空时的画面抖动剩余 tick */
  shake: number
  over: boolean
  rng: number
}

export type Action =
  /** 渲染层按真实 dt 折算后推进 n 个 tick */
  | { type: 'tick'; n: number }
  /** 点击挥棒 */
  | { type: 'swing' }

/** 用当前 rng 游标生成一球参数 */
function makePitch(r: Rng, index: number): Pitch {
  return {
    index,
    t: 0,
    center: r.range(CENTER_MIN, CENTER_MAX),
    half: WINDOW_HALF,
    laneX: r.range(180, 540),
    curve: r.float(-42, 42),
    depth: r.float(0.85, 1.2),
    swung: false,
    swingTick: -1,
  }
}

/** 进入下一球；球数用尽即终局 */
function nextPitch(state: State): State {
  const no = state.pitchNo + 1
  if (no > TOTAL_PITCHES) return { ...state, phase: 'over', over: true }
  const r = new Rng(state.rng)
  return {
    ...state,
    phase: 'pitch',
    pitch: makePitch(r, no - 1),
    pitchNo: no,
    hold: 0,
    shake: 0,
    rng: r.s,
  }
}

/** 结算当前球：kind 由判定得出 */
function settle(state: State, kind: HitKind, offset: number): State {
  const gain = RESULT_GAIN[kind]
  const result: PitchResult = { kind, offset, hits: gain.hits, points: gain.points }
  const done = state.pitchNo >= TOTAL_PITCHES
  return {
    ...state,
    phase: done ? 'over' : 'result',
    hold: RESULT_HOLD_TICKS,
    results: state.results.concat(result),
    last: result,
    hits: state.hits + gain.hits,
    score: state.score + gain.points,
    shake: kind === 'foul' || kind === 'miss' ? 12 : 0,
    over: done,
  }
}

/** 一个 tick 的推进 */
function step(state: State): State {
  if (state.over) return state
  if (state.phase === 'pitch') {
    const pitch: Pitch = { ...state.pitch, t: state.pitch.t + 1 }
    // 球已经越过本垒还没挥棒 → 白白丢掉这一球，但仍然计入球数
    if (pitch.t >= PITCH_TICKS && !pitch.swung) {
      return settle({ ...state, pitch }, 'take', 0)
    }
    return { ...state, pitch }
  }
  if (state.phase === 'result') {
    const hold = state.hold - 1
    if (hold <= 0) return nextPitch(state)
    return { ...state, hold }
  }
  return state
}

export function create(seed: number): State {
  const r = new Rng(seed)
  return {
    phase: 'pitch',
    pitch: makePitch(r, 0),
    pitchNo: 1,
    hold: 0,
    results: [],
    last: null,
    hits: 0,
    score: 0,
    shake: 0,
    over: false,
    rng: r.s,
  }
}

/** 判定窗口此刻是否亮起（球已进入击球区） */
export function windowOpen(state: State): boolean {
  if (state.phase !== 'pitch') return false
  return Math.abs(state.pitch.t - state.pitch.center) <= state.pitch.half
}

/** 距判定窗口开启还剩几个 tick（负数表示窗口已经开启或已关闭） */
export function ticksToWindow(state: State): number {
  if (state.phase !== 'pitch') return -1
  return state.pitch.center - state.pitch.t - state.pitch.half
}

/** 挥棒偏差：正数表示挥晚，负数表示挥早 */
export function timingOffset(state: State): number {
  if (state.phase !== 'pitch') return 0
  return state.pitch.t - state.pitch.center
}

/** 纯函数状态迁移：非法 / 终局动作原样返回入参（引用相等） */
export function reduce(state: State, action: Action): State {
  if (state.over) return state
  if (action.type === 'tick') {
    const n = Math.min(MAX_TICKS_PER_ACTION, Math.max(0, Math.floor(action.n)))
    let cur = state
    for (let i = 0; i < n; i++) cur = step(cur)
    return cur
  }
  if (action.type === 'swing') {
    // 一球只能挥一次；结果展示中、球还没投出、终局一律忽略
    if (state.phase !== 'pitch' || state.pitch.swung) return state
    const offset = state.pitch.t - state.pitch.center
    const pitch: Pitch = { ...state.pitch, swung: true, swingTick: state.pitch.t }
    return settle({ ...state, pitch }, judge(offset), offset)
  }
  return state
}
