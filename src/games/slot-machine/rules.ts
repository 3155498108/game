/**
 * 三轴老虎机的纯规则层：赔付表、赔付判定、定步状态机。
 *
 * 约束：
 * - 不引入 DOM、不读 `Date` / `performance`、不碰全局随机数；
 * - 所有随机一律来自 `Rng`（游标存在 `state.rng`，种子来自 `create(seed)`）；
 * - `reduce` 是纯函数：不修改入参，同输入必得同输出。
 */
import { Rng, hashSeed } from '../../core/rng'

// ------------------------------------------------------------------ 规格常量

export const VW = 720
export const VH = 1280

/** 定步时长（秒）。index.ts 把真实 dt(ms) 折算成整数步数交给这里。 */
export const DT = 0.07
/** 一场对局共打多少局，打满即终局。 */
export const ROUNDS = 10

export const COLS = 3
/** 每列可见的行数（3×3 转轴） */
export const ROWS = 3

/** 三列各自停稳的定步序号（右列最晚，形成依次停下的节奏）；渲染层据此排滚动动画窗口 */
export const REEL_STOP_TICK = [4, 7, 10] as const
/** 走到这一步即判定赔付 */
export const SETTLE_TICK = 16

// ------------------------------------------------------------------ 符号与赔付表

/** 转轴上的 6 种符号，按赔率从低到高排列；数组下标即符号编号 */
export const SYMBOLS = ['cherry', 'bell', 'star', 'diamond', 'seven', 'crown'] as const
export type SymbolId = (typeof SYMBOLS)[number]
export const SYMBOL_COUNT = SYMBOLS.length
/** 与 SYMBOLS 同序的数组形式，渲染层按下标取符号时更顺手 */
export const SYMBOL_IDS: readonly SymbolId[] = SYMBOLS

/** 符号编号（0..5）→ 符号名 */
export function symbolOf(index: number): SymbolId {
  return SYMBOLS[((index % SYMBOL_COUNT) + SYMBOL_COUNT) % SYMBOL_COUNT]
}

/**
 * 赔付唯一数据源（单位：**注额倍数**，不是金币）。
 * 判定逻辑（`evaluate`）与测试断言全部从这张表推导，规则代码里不出现散落的赔率常量。
 *
 * 三连按符号分六档，相邻档至少翻倍：普通三连（樱桃/铃铛）与顶级三连（皇冠）相差 23 倍。
 */
export const TRIPLE_PAY: Readonly<Record<SymbolId, number>> = {
  cherry: 2,
  bell: 4,
  star: 8,
  diamond: 16,
  seven: 28,
  crown: 46,
}

/** 任意两轴同图（不含三连）的小额赔付 */
export const PAIR_PAY = 1

/** 全部组合数 6³ = 216 */
export const OUTCOMES_TOTAL = SYMBOL_COUNT ** COLS
/** 三连组合数：每个符号 1 种 */
export const TRIPLE_OUTCOMES = SYMBOL_COUNT
/** 恰好两连组合数：选相邻位 3 种 × 符号 6 种 × 另一个符号 5 种 = 90 */
export const PAIR_OUTCOMES = COLS * SYMBOL_COUNT * (SYMBOL_COUNT - 1)
/** 三连赔率之和 */
export const TRIPLE_PAY_SUM = SYMBOLS.reduce((n, s) => n + TRIPLE_PAY[s], 0)

/** 理论期望回报率 =（三连赔率总和 + 两连组合数×两连赔率）/ 组合总数 */
export const THEORETIC_RTP = (TRIPLE_PAY_SUM + PAIR_OUTCOMES * PAIR_PAY) / OUTCOMES_TOTAL

// ------------------------------------------------------------------ 判定

export type ComboKind = 'triple' | 'pair' | 'none'

export interface Combo {
  kind: ComboKind
  /** 中中的符号；空奖为 null */
  symbol: SymbolId | null
  /** 赔付倍数（单位：注额倍），恒为非负整数 */
  pay: number
  /** 命中的列下标，供渲染高亮 */
  cols: number[]
}

/** 构造一个新的空奖结果（每次都返回新对象，state 里不留共享可变对象） */
export function emptyCombo(): Combo {
  return { kind: 'none', symbol: null, pay: 0, cols: [] }
}

/**
 * 按赔付表判定三列结果。
 * - 三轴同图 → 三连档赔率
 * - 任意两轴同图 → 两连小额
 * - 三轴全不同 → 空奖
 * 赔付额只依赖 `PAY_TABLE`，不写死在分支里。
 */
export function evaluate(reels: readonly number[]): Combo {
  const a = symbolOf(reels[0])
  const b = symbolOf(reels[1])
  const c = symbolOf(reels[2])
  if (a === b && b === c) {
    return { kind: 'triple', symbol: a, pay: TRIPLE_PAY[a], cols: [0, 1, 2] }
  }
  if (a === b) return { kind: 'pair', symbol: a, pay: PAIR_PAY, cols: [0, 1] }
  if (b === c) return { kind: 'pair', symbol: b, pay: PAIR_PAY, cols: [1, 2] }
  if (a === c) return { kind: 'pair', symbol: a, pay: PAIR_PAY, cols: [0, 2] }
  return emptyCombo()
}

// ------------------------------------------------------------------ 状态机

export type Phase = 'ready' | 'spinning' | 'over'

export interface State {
  /** 随机游标（mulberry32 状态），唯一随机来源 */
  rng: number
  phase: Phase
  /** 已结算的局数 */
  round: number
  /** 本局已走的定步数 */
  spinTicks: number
  /** 本局三列最终落定的符号编号（spinning 期间是结果，画面滚动走 anim 旁路） */
  reels: number[]
  /** 上一局的判定结果 */
  combo: Combo
  /** 累计净盈亏，单位是「注额倍」 */
  net: number
  /** 拉杆计数，用作 anim 旁路的签名，让每次拉杆都触发新的滚动动画 */
  spin: number
}

export type Action =
  /** 拉杆：扣 1 注额并摇出三列结果 */
  | { type: 'pull' }
  /** 定步推进，由 index.ts 从真实 dt 折算而来 */
  | { type: 'step'; n: number }
  /** 跳过剩余动画，立刻结算（仅 spinning 有效） */
  | { type: 'skip' }
  /** 终局后重开一场，沿用当前随机游标 */
  | { type: 'restart' }

/** 初始状态：种子打散进 rng，同种子必得同一开局 */
export function create(seed: number): State {
  return {
    rng: hashSeed(seed),
    phase: 'ready',
    round: 0,
    spinTicks: 0,
    reels: [0, 0, 0],
    combo: emptyCombo(),
    net: 0,
    spin: 0,
  }
}

/** 结算：判定赔付、入账、推进局数，打满 ROUNDS 进入终局 */
function settle(s: State): State {
  const combo = evaluate(s.reels)
  const round = s.round + 1
  const net = s.net + combo.pay
  return {
    ...s,
    phase: round >= ROUNDS ? 'over' : 'ready',
    round,
    combo,
    net,
  }
}

/** 纯函数状态迁移；任何非法动作都原样返回入参（引用相同） */
export function reduce(s: State, action: Action): State {
  switch (action.type) {
    case 'pull': {
      if (s.phase !== 'ready') return s
      const r = new Rng(s.rng)
      // 三列各自独立、等概率摇出
      const reels = [r.int(SYMBOL_COUNT), r.int(SYMBOL_COUNT), r.int(SYMBOL_COUNT)]
      // 摇杆瞬间即扣注，net 先掉 1 注，停稳后再补赔付
      return { ...s, rng: r.s, phase: 'spinning', spinTicks: 0, reels, net: s.net - 1, spin: s.spin + 1 }
    }
    case 'step': {
      if (s.phase !== 'spinning') return s
      const n = Math.max(0, Math.floor(action.n))
      if (n === 0) return s
      const t = s.spinTicks + n
      if (t < SETTLE_TICK) return { ...s, spinTicks: t }
      return settle({ ...s, spinTicks: t })
    }
    case 'skip': {
      if (s.phase !== 'spinning') return s
      return settle(s)
    }
    case 'restart': {
      // 重开沿用当前随机游标（不是同一个开局），但计分与局数清零
      return {
        rng: s.rng,
        phase: 'ready',
        round: 0,
        spinTicks: 0,
        reels: [0, 0, 0],
        combo: emptyCombo(),
        net: 0,
        spin: s.spin + 1,
      }
    }
    default:
      return s
  }
}
