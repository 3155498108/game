import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'whack-a-mole',
  name: '打地鼠',
  category: 'arcade',
  tags: ['单人', '反应', '限时'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '六十秒限时敲地鼠，敲中一只得十分，敲得越准分越高。',
  howto: [
    '地鼠会从九个洞里探头，在洞里待一会儿就缩回去。',
    '看到地鼠就点它所在的洞，敲中一只加十分。',
    '敲空的洞记一次失误，不扣分但会拉低命中率。',
    '六十秒倒计时走完本局就结束，敲中只数越多分越高。',
  ],
}

export default meta
