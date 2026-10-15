import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'rail-cart',
  name: '轨道车',
  category: 'mini',
  tags: ['单人', '街机', '躲避'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '轨道车自动前进，左右换道躲障碍、吃金币，速度越来越快。',
}

export default meta
