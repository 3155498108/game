import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'chinese-checkers',
  name: '中国跳棋',
  category: 'board',
  tags: ['人机', '策略', '连跳'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '星形棋盘上每方 6 颗子：滑一格或跳过敌子连跳，把棋子送进对方底区的中心星格。',
  howto: [
    '星形棋盘，你和电脑各 6 颗棋子，从各自的角区出发。',
    '一步可以滑到相邻空格，也可以跳过一颗相邻棋子落到空格。',
    '连续跳跃可以一步连跳，多跳几次不额外计步。',
    '棋子之间不能重叠，落点必须是空格。',
    '把自己 6 颗棋子全部搬进对面角区的中心星格即获胜。',
  ],
}

export default meta