import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'takoyaki',
  name: '章鱼烧',
  category: 'puzzle',
  tags: ['单人', '益智', '消除'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '点列落下小球，填满一整行即消除，堆到顶部结束。',
}

export default meta