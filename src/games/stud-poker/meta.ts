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
}

export default meta
