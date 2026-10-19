import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'gomoku',
  name: '五子棋',
  category: 'board',
  tags: ['人机', '策略', '棋类'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  // 电脑执白后手，玩家执黑先行
  players: 'ai',
  summary: '15×15 棋盘，黑先白后，五子连珠即胜，默认不设禁手。',
  howto: [
    '15×15 棋盘，你执黑先行，电脑执白后手。',
    '点击交叉点落子，横、竖、斜任意方向连成五子即胜。',
    '先连成五子的一方立刻获胜。',
    '棋盘下满仍没人连成五子则判平局。',
  ],
}

export default meta