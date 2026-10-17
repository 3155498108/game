import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'pig-tail',
  name: '猪尾巴',
  category: 'mini',
  tags: ['人机', '记忆', '接龙'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '系统点亮尾巴的一节，你把它的颜色还原出来；答对就长一节，答错就结束。',
  howto: [
    '系统会点亮猪尾巴最前面的一节，你按顺序把它的颜色依次还原出来。',
    '每答对一次，尾巴就长出一节。',
    '颜色记错或反应超时，本局立刻结束。',
    '尾巴长得越长分数越高，能到多少节就是最终成绩。',
  ],
}

export default meta
