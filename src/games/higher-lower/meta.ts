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
  howto: [
    '开局翻开一张牌当基准，猜下一张比它大还是比它小。',
    '猜对进入下一轮并累计分数，猜错立刻结束。',
    '连对越多分数越高，中途猜错则前面累积的分数作废。',
    'A 最小、K 最大；点数相同算「小」。',
  ],
}

export default meta
