import type { GameMeta } from '../../core/types'

// 注册表用 import.meta.glob(..., { import: 'meta' }) 同步收集，因此必须具名导出 meta
export const meta: GameMeta = {
  id: 'rail-cart',
  name: '轨道车',
  category: 'mini',
  tags: ['单人', '街机', '躲避'],
  viewport: { width: 720, height: 1280 },
  orientation: 'portrait',
  players: 1,
  summary: '轨道车自动前进，左右换道躲障碍、吃金币，速度越来越快。',
  howto: [
    '轨道车会自动向前开，你唯一能做的是左右换道。',
    '换道有冷却时间，狂点没用，得提前判断。',
    '吃金币加分，撞上障碍直接结束。',
    '速度会一轮比一轮快，坚持的时间越久分数越高。',
    '跑得越远累计分数越高，是一款纯考反应的街机游戏。',
  ],
}

export default meta
