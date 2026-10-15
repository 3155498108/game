/**
 * 玩具冰壶 · 元信息（首屏加载，保持轻量）
 * 壳用具名导出 meta，本目录 index.ts 用默认导出。
 */
import type { GameMeta } from '../../core/types'

export const meta: GameMeta = {
  id: 'toy-curling',
  name: '玩具冰壶',
  category: 'arcade',
  tags: ['物理碰撞', '蓄力', '对战AI', '多轮计分'],
  viewport: { width: 720, height: 1280 },
  orientation: 'landscape',
  players: 'ai',
  summary: '顶部视角冰道：按住蓄力、左右调向，松手出壶。冰壶互相碰撞传递动量，停在圆心越近分越高，多轮累计与 AI 决胜负。',
}

export default meta
