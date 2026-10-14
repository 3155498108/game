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
}

export default meta
