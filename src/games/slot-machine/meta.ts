import type { GameMeta } from '../../core/types'

/**
 * 三轴老虎机的元信息。
 * 视口固定 720×1280 竖屏，同时提供具名导出与默认导出，供站点壳两种引用方式使用。
 */
export const meta: GameMeta = {
  id: 'slot-machine',
  name: '三轴老虎机',
  category: 'arcade',
  tags: ['老虎机', '随机', '金币', '竖屏', '赔率表'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '三列转轴依次停下：三连按符号分档高赔，任意两连小额赔付，全表公开、期望回报率约 90%。',
  howto: [
    '点「拉杆开转」，三列转轴会依次停下，中奖看中间那条横线。',
    '三列出现同一个图案算三连，按图案从 ×2 到 ×46 赔付。',
    '图案越稀有赔得越多；任意两列相同赔 ×1。',
    '三列都不同则空奖，输掉这一注。',
    '赔付 = 倍数 × 注额，注额可以在底部切换。',
    '每场打十局，满十局自动结算本场总盈亏。',
  ],
}

export default meta
