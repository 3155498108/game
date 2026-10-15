/** 玩具足球 · 元信息（壳用具名导出 meta） */
import type { GameMeta } from '../../core/types'

export const meta: GameMeta = {
  id: 'toy-football',
  name: '玩具足球',
  category: 'arcade',
  tags: ['足球', '手势', '反应', '十脚挑战'],
  viewport: { width: 720, height: 1280 },
  orientation: 'landscape',
  players: 1,
  summary: '拖动滑条设定力度与角度，点按出脚，十脚之内看你能踢进几个球。',
}

export default meta
