import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'sudoku',
  name: '数独',
  category: 'puzzle',
  tags: ['单人', '益智', '逻辑'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '在 9×9 格里填入 1~9，每行每列每宫都不重复。',
  howto: [
    '点一个格子把它选中，选中的格子会亮起边框。',
    '点下方的数字把它填进选中的格子。',
    '再点一次同样的数字可以清空这个格子。',
    '打开笔记模式后点数字，会把候选数字记在格子的角落。',
    '所有空格都填对就算通关，用的提示越少分越高。',
  ],
}

export default meta
