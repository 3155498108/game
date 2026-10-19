/**
 * 统一游戏接口定义。
 * 注意：本文件只含类型，不依赖 DOM，可被游戏逻辑与站点壳共同引用。
 */

export type Category = 'card' | 'board' | 'puzzle' | 'arcade' | 'mini'

export const CATEGORY_LABEL: Record<Category, string> = {
  card: '牌类',
  board: '棋类',
  puzzle: '益智',
  arcade: '休闲动作',
  mini: '迷你',
}

export const CATEGORY_ORDER: Category[] = ['card', 'board', 'puzzle', 'mini', 'arcade']

export interface Viewport {
  width: number
  height: number
}

export type Orientation = 'portrait' | 'landscape' | 'both'
export type Players = 1 | 2 | 'ai'

/** 指针输入（已换算为逻辑坐标，即 viewport 坐标系） */
export interface PointerInput {
  kind: 'down' | 'move' | 'up'
  x: number
  y: number
  /** move 事件时是否处于按下状态 */
  pressed: boolean
}

/** 游戏提供给站点壳的 DOM 按钮（放在提示区，天然满足 44px 触控目标） */
export interface Control<A> {
  label: string
  action: A
  disabled?: boolean
  primary?: boolean
}

export type SoundName = 'click' | 'place' | 'flip' | 'score' | 'win' | 'lose' | 'error' | 'hit' | 'tick'

/** 由状态迁移推导出的副作用（声音、粒子），由站点壳执行，reduce 保持纯净 */
export type Effect =
  | { kind: 'sound'; name: SoundName }
  | { kind: 'burst'; x: number; y: number; color?: string; count?: number }
  | { kind: 'flash'; color?: string }
  | { kind: 'shake'; power?: number }

/** 对局结束后的成绩（用于本机最佳纪录） */
export interface Outcome {
  /** 用于比较的数值 */
  score: number
  /** 越大越好 / 越小越好 */
  better: 'higher' | 'lower'
  /** 成绩单位或说明，例如「步」「秒」「分」 */
  unit: string
  /** 是否胜利（仅展示用） */
  win?: boolean
}

/** 列表页所需的元信息（首屏加载，保持轻量） */
export interface GameMeta {
  id: string
  name: string
  category: Category
  tags: string[]
  viewport: Viewport
  orientation: Orientation
  players: Players
  summary: string
  /**
   * 玩法介绍：分步骤的中文说明，游戏页点「玩法」展开。
   *
   * 与 `summary` 的分工：`summary` 是一句话，扛得住首页卡片的窄栏；
   * `howto` 是成篇的「怎么打」，只有真的点开才需要，占的是首屏之外的预算。
   *
   * 写它的几条硬要求：
   * - 每条只讲**一个**动作，不写实现细节（不要出现常量名、坐标、函数名）；
   * - 必须包含**怎么赢 / 怎么结束**，玩家最想知道的是这个；
   * - 3~6 条为宜。太长没人看，太短不算介绍。
   *
   * 可选是刻意的：新增游戏漏写它只是少一段说明，站点不会因此报错；
   * 但 `src/smoke.test.ts` 会把「每款都写了」当成契约盯着。
   */
  howto?: string[]
}

/**
 * 游戏模块。前 4 个函数 + aiAction 为题目规定的统一接口，
 * 其余为可选扩展，均为纯函数（除 render）。
 */
export interface GameModule<S = any, A = any> extends GameMeta {
  create(seed: number): S
  /** 纯函数：不读时间、不读全局随机数、不碰 DOM */
  reduce(state: S, action: A): S
  render(ctx: CanvasRenderingContext2D, state: S): void
  /** 仅 AI 对局需要：轮到 AI 时返回动作，否则返回 null（须快速返回） */
  aiAction?(state: S): A | null

  // ---------- 可选扩展 ----------
  /** 把逻辑坐标的指针事件翻译为 action（纯函数） */
  input?(state: S, p: PointerInput): A | null
  /** 键盘输入（桌面便利），key 为 KeyboardEvent.key */
  key?(state: S, key: string): A | null
  /** 实时游戏：返回时间推进 action，站点壳每帧以 dt(ms) 调用 */
  tick?(dt: number): A
  /** 提示区文字 */
  hint?(state: S): string
  /** 提示区按钮 */
  controls?(state: S): Control<A>[]
  /** 对局结束时返回成绩，未结束返回 null */
  outcome?(state: S): Outcome | null
  /** 从状态迁移中推导副作用 */
  effects?(prev: S, next: S): Effect[]
  /**
   * 金币结算：一局结束时算出**净盈亏**（正 = 赚，负 = 输，0 = 退还）。
   *
   * **默认规则**（不实现本方法时生效）：`outcome.win === true` 赢 `bet`，
   * `=== false` 输 `bet`，`undefined`（平局/无胜负概念）不结算。
   * 只有「得分型」或「赔率特殊」的游戏才需要自己实现——梭哈的老葫芦、
   * 轮盘的红黑、百家乐的和对、以及所有按分数换算的金币游戏。
   *
   * 注：`bet` 是玩家在壳层选定的下注额，实现里必须**原样按倍数换算**，
   * 不要在内部再乘一个固定面值，否则玩家调注额就不起作用了。
   * 另注：结算逻辑住在壳层，`rules.ts` 不得触碰本函数。
   */
  coins?(state: S, outcome: Outcome, bet: number): number
  /** AI 落子前的思考延迟（ms），默认 500；0 表示每帧同步调用（实时游戏） */
  aiDelay?: number
}
