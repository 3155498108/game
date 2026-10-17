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
}

export default meta
