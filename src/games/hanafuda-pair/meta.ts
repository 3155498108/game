import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'hanafuda-pair',
  name: '花牌',
  category: 'card',
  tags: ['单人', '记忆', '和风'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '48 张花札里抽出 8 种，4×4 翻开配对，全部配完即通关。',
  howto: [
    '48 张花札里随机抽出 8 种图案，每种图案各有一对，共 16 张牌。',
    '每次翻开两张：图案相同就消除，不相同就盖回去。',
    '刚配成的牌会保持亮着，可以当作后面配对的参考。',
    '8 对全部配完即通关；牌翻完了还没配完就算失败。',
  ],
}

export default meta
