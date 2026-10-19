import type { GameMeta } from '../../core/types'

export const meta: GameMeta = {
  id: 'stud-poker',
  name: '梭哈',
  category: 'card',
  tags: ['扑克', '比牌型', '换牌', 'AI 对手'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '简化梭哈：两人各五张全亮牌，可弃牌、可换 1~3 张牌再与电脑比牌型，豹子通杀。',
  howto: [
    '你和电脑各拿 5 张牌，双方全部明牌摊在桌上。',
    '点手牌可以选中要换掉的牌，一次最多选 3 张，换牌机会有限。',
    '选好后点「换牌」，也可以直接「停牌比牌」或者「弃牌」。',
    '弃牌立刻判负；停牌后电脑也会决定换牌还是跟牌。',
    '牌型大小依次是同花顺、四条、葫芦、同花、顺子、三条。',
    '再往下是两对、一对、散牌；四条以上叫豹子，拿双倍注。',
  ],
}

export default meta
