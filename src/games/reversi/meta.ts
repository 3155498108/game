import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'reversi',
  name: '黑白棋',
  category: 'board',
  tags: ['人机', '策略', '易上手'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '8×8 棋盘，落子必须夹住对方棋子并翻转，黑先白后，按棋子数定胜负，人机对弈。',
}

export default meta