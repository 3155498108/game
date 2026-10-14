import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'link-six',
  name: '6 连珠',
  category: 'puzzle',
  tags: ['单人', '益智', '消除'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '拖动连接 4 个以上同色球即可消除，满盘无解时自动洗牌。',
}

export default meta
