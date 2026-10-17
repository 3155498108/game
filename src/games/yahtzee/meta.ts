import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'yahtzee',
  name: '快艇骰子',
  category: 'card',
  tags: ['单人', '骰子', '策略'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '5 颗骰子 13 个计分格，每轮三掷，逼近满分 375。',
  howto: [
    '5 颗骰子，每轮最多掷三次，每次掷完把骰子分配到右侧的计分格。',
    '点数、顺子、同花、全对等组合各占一个格子，每个格子只能用一次。',
    '同一个结果不能重复占两格，比如「五颗同点」和「总和 20」只能二选一。',
    '13 个格子全部填满即结束，总分逼近满分 375 就算是高手。',
  ],
}

export default meta
