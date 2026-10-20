#!/usr/bin/env node
/**
 * 小程序主包体检。
 *
 * ## 为什么要有这个
 *
 * 「44 款游戏全在主包里，放得下吗」这句话，此前一直是个**估算**
 * （源码 1.19 MB × 37.7% minify 压缩比 ≈ 449 KB，占 2 MB 上限的 22%）。
 *
 * 估算的问题不是不准，而是**会过期**：
 * 以后每加一款游戏、每改一处共享层，估算的输入就变了，
 * 而没人会重算——直到某天上传时被微信拒了。
 *
 * 所以这里直接量**真实的主包内容**：
 * 按 `project.config.json` 的 `packOptions.ignore` 规则算出真正会进包的文件，
 * 逐个统计体积，并核对 44 款游戏是不是都在里面。
 *
 * ## 它量的是什么、不是什么
 *
 * - **量的是**：源码原始字节数（`.ts` / `.wxml` / `.wxss` / `.json` 原样相加）。
 *   这是**上界**——微信开发者工具会先编译成 JS 再 minify，真实包更小。
 * - **估的是**：编译压缩后的体积，用一个固定比例换算。比例来自实测，
 *   但**换游戏类型、换工具链版本都会变**，所以只作参考，不作判据。
 * - **判的是**：2 MB 上限。微信限制的是**编译后**的包，所以源码体积
 *   超过 2 MB 不一定意味着发不上去，但接近了就该警惕。
 *
 * 用法：`npm run pack:check`
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MINI = join(ROOT, 'miniprogram')

/** 微信主包上限 2 MB */
const LIMIT = 2 * 1024 * 1024

/** 实测的压缩比（TS → JS + minify）。只作参考，见文件头的说明 */
const COMPRESS_RATIO = 0.377

const pc = JSON.parse(readFileSync(join(MINI, 'project.config.json'), 'utf8'))
const ignore = pc.packOptions?.ignore ?? []

/** ignore 规则：{type:'folder'|'file', value:string}，路径相对 miniprogram 根 */
function ignored(relPath, isDir) {
  for (const rule of ignore) {
    if (rule.type === 'folder' && isDir && relPath === rule.value) return true
    if (rule.type === 'file' && !isDir && relPath === rule.value) return true
    if (rule.type === 'folder' && !isDir && relPath.startsWith(`${rule.value}/`)) return true
  }
  return false
}

/** 走一遍目录，返回「会进包的文件」与「被排除的项」 */
function walk(dir, base = '') {
  const kept = []
  const dropped = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(dir, entry.name)
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (ignored(rel, entry.isDirectory())) {
      // 整个目录被排除时只记一条，不再往下走——否则会把里面的文件也列一遍
      dropped.push(entry.isDirectory() ? `${rel}/` : rel)
      continue
    }
    if (entry.isDirectory()) {
      const [k, d] = walk(abs, rel)
      kept.push(...k)
      dropped.push(...d)
    } else {
      kept.push([rel, statSync(abs).size])
    }
  }
  return [kept, dropped]
}

if (!existsSync(MINI)) {
  console.error(`找不到小程序目录：${MINI}`)
  process.exit(1)
}

const [files, dropped] = walk(MINI)
const total = files.reduce((s, [, size]) => s + size, 0)
const byExt = new Map()
for (const [rel, size] of files) {
  const ext = rel.slice(rel.lastIndexOf('.'))
  byExt.set(ext, (byExt.get(ext) ?? 0) + size)
}

const manifest = JSON.parse(readFileSync(join(MINI, 'ported-games.json'), 'utf8'))
const games = manifest.games ?? []
const missing = games.filter((id) => !files.some(([rel]) => rel === `games/${id}/meta.ts`))

const kb = (n) => `${(n / 1024).toFixed(1)} KB`
const pct = (n) => `${((n / LIMIT) * 100).toFixed(1)}%`

console.log('=== 小程序主包体检 ===')
console.log('')
console.log(`会进包的文件：${files.length} 个，共 ${kb(total)}（原始源码，未编译）`)
console.log('')
console.log('按类型：')
for (const [ext, size] of [...byExt.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${ext.padEnd(8)} ${kb(size).padStart(12)}`)
}
console.log('')
console.log(`被 packOptions.ignore 排除：${dropped.length} 项`)
for (const d of dropped) console.log(`  - ${d}`)
console.log('')
console.log(`游戏：清单 ${games.length} 款，主包实到 ${games.length - missing.length} 款`)
if (missing.length) {
  console.log(`  ❌ 缺：${missing.join(', ')}`)
}
console.log('')
const estimated = Math.round(total * COMPRESS_RATIO)
console.log(`2 MB 上限：原始源码占 ${pct(total)}；按 ${(COMPRESS_RATIO * 100).toFixed(1)}% 压缩比估算，编译后约 ${kb(estimated)}（占 ${pct(estimated)}）`)
console.log('')
console.log('提醒：微信限制的是**编译压缩后**的包，原始源码体积只是上界。')
console.log('真要上传，请用微信开发者工具的「上传」看它报的真实包大小。')

process.exit(missing.length ? 1 : 0)
