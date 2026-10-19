/**
 * 玩具拳击规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 对局节奏（两段式操作，每回合固定三段）：
 *   choose（选方向）→ windup（蓄力 N tick）→ window（时机窗口 W tick）→ 结算 → 换手
 *
 * - 三个拳的「蓄力 tick 数 / 时机窗口宽度 / 基础伤害」两两不同，构成难度梯度。
 * - windup 与 window 期间都可以点出拳：窗口内命中，windup 未走完就点 → 落空。
 * - 窗口走完仍未出拳同样判落空，回合自动交还。
 * - 命中累积连击（伤害乘区随连击递增），落空立即清零连击。
 * - 任意一方 HP 归零立即终局；每一个 action 分支结束时都会走 settle()，不会卡死。
 *
 * 随机数只来自 state.rng（Rng 游标），同种子 + 同操作序列必然复现同一局。
 */
import { Rng, hashSeed } from '../../core/rng'
import { rowLayout } from '../../core/geom'
import type { Rect } from '../../core/geom'

// ---------------------------------------------------------------- 布局常量

export const VIEW_W = 720
export const VIEW_H = 1280

/** 底部三个出拳方向按钮（render 与 input 共用同一份布局，纯计算） */
export const PUNCH_BUTTONS: readonly Rect[] = rowLayout(3, VIEW_H - 250, 200, 150, 30, VIEW_W)

/** 时机窗口期的大出拳区：只有点这里才算「出拳」 */
export const STRIKE_PAD: Rect = { x: VIEW_W / 2 - 300, y: VIEW_H - 400, w: 600, h: 120 }

// ---------------------------------------------------------------- 拳种定义

export type PunchKind = 'jab' | 'cross' | 'hook'

export interface PunchSpec {
  kind: PunchKind
  /** 中文名 */
  name: string
  /** 基础伤害（未计连击加成） */
  damage: number
  /** 选向后的蓄力 tick 数 */
  windup: number
  /** 时机窗口宽度（tick） */
  window: number
  /** 面板上的一句话说明 */
  note: string
}

export const PUNCHES: readonly PunchSpec[] = [
  { kind: 'jab', name: '直拳', damage: 6, windup: 5, window: 7, note: '出手快 · 窗口宽' },
  { kind: 'cross', name: '摆拳', damage: 12, windup: 10, window: 4, note: '蓄力较久' },
  { kind: 'hook', name: '勾拳', damage: 20, windup: 16, window: 3, note: '伤害最高 · 窗口最窄' },
]

export const PUNCH_BY_KIND: Record<PunchKind, PunchSpec> = {
  jab: PUNCHES[0],
  cross: PUNCHES[1],
  hook: PUNCHES[2],
}

export function isPunchKind(v: unknown): v is PunchKind {
  return v === 'jab' || v === 'cross' || v === 'hook'
}

/** 全部拳种的蓄力 tick 总和，测试「三拳出拳时间各不相同」时用作量级参照 */
export const TOTAL_WINDUP = PUNCHES.reduce((sum, p) => sum + p.windup, 0)

// ---------------------------------------------------------------- 数值规则

export const MAX_HP = 100
/** 每层连击提供的伤害加成 */
export const COMBO_STEP = 0.15
/** 连击加成的层数上限 */
export const COMBO_CAP = 10

export function comboMultiplier(combo: number): number {
  const c = combo < 0 ? 0 : combo > COMBO_CAP ? COMBO_CAP : combo
  return 1 + c * COMBO_STEP
}

export function flip(side: Side): Side {
  return side === 'you' ? 'foe' : 'you'
}

// ---------------------------------------------------------------- 状态

export type Side = 'you' | 'foe'
export type Phase = 'choose' | 'windup' | 'window'
export type LastEvent = '' | 'hit' | 'whiff'

export interface Fighter {
  hp: number
  /** 当前连击数，落空清零 */
  combo: number
  /** 历史最高连击 */
  best: number
}

export interface State {
  phase: Phase
  /** 当前行动方 */
  turn: Side
  /** 已选定的出拳方向，choose 阶段为 null */
  choice: PunchKind | null
  /** 当前阶段剩余 tick 数 */
  timer: number
  you: Fighter
  foe: Fighter
  over: boolean
  /** 0 = 平局或未结束 */
  winner: Side | 0
  lastEvent: LastEvent
  lastDamage: number
  /** 最近一次结算的行动方 */
  lastBy: Side | null
  /** 每次结算自增，供渲染判断「新事件」 */
  seq: number
  /** 最近一次结算时的 tick 计数，供渲染播放受击/落空动作 */
  animFrom: number
  /** 最近一次结算消耗掉的一个随机数，仅影响火花抖动 */
  lastRoll: number
  /** 整局累计 tick 数 */
  tickCount: number
  /** 随机数游标 */
  rng: number
}

export type Action =
  | { type: 'choose'; punch: PunchKind }
  | { type: 'punch' }
  | { type: 'tick'; n: number }

export function create(seed: number): State {
  return {
    phase: 'choose',
    turn: 'you',
    choice: null,
    timer: 0,
    you: { hp: MAX_HP, combo: 0, best: 0 },
    foe: { hp: MAX_HP, combo: 0, best: 0 },
    over: false,
    winner: 0,
    lastEvent: '',
    lastDamage: 0,
    lastBy: null,
    seq: 0,
    animFrom: 0,
    lastRoll: 0,
    tickCount: 0,
    rng: hashSeed(seed),
  }
}

export function selfOf(state: State, side: Side): Fighter {
  return side === 'you' ? state.you : state.foe
}

export function foeOf(state: State, side: Side): Fighter {
  return side === 'you' ? state.foe : state.you
}

/** 当前选中的拳的参数；未选定时回落到直拳，避免出现除零 / NaN */
export function activeSpec(state: State): PunchSpec {
  return state.choice ? PUNCH_BY_KIND[state.choice] : PUNCH_BY_KIND.jab
}

/** 蓄力进度 0..1（1 表示窗口已开启），供渲染画进度条 */
export function windupProgress(state: State): number {
  const spec = activeSpec(state)
  if (state.phase === 'choose') return 0
  if (state.phase === 'window') return 1
  if (spec.windup <= 0) return 1
  const left = spec.windup - state.timer
  return left <= 0 ? 1 : Math.min(1, left / spec.windup)
}

/**
 * 当前行动方允许的操作。不含 tick —— tick 由站点壳按真实时间驱动，
 * 但 windup 阶段的「再等 n tick」本身也是合法的回合内决策，因此一并列出，
 * 供 AI 遍历试算、也供测试断言 AI 只从合法手里挑。
 */
export function legalActions(state: State): Action[] {
  if (state.over) return []
  if (state.phase === 'choose') return PUNCHES.map((p): Action => ({ type: 'choose', punch: p.kind }))
  if (state.phase === 'window') return [{ type: 'punch' }]
  const out: Action[] = [{ type: 'punch' }]
  for (let n = 1; n <= state.timer; n++) out.push({ type: 'tick', n })
  return out
}

// ---------------------------------------------------------------- 结算内部工具

/** 命中：结算伤害、累积连击、交换行动方 */
function strike(state: State): State {
  const spec = activeSpec(state)
  const atk = selfOf(state, state.turn)
  const def = foeOf(state, state.turn)
  const dmg = Math.max(1, Math.round(spec.damage * comboMultiplier(atk.combo)))
  const r = new Rng(state.rng)
  const roll = r.next()
  const nextCombo = atk.combo + 1
  const attackers: Fighter = { hp: atk.hp, combo: nextCombo, best: Math.max(atk.best, nextCombo) }
  const defender: Fighter = { hp: Math.max(0, def.hp - dmg), combo: def.combo, best: def.best }
  const fighters: Record<Side, Fighter> =
    state.turn === 'you' ? { you: attackers, foe: defender } : { you: defender, foe: attackers }
  return {
    ...state,
    phase: 'choose',
    turn: flip(state.turn),
    choice: null,
    timer: 0,
    you: fighters.you,
    foe: fighters.foe,
    lastEvent: 'hit',
    lastDamage: dmg,
    lastBy: state.turn,
    seq: state.seq + 1,
    animFrom: state.tickCount,
    lastRoll: roll,
    rng: r.s,
  }
}

/** 落空：连击清零，回合交还 */
function whiff(s: State): State {
  const atk = selfOf(s, s.turn)
  const broken: Fighter = { hp: atk.hp, combo: 0, best: atk.best }
  const r = new Rng(s.rng)
  r.next()
  return {
    ...s,
    phase: 'choose',
    turn: flip(s.turn),
    choice: null,
    timer: 0,
    you: s.turn === 'you' ? broken : s.you,
    foe: s.turn === 'you' ? s.foe : broken,
    lastEvent: 'whiff',
    lastDamage: 0,
    lastBy: s.turn,
    seq: s.seq + 1,
    animFrom: s.tickCount,
    lastRoll: r.next(),
    rng: r.s,
  }
}

/** 终局判定：任意一方 HP 归零即结束（唯一入口，所有分支都必须经过它） */
function settle(s: State): State {
  if (s.over) return s
  const youDown = s.you.hp <= 0
  const foeDown = s.foe.hp <= 0
  if (!youDown && !foeDown) return s
  return {
    ...s,
    over: true,
    winner: foeDown ? (youDown ? 0 : 'you') : 'foe',
    phase: 'choose',
    choice: null,
    timer: 0,
  }
}

// ---------------------------------------------------------------- 纯状态迁移

/** 纯函数状态迁移：不修改入参，终局判定在每个分支末尾统一执行 */
export function reduce(state: State, action: Action): State {
  if (state.over) return state

  switch (action.type) {
    case 'choose': {
      if (state.phase !== 'choose' || !isPunchKind(action.punch)) return state
      return settle({ ...state, phase: 'windup', choice: action.punch, timer: PUNCH_BY_KIND[action.punch].windup })
    }

    case 'punch': {
      if (state.phase !== 'windup' && state.phase !== 'window') return state
      // 只有窗口期才算命中；windup 未走完就出拳 = 落空
      return settle(state.phase === 'window' ? strike(state) : whiff(state))
    }

    case 'tick': {
      const n = action.n > 0 ? Math.floor(action.n) : 0
      if (n === 0) return state
      let s = state
      let left = n
      while (left > 0 && !s.over) {
        // choose 阶段由选向 action 推进，时间不流逝
        if (s.phase === 'choose') break
        const take = Math.min(left, s.timer)
        s = { ...s, timer: s.timer - take, tickCount: s.tickCount + take }
        left -= take
        if (s.timer > 0) continue
        if (s.phase === 'windup') {
          // 蓄力走完 → 时机窗口开启
          s = { ...s, phase: 'window', timer: activeSpec(s).window }
        } else {
          // 窗口走完仍未出拳 → 落空，回合结束
          s = whiff(s)
        }
      }
      return settle(s)
    }
  }
}

/** 选向 + 完美出拳的快捷推进（走的是同一个 reduce），供 AI 试算与测试使用 */
export function perfectPunch(state: State): State {
  let s = state
  if (s.over || s.phase === 'choose') return s
  if (s.phase === 'windup' && s.timer > 0) s = reduce(s, { type: 'tick', n: s.timer })
  if (!s.over && s.phase === 'window') s = reduce(s, { type: 'punch' })
  return s
}

/** 完成一个完整回合（选向 → 蓄力 → 窗口内出拳），返回结算后的状态 */
export function playTurn(state: State, punch: PunchKind): State {
  if (state.over || state.phase !== 'choose' || !isPunchKind(punch)) return state
  return perfectPunch(reduce(state, { type: 'choose', punch }))
}

// ---------------------------------------------------------------- AI

/** me 视角的局面评分（越大越好），只看战斗结果，不含回合阶段 */
export function evaluate(state: State, me: Side): number {
  if (state.over) {
    if (state.winner === me) return 100_000
    if (state.winner === 0) return -50_000
    return -100_000
  }
  const mine = selfOf(state, me)
  const theirs = foeOf(state, me)
  return (mine.hp - theirs.hp) * 10 + mine.combo * 5 - theirs.combo * 4
}

/** 按权重抽取一项，权重来自模拟结果（越高越可能被选中） */
function pickWeighted<T>(r: Rng, items: readonly T[], weight: (x: T) => number): T {
  const ws = items.map((x) => Math.max(1, Math.round(weight(x))))
  let total = 0
  for (const w of ws) total += w
  let t = r.next() * total
  for (let i = 0; i < items.length; i++) {
    t -= ws[i]
    if (t < 0) return items[i]
  }
  return items[items.length - 1]
}

/**
 * choose 阶段：遍历三个方向，用同一个 reduce 试算「完美出拳」的结果，
 * 权重取模拟出的实际伤害 —— 于是强力拳更常被选中，但种子不同会走出不同路线。
 */
function choosePunch(state: State, me: Side): Action {
  const r = new Rng(state.rng)
  const results = PUNCHES.map((p) => {
    const chosen = reduce(state, { type: 'choose', punch: p.kind })
    const struck = perfectPunch(chosen)
    const kills = struck.over && struck.winner === me
    return { action: { type: 'choose', punch: p.kind } as Action, w: kills ? 10_000 : Math.max(1, struck.lastDamage) }
  })
  return pickWeighted(r, results, (x) => x.w).action
}

/**
 * windup / window 阶段：遍历 legalActions（含「硬打落空」与「再等 n tick」），
 * 逐个调用同一个 reduce 试算后取最优。
 */
function strikeOrWait(state: State, me: Side): Action {
  const r = new Rng(state.rng)
  const order = r.shuffle(legalActions(state))
  let best: Action = { type: 'punch' }
  let bestScore = -Infinity
  for (const a of order) {
    const stepped = reduce(state, a)
    // 只有真正进入窗口的那一步才继续模拟出拳；提前硬打得到的空拳按原样评估
    const full = stepped.phase === 'window' ? perfectPunch(stepped) : stepped
    const sc = evaluate(full, me)
    if (sc > bestScore) {
      bestScore = sc
      best = a
    }
  }
  return best
}

/**
 * 为指定一方求一个动作：始终遍历 legalActions 并调用 reduce 试算，不维护第二套规则。
 * 非该方回合 / 已终局时返回 null。
 */
export function aiActionFor(state: State, side: Side): Action | null {
  if (state.over) return null
  if (state.turn !== side) return null
  if (state.phase === 'choose') return choosePunch(state, side)
  if (state.phase === 'window') return { type: 'punch' }
  return strikeOrWait(state, side)
}

/** 电脑（foe）回合的动作 */
export function aiAction(state: State): Action | null {
  return aiActionFor(state, 'foe')
}

/** 一方连续会打出多少伤害（测试「三拳各不相同」用） */
export function punchDamage(punch: PunchKind, combo = 0): number {
  return Math.max(1, Math.round(PUNCH_BY_KIND[punch].damage * comboMultiplier(combo)))
}
