import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'memory',
  name: '记忆卡牌',
  category: 'card',
  tags: ['单人', '益智', '消消乐'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '4×4 翻开两张配对，全部配对成功即通关。',
  howto: [
    '4×4 共 16 张牌，全部背面朝上。',
    '每次翻开两张，图案相同就消除，不相同就盖回去。',
    '配成的牌会保持亮着，可以当作后面配对的参考。',
    '记不住全部位置也没关系，多翻几次总会记住。',
    '把 8 对全部配完即通关，翻牌次数越少越省时间。',
  ],
}

export default meta
