/**
 * 游戏注册表。
 *
 * **这是与网页版唯一一处「结构性」差异**，原因是工具链而不是设计：
 *
 * 网页版用 `import.meta.glob` 自动发现游戏目录，新增游戏零改动。
 * 小程序没有 Vite，打包器要求依赖**静态可分析**——写成 `import(变量)` 或
 * 运行时按路径 `require` 都会在真机上直接失败。所以这里只能手写 import 清单。
 *
 * 代价与出路：
 * - 代价：加游戏要回来加两行（meta + index）。
 * - 出路：等游戏多到主包装不下时（2MB 上限），把这些 import 拆进**分包**，
 *   由分包异步化在运行时按需加载——那才是小程序版的「按需加载」等价物。
 *
 * 目前试点只有 4 款，全部进主包，体积可以忽略。
 */
import type { GameMeta, GameModule } from '../core/types'

import mazeMeta from '../games/maze/meta'
import mazeGame from '../games/maze/index'
import memoryMeta from '../games/memory/meta'
import memoryGame from '../games/memory/index'
import rabbitsMeta from '../games/rabbits-and-hounds/meta'
import rabbitsGame from '../games/rabbits-and-hounds/index'
import tennisMeta from '../games/toy-tennis/meta'
import tennisGame from '../games/toy-tennis/index'

type AnyModule = GameModule<any, any>

const MODULES: Record<string, AnyModule> = {
  [mazeMeta.id]: mazeGame,
  [memoryMeta.id]: memoryGame,
  [rabbitsMeta.id]: rabbitsGame,
  [tennisMeta.id]: tennisGame,
}

export const GAMES: GameMeta[] = Object.keys(MODULES)
  .map((id) => MODULES[id])
  .map((g) => {
    const m = g as unknown as GameMeta
    return {
      id: m.id,
      name: m.name,
      category: m.category,
      tags: m.tags,
      viewport: m.viewport,
      orientation: m.orientation,
      players: m.players,
      summary: m.summary,
      howto: m.howto,
    }
  })
  .sort((a, b) => (a.id < b.id ? -1 : 1))

export function findMeta(id: string): GameMeta | undefined {
  return GAMES.find((g) => g.id === id)
}

/** 小程序里所有游戏都已打进包，没有异步加载这一步 */
export function loadGame(id: string): AnyModule {
  const m = MODULES[id]
  if (!m) throw new Error(`未找到游戏：${id}`)
  return m
}
