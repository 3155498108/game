/**
 * 欧式轮盘 roulette —— 列表页元信息。
 * 纯数据，不含任何逻辑。
 */
import type { GameMeta } from '../../core/types'

export const meta: GameMeta = {
  id: 'roulette',
  name: '欧式轮盘',
  category: 'mini',
  tags: ['轮盘', '运气', '单手', '筹码'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '欧式单零轮盘：红黑单双、大小、零注 35:1，十盘一局，考验手气。',
}

export default meta
