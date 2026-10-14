import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'rush-hour',
  name: '滑块解锁',
  category: 'puzzle',
  tags: ['单人', '益智', '滑块'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '6×6 棋盘上把红色车开到最右侧：按住车沿它自己的方向拖动，不能重叠也不能穿车。',
}

export default meta