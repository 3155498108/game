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
}

export default meta
