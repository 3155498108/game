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
const srcShell = import.meta.glob('/src/shell/*.ts', { query: '?raw', import: 'default', eager: true }) as unknown as Record<string, string>

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

/**
 * 越层规则**按层看**。
 *
 * - `core/` `render/` `games/` 是共享层：一条都不许依赖站点壳（`shell/` `pages/`）。
 * - `shell/` 里被共享的那两份（`coins.ts` / `daily.ts`）**本身就是壳层文件**——
 *   它们依赖同层的 `shell/storage.ts` 是天经地义，不算越层。
 *   但那份 storage 是**平台专属**的（localStorage ↔ wx），所以它的 API 由
 *   「两端壳层对账」那条检查钉住：行为有没有保证，靠的是**导出面对得上**，
 *   不靠「这份依赖本身无害」。
 */
const SHARED_SHELL_ALLOWED = [
  '/miniprogram/core/',
  '/miniprogram/render/',
  '/miniprogram/games/',
  '/miniprogram/shell/storage.ts',
]

/** 平台专属、刻意不与网页版同步的文件 */
const HAND_WRITTEN = new Set([
  '/miniprogram/render/audio.ts',
  '/miniprogram/shell/storage.ts',
  '/miniprogram/shell/runtime.ts',
  '/miniprogram/shell/perf.ts',
])

/** 由清单生成，不算「计划外的文件」 */
const GENERATED = new Set(['/miniprogram/shell/registry.ts'])

/**
 * 壳层里与平台无关、**逐字节共享**的两份。
 *
 * 它们只依赖 `../core/*` 与 `./storage`，而两端的 `shell/storage.ts`
 * 暴露的是同一套 API（逻辑都在 `core/storage.ts`，壳层只注入后端）。
 *
 * 把它们纳入共享范围，值在**钱包那条链路**上：结算公式、签到判定、
 * 余额夹取的任何一次改动，两端同时生效，不可能再漂移。
 */
const SHARED_SHELL = ['/src/shell/coins.ts', '/src/shell/daily.ts']

const ALL: Record<string, string> = {
  ...srcCore,
  ...srcRender,
  ...srcGames,
  ...srcShell,
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
  for (const k of SHARED_SHELL) out.push(k.replace('/src/', '/miniprogram/'))
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

/**
 * 取出一个模块导出的所有名字。
 *
 * 覆盖四种写法：`export function/const/class/interface/type`、
 * `export async function`、`export { a, b }`、`export type { a }`。
 */
function exportedNames(src: string): string[] {
  const code = stripComments(src)
  const out = new Set<string>()
  for (const m of code.matchAll(
    /^export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    out.add(m[1])
  }
  for (const m of code.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim() ?? ''
      if (name) out.add(name)
    }
  }
  return [...out].sort()
}

/**
 * **平台差异登记表**。
 *
 * 共享层（core / render / games / shell 的两份）靠「逐字节相同」保证两端一致；
 * 但 `shell/runtime.ts` 与 `shell/storage.ts` 是**手写**的两份，承载平台差异，
 * 零差异机制管不到它们。
 *
 * 它们的导出名一旦漂移——比如网页版加了个函数、小程序侧忘了加——
 * 编译**不会报错**（两边各自都合法），要到运行时才炸。
 * 所以这里把两边的导出名集合拿来比对：除了下面登记在册的，其余必须完全一致。
 *
 * 登记规则：只登记**确实由平台差异造成**的名字，且要写清为什么。
 * 数量被下面的断言钉住——想新增例外得改那个数字，是一次有意识的动作。
 */
const PLATFORM_ONLY: Record<string, { web: string[]; mini: string[]; why: string }> = {
  'shell/storage.ts': {
    web: ['installLocalBackend'],
    mini: ['installWxBackend'],
    why: '注入的存储后端不同：localStorage ↔ wx.*StorageSync。名字必须不同，否则会以为两端可互换',
  },
  'shell/runtime.ts': {
    web: ['PlayElements'],
    mini: ['CanvasNode', 'Host', 'CtrlView'],
    why: '网页版拿 DOM 元素，小程序拿 canvas 节点 + setData 宿主；类型形态天生不同',
  },
}

/** 平台专属导出的总数。新增例外时这里要改，并在上面写清原因 */
const PLATFORM_ONLY_COUNT = 6

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
    const actual = [
      ...Object.keys(miniCore),
      ...Object.keys(miniRender),
      ...Object.keys(miniGames),
      ...Object.keys(miniShell),
    ]
      .filter((k) => !HAND_WRITTEN.has(k) && !GENERATED.has(k))
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
      // 被共享的那两份壳层文件按「壳内依赖」处理，其余按「共享层不许碰壳」处理
      const isSharedShellFile = SHARED_SHELL.includes(key.replace('/miniprogram/', '/src/'))
      for (const m of ALL[key].matchAll(/from '(\.[^']+)'/g)) {
        const spec = m[1]
        const target = spec.endsWith('.ts') ? spec : `${spec}.ts`
        const resolved = normalize(`${base}/${target}`)
        if (ALL[resolved] === undefined) {
          bad.push(`${key} 里的 import '${spec}' 解析不到`)
          continue
        }
        if (isSharedShellFile) {
          const ok = SHARED_SHELL_ALLOWED.some((p) => resolved === p || resolved.startsWith(p))
          if (!ok) bad.push(`${key} 越层依赖了 ${resolved}：共享的壳层文件只许依赖 core/render/games 与 shell/storage.ts`)
        } else if (SHELL_PREFIXES.some((p) => resolved.startsWith(p))) {
          // 越层检查：共享层只能依赖共享层，不许碰站点壳
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

// ---------------- 两端壳层对账 ----------------

describe('两端壳层对账（src/shell/ ↔ miniprogram/shell/）', () => {
  /** 两端都有的壳层模块 */
  const SHELL_MODULES = [
    'shell/coins.ts',
    'shell/daily.ts',
    'shell/storage.ts',
    'shell/runtime.ts',
    'shell/registry.ts',
  ]

  it('每个壳层模块两端都在（少一个就是漏了一端）', () => {
    for (const m of SHELL_MODULES) {
      expect(ALL[`/src/${m}`], `网页版缺 ${m}`).toBeTruthy()
      expect(ALL[`/miniprogram/${m}`], `小程序侧缺 ${m}`).toBeTruthy()
    }
  })

  it('导出面一致：单边的导出必须恰好是登记在册的平台差异', () => {
    // 注意这是**严格相等**，不是「不包含」。
    // 「网页版有、小程序没有」的名字集合必须恰好等于登记的例外——
    // 多一个就是漏同步（运行时才炸），少一个就是登记已经过期（白白开了口子）。
    const bad: string[] = []
    for (const m of SHELL_MODULES) {
      const web = exportedNames(ALL[`/src/${m}`])
      const mini = exportedNames(ALL[`/miniprogram/${m}`])
      const ex = PLATFORM_ONLY[m] ?? { web: [], mini: [], why: '' }
      const onlyWeb = web.filter((n) => !mini.includes(n)).sort()
      const onlyMini = mini.filter((n) => !web.includes(n)).sort()
      if (onlyWeb.join(',') !== [...ex.web].sort().join(',')) {
        bad.push(`${m}：只在网页版的是 [${onlyWeb.join(', ')}]，登记的是 [${ex.web.join(', ')}]`)
      }
      if (onlyMini.join(',') !== [...ex.mini].sort().join(',')) {
        bad.push(`${m}：只在小程序侧的是 [${onlyMini.join(', ')}]，登记的是 [${ex.mini.join(', ')}]`)
      }
    }
    expect(bad).toEqual([])
  })

  it('登记在册的平台差异确实只在一侧存在', () => {
    // 防止「登记了但其实两边都有」——那说明登记已经过期，白白开了一个口子
    for (const [m, ex] of Object.entries(PLATFORM_ONLY)) {
      const web = exportedNames(ALL[`/src/${m}`])
      const mini = exportedNames(ALL[`/miniprogram/${m}`])
      for (const n of ex.web) {
        expect(web, `${m} 的 ${n} 应当只存在于网页版`).toContain(n)
        expect(mini, `${m} 的 ${n} 不该出现在小程序侧`).not.toContain(n)
      }
      for (const n of ex.mini) {
        expect(mini, `${m} 的 ${n} 应当只存在于小程序侧`).toContain(n)
        expect(web, `${m} 的 ${n} 不该出现在网页版`).not.toContain(n)
      }
    }
  })

  it('平台差异登记表的规模是钉住的（新增例外要改数字并写清原因）', () => {
    const total = Object.values(PLATFORM_ONLY).reduce((s, e) => s + e.web.length + e.mini.length, 0)
    expect(total).toBe(PLATFORM_ONLY_COUNT)
    // 每条例外都要写清「为什么这是平台差异」，不能只登记不解释
    for (const [m, e] of Object.entries(PLATFORM_ONLY)) {
      expect(e.why.length, `${m} 的平台差异没写原因`).toBeGreaterThan(10)
    }
  })
})
