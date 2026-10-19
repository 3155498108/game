/**
 * 共享层漂移检查。
 *
 * ## 这条用例在防什么
 *
 * 小程序打包器只认 `miniprogramRoot` 下的文件，所以 `src/games/<id>/` 到小程序那一份
 * **永远是「复制」**。复制会漂移，而且漂移**没有任何报错**：
 *
 *   在 src/games/maze/rules.ts 修了一个 bug，忘了同步 miniprogram/games/maze/rules.ts。
 *   小程序继续跑旧代码，两边测试各自都绿，直到用户在真机上遇到那个 bug。
 *
 * 所以这里把「小程序侧应该长什么样」**从 src/ 重新推导一遍**，然后和实际文件比对。
 * 推导规则和 `scripts/sync-miniprogram.mjs` 相同，但**这条用例是权威**——
 * 脚本推错了，或者有人手改了小程序侧，这一条都会红。
 *
 * 检查项：
 *   1. 共享层逐字节相同（core / render / games 三处）
 *   2. 小程序侧没有计划外的文件（孤儿）
 *   3. 移植清单与 shell/registry.ts 注册的游戏一致
 *   4. 清单里的游戏在 src/games 下确实存在
 *   5. 相对 import 在小程序侧都能解析到文件
 *   6. 游戏逻辑与渲染层里没有浏览器专属 API
 *
 * 全程只用 Vite 的 `?raw` 读文件，**不依赖 @types/node**（本仓库刻意不加它）。
 */
import { describe, expect, it } from 'vitest'

const srcCore = import.meta.glob('/src/core/*.ts', { query: '?raw', import: 'default', eager: true }) as unknown as Record<string, string>
const srcRender = import.meta.glob('/src/render/*.ts', { query: '?raw', import: 'default', eager: true }) as unknown as Record<string, string>
const srcGames = import.meta.glob('/src/games/**/!(*.test).ts', { query: '?raw', import: 'default', eager: true }) as unknown as Record<string, string>

const miniCore = import.meta.glob('/miniprogram/core/*.ts', { query: '?raw', import: 'default', eager: true }) as unknown as Record<string, string>
const miniRender = import.meta.glob('/miniprogram/render/*.ts', { query: '?raw', import: 'default', eager: true }) as unknown as Record<string, string>
const miniGames = import.meta.glob('/miniprogram/games/**/*.ts', { query: '?raw', import: 'default', eager: true }) as unknown as Record<string, string>
const miniShell = import.meta.glob('/miniprogram/shell/*.ts', { query: '?raw', import: 'default', eager: true }) as unknown as Record<string, string>
const manifestRaw = import.meta.glob('/miniprogram/ported-games.json', { query: '?raw', import: 'default', eager: true }) as unknown as Record<string, string>
const registryRaw = import.meta.glob('/miniprogram/shell/registry.ts', { query: '?raw', import: 'default', eager: true }) as unknown as Record<string, string>

/**
 * 共享层**不得**依赖站点壳。
 *
 * 曾经有一处越层：`games/mahjong-match/index.ts` 为了存「每关最少步数 / 最快用时」
 * 而 import 了 `shell/storage`。那不是 bug——小程序侧也有同名同 API 的文件，
 * `tsc` 也会对着它做类型检查——但它是**共享层与壳之间的一条暗债**：
 * 共享层本该与站点壳无关，壳一改，游戏就跟着改。
 *
 * 现在还清了：存档逻辑搬进 `core/storage.ts`（两端逐字节共享），
 * 壳层只剩一个后端适配器。所以这条检查从「白名单」升级成「**禁止**」——
 * 不是「少一条越层是允许的」，而是「一条都不许有」。
 */
const SHELL_PREFIXES = ['/miniprogram/shell/', '/miniprogram/pages/']

/** 平台专属、刻意不与网页版同步的文件 */
const HAND_WRITTEN = new Set(['/miniprogram/render/audio.ts'])

const ALL: Record<string, string> = {
  ...srcCore,
  ...srcRender,
  ...srcGames,
  ...miniCore,
  ...miniRender,
  ...miniGames,
  ...miniShell,
}

function portedGames(): string[] {
  const raw = manifestRaw['/miniprogram/ported-games.json']
  expect(raw, '缺少 miniprogram/ported-games.json').toBeTruthy()
  const parsed = JSON.parse(raw) as { games?: string[] }
  expect(Array.isArray(parsed.games), 'ported-games.json 缺少 games 数组').toBe(true)
  return parsed.games as string[]
}

/** 从 src/ 重新推导「小程序侧应该有哪些共享文件」 */
function expectedShared(): string[] {
  const out: string[] = []
  for (const k of Object.keys(srcCore)) out.push(k.replace('/src/', '/miniprogram/'))
  for (const k of Object.keys(srcRender)) {
    if (k === '/src/render/audio.ts') continue // 平台专属，不复制
    out.push(k.replace('/src/', '/miniprogram/'))
  }
  const games = portedGames()
  for (const k of Object.keys(srcGames)) {
    const m = /^\/src\/games\/([^/]+)\//.exec(k)
    if (m && games.includes(m[1])) out.push(k.replace('/src/', '/miniprogram/'))
  }
  return out.sort()
}

/** 把路径里的 . 与 .. 归一 */
function normalize(p: string): string {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return '/' + out.join('/')
}

/**
 * 剥掉注释再扫浏览器 API。
 * `//` 前面是 `:` 时不当作行注释（避免把 https:// 砍掉）。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1')
}

describe('共享层漂移检查（src/ ↔ miniprogram/）', () => {
  it('移植清单非空', () => {
    expect(portedGames().length).toBeGreaterThan(0)
  })

  it('共享层逐字节相同', () => {
    const expected = expectedShared()
    expect(expected.length).toBeGreaterThan(0)
    const bad: string[] = []
    for (const key of expected) {
      const srcKey = key.replace('/miniprogram/', '/src/')
      if (ALL[key] === undefined) bad.push(`${key}：小程序侧缺失`)
      else if (ALL[key] !== ALL[srcKey]) bad.push(`${key}：与 ${srcKey} 不一致`)
    }
    expect(bad).toEqual([])
  })

  it('小程序侧没有计划外的文件', () => {
    const actual = [...Object.keys(miniCore), ...Object.keys(miniRender), ...Object.keys(miniGames)]
      .filter((k) => !HAND_WRITTEN.has(k))
      .sort()
    expect(actual).toEqual(expectedShared())
  })

  it('移植清单与注册表一致', () => {
    const registry = registryRaw['/miniprogram/shell/registry.ts']
    expect(registry).toBeTruthy()
    const registered = [...registry.matchAll(/from '\.\.\/games\/([^/]+)\/meta'/g)].map((m) => m[1]).sort()
    expect(registered).toEqual([...portedGames()].sort())
  })

  it('清单里的游戏在 src/games 下确实存在', () => {
    for (const id of portedGames()) {
      const found = Object.keys(srcGames).some((k) => k.startsWith(`/src/games/${id}/`))
      expect(found, `src/games/${id} 不存在`).toBe(true)
    }
  })

  it('相对 import 在小程序侧都能解析到文件，且不越层', () => {
    const bad: string[] = []
    for (const key of expectedShared()) {
      const base = key.slice(0, key.lastIndexOf('/'))
      for (const m of ALL[key].matchAll(/from '(\.[^']+)'/g)) {
        const spec = m[1]
        const target = spec.endsWith('.ts') ? spec : `${spec}.ts`
        const resolved = normalize(`${base}/${target}`)
        if (ALL[resolved] === undefined) {
          bad.push(`${key} 里的 import '${spec}' 解析不到`)
          continue
        }
        // 越层检查：共享层只能依赖共享层，不许碰站点壳
        if (SHELL_PREFIXES.some((p) => resolved.startsWith(p))) {
          bad.push(`${key} 越层依赖了 ${resolved}：共享层不许依赖站点壳`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('共享层里没有任何文件 import 站点壳', () => {
    // 上面那条按「解析到的路径」判；这条按「源码里写了什么」判。
    // 两条独立实现，坏掉一条另一条还能兜住。
    //
    // `shell` 与 `pages` 都要扫：站点壳有两处，
    // 只认其中一个就等于给另一半留了个后门。
    const bad: string[] = []
    for (const key of expectedShared()) {
      for (const m of ALL[key].matchAll(/from '(\.\.[^']*(?:shell|pages)[^']*)'/g)) {
        bad.push(`${key} import 了 ${m[1]}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('游戏逻辑里没有浏览器专属 API', () => {
    // rules.ts 与 core/ 是纯逻辑：这些 API 一旦出现，小程序上会直接崩或静默失效
    //
    // 匹配的是**全局对象的用法**而不是「文件里出现了这个词」：
    // `window` 在 toy-boxing 里是领域词（时机窗口：state.phase === 'window'、spec.window），
    // 用 `\bwindow\b` 去扫会误报——而**一个会误报的检查比没有检查更糟**：
    // 大家会习惯性地加白名单，而不是去修检查本身。
    //
    // 所以规则是「前面不能是 . 或标识符字符，后面必须紧跟 . 或 [」：
    //   window.foo      → 命中（全局 window）
    //   spec.window     → 不命中（前面是 .，是别的对象的属性）
    //   'window'        → 不命中（后面是引号）
    //   window: number  → 不命中（后面是冒号，是类型字段名）
    const forbidden = [
      /(?<![.\w$])document\s*[.[]/,
      /(?<![.\w$])window\s*[.[]/,
      /(?<![.\w$])localStorage\s*[.[]/,
      /(?<![.\w$])performance\s*[.[]/,
      /\bMath\s*\.\s*random\b/,
      /\bnew\s+Date\b/,
    ]
    const bad: string[] = []
    const scope = [
      ...Object.keys(miniCore),
      ...Object.keys(miniGames).filter((k) => /\/rules\.ts$/.test(k)),
    ]
    for (const key of scope) {
      const body = stripComments(ALL[key])
      for (const re of forbidden) {
        if (re.test(body)) bad.push(`${key} 命中 ${re.source}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('渲染层里没有浏览器专属 API（performance 除外，它有垫片）', () => {
    const forbidden = [
      /(?<![.\w$])document\s*[.[]/,
      /(?<![.\w$])window\s*[.[]/,
      /(?<![.\w$])localStorage\s*[.[]/,
      /\bAudioContext\b/,
    ]
    const bad: string[] = []
    // 扫的是小程序侧**实际存在的**文件，包括手写的 render/audio.ts——
    // 它不参与复制，但同样不该出现浏览器 API
    const scope = [
      ...Object.keys(miniRender),
      ...Object.keys(miniGames).filter((k) => /\/index\.ts$/.test(k)),
    ]
    for (const key of scope) {
      const body = stripComments(ALL[key])
      for (const re of forbidden) {
        if (re.test(body)) bad.push(`${key} 命中 ${re.source}`)
      }
    }
    expect(bad).toEqual([])
  })
})
