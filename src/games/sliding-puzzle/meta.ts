import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'sliding-puzzle',
  name: '数字华容道',
  category: 'puzzle',
  tags: ['单人', '益智', '动脑'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '4×4 数字方块，挪动相邻块把数字归位，用最少步数通关。',
  howto: [
    '4×4 数字方块被打乱，空位固定出现在右下角。',
    '点击与空位相邻的方块，它就会滑进空位，空位随之移动。',
    '不能斜着挪，一次只能动一块。',
    '把 1 到 15 按顺序排好、空位回到右下角即通关。',
    '同样布局下步数越少越好，成绩按步数记录。',
  ],
}

export default meta
