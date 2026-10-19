import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'maze',
  name: '随机迷宫',
  category: 'puzzle',
  tags: ['单人', '益智', '闯关', '随机'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '每关都现生成一张新迷宫，从左上角走到右下角的终点，步数不能超上限。',
  howto: [
    '每一关都会随机生成一张新迷宫，墙的布局每次都不一样。',
    '从左上角的圆点出发，走到右下角闪烁的终点就算过关。',
    '只能上下左右一格一格走，不能穿墙，也不能斜着走。',
    '每关的步数有上限，超出上限这一局就结束。',
    '走错可以撤销一步，撤销不额外计步，提示每关只能用一次。',
    '连续过关越多成绩越高，成绩就是本局通关的关数。',
  ],
}

export default meta
