import type { GameMeta } from '../../core/types'

export const meta: GameMeta = {
  id: 'mines',
  name: '扫雷赌局',
  category: 'mini',
  tags: ['扫雷', '赌局', '反应', '点击'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '5×5 雷区任选 3 / 5 / 10 雷，翻一格踩雷输光注额，翻得越多收益倍数越高。',
}

export default meta
