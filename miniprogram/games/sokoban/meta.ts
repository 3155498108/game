import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'sokoban',
  name: '推箱子',
  category: 'puzzle',
  tags: ['单人', '逻辑', '经典'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '把箱子推到目标点上，一关比一关难。',
  howto: [
    '点身边相邻的格子就能朝那个方向走一步，撞上箱子会把箱子一起推走。',
    '把每个箱子都推到圆形目标点上，这一关就通了。',
    '推错了不要紧，「撤销」可以一步步退回来，「重开」直接重开本关。',
    '走不动了可以点「提示」，它会按最短解法告诉你下一步往哪走。',
  ],
}

export default meta
