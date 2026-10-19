import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'rabbits-and-hounds',
  name: '狐犬棋',
  category: 'board',
  tags: ['人机', '追逐', '围堵', '可选边'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary:
    '经典 Hare & Hounds 的直走版：矛尖形 27 点棋盘，三只猎犬围一只兔子，只走横竖相邻一格。开局可选执犬（较难）或执兔（较易）。',
  howto: [
    '开局选边：执三只猎犬较难，执一只兔子较易，猎犬永远先走。',
    '棋子一次只走到横竖相邻的一格，不能斜着走，也没有跳子和吃子。',
    '猎犬不能后退，只能前进或左右横移；兔子四面都能走。',
    '你执兔子时，跑到犬阵左后方的绿区就算你赢。',
    '你执猎犬时，把兔子逼得无路可走就算你赢。',
    '猎犬连着横移十步不往前推，就算磨洋工，兔子直接赢。',
  ],
}

export default meta
