import { CATEGORY_LABEL, CATEGORY_ORDER, type GameMeta } from '../../core/types'
import { canSignIn, claimSignin, formatCoins, readWallet, signinAmount } from '../../shell/coins'
import { dailyGame, todayLabel } from '../../shell/daily'
import { GAMES } from '../../shell/registry'
import { formatBest, readBest, readJSON, writeJSON } from '../../shell/storage'

interface Card {
  id: string
  name: string
  summary: string
  tags: string[]
  category: string
  /** 玩家数：单人 / 双人 / 人机 */
  playersLabel: string
  /** 横屏游戏要在列表页就标出来——玩家进游戏前就该知道要转设备 */
  landscape: boolean
  /** 本机最佳成绩，没打过就没有 */
  best: string
}

/** 一个分类分组：标题 + 该分类下的游戏 */
interface Group {
  key: string
  label: string
  items: Card[]
}

/**
 * 「全部」的哨兵值。
 *
 * 与网页版 `src/shell/home.ts` 用**同一个**取值（那边也是 `'all'`），
 * 这样存进 `gs:settings:filter` 的内容在两端是同一种形状。
 */
const ALL = 'all'

/** 与网页版同一个 key：两端存的是同一种东西（「上次看到哪了」） */
const FILTER_KEY = 'gs:settings:filter'

/** 与网页版 `src/shell/home.ts` 同一张表 */
const PLAYERS_LABEL: Record<string, string> = { '1': '单人', '2': '双人', ai: '人机' }

/** 分类是否合法：'all' 或五个真实分类之一 */
function isKnownCat(c: string): boolean {
  return c === ALL || (CATEGORY_ORDER as string[]).indexOf(c) >= 0
}

function card(g: GameMeta): Card {
  const best = readBest(g.id)
  return {
    id: g.id,
    name: g.name,
    summary: g.summary,
    tags: g.tags,
    category: g.category,
    playersLabel: PLAYERS_LABEL[String(g.players)] ?? '',
    landscape: g.orientation === 'landscape',
    best: best ? formatBest(best) : '',
  }
}

Page({
  data: {
    wallet: '0',
    canSignin: false,
    signinAmount: 0,
    today: '',
    dailyName: '',
    /** 全部游戏数（不是筛选后的数量）——与网页版一致 */
    total: 0,
    q: '',
    cat: ALL,
    cats: [] as Array<{ key: string; label: string }>,
    /** 按分类分组的游戏列表 */
    groups: [] as Group[],
    howtoOpen: false,
    howtoTitle: '',
    howto: [] as string[],
    toast: '',
    toastHidden: true,
  },

  onLoad(): void {
    const cats = [{ key: ALL, label: '全部' }].concat(
      CATEGORY_ORDER.map((c) => ({ key: c, label: CATEGORY_LABEL[c] })),
    )
    const daily = dailyGame(GAMES)

    // 恢复上次的分类与搜索词。
    // 存档被改坏（隐私模式、JSON 损坏、外部写入）时回落到默认值，不让首页开不起来。
    const saved = readJSON<{ cat?: string; q?: string }>(FILTER_KEY, {})
    const cat = saved && typeof saved.cat === 'string' && isKnownCat(saved.cat) ? saved.cat : ALL
    const q = saved && typeof saved.q === 'string' ? saved.q : ''

    this.setData({
      cats,
      today: todayLabel(),
      dailyName: daily ? daily.name : '—',
      total: GAMES.length,
      cat,
      q,
    })
    this.refresh()
  },

  onShow(): void {
    this.refresh()
  },

  /** 余额、签到状态、筛选结果一起刷；每次从游戏页返回都要走一遍 */
  refresh(): void {
    const w = readWallet()
    const q = String(this.data.q || '').trim().toLowerCase()
    const cat = String(this.data.cat || ALL)

    /** 搜索命中：游戏名 / 玩法介绍 / 标签 / 分类名 */
    const match = (g: GameMeta): boolean => {
      if (q === '') return true
      const hay = `${g.name}${g.summary}${g.tags.join('')}${g.category}`.toLowerCase()
      return hay.indexOf(q) >= 0
    }

    // 分组规则与网页版一致：
    // 「全部」时按分类顺序分节展示；选中了某个分类就只留那一节。
    // 空分组不显示（否则搜索会留下一堆空标题）。
    const groups: Group[] = CATEGORY_ORDER.filter((c) => GAMES.some((g) => g.category === c))
      .filter((c) => cat === ALL || c === cat)
      .map((c) => ({
        key: c,
        label: CATEGORY_LABEL[c],
        items: GAMES.filter((g) => g.category === c && match(g)).map(card),
      }))
      .filter((x) => x.items.length > 0)

    this.setData({
      wallet: formatCoins(w.balance),
      canSignin: canSignIn(w),
      signinAmount: signinAmount(w),
      groups,
    })
  },

  onSearch(e: MiniEvent): void {
    this.setData({ q: String((e.detail as { value?: string }).value || '') })
    this.refresh()
    this.saveFilter()
  },

  onCat(e: MiniEvent): void {
    this.setData({ cat: String(e.currentTarget.dataset.k) })
    this.refresh()
    this.saveFilter()
  },

  /** 记住上次的分类与搜索词：下次进来还在原地 */
  saveFilter(): void {
    writeJSON(FILTER_KEY, { cat: this.data.cat, q: this.data.q })
  },

  onSignin(): void {
    const r = claimSignin(readWallet())
    if (!r.ok) {
      this.flash('今天已经领过了')
      return
    }
    this.refresh()
    this.flash(`签到成功 +${r.amount} 金币`)
  },

  onPlay(e: MiniEvent): void {
    const id = String(e.currentTarget.dataset.id)
    wx.navigateTo({ url: `/pages/play/play?id=${id}` })
  },

  onDaily(): void {
    const d = dailyGame(GAMES)
    if (!d) return
    wx.navigateTo({ url: `/pages/play/play?id=${d.id}&daily=1` })
  },

  /** 卡片右上角的「玩法」：用 catchtap 阻止冒泡到卡片本身的跳转 */
  onHowto(e: MiniEvent): void {
    const id = String(e.currentTarget.dataset.id)
    const m = GAMES.find((g) => g.id === id)
    if (!m || !m.howto) return
    this.setData({ howtoOpen: true, howtoTitle: m.name, howto: m.howto })
  },

  onCloseHowto(): void {
    this.setData({ howtoOpen: false, howto: [] })
  },

  /** 弹层内容区的空处理器：吃掉冒泡，否则点正文会连带把弹层关掉 */
  onNoop(): void {
    /* 故意留空 */
  },

  onToastOk(): void {
    this.setData({ toastHidden: true })
  },

  flash(msg: string): void {
    this.setData({ toast: msg, toastHidden: false })
    setTimeout(() => this.setData({ toastHidden: true }), 1800)
  },
})
