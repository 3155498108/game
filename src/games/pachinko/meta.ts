/**
 * 弹戏 pachinko —— 元信息（列表页首屏加载，保持轻量）
 */
import type { GameMeta } from '../../core/types'

export const meta: GameMeta = {
  id: 'pachinko',
  name: '弹戏',
  category: 'mini',
  tags: ['弹珠', '钉阵', '挡板', '技巧'],
  viewport: { width: 720, height: 1280 },
  orientation: 'landscape',
  players: 1,
  summary: '顶部投放弹珠，穿过钉阵落入底部分值区；左右挡板可调角度，限定弹珠数量。',
}

export default meta
