import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'memory-sequence',
  name: '猜颜色',
  category: 'mini',
  tags: ['单人', '记忆', '反应'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '记住系统亮起的色块顺序并复现，一轮比一轮长。',
}

export default meta
