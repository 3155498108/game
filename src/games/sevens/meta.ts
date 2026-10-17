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
  howto: [
    '牌局围绕数字 7 展开：可以接 6、7、8，也可以接 7 的倍数。',
    '每人开局发 3 张牌，轮流出牌接龙。',
    '2 是万能牌，可以代表任何数字来接。',
    '先把手牌出完的人获胜。',
  ],
}

export default meta
