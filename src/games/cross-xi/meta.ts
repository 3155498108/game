import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'cross-xi',
  name: '英国十字戏',
  category: 'board',
  tags: ['人机', '挤棋', '策略'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '十字形棋盘上的挤棋：沿直线滑动，遇子就推，把对方棋子挤进你自己的底线格即胜。',
  howto: [
    '十字形棋盘，双方各自守一条底线，目标是把对方的棋子挤过自己的底线。',
    '棋子只能沿直线滑动到空格，不能拐弯。',
    '滑到相邻有棋子的位置时可以推动它，一次只能推动一颗。',
    '把对方的棋子全部挤出棋盘（越过你的底线）即获胜。',
  ],
}

export default meta
