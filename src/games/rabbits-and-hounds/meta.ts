import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'rabbits-and-hounds',
  name: '兔子和猎犬',
  category: 'board',
  tags: ['人机', '追逐', '滑行'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '7×9 棋盘，1 只狐狸对 4 兔 + 1 猎犬：只有滑行没有吃子，狐狸滑到左右两侧底线就赢，兔子把它围死就赢。',
  howto: [
    '7×9 棋盘，1 只狐狸对 4 只兔 + 1 只猎犬，你执兔方。',
    '所有棋子都只能沿格线滑行，没有吃子这一步。',
    '狐狸要滑到左右两侧的底线格逃走，兔子要把它围死让它无路可走。',
    '兔子必须靠「挤」来封路：四个方向都被堵住狐狸就走不动了。',
    '任一方达成目标即刻分出胜负。',
  ],
}

export default meta
