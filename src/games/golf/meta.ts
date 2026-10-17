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
  howto: [
    '先拖动滑条设定击球方向。',
    '按住画面蓄力，蓄力条越满球飞得越远。',
    '蓄力过头会打厚——球飞得远但落点控制不住。',
    '平地、草地、沙坑、水障碍的摩擦各不相同，同一杆在不同位置结果差很多。',
    '和 AI 逐洞比拼，看谁的总杆数更低。',
  ],
}

export default meta
