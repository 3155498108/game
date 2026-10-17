import type { GameMeta } from '../../core/types'

export const meta: GameMeta = {
  id: 'baccarat',
  name: '百家乐',
  category: 'card',
  tags: ['百家乐', '卡牌', '赌局', '点数'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '8 副牌只比点数：庄 / 闲 / 和三种下注，庄 1:1、闲 1:1、和 8:1。',
}

export default meta
