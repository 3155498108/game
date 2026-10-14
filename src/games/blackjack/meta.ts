import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'blackjack',
  name: '二十一点',
  category: 'card',
  tags: ['人机', '经典', '一局一分钟'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '经典二十一点，和庄家比点数，别爆掉 21 点。',
}

export default meta
