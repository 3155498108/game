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
 * 清单与 `miniprogram/ported-games.json` 必须一致，这条一致性由
 * `src/miniprogram-sync.test.ts` 盯着：加游戏时改了清单忘了注册（或反之），
 * 测试会直接变红——玩家点不到的游戏和注册表里指向不存在文件的条目，都是静默故障。
 *
 * 目前试点 10 款，全部进主包，体积可以忽略。
 */
import type { GameMeta, GameModule } from '../core/types'

import blackjackMeta from '../games/blackjack/meta'
import blackjackGame from '../games/blackjack/index'
import connectFourMeta from '../games/connect-four/meta'
import connectFourGame from '../games/connect-four/index'
import golfMeta from '../games/golf/meta'
import golfGame from '../games/golf/index'
import higherLowerMeta from '../games/higher-lower/meta'
import higherLowerGame from '../games/higher-lower/index'
import mazeMeta from '../games/maze/meta'
import mazeGame from '../games/maze/index'
import memoryMeta from '../games/memory/meta'
import memoryGame from '../games/memory/index'
import pachinkoMeta from '../games/pachinko/meta'
import pachinkoGame from '../games/pachinko/index'
import rabbitsMeta from '../games/rabbits-and-hounds/meta'
import rabbitsGame from '../games/rabbits-and-hounds/index'
import boxingMeta from '../games/toy-boxing/meta'
import boxingGame from '../games/toy-boxing/index'
import tennisMeta from '../games/toy-tennis/meta'
import tennisGame from '../games/toy-tennis/index'

type AnyModule = GameModule<any, any>

const MODULES: Record<string, AnyModule> = {
  [blackjackMeta.id]: blackjackGame,
  [connectFourMeta.id]: connectFourGame,
  [golfMeta.id]: golfGame,
  [higherLowerMeta.id]: higherLowerGame,
  [mazeMeta.id]: mazeGame,
  [memoryMeta.id]: memoryGame,
  [pachinkoMeta.id]: pachinkoGame,
  [rabbitsMeta.id]: rabbitsGame,
  [boxingMeta.id]: boxingGame,
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
