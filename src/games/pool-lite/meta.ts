/**
 * 台球简化版 pool-lite 元信息。
 * 纯数据，无逻辑、无依赖。
 */
import type { GameMeta } from '../../core/types'

export const meta: GameMeta = {
  id: 'pool-lite',
  name: '台球简化版',
  category: 'arcade',
  tags: ['物理碰撞', '圆形刚体', 'AI 对手', '轮流击球'],
  viewport: { width: 720, height: 1280 },
  orientation: 'landscape',
  players: 'ai',
  summary: '圆形刚体碰撞的迷你台球：必须按最小编号顺序进球，玩家与 AI 轮流击球。',
  howto: [
    '圆形刚体碰撞的迷你台球，你和 AI 轮流击球。',
    '拖动球杆蓄力并调整方向，松手完成击球。',
    '必须按球面上编号从小到大的顺序进球。',
    '把球打进指定袋口才算进球，乱打乱撞会先犯规。',
    '目标球全部合法入袋后本局结束。',
  ],
}

export default meta
