import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'dots-and-boxes',
  name: '点格棋',
  category: 'board',
  tags: ['人机', '策略', '连吃'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '5×5 点阵围格子：围成一个盒子得 1 分并连走一步，收尾阶段一口气吃光剩下的盒子。',
  howto: [
    '5×5 点阵围出 4×4 共 16 个格子，你和 AI 轮流围。',
    '每回合在两个相邻的点之间画一条线，凑齐四条边就围出一个盒子。',
    '围出盒子得 1 分，并且获得一次「继续画」的额外机会。',
    '所有格子分完后，最后围到格子的一方会再吃掉所有剩余格子。',
    '得分高的一方获胜。',
  ],
}

export default meta