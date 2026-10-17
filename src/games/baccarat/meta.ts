import type { GameMeta } from '../../core/types'

export const meta: GameMeta = {
  id: 'baccarat',
  name: '百家乐',
  category: 'card',
  tags: ['百家乐', '卡牌', '赌局', '点数'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '8 副牌只比点数：庄 / 闲 / 和三种下注，庄 1:1、闲 1:1、和 8:1。',
  howto: [
    '选「庄 / 闲 / 和」之一下注，点「开始」后牌会一张张发到庄闲两家手里。',
    '点数只保留个位：A 记 1 点，10 / J / Q / K 一律记 10 点。',
    '闲家点数 0~5 要牌，6~9 点停牌。',
    '庄家点数 0~5、7、9 要牌，6 和 8 点停牌。',
    '两家只比个位：同点算「和」，其余大者胜。',
    '押中赔率是庄 1:1、闲 1:1、和 8:1；开和而没押和，本金退还不输不赢。',
  ],
}

export default meta
