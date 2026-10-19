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
 */
const HAND_WRITTEN = new Set(['miniprogram/render/audio.ts'])

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

  for (const id of games) {
    const from = join(SRC, 'games', id)
    if (!existsSync(from)) throw new Error(`清单里的游戏在 src/games 下不存在：${id}`)
    for (const name of listTs(from)) {
      files.push({ from: join(from, name), to: join(MINI, 'games', id, name) })
    }
  }

  return files
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

// 孤儿检查：miniprogram/{core,render,games} 下不该有计划外的文件
const planned = new Set(files.map((f) => rel(f.to)))
const orphans = []
for (const dir of ['core', 'render', 'games']) {
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
  if (changed.length === 0 && orphans.length === 0) {
    console.log(`[sync] 共享层无漂移（${files.length} 个文件）`)
    process.exit(0)
  }
  console.error('[sync] 共享层有漂移：')
  for (const f of changed) console.error(`  差异  ${rel(f.to)}`)
  for (const o of orphans) console.error(`  多余  ${o}`)
  console.error('\n修复：node scripts/sync-miniprogram.mjs')
  process.exit(1)
}

// 写入
for (const f of changed) {
  mkdirSync(dirname(f.to), { recursive: true })
  writeFileSync(f.to, readFileSync(f.from))
  console.log(`  同步  ${rel(f.to)}`)
}
for (const o of orphans) {
  // 双保险：删除是不可逆的，宁可漏删也不能误删
  if (HAND_WRITTEN.has(o)) continue
  if (!/^miniprogram\/(core|render|games)\//.test(o)) {
    console.error(`  [跳过] ${o}：不在受管目录内`)
    continue
  }
  const p = join(ROOT, o)
  rmSync(p, { force: true })
  console.log(`  删除  ${o}`)
}

console.log(`[sync] 完成：${files.length} 个文件，${changed.length} 个有变化，${orphans.length} 个多余已删除`)
