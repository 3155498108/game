import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'tank-duel',
  name: '坦克对决',
  category: 'mini',
  tags: ['人机', '推理', '回合'],
  viewport: { width: 720, height: 1280 },
  // 横屏玩法：网格战场是横向铺开的，手机横过来玩更舒服
  orientation: 'landscape',
  players: 'ai',
  summary: '10×8 网格战场，两辆坦克分居两端；每回合在前进 / 转向 / 开火中三选一，先用炮弹打中对方者胜。',
}

export default meta
