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
  howto: [
    '只有同花色且点数相邻的牌才能接上。',
    '大小王是万能牌，既能当任意点数，也能当任意花色。',
    '轮到你时打出能接的牌；场上有能接的牌却不出，这张会被罚进手里。',
    '先把手牌出完的一方获胜。',
  ],
}

export default meta
