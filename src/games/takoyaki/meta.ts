import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'takoyaki',
  name: '章鱼烧',
  category: 'puzzle',
  tags: ['单人', '益智', '消除'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '点列落下小球，填满一整行即消除，堆到顶部结束。',
  howto: [
    '先在顶部左右滑动选择一列，点一下落下一颗小球。',
    '某一行被 4 颗以上同色小球填满时会自动消除。',
    '一次落子同时消掉多行会触发连击，加成分数。',
    '小球堆到顶部、放不下新球时结束。',
  ],
}

export default meta