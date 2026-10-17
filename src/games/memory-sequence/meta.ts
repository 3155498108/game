import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'memory-sequence',
  name: '猜颜色',
  category: 'mini',
  tags: ['单人', '记忆', '反应'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '记住系统亮起的色块顺序并复现，一轮比一轮长。',
  howto: [
    '系统会依次亮起若干色块，看完就轮到你复现。',
    '按刚才亮起的顺序依次点击色块，顺序和数量都要对。',
    '全部点对才算过关，点错则本局立刻结束。',
    '每过一关序列就长一格，能撑到多少关就是最终成绩。',
  ],
}

export default meta
