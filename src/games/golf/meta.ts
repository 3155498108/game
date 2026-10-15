import type { GameMeta } from '../../core/types'

/** 高尔夫球：列表页元信息。同时提供具名与默认导出，壳用具名 meta。 */
export const meta: GameMeta = {
  id: 'golf',
  name: '高尔夫球',
  category: 'arcade',
  tags: ['点击蓄力', '方向滑条', '地形摩擦', '对战 AI', '计总杆'],
  viewport: { width: 720, height: 1280 },
  orientation: 'landscape',
  players: 'ai',
  summary: '按住蓄力、松开击球，方向由滑条控制；平地、草地、沙坑、水障碍摩擦各异，和 AI 逐洞比拼总杆数。',
}

export default meta
