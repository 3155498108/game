import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'sliding-puzzle',
  name: '数字华容道',
  category: 'puzzle',
  tags: ['单人', '益智', '动脑'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '4×4 数字方块，挪动相邻块把数字归位，用最少步数通关。',
}

export default meta
