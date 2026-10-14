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
}

export default meta