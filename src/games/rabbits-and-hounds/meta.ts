import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'rabbits-and-hounds',
  name: '狐犬棋',
  category: 'board',
  tags: ['人机', '追逐', '围堵'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary:
    '经典 Hare & Hounds：矛尖形 27 点棋盘，3 只猎犬围 1 只兔子。你执猎犬且先手 —— 把兔子逼得无路可走就算你赢。',
  howto: [
    '矛尖形棋盘共 27 个点：中间三行 7 列，最上和最下两行只有中间 3 列。',
    '你执三只猎犬，电脑执一只兔子，猎犬先走。',
    '棋子每次只走到相邻一格，横、竖、斜都算，没有滑行也没有吃子。',
    '猎犬不能后退，只能前进、斜着前进或左右横移。',
    '把兔子逼得无路可走你就赢；它从你犬阵的左后方绕出去它赢。',
    '猎犬连着横移十次算磨洋工，直接判兔子胜。',
  ],
}

export default meta
