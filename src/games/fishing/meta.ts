import type { GameMeta } from '../../core/types'

/** 钓鱼 · 浮漂等鱼 · 判断时机收杆 */
export const meta: GameMeta = {
  id: 'fishing',
  name: '钓鱼',
  category: 'arcade',
  tags: ['反应', '时机', '休闲', '单人'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '浮漂沉入水下，鱼群游过。看准浮漂下沉的瞬间收杆，90 秒内钓满最重的鱼。',
  howto: [
    '浮漂会随时间沉入水下，鱼群从画面下方游过。',
    '盯住浮漂刚要下沉的那一刻点画面收杆。',
    '收早了是空杆，收晚了鱼已经游走——只有下沉那一瞬才算命中。',
    '上钩的鱼越重得分越高，大鱼还会明显拖长等待时间。',
    '限时 90 秒，时间到后按总重量结算。',
  ],
}

export default meta
