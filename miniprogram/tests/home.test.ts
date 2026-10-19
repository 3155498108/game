/**
 * 小程序首页的测试。
 *
 * **为什么网页版的 `src/smoke.test.ts` 覆盖不到这里**：那份测的是 DOM 壳
 * （`addEventListener` / `innerHTML`），小程序首页换成了 `setData` + WXML 模板。
 * 而首页恰好是**两端对账里差得最多**的地方（4.36 的对账表列了两条：
 * 「按分类分组显示」与「记住上次的分类/搜索」都只在小程序侧缺着），
 * 也就是说这块**一行测试都没有**。
 *
 * 这里把 `Page` 替身掉，让首页真跑起来：
 *   - 页面模块在 import 时就会调用 `Page({...})`，所以必须先装好替身再**动态 import**；
 *   - `setData` 做成「合并进 this.data」，与小程序框架的行为一致，
 *     这样 `this.data.q` 之类的读法才是真的。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { CATEGORY_LABEL, CATEGORY_ORDER } from '../core/types'
import { GAMES } from '../shell/registry'
import { installWxBackend } from '../shell/storage'

// ---------------- 替身 ----------------

const store = new Map<string, unknown>()
let pageOptions: Record<string, any> | null = null

;(globalThis as unknown as { wx: unknown }).wx = {
  getStorageSync: (k: string) => (store.has(k) ? store.get(k) : ''),
  setStorageSync: (k: string, v: unknown) => {
    store.set(k, v)
  },
  removeStorageSync: (k: string) => {
    store.delete(k)
  },
  navigateTo: () => undefined,
}

;(globalThis as unknown as { Page: unknown }).Page = (o: unknown) => {
  pageOptions = o as Record<string, any>
}

// 动态 import：静态 import 会在模块体之前求值，那时 `Page` 还没装上
await import('../pages/home/home')

interface Group {
  key: string
  label: string
  items: Array<{ id: string; category: string }>
}

interface FakePage {
  data: Record<string, any>
  setData(patch: Record<string, unknown>): void
  onLoad(): void
  onShow(): void
  onSearch(e: unknown): void
  onCat(e: unknown): void
}

/** 造一个页面实例：data 深拷贝，setData 合并进 data */
function makePage(): FakePage {
  if (!pageOptions) throw new Error('页面模块没有注册 Page({...})')
  const inst = {
    ...pageOptions,
    data: JSON.parse(JSON.stringify(pageOptions.data)) as Record<string, any>,
  } as FakePage
  inst.setData = (patch: Record<string, unknown>) => {
    Object.assign(inst.data, patch)
  }
  return inst
}

function groups(p: FakePage): Group[] {
  return p.data.groups as Group[]
}

function search(p: FakePage, q: string): void {
  p.onSearch({ detail: { value: q }, currentTarget: { dataset: {}, id: '' } })
}

function pick(p: FakePage, k: string): void {
  p.onCat({ detail: {}, currentTarget: { dataset: { k }, id: '' } })
}

beforeEach(() => {
  store.clear()
  // 重装后端：`core/storage.ts` 的内存兜底会一并清空，
  // 否则上一条用例写下的分类/搜索词会漏到下一条。
  installWxBackend()
})

// ---------------- 分组 ----------------

describe('首页分组', () => {
  it('按分类分组展示，标题是分类名、数量是这一组的游戏数', () => {
    const p = makePage()
    p.onLoad()
    const gs = groups(p)

    const withGames = CATEGORY_ORDER.filter((c) => GAMES.some((g) => g.category === c))
    expect(gs.map((g) => g.key)).toEqual(withGames)
    for (const g of gs) {
      expect(g.label).toBe(CATEGORY_LABEL[g.key as keyof typeof CATEGORY_LABEL])
      expect(g.items.length).toBeGreaterThan(0)
    }
  })

  it('所有游戏都出现且不重复（分组不能吞掉游戏）', () => {
    const p = makePage()
    p.onLoad()
    const ids = groups(p).flatMap((g) => g.items.map((i) => i.id))
    expect(ids.length).toBe(GAMES.length)
    expect(new Set(ids).size).toBe(GAMES.length)
  })

  it('选中一个分类时只显示那一组', () => {
    const p = makePage()
    p.onLoad()
    pick(p, 'card')
    const gs = groups(p)
    expect(gs.length).toBe(1)
    expect(gs[0].key).toBe('card')
    expect(gs[0].items.every((i) => i.category === 'card')).toBe(true)
  })

  it('搜索会过滤每一组里的游戏', () => {
    const p = makePage()
    p.onLoad()
    // 「麻」只命中麻将对对消一款
    search(p, '麻')
    const gs = groups(p)
    expect(gs.length).toBe(1)
    expect(gs[0].key).toBe('puzzle')
    expect(gs[0].items.map((i) => i.id)).toEqual(['mahjong-match'])
  })

  it('某一分类下没有匹配游戏时，那一组不出现（不留空标题）', () => {
    const p = makePage()
    p.onLoad()
    search(p, '麻')
    // 牌类/棋类/迷你/休闲四组都空了，只剩益智
    expect(groups(p).map((g) => g.key)).toEqual(['puzzle'])
  })

  it('搜不到任何东西时分组为空，页面显示空状态', () => {
    const p = makePage()
    p.onLoad()
    search(p, '根本没有这个游戏xyz')
    expect(groups(p).length).toBe(0)
  })

  it('标题显示的是全部游戏数，不是筛选后的数量', () => {
    const p = makePage()
    p.onLoad()
    expect(p.data.total).toBe(GAMES.length)
    search(p, '麻')
    // 筛选不改变标题上的总数——与网页版一致
    expect(p.data.total).toBe(GAMES.length)
  })
})

// ---------------- 记住上次的筛选 ----------------

describe('记住上次的分类与搜索词', () => {
  it('选过分类与搜索词后，下次进来还在原地', () => {
    const p1 = makePage()
    p1.onLoad()
    pick(p1, 'card')
    search(p1, '梭')

    const p2 = makePage()
    p2.onLoad()
    expect(p2.data.cat).toBe('card')
    expect(p2.data.q).toBe('梭')
    // 恢复之后看到的也应当是筛过的结果，不是全部
    const gs = groups(p2)
    expect(gs.length).toBe(1)
    expect(gs[0].key).toBe('card')
    expect(gs[0].items.map((i) => i.id)).toEqual(['stud-poker'])
  })

  it('只选了分类、没搜过词时，分类也要记住', () => {
    // 上一条用例里选了分类又搜了词，**搜词那一步也会保存**，
    // 于是「只选分类」这条路径根本没被验到——去掉搜索这一步单独验一次。
    const p1 = makePage()
    p1.onLoad()
    pick(p1, 'board')

    const p2 = makePage()
    p2.onLoad()
    expect(p2.data.cat).toBe('board')
    expect(p2.data.q).toBe('')
    expect(groups(p2).map((g) => g.key)).toEqual(['board'])
  })

  it('只搜了词、没选过分类时，搜索词也要记住', () => {
    const p1 = makePage()
    p1.onLoad()
    search(p1, '麻')

    const p2 = makePage()
    p2.onLoad()
    expect(p2.data.cat).toBe('all')
    expect(p2.data.q).toBe('麻')
    expect(groups(p2).map((g) => g.key)).toEqual(['puzzle'])
  })

  it('存档被改坏时回落到默认值，首页照常打开', () => {
    store.set('gs:settings:filter', '{ 这不是 JSON')
    const p = makePage()
    p.onLoad()
    expect(p.data.cat).toBe('all')
    expect(p.data.q).toBe('')
    expect(groups(p).length).toBeGreaterThan(0)
  })

  it('存档里的分类不合法时回落到「全部」，搜索词照常恢复', () => {
    store.set('gs:settings:filter', JSON.stringify({ cat: '不存在的分类', q: '麻' }))
    const p = makePage()
    p.onLoad()
    expect(p.data.cat).toBe('all')
    expect(p.data.q).toBe('麻')
  })

  it('存档里的字段类型不对时也回落到默认值', () => {
    store.set('gs:settings:filter', JSON.stringify({ cat: 123, q: { a: 1 } }))
    const p = makePage()
    p.onLoad()
    expect(p.data.cat).toBe('all')
    expect(p.data.q).toBe('')
  })
})
