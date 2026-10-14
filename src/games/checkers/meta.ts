import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'checkers',
  name: '西洋跳棋',
  category: 'board',
  tags: ['人机', '策略', '经典棋类'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '8×8 棋盘 12 子对 12 子，斜走一格、跳过敌子连吃、抵达底线升变当王，人机对弈。',
}

export default meta
