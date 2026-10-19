/**
 * 猪尾巴（记忆接龙）规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * 玩法：一条有 N 节的猪尾巴，每节一个颜色。系统（AI，出题方）从尾巴里挑一节，
 * 把该节的颜色记下来当答案；玩家在那一节被卷起遮住之后，从色板里把颜色还原出来。
 *   还原正确 → 尾巴加长一节（随机新色），进入下一题
 *   还原错误 → 立即结束
 * 尾巴长到 MAX_TAIL 即通关。
 *
 * 回合分五个阶段，逐级推进：
 *   ask 出题（AI 挑节）→ show 展示（点亮该节，玩家记色）→ input 输入（该节被卷起，
 *   玩家还原）→ settle 结算（尾巴 +1）→ 回到 ask 出下一题；答错走 over，答满走 won。
 *
 * 两处明确的取舍：
 * 1) 展示阶段刻意给足记忆时间，但**计时不进 reduce**：亮灯与呼吸由 index.ts 的 render
 *    读 render/anim.ts 旁路现算，阶段只由显式 action 推进，因此本文件不读时间、
 *    不读全局随机，reduce 可复盘。
 * 2) 「还原」的判定对象是**被问的那一节**而不是尾巴上任意一节：颜色对但位置错同样算错，
 *    否则玩家只要扫一眼尾巴就能猜中，记忆就失去意义。
 */
import { Rng } from '../../core/rng'

/** 开局尾巴节数 */
export const START_TAIL = 3
/** 尾巴最长节数：达到即通关，同时也是尾巴能画下的上限 */
export const MAX_TAIL = 13
/** 开局颜色数 */
export const START_COLORS = 3
/** 颜色数上限，与 render/draw 的 PALETTE 长度一致 */
export const MAX_COLORS = 8
/** 每答对多少回合多出一种颜色 */
export const COLOR_STEP = 2

/** 回合阶段：出题 → 展示 → 输入 → 结算 → 出下一题；over / won 为终局 */
export type Phase = 'ask' | 'show' | 'input' | 'settle' | 'over' | 'won'

export interface State {
  phase: Phase
  /** 尾巴各节的颜色，取值 0 .. colorCount-1 */
  tail: number[]
  /** 本题被问到的那一节下标 */
  quizIndex: number
  /** 本题的标准答案：被问到那一节当时的颜色 */
  quizColor: number
  /** 本回合色板上的颜色数，随回合增长 */
  colorCount: number
  /** 已答对的回合数（= 尾巴长出的节数） */
  round: number
  /** 玩家最近一次选择的颜色，-1 表示无 */
  lastPick: number
  /** 玩家最近一次是否选错 */
  lastWrong: boolean
  rng: number
}

export type Action =
  /** 出题阶段 / 展示阶段：确认，推进到下一个阶段 */
  | { type: 'ready' }
  /** 输入阶段：玩家从色板里选一个颜色 */
  | { type: 'pick'; color: number }
  /** 结算阶段：进入下一题 */
  | { type: 'next' }

/**
 * 难度曲线：答对得越多，色板上的颜色越多。
 * round 是已答对回合数，故开局为 START_COLORS，封顶 MAX_COLORS。
 */
export function colorCountFor(round: number): number {
  return Math.min(MAX_COLORS, START_COLORS + Math.floor(Math.max(0, round) / COLOR_STEP))
}

/** 颜色取值是否落在当前回合的色板范围内 */
export function isValidColor(state: State, color: number): boolean {
  return Number.isInteger(color) && color >= 0 && color < state.colorCount
}

/** 本题的正确答案（渲染与测试读这一份） */
export function expected(state: State): number {
  return state.quizColor
}

/** 随机生成一节尾巴的颜色 */
function newSegment(r: Rng, colorCount: number): number {
  return r.int(colorCount)
}

/**
 * 出题：在尾巴里挑一节。
 * 尽量不重复问刚问过的那一节（连问同一节几乎等于送分），随机仍全部来自 Rng，可复盘。
 */
function askQuestion(tail: readonly number[], r: Rng, avoid: number): { index: number; color: number } {
  let index = r.int(tail.length)
  if (index === avoid && tail.length > 1) index = (index + 1 + r.int(tail.length - 1)) % tail.length
  return { index, color: tail[index] }
}

export function create(seed: number): State {
  const r = new Rng(seed | 0)
  const colorCount = colorCountFor(0)
  const tail: number[] = []
  for (let i = 0; i < START_TAIL; i++) tail.push(newSegment(r, colorCount))
  const q = askQuestion(tail, r, -1)
  return {
    phase: 'ask',
    tail,
    quizIndex: q.index,
    quizColor: q.color,
    colorCount,
    round: 0,
    lastPick: -1,
    lastWrong: false,
    rng: r.s,
  }
}

/** 纯函数状态迁移 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'ready': {
      // 出题 → 展示 → 输入；其余阶段重复提交都是空操作（返回同一对象）
      if (state.phase === 'ask') return { ...state, phase: 'show' }
      if (state.phase === 'show') return { ...state, phase: 'input' }
      return state
    }

    case 'pick': {
      // 只有输入阶段才接受还原
      if (state.phase !== 'input') return state
      if (!isValidColor(state, action.color)) return state

      // 还原失败：立即结束，尾巴停在当前长度
      if (action.color !== state.quizColor) {
        return { ...state, phase: 'over', lastPick: action.color, lastWrong: true }
      }

      const round = state.round + 1
      // 新长出来的一节用「本回合」的色板取色，保证 tail 里每一节都 < colorCount
      const r = new Rng(state.rng)
      const tail = state.tail.concat(newSegment(r, state.colorCount))

      // 长到上限即通关
      if (tail.length >= MAX_TAIL) {
        return {
          ...state,
          phase: 'won',
          tail,
          quizIndex: tail.length - 1,
          quizColor: tail[tail.length - 1],
          colorCount: colorCountFor(round),
          round,
          lastPick: action.color,
          lastWrong: false,
          rng: r.s,
        }
      }

      // 答对：结算阶段展示新长出来的那一节（旧的题目索引仍然有效，尾巴只在尾部增长）
      return {
        ...state,
        phase: 'settle',
        tail,
        colorCount: colorCountFor(round),
        round,
        lastPick: action.color,
        lastWrong: false,
        rng: r.s,
      }
    }

    case 'next': {
      // 只有结算阶段能出下一题；上一题的下标用于避免重复问同一节
      if (state.phase !== 'settle') return state
      const r = new Rng(state.rng)
      const q = askQuestion(state.tail, r, state.quizIndex)
      return {
        ...state,
        phase: 'ask',
        quizIndex: q.index,
        quizColor: q.color,
        lastPick: -1,
        lastWrong: false,
        rng: r.s,
      }
    }
  }
}

/** 便捷别名：确认（出题 / 展示阶段推进） */
export function ready(state: State): State {
  return reduce(state, { type: 'ready' })
}

/** 便捷别名：还原颜色 */
export function pick(state: State, color: number): State {
  return reduce(state, { type: 'pick', color })
}

/** 便捷别名：进入下一题 */
export function next(state: State): State {
  return reduce(state, { type: 'next' })
}
