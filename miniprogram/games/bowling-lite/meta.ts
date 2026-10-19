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
  howto: [
    '先用滑条选好投球角度。',
    '再按住画面蓄力选择力度，松手把球掷出。',
    '球沿选定方向滚出，撞倒三角排列的 10 个瓶。',
    '十瓶一次全倒是「全中」，除基本分外还有额外加分。',
    '共十局，按标准保龄球规则累计总分，满分 300。',
  ],
}

export default meta
