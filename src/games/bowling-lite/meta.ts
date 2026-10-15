import type { GameMeta } from '../../core/types'

export const meta: GameMeta = {
  id: 'bowling-lite',
  name: '保龄球简化版',
  category: 'arcade',
  tags: ['投球', '碰撞', '十局', '休闲'],
  viewport: { width: 720, height: 1280 },
  orientation: 'landscape',
  players: 1,
  summary: '选角度与力度投球，撞倒三角排列的 10 个瓶，全中额外加分，共十局累计总分。',
}

export default meta
