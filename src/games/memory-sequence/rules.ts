/**
 * 猜颜色（记忆序列）规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 关键取舍：亮灯播放的计时**不进 reduce**。reduce 只推进「阶段」与玩家答对的步数，
 * 播放节奏由 index.ts 的 render 读 render/anim.ts 现算，因此本文件不读时间、不用全局随机。
 */
import { Rng } from '../../core/rng'

/** 色块数量：取 PALETTE 前 4 个颜色 */
export const COLOR_COUNT = 4
/** 通关上限：完成第 MAX_ROUND 轮即通关，此时序列长度也是 MAX_ROUND */
export const MAX_ROUND = 8

/** show = 系统播放序列；input = 玩家复现；over = 答错结束；won = 全部通关 */
export type Phase = 'show' | 'input' | 'over' | 'won'

export interface State {
  phase: Phase
  /** 本轮需要复现的颜色序列，元素取值 0 .. COLOR_COUNT-1 */
  sequence: number[]
  /** 当前轮次，从 1 开始；第 r 轮序列长度为 r */
  round: number
  /** 本轮已答对的步数 */
  step: number
  /** 最近一次点击的色块，-1 表示无 */
  lastPick: number
  /** 最近一次点击是否点错 */
  lastWrong: boolean
  /** 累计答对次数（跨轮累计，仅用于展示） */
  hits: number
  rng: number
}

export type Action =
  /** 展示阶段结束，交还给玩家：show → input */
  | { type: 'ready' }
  /** 玩家点击某个色块 */
  | { type: 'pick'; color: number }

/** 颜色取值是否合法 */
export function isValidColor(color: number): boolean {
  return Number.isInteger(color) && color >= 0 && color < COLOR_COUNT
}

/** 本轮玩家下一个应该点的颜色（渲染与测试都读这一份） */
export function expected(state: State): number {
  return state.sequence[state.step]
}

/** 本轮还剩几个没点 */
export function remaining(state: State): number {
  return state.sequence.length - state.step
}

export function create(seed: number): State {
  const r = new Rng(seed)
  return {
    phase: 'show',
    sequence: [r.int(COLOR_COUNT)],
    round: 1,
    step: 0,
    lastPick: -1,
    lastWrong: false,
    hits: 0,
    rng: r.s,
  }
}

/**
 * 追加一个新颜色。尽量避免与上一个重复（Simon 式手感更连贯），
 * 随机仍全部来自 Rng，因此可复盘。
 */
function extend(sequence: readonly number[], r: Rng): number[] {
  const last = sequence[sequence.length - 1]
  let c = r.int(COLOR_COUNT)
  if (c === last) c = (c + 1 + r.int(COLOR_COUNT - 1)) % COLOR_COUNT
  return sequence.concat(c)
}

/** 纯函数状态迁移 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'ready': {
      // 只有展示阶段才接受；重复提交是空操作（返回同一对象）
      if (state.phase !== 'show') return state
      return { ...state, phase: 'input', step: 0, lastPick: -1, lastWrong: false }
    }

    case 'pick': {
      // 展示 / 结束 / 通关阶段一律不响应玩家点击
      if (state.phase !== 'input') return state
      const color = action.color
      if (!isValidColor(color)) return state

      // 点错：立即结束，展示到达的轮次
      if (color !== state.sequence[state.step]) {
        return { ...state, phase: 'over', lastPick: color, lastWrong: true }
      }

      const hits = state.hits + 1

      // 本轮还没点完
      if (state.step + 1 < state.sequence.length) {
        return { ...state, step: state.step + 1, lastPick: color, lastWrong: false, hits }
      }

      // 最后一轮已答完 → 通关
      if (state.round >= MAX_ROUND) {
        return { ...state, phase: 'won', step: 0, lastPick: color, lastWrong: false, hits }
      }

      // 进入下一轮：序列追加一个新颜色，回到展示阶段
      const r = new Rng(state.rng)
      return {
        ...state,
        phase: 'show',
        sequence: extend(state.sequence, r),
        round: state.round + 1,
        step: 0,
        lastPick: color,
        lastWrong: false,
        hits,
        rng: r.s,
      }
    }
  }
}

/** 便捷别名：点色块 */
export function pick(state: State, color: number): State {
  return reduce(state, { type: 'pick', color })
}

/** 便捷别名：展示结束、交还给玩家 */
export function ready(state: State): State {
  return reduce(state, { type: 'ready' })
}
