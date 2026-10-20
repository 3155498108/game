#!/usr/bin/env node
/**
 * 同步共享层：src/ → miniprogram/
 *
 * ## 为什么要有这个脚本
 *
 * 小程序打包器只认 `miniprogramRoot` 下的文件，所以 `src/games/<id>/` 到小程序那一份
 * **永远是「复制」**。复制会带来漂移：
 *
 *   在 src/games/maze/rules.ts 修了一个 bug，忘了同步 miniprogram/games/maze/rules.ts。
 *   小程序于是继续跑旧代码，而且**没有任何报错**——两边测试各自都绿。
 *
 * 这个脚本把「复制」变成一条命令，把「忘了」变成一条报错：
 *
 *   node scripts/sync-miniprogram.mjs           # 复制
 *   node scripts/sync-miniprogram.mjs --check   # 只校验漂移，有差异退出码 1
 *
 * 更强的门禁在 `src/miniprogram-sync.test.ts`：那是一条 Vitest 用例，跑 `npm test`
 * 就会自动执行，覆盖面比本脚本的 --check 更广（多文件孤儿检查、清单与注册表一致性、
 * 相对 import 可解析性、浏览器 API 扫描）。**那条用例才是权威。**
 *
 * ## 复制范围
 *
 *   src/core/*.ts              → miniprogram/core/          全部
 *   src/render/*.ts            → miniprogram/render/        除 audio.ts 外全部
 *   src/games/<已移植>/*.ts    → miniprogram/games/<id>/    只复制清单里的游戏
 *   src/shell/{coins,daily}.ts → miniprogram/shell/         壳层里与平台无关的两份
 *   移植清单                   → miniprogram/shell/registry.ts  **生成**
 *
 * ## 三个刻意的不对称
 *
 * 1. `render/audio.ts` **不复制**：网页版用 WebAudio 振荡器，小程序用震动反馈，
 *    是两份不同的实现。保留小程序自己那份，脚本永远不碰它。
 * 2. `*.test.ts` **不复制**：测试属于网页版那套 Vitest，小程序有自己的冒烟测试。
 * 3. 游戏**只复制清单里列出的**：没验证过的游戏不该进小程序包。
 *
 * 复制是**逐字节**的，不做任何改写。共享层与网页版保持零差异，
 * 这样「两版要不要分仓库」这个决定随时可以反悔。
 *
 * ### 为什么 `shell/coins.ts` 与 `shell/daily.ts` 也能共享
 *
 * 壳层里的大部分是平台专属的（DOM ↔ WXML、localStorage ↔ wx），
 * 但**钱包/结算/签到**与**每日挑战**这两份不是：它们只 import `../core/*`
 * 与 `./storage`，而两端的 `shell/storage.ts` 暴露的是**同一套 API**
 * （逻辑都在 `core/storage.ts`，壳层只注入后端）。
 *
 * 所以它们可以逐字节共享。这条很值钱——**钱包那条链路上出的每一次改动
 * （结算公式、签到判定、余额夹取）两端同时生效，不可能再漂移**。
 * 共享层之外的代码不受这个机制保护，所以共享范围要尽量往里收。
 *
 * ## 注册表为什么是生成的
 *
 * 网页版的注册表用 `import.meta.glob` 自动发现游戏目录——加游戏零改动。
 * 小程序没有这个能力：打包器要求依赖**静态可分析**，写成 `import(变量)` 或
 * 运行时按路径 `require` 都会在真机上直接失败。
 *
 * 手工维护 44 款 × 2 行 import 是 88 行噪声，而且**清单和注册表会漂移**
 * （改了清单忘了注册，玩家就点不到那款游戏；或者注册了不存在的 id，直接崩）。
 *
 * 所以注册表**由清单生成**。这与网页版的 `import.meta.glob` 是同一个目的：
 * **让「加一款游戏」不需要改站点壳**。区别只是小程序那边用生成代替自动发现。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const MINI = join(ROOT, 'miniprogram')

/**
 * 不参与复制、也**绝不会被删除**的文件。
 * 注意：这里的路径必须相对**仓库根**（与 rel() 输出一致），
 * 早先写成相对 miniprogram/ 的 'render/audio.ts'，结果孤儿检查把手写的那份当成了多余文件删掉。
 *
 * `shell/` 下这三个是**手写**的：它们承载平台差异（DOM ↔ WXML、localStorage ↔ wx），
 * 没法共享。`shell/registry.ts` 是生成物，登记在 planned 里而不是这里。
 */
const HAND_WRITTEN = new Set([
  'miniprogram/render/audio.ts',
  'miniprogram/shell/storage.ts',
  'miniprogram/shell/runtime.ts',
  'miniprogram/shell/perf.ts',
])

const CHECK_ONLY = process.argv.includes('--check')

function readManifest() {
  const file = join(MINI, 'ported-games.json')
  if (!existsSync(file)) throw new Error(`缺少移植清单：${file}`)
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(raw.games)) throw new Error('ported-games.json 缺少 games 数组')
  return raw.games
}

function listTs(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
}

/** id → 合法标识符片段：rabbits-and-hounds → rabbitsAndHounds */
function camel(id) {
  return id.replace(/[-_]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '')
}

/** 算出「该复制哪些文件」：返回 [{ from, to }] */
function plan(games) {
  const files = []

  for (const name of listTs(join(SRC, 'core'))) {
    files.push({ from: join(SRC, 'core', name), to: join(MINI, 'core', name) })
  }

  for (const name of listTs(join(SRC, 'render'))) {
    if (name === 'audio.ts') continue // 平台专属，小程序自己那份
    files.push({ from: join(SRC, 'render', name), to: join(MINI, 'render', name) })
  }

  // 壳层里与平台无关的两份：钱包/结算/签到、每日挑战。
  // 它们只依赖 `../core/*` 与 `./storage`，两端的 storage 暴露同一套 API。
  for (const name of ['coins.ts', 'daily.ts']) {
    files.push({ from: join(SRC, 'shell', name), to: join(MINI, 'shell', name) })
  }

  for (const id of games) {
    const from = join(SRC, 'games', id)
    if (!existsSync(from)) throw new Error(`清单里的游戏在 src/games 下不存在：${id}`)
    for (const name of listTs(from)) {
      files.push({ from: join(from, name), to: join(MINI, 'games', id, name) })
    }
  }

  return files
}

/** 生成注册表源码。清单是唯一真相源，这里是它在小程序侧的静态展开。 */
function renderRegistry(games) {
  const sorted = [...games].sort()
  const names = new Map()
  for (const id of sorted) {
    const base = camel(id)
    if (!base) throw new Error(`游戏 id 非法：${id}`)
    if (names.has(base)) {
      throw new Error(`游戏 id 撞名：${id} 与 ${names.get(base)} 都变成了标识符 ${base}`)
    }
    names.set(base, id)
  }

  const imports = sorted
    .map((id) => {
      const b = camel(id)
      return `import ${b}Meta from '../games/${id}/meta'\nimport ${b}Game from '../games/${id}/index'`
    })
    .join('\n')

  const entries = sorted.map((id) => `  [${camel(id)}Meta.id]: ${camel(id)}Game,`).join('\n')

  return `/**
 * 游戏注册表。
 *
 * ⚠️ **本文件由 \`scripts/sync-miniprogram.mjs\` 自动生成，请勿手工编辑。**
 *
 *    要加游戏：把 id 加进 \`miniprogram/ported-games.json\`，然后跑 \`npm run sync:mini\`。
 *    手工改这里的话，下一次同步会被覆盖——而且清单与注册表一旦对不上，
 *    要么玩家点不到那款游戏，要么注册表指向不存在的文件直接崩。
 *
 * ## 为什么是生成而不是手写
 *
 * 网页版的注册表用 \`import.meta.glob\` 自动发现游戏目录，加游戏零改动。
 * 小程序没有这个能力：打包器要求依赖**静态可分析**，\`import(变量)\` 或运行时
 * 按路径 \`require\` 都会在真机上直接失败。手工维护 44 款 × 2 行 import 是 88 行噪声。
 *
 * 所以这里用**生成**来达到同一个目的：让「加一款游戏」不需要改站点壳。
 * 区别只是小程序那边用生成代替自动发现。
 */
import type { GameMeta, GameModule } from '../core/types'

${imports}

type AnyModule = GameModule<any, any>

const MODULES: Record<string, AnyModule> = {
${entries}
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
  if (!m) throw new Error(\`未找到游戏：\${id}\`)
  return m
}
`
}

function sameBytes(a, b) {
  if (!existsSync(a) || !existsSync(b)) return false
  const x = readFileSync(a)
  const y = readFileSync(b)
  return x.length === y.length && x.equals(y)
}

function rel(p) {
  return p.slice(ROOT.length + 1).split('\\').join('/')
}

const games = readManifest()
const files = plan(games)

const changed = []
for (const f of files) {
  if (!sameBytes(f.from, f.to)) changed.push(f)
}

// 注册表：生成物，同样参与漂移检查
const registryPath = join(MINI, 'shell', 'registry.ts')
const registryContent = renderRegistry(games)
const registryChanged = !existsSync(registryPath) || readFileSync(registryPath, 'utf8') !== registryContent

// 孤儿检查：miniprogram/{core,render,games,shell} 下不该有计划外的文件
// （`shell/` 也纳入：那边的手写文件会进小程序包，留个没人认领的旧文件进去是悄悄的体积损失）
const planned = new Set(files.map((f) => rel(f.to)))
planned.add(rel(registryPath)) // 注册表是生成物，也在计划内
const orphans = []
for (const dir of ['core', 'render', 'games', 'shell']) {
  const base = join(MINI, dir)
  if (!existsSync(base)) continue
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name)
      if (entry.isDirectory()) walk(p)
      else {
        const r = rel(p)
        if (!planned.has(r) && !HAND_WRITTEN.has(r)) orphans.push(r)
      }
    }
  }
  walk(base)
}

if (CHECK_ONLY) {
  const problems = []
  for (const f of changed) problems.push(`  差异  ${rel(f.to)}`)
  for (const o of orphans) problems.push(`  多余  ${o}`)
  if (registryChanged) problems.push('  差异  miniprogram/shell/registry.ts（注册表与移植清单不同步）')
  if (problems.length === 0) {
    console.log(`[sync] 共享层无漂移（${files.length} 个文件 + 1 份生成注册表）`)
    process.exit(0)
  }
  console.error('[sync] 共享层有漂移：')
  for (const p of problems) console.error(p)
  console.error('\n修复：node scripts/sync-miniprogram.mjs')
  process.exit(1)
}

// 写入
for (const f of changed) {
  mkdirSync(dirname(f.to), { recursive: true })
  writeFileSync(f.to, readFileSync(f.from))
  console.log(`  同步  ${rel(f.to)}`)
}
if (registryChanged) {
  writeFileSync(registryPath, registryContent)
  console.log('  生成  miniprogram/shell/registry.ts')
}
for (const o of orphans) {
  // 双保险：删除是不可逆的，宁可漏删也不能误删
  if (HAND_WRITTEN.has(o)) continue
  if (!/^miniprogram\/(core|render|games|shell)\//.test(o)) {
    console.error(`  [跳过] ${o}：不在受管目录内`)
    continue
  }
  const p = join(ROOT, o)
  rmSync(p, { force: true })
  console.log(`  删除  ${o}`)
}

console.log(
  `[sync] 完成：${files.length} 个文件，${changed.length} 个有变化，${orphans.length} 个多余已删除，注册表${registryChanged ? '已重新生成' : '无变化'}`,
)
