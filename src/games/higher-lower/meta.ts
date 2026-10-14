import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'higher-lower',
  name: '比大小',
  category: 'card',
  tags: ['单人', '反应', '一分钟一局'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '翻开一张牌，猜下一张更大还是更小，一路猜到底。',
}

export default meta
