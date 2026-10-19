/**
 * 快艇骰子（Yahtzee）· 规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 玩法：5 颗骰子、13 个计分格、每轮 3 次投掷。
 *   - 第 1 掷掷全部 5 颗；之后可勾选保留部分骰子，只重投未勾选的；
 *   - 每轮结束把当前骰面写进某一个空缺格（13 格各自最多填一次，填 0 即放弃该格）；
 *   - 13 格填完即终局，展示总分与上/下段小计。
 *
 * 计分表（简化版，见下方 MAX_SCORE 的推导）：
 *   上段 1~6：该点数骰子之和（满分 5/10/15/20/25/30，合计 105）
 *   下段：对子 5、两对 15、三条 20、四条 25、小顺 30、大顺 40、快艇 50（合计 185）
 *   额外奖励：上段合计 ≥ 63 → +35；快艇格拿到满分 50 → 再 +50
 *   理论满分：105 + 35 + 185 + 50 = 375
 *
 * 随机全部来自 state.rng（mulberry32 游标）+ core/rng 的 rollDie，
 * 即规格里的 floor(random * 6) + 1 的可播种版本。本文件不读时间、不用全局随机、不碰 DOM。
 */
import { Rng, rollDie } from '../../core/rng'

/** 骰子数量 */
export const DIE_COUNT = 5
/** 计分格总数：上段 6 + 下段 7 */
export const SLOT_COUNT = 13
/** 上段格数 */
export const UPPER_SLOT_COUNT = 6
/** 每轮投掷次数 */
export const ROLLS_PER_ROUND = 3
/** 上段奖励门槛 */
export const UPPER_BONUS_TARGET = 63
/** 上段奖励 */
export const UPPER_BONUS = 35
/** 快艇额外奖励（与快艇格本身的 50 分分开计算） */
export const YAHTZEE_BONUS = 50

/** 下段各格序号 */
export const SLOT_PAIR = 6
export const SLOT_TWO_PAIR = 7
export const SLOT_THREE = 8
export const SLOT_FOUR = 9
export const SLOT_SMALL = 10
export const SLOT_LARGE = 11
export const SLOT_YAHTZEE = 12

export interface SlotDef {
  /** 格序号 0..12 */
  id: number
  /** 上段按点数求和，下段按组合给固定分 */
  kind: 'upper' | 'lower'
  /** 上段：对应点数 1..6；下段为 0 */
  face: number
  /** 界面显示名 */
  label: string
  /** 界面说明 */
  desc: string
  /** 该格满分 */
  max: number
}

/** 13 个计分格。max 一律由这里定义，UPPER_MAX / LOWER_MAX / MAX_SCORE 全部由它推导，不会漂移 */
export const SLOTS: readonly SlotDef[] = [
  { id: 0, kind: 'upper', face: 1, label: '1', desc: '所有 1 之和', max: 5 },
  { id: 1, kind: 'upper', face: 2, label: '2', desc: '所有 2 之和', max: 10 },
  { id: 2, kind: 'upper', face: 3, label: '3', desc: '所有 3 之和', max: 15 },
  { id: 3, kind: 'upper', face: 4, label: '4', desc: '所有 4 之和', max: 20 },
  { id: 4, kind: 'upper', face: 5, label: '5', desc: '所有 5 之和', max: 25 },
  { id: 5, kind: 'upper', face: 6, label: '6', desc: '所有 6 之和', max: 30 },
  { id: 6, kind: 'lower', face: 0, label: '对子', desc: '至少两颗相同', max: 5 },
  { id: 7, kind: 'lower', face: 0, label: '两对', desc: '两组对子', max: 15 },
  { id: 8, kind: 'lower', face: 0, label: '三条', desc: '至少三颗相同', max: 20 },
  { id: 9, kind: 'lower', face: 0, label: '四条', desc: '至少四颗相同', max: 25 },
  { id: 10, kind: 'lower', face: 0, label: '小顺', desc: '1-2-3-4-5', max: 30 },
  { id: 11, kind: 'lower', face: 0, label: '大顺', desc: '2-3-4-5-6', max: 40 },
  { id: 12, kind: 'lower', face: 0, label: '快艇', desc: '五颗全同', max: 50 },
]

/** 上段满分合计 = 5 × (1+2+3+4+5+6) = 105 */
export const UPPER_MAX = SLOTS.slice(0, UPPER_SLOT_COUNT).reduce((a, s) => a + s.max, 0)
/** 下段满分合计 = 5+15+20+25+30+40+50 = 185 */
export const LOWER_MAX = SLOTS.slice(UPPER_SLOT_COUNT).reduce((a, s) => a + s.max, 0)
/** 理论满分 = 上段 105 + 上段奖励 35 + 下段 185 + 快艇奖励 50 = 375 */
export const MAX_SCORE = UPPER_MAX + UPPER_BONUS + LOWER_MAX + YAHTZEE_BONUS

/** 序号是否合法 */
export function isSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT
}

/** 统计 1..6 每个点数出现的次数，下标 0 恒为 0 */
export function counts(dice: readonly number[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0]
  for (const d of dice) if (d >= 1 && d <= 6) c[d] += 1
  return c
}

/** 出现次数最多的点数的颗数（0 表示没有骰子） */
export function maxCount(dice: readonly number[]): number {
  const c = counts(dice)
  let m = 0
  for (let f = 1; f <= 6; f++) if (c[f] > m) m = c[f]
  return m
}

/** 出现「至少 need 颗」的点数的个数（用来判两对） */
export function facesWithAtLeast(dice: readonly number[], need: number): number {
  const c = counts(dice)
  let n = 0
  for (let f = 1; f <= 6; f++) if (c[f] >= need) n += 1
  return n
}

function hasAll(dice: readonly number[], faces: readonly number[]): boolean {
  const c = counts(dice)
  return faces.every((f) => c[f] >= 1)
}

export function isPair(dice: readonly number[]): boolean {
  return maxCount(dice) >= 2
}

export function isTwoPair(dice: readonly number[]): boolean {
  return facesWithAtLeast(dice, 2) >= 2
}

export function isThree(dice: readonly number[]): boolean {
  return maxCount(dice) >= 3
}

export function isFour(dice: readonly number[]): boolean {
  return maxCount(dice) >= 4
}

/** 小顺：1-2-3-4-5；按标准规则大顺（2-3-4-5-6）同时也算小顺 */
export function isSmallStraight(dice: readonly number[]): boolean {
  return hasAll(dice, [1, 2, 3, 4, 5]) || hasAll(dice, [2, 3, 4, 5, 6])
}

/** 大顺：2-3-4-5-6 */
export function isLargeStraight(dice: readonly number[]): boolean {
  return hasAll(dice, [2, 3, 4, 5, 6])
}

/** 快艇：五颗全同 */
export function isYahtzee(dice: readonly number[]): boolean {
  return dice.length === DIE_COUNT && maxCount(dice) === DIE_COUNT
}

/** 某一格按当前骰面应得的分数（不满足组合时为 0） */
export function scoreFor(slot: number, dice: readonly number[]): number {
  const def = SLOTS[slot]
  if (!def) return 0
  if (def.kind === 'upper') return counts(dice)[def.face] * def.face
  switch (def.id) {
    case SLOT_PAIR:
      return isPair(dice) ? def.max : 0
    case SLOT_TWO_PAIR:
      return isTwoPair(dice) ? def.max : 0
    case SLOT_THREE:
      return isThree(dice) ? def.max : 0
    case SLOT_FOUR:
      return isFour(dice) ? def.max : 0
    case SLOT_SMALL:
      return isSmallStraight(dice) ? def.max : 0
    case SLOT_LARGE:
      return isLargeStraight(dice) ? def.max : 0
    case SLOT_YAHTZEE:
      return isYahtzee(dice) ? def.max : 0
    default:
      return 0
  }
}

export interface State {
  /** 本轮当前 5 颗骰面；本轮还没掷过时为空数组 */
  dice: number[]
  /** 每颗骰子是否勾选「保留」，重投时只重投未勾选的 */
  keep: boolean[]
  /** 当前轮次 1..13 */
  round: number
  /** 本轮剩余投掷次数 0..ROLLS_PER_ROUND */
  rollsLeft: number
  /** 13 个计分格：null = 空缺；数字 = 已填得分（0 表示放弃该格） */
  slots: (number | null)[]
  /** 最近一次填入的格（渲染高亮用），-1 表示本轮还没填过 */
  lastSlot: number
  /** 累计投掷次数 */
  throws: number
  /** 13 格填完即终局 */
  over: boolean
  rng: number
}

export type Action =
  /** 掷骰：保留 keep 中勾选的，只重投其余 */
  | { type: 'roll' }
  /** 勾选 / 取消勾选某颗骰子 */
  | { type: 'toggle'; die: number }
  /** 把当前骰面写入某一空缺格；abandon 为 true 时直接记 0 分（放弃该格） */
  | { type: 'fill'; slot: number; abandon?: boolean }
  /** AI 自动选最优格并填入 */
  | { type: 'auto' }

export function create(seed: number): State {
  const r = new Rng(seed)
  return {
    dice: [],
    keep: [false, false, false, false, false],
    round: 1,
    rollsLeft: ROLLS_PER_ROUND,
    slots: [null, null, null, null, null, null, null, null, null, null, null, null, null],
    lastSlot: -1,
    throws: 0,
    over: false,
    rng: r.s,
  }
}

/** 已填格的个数 */
export function filledCount(slots: readonly (number | null)[]): number {
  let n = 0
  for (const v of slots) if (v !== null) n += 1
  return n
}

/** 上段合计（不含 +35 奖励） */
export function upperTotal(state: State): number {
  let sum = 0
  for (let i = 0; i < UPPER_SLOT_COUNT; i++) {
    const v = state.slots[i]
    if (v !== null) sum += v
  }
  return sum
}

/** 下段合计 */
export function lowerTotal(state: State): number {
  let sum = 0
  for (let i = UPPER_SLOT_COUNT; i < SLOT_COUNT; i++) {
    const v = state.slots[i]
    if (v !== null) sum += v
  }
  return sum
}

/** 上段合计 ≥ 63 才有 +35；已填的 0 分不影响判定 */
export function upperBonus(state: State): number {
  return upperTotal(state) >= UPPER_BONUS_TARGET ? UPPER_BONUS : 0
}

/** 快艇额外奖励：只有快艇格真的拿到满分 50 才兑现，与快艇格本身的 50 分分开算 */
export function yahtzeeBonus(state: State): number {
  const v = state.slots[SLOT_YAHTZEE]
  return v !== null && v >= SLOTS[SLOT_YAHTZEE].max ? YAHTZEE_BONUS : 0
}

/** 总分 = 上段 + 下段 + 上段奖励 + 快艇奖励 */
export function totalScore(state: State): number {
  return upperTotal(state) + lowerTotal(state) + upperBonus(state) + yahtzeeBonus(state)
}

// ---------------- AI 目标函数 ----------------

/** 上段 63 分奖励的潜力权重：缺口越小越值钱 */
const UPPER_GAP_WEIGHT = 3
/** 边际损失：把三颗以上的主线面填进对不上的上段格时扣除 */
const WASTE_COST = 6

/** 本次的主线面：出现 3 颗以上的点数（同数时取最小面值），没有则返回 0 */
export function leadFace(dice: readonly number[]): number {
  const c = counts(dice)
  let lead = 0
  let best = 2
  for (let f = 1; f <= 6; f++) {
    if (c[f] > best) {
      best = c[f]
      lead = f
    }
  }
  return lead
}

/** 边际损失：主线面自己的上段格还空着时，填到别的上段格要扣分（下段格不按面值走，不扣） */
function wasteCost(state: State, slot: number): number {
  const def = SLOTS[slot]
  if (def.kind === 'lower') return 0
  const lead = leadFace(state.dice)
  if (lead === 0 || lead === def.face) return 0
  if (state.slots[lead - 1] !== null) return 0 // 主线面那一格已经填过，不算浪费
  return WASTE_COST
}

/**
 * 把 slot 按当前骰面填上之后，这一手值多少分（目标函数，越大越好）。纯函数、无随机。
 * 构成：已到手总分 + 本格得分 + 上段 63 分奖励的潜力变化 + 快艇奖励 + 边际损失。
 * 槽位非法或已被填写时返回 -Infinity。
 */
export function slotValue(state: State, slot: number): number {
  if (!isSlot(slot) || state.slots[slot] !== null) return -Infinity
  const gained = scoreFor(slot, state.dice)

  let v = totalScore(state) + gained

  // 1) 上段 63 分奖励：这一手正好补齐就立刻兑现，否则按剩余缺口扣分（缺口越小越值钱）
  const upperBefore = upperTotal(state)
  if (upperBefore < UPPER_BONUS_TARGET) {
    const upperAfter = upperBefore + (slot < UPPER_SLOT_COUNT ? gained : 0)
    const gap = Math.max(0, UPPER_BONUS_TARGET - upperAfter)
    v += gap === 0 ? UPPER_BONUS : -gap * UPPER_GAP_WEIGHT
  }

  // 2) 快艇奖励：只有把五同写进快艇格才兑现
  if (state.slots[SLOT_YAHTZEE] === null && slot === SLOT_YAHTZEE && gained >= SLOTS[SLOT_YAHTZEE].max) {
    v += YAHTZEE_BONUS
  }

  // 3) 边际损失
  v -= wasteCost(state, slot)
  return v
}

/** 空缺格里目标函数最高的一格；没有可填的格（或本轮还没掷骰）时返回 -1 */
export function bestSlot(state: State): number {
  if (state.over || state.dice.length !== DIE_COUNT) return -1
  let best = -1
  let bestValue = -Infinity
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    if (state.slots[slot] !== null) continue
    const v = slotValue(state, slot)
    // 严格大于才替换，因此同分时保留序号更小的格，AI 完全可复盘
    if (v > bestValue) {
      bestValue = v
      best = slot
    }
  }
  return best
}

/** 空缺格里最不值得填的一格（「放弃一格」按钮用）；无可填时返回 -1 */
export function worstSlot(state: State): number {
  if (state.over || state.dice.length !== DIE_COUNT) return -1
  let worst = -1
  let worstValue = Infinity
  for (let slot = SLOT_COUNT - 1; slot >= 0; slot--) {
    if (state.slots[slot] !== null) continue
    const v = slotValue(state, slot)
    if (v < worstValue) {
      worstValue = v
      worst = slot
    }
  }
  return worst
}

// ---------------- 状态迁移（纯函数） ----------------

/** 掷骰：第 1 掷掷全部 5 颗，之后只重投未勾选保留的 */
function doRoll(state: State): State {
  if (state.rollsLeft <= 0) return state
  const r = new Rng(state.rng)
  const first = state.dice.length !== DIE_COUNT
  const dice: number[] = []
  for (let i = 0; i < DIE_COUNT; i++) {
    dice.push(first || !state.keep[i] ? rollDie(r) : state.dice[i])
  }
  return {
    ...state,
    dice,
    keep: first ? [false, false, false, false, false] : state.keep.slice(),
    rollsLeft: state.rollsLeft - 1,
    throws: state.throws + 1,
    rng: r.s,
  }
}

/** 勾选 / 取消勾选保留某颗骰子 */
function doToggle(state: State, die: number): State {
  if (!Number.isInteger(die) || die < 0 || die >= DIE_COUNT) return state
  if (state.dice.length !== DIE_COUNT) return state // 本轮还没掷过，没有可保留的骰子
  if (state.rollsLeft <= 0) return state // 投掷机会用完，勾选已无意义
  const keep = state.keep.slice()
  keep[die] = !keep[die]
  return { ...state, keep }
}

/** 把当前骰面写进某一空缺格，然后开新一轮 */
function doFill(state: State, slot: number, abandon: boolean): State {
  if (state.dice.length !== DIE_COUNT) return state // 必须先掷过才能计分
  if (!isSlot(slot)) return state
  if (state.slots[slot] !== null) return state // 每格只能填一次
  const slots = state.slots.slice()
  slots[slot] = abandon ? 0 : scoreFor(slot, state.dice)
  const done = filledCount(slots) >= SLOT_COUNT
  return {
    ...state,
    slots,
    lastSlot: slot,
    over: done,
    // 还有空格才开下一轮；终局保留最后一手骰面便于展示
    dice: done ? state.dice : [],
    keep: done ? state.keep : [false, false, false, false, false],
    round: done ? state.round : state.round + 1,
    rollsLeft: done ? state.rollsLeft : ROLLS_PER_ROUND,
  }
}

/** 纯函数状态迁移：非法 / 终局动作原样返回入参（引用相等） */
export function reduce(state: State, action: Action): State {
  if (state.over) return state
  switch (action.type) {
    case 'roll':
      return doRoll(state)
    case 'toggle':
      return doToggle(state, action.die)
    case 'fill':
      return doFill(state, action.slot, action.abandon === true)
    case 'auto': {
      const slot = bestSlot(state)
      if (slot < 0) return state
      return doFill(state, slot, false)
    }
  }
}
