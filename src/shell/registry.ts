/**
 * 游戏注册表：自动发现 src/games/<id>/ 目录。
 * - meta.ts 在首屏同步加载（只含几行元信息）
 * - index.ts 通过动态 import() 按需加载
 * 新增游戏只需新建目录，无需修改站点壳代码。
 */
import type { GameMeta, GameModule } from '../core/types'

const metaModules = import.meta.glob<GameMeta>('../games/*/meta.ts', { eager: true, import: 'meta' })
const loaders = import.meta.glob<GameModule>('../games/*/index.ts', { import: 'default' })

function dirOf(path: string): string {
  const m = /games\/([^/]+)\//.exec(path)
  return m ? m[1] : path
}

const loaderById = new Map<string, () => Promise<GameModule>>()
for (const [path, load] of Object.entries(loaders)) loaderById.set(dirOf(path), load)

export const GAMES: GameMeta[] = Object.entries(metaModules)
  .map(([path, meta]) => {
    if (meta.id !== dirOf(path)) console.warn(`[registry] 目录名 ${dirOf(path)} 与 id ${meta.id} 不一致`)
    return meta
  })
  .filter((m) => loaderById.has(m.id))

export function findMeta(id: string): GameMeta | undefined {
  return GAMES.find((g) => g.id === id)
}

export async function loadGame(id: string): Promise<GameModule> {
  const load = loaderById.get(id)
  if (!load) throw new Error(`未找到游戏：${id}`)
  return load()
}
