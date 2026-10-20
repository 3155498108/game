import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'merge-2048',
  name: '数字合成',
  category: 'puzzle',
  tags: ['单人', '益智', '合成'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '滑动棋盘把相同数字并成双倍，目标是合成 2048。',
  howto: [
    '向四个方向滑动棋盘，把相同数字的方块并到一起。',
    '两个相同的数字并成一个双倍的数字，并分得对应的分数。',
    '每滑动一次都会在空位冒出一个新方块，数字 2 更常见。',
    '合成出 2048 就算通关，之后还能继续玩，棋盘塞满又无法合并时本局结束。',
  ],
}

export default meta
