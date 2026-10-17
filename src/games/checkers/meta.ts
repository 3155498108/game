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
  howto: [
    '8×8 棋盘，双方各 12 颗棋子，从自己那侧的四排出发。',
    '棋子只能斜着走一格；跳过相邻敌子时可以连续跳吃。',
    '走到对方底线那一排的棋子升变成王，之后可以横竖自由走。',
    '棋子被吃光、或者无子可走的一方判负。',
  ],
}

export default meta
