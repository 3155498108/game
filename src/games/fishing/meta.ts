import type { GameMeta } from '../../core/types'

/** 钓鱼 · 浮漂等鱼 · 判断时机收杆 */
export const meta: GameMeta = {
  id: 'fishing',
  name: '钓鱼',
  category: 'arcade',
  tags: ['反应', '时机', '休闲', '单人'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '浮漂沉入水下，鱼群游过。看准浮漂下沉的瞬间收杆，90 秒内钓满最重的鱼。',
}

export default meta
