import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'gops',
  name: '接龙',
  category: 'card',
  tags: ['人机', '接龙', '经典'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '同花色相邻才能接，大小王当万能牌，先出完者胜。',
}

export default meta
