import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'memory',
  name: '记忆卡牌',
  category: 'card',
  tags: ['单人', '益智', '消消乐'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '4×4 翻开两张配对，全部配对成功即通关。',
}

export default meta
