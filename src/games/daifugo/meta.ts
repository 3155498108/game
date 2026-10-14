import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'daifugo',
  name: '大富豪',
  category: 'card',
  tags: ['人机', '大牌局', '烧脑'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '两副牌接龙，2 是万能牌，谁先出完谁赢。',
}

export default meta
