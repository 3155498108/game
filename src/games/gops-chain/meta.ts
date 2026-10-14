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
}

export default meta