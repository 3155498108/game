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
}

export default meta
