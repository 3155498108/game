/**
 * 玩具拳击 —— 元信息（首屏列表用，保持轻量，不引入任何逻辑代码）
 */
import type { GameMeta } from '../../core/types'

export const meta: GameMeta = {
  id: 'toy-boxing',
  name: '玩具拳击',
  category: 'arcade',
  tags: ['两段式出拳', '时机窗口', '连击加成', 'AI 对手'],
  viewport: { width: 720, height: 1280 },
  orientation: 'landscape',
  players: 'ai',
  summary: '直拳、摆拳、勾拳三种出拳方向各有不同的伤害与出拳时间：先选方向，再在时机窗口里出拳，连击越叠越重，把玩具熊打到体力归零。',
  howto: [
    '每回合先从直拳、摆拳、勾拳里选一种出拳方向。',
    '选定后会出现出拳时机窗口，在窗口内点画面才能打中。',
    '早了或晚了都挥空，对手趁机回击。',
    '三种拳的伤害和出拳时间各不相同。',
    '连续命中会叠连击，层数越高单次伤害越重。',
    '把玩具熊的体力打到 0 就获胜。',
  ],
}

export default meta
