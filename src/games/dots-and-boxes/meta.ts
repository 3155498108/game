import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'dots-and-boxes',
  name: '点格棋',
  category: 'board',
  tags: ['人机', '策略', '连吃'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '5×5 点阵围格子：围成一个盒子得 1 分并连走一步，收尾阶段一口气吃光剩下的盒子。',
}

export default meta