import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'mahjong-match',
  name: '麻将对对消',
  category: 'puzzle',
  tags: ['单人', '益智', '消除'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '翻两张能连通的麻将牌即可消除，三关牌阵由 8 张递增到 24 张。',
}

export default meta