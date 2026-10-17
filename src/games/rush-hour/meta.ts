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
  howto: [
    '6×6 棋盘，只有红车需要开到最右侧，其余车辆都是障碍。',
    '按住车沿它自己的方向拖动，一次只能走直线，不能拐弯。',
    '车与车之间不能重叠，也不能穿过任何一辆车。',
    '把红车开到最右端的出口即通关。',
    '共 12 关，每关的最少步数都是解出来的，步数越少越好。',
  ],
}

export default meta