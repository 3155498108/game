/**
 * 玩具棒球 · 列表页元信息。
 * 站点壳用具名导出 meta 读取 id / 分类 / 视口；游戏模块用默认导出 meta 展开。
 */
import type { GameMeta } from '../../core/types'

export const meta: GameMeta = {
  id: 'toy-baseball',
  name: '玩具棒球',
  category: 'arcade',
  tags: ['点击', '时机', '反应', '单球决胜'],
  viewport: { width: 720, height: 1280 },
  orientation: 'landscape',
  players: 1,
  summary: '十球之内盯住击球区出现的判定窗口点击挥棒，时机越准打得越远。',
  howto: [
    '球进入击球区时，会出现一小段判定窗口。',
    '在窗口内点画面挥棒，打得越准球飞得越远。',
    '早半拍或晚半拍都会挥空，白白浪费一球。',
    '挥出的距离越远得分越高。',
    '全程十球机会，用完即结束。',
  ],
}

export default meta
