/** 射靶 · 列表页元信息 */
import type { GameMeta } from '../../core/types'

export const meta: GameMeta = {
  id: 'target-shooting',
  name: '射靶',
  category: 'arcade',
  tags: ['射击', '反应', '限时', '单人'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '60 秒限时射靶：靶子随机出现、越到后半场停留越短，命中越靠靶心分数越高，结束后结算命中率。',
  howto: [
    '60 秒限时，靶子会随机在场上出现并停留一小会儿。',
    '点中靶子得分，命中越靠靶心分值越高。',
    '后半场靶子停留时间更短，留给瞄准的窗口更小。',
    '打空的子弹不扣分，所以可以放心多打。',
    '时间到后按总环数结算，并统计命中率。',
  ],
}

export default meta
