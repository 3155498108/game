/**
 * 游戏注册表。
 *
 * ⚠️ **本文件由 `scripts/sync-miniprogram.mjs` 自动生成，请勿手工编辑。**
 *
 *    要加游戏：把 id 加进 `miniprogram/ported-games.json`，然后跑 `npm run sync:mini`。
 *    手工改这里的话，下一次同步会被覆盖——而且清单与注册表一旦对不上，
 *    要么玩家点不到那款游戏，要么注册表指向不存在的文件直接崩。
 *
 * ## 为什么是生成而不是手写
 *
 * 网页版的注册表用 `import.meta.glob` 自动发现游戏目录，加游戏零改动。
 * 小程序没有这个能力：打包器要求依赖**静态可分析**，`import(变量)` 或运行时
 * 按路径 `require` 都会在真机上直接失败。手工维护 44 款 × 2 行 import 是 88 行噪声。
 *
 * 所以这里用**生成**来达到同一个目的：让「加一款游戏」不需要改站点壳。
 * 区别只是小程序那边用生成代替自动发现。
 */
import type { GameMeta, GameModule } from '../core/types'

import baccaratMeta from '../games/baccarat/meta'
import baccaratGame from '../games/baccarat/index'
import blackjackMeta from '../games/blackjack/meta'
import blackjackGame from '../games/blackjack/index'
import bowlingLiteMeta from '../games/bowling-lite/meta'
import bowlingLiteGame from '../games/bowling-lite/index'
import checkersMeta from '../games/checkers/meta'
import checkersGame from '../games/checkers/index'
import chineseCheckersMeta from '../games/chinese-checkers/meta'
import chineseCheckersGame from '../games/chinese-checkers/index'
import connectFourMeta from '../games/connect-four/meta'
import connectFourGame from '../games/connect-four/index'
import crossXiMeta from '../games/cross-xi/meta'
import crossXiGame from '../games/cross-xi/index'
import daifugoMeta from '../games/daifugo/meta'
import daifugoGame from '../games/daifugo/index'
import dotsAndBoxesMeta from '../games/dots-and-boxes/meta'
import dotsAndBoxesGame from '../games/dots-and-boxes/index'
import fishingMeta from '../games/fishing/meta'
import fishingGame from '../games/fishing/index'
import golfMeta from '../games/golf/meta'
import golfGame from '../games/golf/index'
import gomokuMeta from '../games/gomoku/meta'
import gomokuGame from '../games/gomoku/index'
import gopsMeta from '../games/gops/meta'
import gopsGame from '../games/gops/index'
import gopsChainMeta from '../games/gops-chain/meta'
import gopsChainGame from '../games/gops-chain/index'
import hanafudaPairMeta from '../games/hanafuda-pair/meta'
import hanafudaPairGame from '../games/hanafuda-pair/index'
import higherLowerMeta from '../games/higher-lower/meta'
import higherLowerGame from '../games/higher-lower/index'
import lastCardMeta from '../games/last-card/meta'
import lastCardGame from '../games/last-card/index'
import linkSixMeta from '../games/link-six/meta'
import linkSixGame from '../games/link-six/index'
import mahjongMatchMeta from '../games/mahjong-match/meta'
import mahjongMatchGame from '../games/mahjong-match/index'
import mazeMeta from '../games/maze/meta'
import mazeGame from '../games/maze/index'
import memoryMeta from '../games/memory/meta'
import memoryGame from '../games/memory/index'
import memorySequenceMeta from '../games/memory-sequence/meta'
import memorySequenceGame from '../games/memory-sequence/index'
import minesMeta from '../games/mines/meta'
import minesGame from '../games/mines/index'
import pachinkoMeta from '../games/pachinko/meta'
import pachinkoGame from '../games/pachinko/index'
import pigTailMeta from '../games/pig-tail/meta'
import pigTailGame from '../games/pig-tail/index'
import poolLiteMeta from '../games/pool-lite/meta'
import poolLiteGame from '../games/pool-lite/index'
import rabbitsAndHoundsMeta from '../games/rabbits-and-hounds/meta'
import rabbitsAndHoundsGame from '../games/rabbits-and-hounds/index'
import railCartMeta from '../games/rail-cart/meta'
import railCartGame from '../games/rail-cart/index'
import reversiMeta from '../games/reversi/meta'
import reversiGame from '../games/reversi/index'
import rouletteMeta from '../games/roulette/meta'
import rouletteGame from '../games/roulette/index'
import rushHourMeta from '../games/rush-hour/meta'
import rushHourGame from '../games/rush-hour/index'
import sevensMeta from '../games/sevens/meta'
import sevensGame from '../games/sevens/index'
import slidingPuzzleMeta from '../games/sliding-puzzle/meta'
import slidingPuzzleGame from '../games/sliding-puzzle/index'
import slotMachineMeta from '../games/slot-machine/meta'
import slotMachineGame from '../games/slot-machine/index'
import studPokerMeta from '../games/stud-poker/meta'
import studPokerGame from '../games/stud-poker/index'
import takoyakiMeta from '../games/takoyaki/meta'
import takoyakiGame from '../games/takoyaki/index'
import tankDuelMeta from '../games/tank-duel/meta'
import tankDuelGame from '../games/tank-duel/index'
import targetShootingMeta from '../games/target-shooting/meta'
import targetShootingGame from '../games/target-shooting/index'
import toyBaseballMeta from '../games/toy-baseball/meta'
import toyBaseballGame from '../games/toy-baseball/index'
import toyBoxingMeta from '../games/toy-boxing/meta'
import toyBoxingGame from '../games/toy-boxing/index'
import toyCurlingMeta from '../games/toy-curling/meta'
import toyCurlingGame from '../games/toy-curling/index'
import toyFootballMeta from '../games/toy-football/meta'
import toyFootballGame from '../games/toy-football/index'
import toyTennisMeta from '../games/toy-tennis/meta'
import toyTennisGame from '../games/toy-tennis/index'
import yahtzeeMeta from '../games/yahtzee/meta'
import yahtzeeGame from '../games/yahtzee/index'

type AnyModule = GameModule<any, any>

const MODULES: Record<string, AnyModule> = {
  [baccaratMeta.id]: baccaratGame,
  [blackjackMeta.id]: blackjackGame,
  [bowlingLiteMeta.id]: bowlingLiteGame,
  [checkersMeta.id]: checkersGame,
  [chineseCheckersMeta.id]: chineseCheckersGame,
  [connectFourMeta.id]: connectFourGame,
  [crossXiMeta.id]: crossXiGame,
  [daifugoMeta.id]: daifugoGame,
  [dotsAndBoxesMeta.id]: dotsAndBoxesGame,
  [fishingMeta.id]: fishingGame,
  [golfMeta.id]: golfGame,
  [gomokuMeta.id]: gomokuGame,
  [gopsMeta.id]: gopsGame,
  [gopsChainMeta.id]: gopsChainGame,
  [hanafudaPairMeta.id]: hanafudaPairGame,
  [higherLowerMeta.id]: higherLowerGame,
  [lastCardMeta.id]: lastCardGame,
  [linkSixMeta.id]: linkSixGame,
  [mahjongMatchMeta.id]: mahjongMatchGame,
  [mazeMeta.id]: mazeGame,
  [memoryMeta.id]: memoryGame,
  [memorySequenceMeta.id]: memorySequenceGame,
  [minesMeta.id]: minesGame,
  [pachinkoMeta.id]: pachinkoGame,
  [pigTailMeta.id]: pigTailGame,
  [poolLiteMeta.id]: poolLiteGame,
  [rabbitsAndHoundsMeta.id]: rabbitsAndHoundsGame,
  [railCartMeta.id]: railCartGame,
  [reversiMeta.id]: reversiGame,
  [rouletteMeta.id]: rouletteGame,
  [rushHourMeta.id]: rushHourGame,
  [sevensMeta.id]: sevensGame,
  [slidingPuzzleMeta.id]: slidingPuzzleGame,
  [slotMachineMeta.id]: slotMachineGame,
  [studPokerMeta.id]: studPokerGame,
  [takoyakiMeta.id]: takoyakiGame,
  [tankDuelMeta.id]: tankDuelGame,
  [targetShootingMeta.id]: targetShootingGame,
  [toyBaseballMeta.id]: toyBaseballGame,
  [toyBoxingMeta.id]: toyBoxingGame,
  [toyCurlingMeta.id]: toyCurlingGame,
  [toyFootballMeta.id]: toyFootballGame,
  [toyTennisMeta.id]: toyTennisGame,
  [yahtzeeMeta.id]: yahtzeeGame,
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
