/**
 * 玩具网球 · 元信息（列表页与站点壳共用）
 * 同时提供具名导出与默认导出：壳用具名 meta，index.ts 用默认导出。
 */
import type { GameMeta } from '../../core/types'

export const meta: GameMeta = {
  id: 'toy-tennis',
  name: '玩具网球',
  category: 'arcade',
  tags: ['对战', '反应', 'AI'],
  viewport: { width: 720, height: 1280 },
  orientation: 'landscape',
  players: 'ai',
  summary: '上下两个场地斜线对拉，球速逐回合递增，先得 7 分者获胜。',
}

export default meta
