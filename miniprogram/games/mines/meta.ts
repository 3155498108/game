import type { GameMeta } from '../../core/types'

export const meta: GameMeta = {
  id: 'mines',
  name: '扫雷赌局',
  category: 'mini',
  tags: ['扫雷', '赌局', '反应', '点击'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '5×5 雷区任选 3 / 5 / 10 雷，翻一格踩雷输光注额，翻得越多收益倍数越高。',
  howto: [
    '先选 3 / 5 / 10 雷，再点「开始」，本局注额就押在这块雷区上。',
    '逐格翻开：翻到安全格会显示数字，翻到雷则本局直接判负。',
    '格子上的数字是它周围 8 格里的雷数，可以据此推断哪几格是雷。',
    '翻开的格数越多，赔率倍数涨得越快；觉得够本就点「收手」结算。',
    '收益倍数 × 注额就是这一局拿到的金币；踩雷则注额全部输掉。',
  ],
}

export default meta
