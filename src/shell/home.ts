/** 首页：游戏卡片列表（按 category 分组）+ 分类筛选 + 搜索 + 每日挑战 + 金币签到 */
import { CATEGORY_LABEL, CATEGORY_ORDER, type Category, type GameMeta } from '../core/types'
import { GAMES } from './registry'
import { formatBest, readBest, readJSON, writeJSON } from './storage'
import { dailyGame, todayLabel, todaySeed } from './daily'
import { canSignIn, claimSignin, formatCoins, readWallet, signinAmount } from './coins'
import { escapeHtml as esc } from './html'

const FILTER_KEY = 'gs:settings:filter'
const PLAYERS_LABEL: Record<string, string> = { '1': '单人', '2': '双人', ai: '人机' }

function card(g: GameMeta): string {
  const best = readBest(g.id)
  const orient = g.orientation === 'landscape' ? '<span class="tag">横屏</span>' : ''
  return `<a class="game-card cat-${g.category}" href="#/play/${g.id}">
    <span class="gc-icon" aria-hidden="true">${esc(g.name.slice(0, 1))}</span>
    <span class="gc-body">
      <span class="gc-name">${esc(g.name)}</span>
      <span class="gc-sum">${esc(g.summary)}</span>
      <span class="gc-meta"><span class="tag">${PLAYERS_LABEL[String(g.players)]}</span>${orient}${best ? `<span class="tag best">${esc(formatBest(best))}</span>` : ''}</span>
    </span>
  </a>`
}

export function mountHome(root: HTMLElement): () => void {
  document.title = '小游戏合集'
  const saved = readJSON<{ cat?: string; q?: string }>(FILTER_KEY, {})
  let cat: Category | 'all' = saved && typeof saved.cat === 'string' && (saved.cat === 'all' || saved.cat in CATEGORY_LABEL) ? (saved.cat as Category | 'all') : 'all'
  let query = saved && typeof saved.q === 'string' ? saved.q : ''

  const seed = todaySeed()
  const daily = dailyGame(GAMES, seed)
  const cats = CATEGORY_ORDER.filter((c) => GAMES.some((g) => g.category === c))
  const wallet = readWallet()
  const claimable = canSignIn(wallet)

  root.innerHTML = `
  <div class="home">
    <header class="home-head">
      <h1>小游戏合集 <small>${GAMES.length} 款</small></h1>
      <div class="wallet-bar">
        <span class="wallet">🪙 ${formatCoins(wallet.balance)}</span>
        <button type="button" class="chip signin${claimable ? ' on' : ''}" data-signin ${claimable ? '' : 'disabled'}>
          ${claimable ? `签到 +${signinAmount(wallet)}` : '今日已签到'}
        </button>
      </div>
      <input class="search" type="search" placeholder="搜索游戏名 / 标签" aria-label="搜索游戏" value="${esc(query)}" />
    </header>
    ${
      daily
        ? `<a class="daily" href="#/play/${daily.id}?seed=${seed}&daily=1">
      <span class="daily-k">每日挑战 · ${todayLabel()}</span>
      <span class="daily-n">${esc(daily.name)}</span>
      <span class="daily-s">今天所有人的开局都一样，来比比看！</span>
    </a>`
        : ''
    }
    <nav class="chips" aria-label="分类">
      <button type="button" class="chip" data-cat="all">全部</button>
      ${cats.map((c) => `<button type="button" class="chip" data-cat="${c}">${CATEGORY_LABEL[c]}</button>`).join('')}
    </nav>
    <main class="list"></main>
    <footer class="home-foot">纯静态 · 无引擎 · 手机电脑通用</footer>
  </div>`

  const list = root.querySelector('.list') as HTMLElement
  const input = root.querySelector('.search') as HTMLInputElement
  const chips = root.querySelector('.chips') as HTMLElement

  function renderList(): void {
    const q = query.trim().toLowerCase()
    const match = (g: GameMeta) =>
      !q || g.name.toLowerCase().includes(q) || g.id.includes(q) || g.summary.toLowerCase().includes(q) || g.tags.some((t) => t.toLowerCase().includes(q))
    const groups = cats
      .filter((c) => cat === 'all' || c === cat)
      .map((c) => ({ c, items: GAMES.filter((g) => g.category === c && match(g)) }))
      .filter((x) => x.items.length > 0)
    list.innerHTML = groups.length
      ? groups
          .map(
            (x) => `<section class="group">
        <h2>${CATEGORY_LABEL[x.c]} <small>${x.items.length}</small></h2>
        <div class="grid">${x.items.map(card).join('')}</div>
      </section>`,
          )
          .join('')
      : `<p class="empty">没有找到匹配「${esc(query)}」的游戏</p>`
    chips.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => b.classList.toggle('on', b.dataset.cat === cat))
    writeJSON(FILTER_KEY, { cat, q: query })
  }

  const onInput = () => {
    query = input.value
    renderList()
  }
  const onChip = (e: Event) => {
    const b = (e.target as HTMLElement).closest('.chip') as HTMLButtonElement | null
    if (!b) return
    cat = (b.dataset.cat as Category | 'all') ?? 'all'
    renderList()
  }
  input.addEventListener('input', onInput)
  chips.addEventListener('click', onChip)
  const signinBtn = root.querySelector('.chip.signin') as HTMLButtonElement | null
  const walletEl = root.querySelector('.wallet-bar .wallet') as HTMLElement | null
  const onSignin = () => {
    const r = claimSignin(wallet)
    if (!r.ok) return
    if (walletEl) walletEl.textContent = `🪙 ${formatCoins(r.wallet.balance)}`
    if (signinBtn) {
      signinBtn.textContent = '今日已签到'
      signinBtn.disabled = true
      signinBtn.classList.remove('on')
    }
    // 签完给个明确反馈：否则「+150」一闪而过，玩家会以为没点到
    window.setTimeout(() => {
      signinBtn?.animate?.(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
        { duration: 280 },
      )
    }, 0)
  }
  signinBtn?.addEventListener('click', onSignin)
  renderList()
  return () => {
    input.removeEventListener('input', onInput)
    chips.removeEventListener('click', onChip)
    signinBtn?.removeEventListener('click', onSignin)
  }
}
