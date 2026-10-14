import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'hanafuda-pair',
  name: '花牌',
  category: 'card',
  tags: ['单人', '记忆', '和风'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '48 张花札里抽出 8 种，4×4 翻开配对，全部配完即通关。',
}

export default meta
