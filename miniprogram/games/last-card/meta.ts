import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'last-card',
  name: '最后一张牌',
  category: 'card',
  tags: ['人机', '轮流出牌', '快节奏'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '出牌要比场上最高牌小，或跟它同花色，先出完手牌者胜。',
  howto: [
    '打出的牌必须比场上已出的最高牌小，或者与那张牌同花色。',
    '大小王是万能牌，可以当任意花色、任意点数打出。',
    '先把手牌出完的一方获胜。',
    '轮到你却无牌可出时，按牌堆最上面一张的点数判大小。',
  ],
}

export default meta
