import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'gops-chain',
  name: '连环新接龙',
  category: 'card',
  tags: ['人机', '接龙', '完整接龙', '悔牌'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '同花色只能往大接、能接必须接完，一轮结束指定花色起手，支持提示与悔牌。',
  howto: [
    '一轮之内只能出比上家更大、且同花色的牌，不能跨着接。',
    '一轮结束时指定一种花色起手，只有该花色的牌能开局。',
    '点数不够时可以用 2 或大小王当万能牌顶上去。',
    '一轮里把手牌出完就直接获胜；出不完则这一轮结束时手牌最少的玩家得分。',
    '点「提示」会告诉你现在该出什么，点「悔棋」可以退回上一步。',
  ],
}

export default meta