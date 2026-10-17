/**
 * 欧式轮盘 roulette —— 列表页元信息。
 * 纯数据，不含任何逻辑。
 */
import type { GameMeta } from '../../core/types'

export const meta: GameMeta = {
  id: 'roulette',
  name: '欧式轮盘',
  category: 'mini',
  tags: ['轮盘', '运气', '单手', '筹码'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '欧式单零轮盘：红黑单双、大小、零注 35:1，十盘一局，考验手气。',
  howto: [
    '在盘面上选一种玩法下注：红黑、单双、大小，或直接押 0。',
    '每种注可以叠多个注码来分散风险。',
    '点「转」之后轮盘旋转停下，落点决定这一注的输赢。',
    '红黑单双都是 1:1，押 0 是 35:1——赢面小但赔率高。',
    '每局打十盘，十盘结束后按总盈亏结算。',
  ],
}

export default meta
