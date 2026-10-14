import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'sevens',
  name: '排七',
  category: 'card',
  tags: ['人机', '接龙', '烧脑'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '围绕 7 展开的接龙，谁先打完手牌谁赢。',
}

export default meta
