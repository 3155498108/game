import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'connect-four',
  name: '四子棋',
  category: 'board',
  tags: ['人机', '策略', '一分钟一局'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '7 列 6 行棋盘，横竖斜任意方向连成四子即胜，人机对弈。',
}

export default meta