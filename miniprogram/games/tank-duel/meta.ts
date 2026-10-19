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
  howto: [
    '10×8 网格战场，你的坦克和电脑的坦克分居两端。',
    '每回合在「前进 / 转向 / 开火」里三选一，轮流行动。',
    '开火沿当前朝向直射，炮弹会一路飞到撞墙为止。',
    '先被炮弹打中的那一方输。',
    '回合数用尽还没分胜负，就按两车之间剩余的格数裁决，格子少的一方胜。',
  ],
}

export default meta
