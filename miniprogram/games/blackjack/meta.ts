import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'blackjack',
  name: '二十一点',
  category: 'card',
  tags: ['人机', '经典', '一局一分钟'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 'ai',
  summary: '经典二十一点，和庄家比点数，别爆掉 21 点。',
  howto: [
    '每轮给你和庄家各发两张牌，目标是凑到接近 21 点但不超过。',
    'A 可以算 1 点或 11 点，10 / J / Q / K 都算 10 点。',
    '要牌还是停牌由你点按钮决定；庄家固定在 16 点以下要牌、17 点以上停牌。',
    '你的点数比庄家大且没爆牌就赢，双方同点算和局不输不赢。',
    '正好凑到 21 点算「黑杰克」，按更高赔率结算；超过 21 点立刻判负。',
  ],
}

export default meta
