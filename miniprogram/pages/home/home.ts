import { CATEGORY_LABEL, CATEGORY_ORDER } from '../../core/types'
import { canSignIn, claimSignin, formatCoins, readWallet, signinAmount } from '../../shell/coins'
import { dailyGame, todayLabel } from '../../shell/daily'
import { GAMES } from '../../shell/registry'

interface Card {
  id: string
  name: string
  summary: string
  tags: string[]
  category: string
}

const ALL = '__all__'

Page({
  data: {
    wallet: '0',
    canSignin: false,
    signinAmount: 0,
    today: '',
    dailyName: '',
    q: '',
    cat: ALL,
    cats: [] as Array<{ key: string; label: string }>,
    games: [] as Card[],
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
    this.setData({
      cats,
      today: todayLabel(),
      dailyName: daily ? daily.name : '—',
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
    const games = GAMES.filter((g) => {
      if (cat !== ALL && g.category !== cat) return false
      if (q === '') return true
      const hay = `${g.name}${g.summary}${g.tags.join('')}${g.category}`.toLowerCase()
      return hay.indexOf(q) >= 0
    }).map((g) => ({ id: g.id, name: g.name, summary: g.summary, tags: g.tags, category: g.category }))

    this.setData({
      wallet: formatCoins(w.balance),
      canSignin: canSignIn(w),
      signinAmount: signinAmount(w),
      games,
    })
  },

  onSearch(e: MiniEvent): void {
    this.setData({ q: String((e.detail as { value?: string }).value || '') })
    this.refresh()
  },

  onCat(e: MiniEvent): void {
    this.setData({ cat: String(e.currentTarget.dataset.k) })
    this.refresh()
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
