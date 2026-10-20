import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'snake',
  name: '贪吃蛇',
  category: 'arcade',
  tags: ['单人', '街机', '反应'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '操控一条越吃越长的蛇去吃红果子，撞墙或咬到自己就结束。',
  howto: [
    '用方向键或屏幕下方的方向按钮改变蛇的前进方向。',
    '每吃到一颗红色食物，蛇身就变长一节，得分增加十分。',
    '蛇会一直向前爬，撞到墙壁或咬到自己的身体本局就结束。',
    '蛇越长爬得越快，把整块棋盘填满就是满分通关。',
  ],
}

export default meta
