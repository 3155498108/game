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
  howto: [
    '从任意一颗球出发按住拖动，连接 4 颗以上同色的球即可消除。',
    '连线不能自交，也不能重复经过同一颗球。',
    '连线拐弯次数越少、连的球越多，分数越高，连击还有额外加成。',
    '盘面无解时会自动洗牌继续。',
    '分数按连球数的平方累加，连击越长加成越猛。',
  ],
}

export default meta
