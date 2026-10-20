import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'solitaire',
  name: '纸牌接龙',
  category: 'card',
  tags: ['单人', '纸牌', '经典'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '把 52 张牌理到四个基础堆上，全部归位即通关。',
  howto: [
    '点左上角的牌堆翻一张牌到右边，翻到的牌会叠在弃牌堆上。',
    '点一张摊开的牌再点目标位置就能移动：桌面堆要异色递减，基础堆要同花色从小到大。',
    '桌面堆只能放 K，空的桌面堆也只收 K，K 能带动它下面的一串一起走。',
    '四堆都摆满 13 张就通关；实在走不动了可以点「放弃」结算已完成的张数。',
  ],
}

export default meta
