import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'daifugo',
  name: '大富豪',
  category: 'card',
  tags: ['人机', '大牌局', '烧脑'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '两副牌接龙，2 是万能牌，谁先出完谁赢。',
  howto: [
    '两副共 108 张牌，其中 2 是万能牌，可以当任意点数使用。',
    '轮到你时打出与上家同花色且更大的牌；实在接不上就过。',
    '接龙必须接：场上有能接的牌却不出，这张牌会被罚进你的手里。',
    '先把手牌出完的一方获胜。',
  ],
}

export default meta
