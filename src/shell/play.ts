/** 游戏页：顶部返回按钮 + 画布 + 游戏内提示区 */
import { CATEGORY_LABEL } from '../core/types'
import { findMeta, loadGame } from './registry'
import { Runtime, newSeed, type PlayElements } from './runtime'
import { escapeHtml } from './html'
import { readJSON, writeJSON } from './storage'

export function mountPlay(root: HTMLElement, id: string, params: URLSearchParams): () => void {
  const meta = findMeta(id)
  document.body.classList.add('playing')
  if (!meta) {
    root.innerHTML = `<div class="empty"><p>找不到这个游戏。</p><a class="btn primary" href="#/">返回首页</a></div>`
    return () => document.body.classList.remove('playing')
  }
  const daily = params.has('daily')
  const seedParam = Number(params.get('seed'))
  const seed = Number.isFinite(seedParam) && params.has('seed') ? seedParam >>> 0 : newSeed()
  const want = meta.orientation === 'portrait' ? '竖屏' : '横屏'
  document.title = `${meta.name} · 小游戏合集`

  const steps = meta.howto ?? []
  const howtoBody = steps.length
    ? `<ol class="howto-steps">${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`
    : '<p class="howto-empty">这款游戏暂时没写玩法介绍。</p>'

  root.innerHTML = `
  <div class="play" data-orientation="${meta.orientation}">
    <header class="bar">
      <a class="btn back" href="#/" aria-label="返回首页">‹ 返回</a>
      <div class="title">
        <h1>${meta.name}<small>${CATEGORY_LABEL[meta.category]}</small></h1>
        <p class="hint" aria-live="polite">加载中…</p>
      </div>
      <button type="button" class="btn icon howto-btn" aria-expanded="false" aria-controls="howto">玩法</button>
      <button type="button" class="btn icon sound" aria-label="音效">🔊</button>
    </header>
    <div class="stage">
      <canvas class="game-canvas" aria-label="${meta.name} 游戏画面"></canvas>
      <div class="toast" hidden></div>
      <div class="howto" id="howto" hidden>
        <div class="howto-card" role="dialog" aria-modal="false" aria-label="${meta.name} 玩法介绍">
          <h2>${escapeHtml(meta.name)} · 玩法</h2>
          <div class="howto-body">
            <p class="howto-sum">${escapeHtml(meta.summary)}</p>
            ${howtoBody}
            <p class="howto-tags">${meta.tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</p>
          </div>
          <button type="button" class="btn primary howto-close">知道了</button>
        </div>
      </div>
      <div class="rotate-tip" hidden>
        <div class="phone ${meta.orientation}"></div>
        <p>本游戏需要${want}游玩<br/>请旋转设备</p>
        <button type="button" class="btn ghost">仍然继续</button>
      </div>
      <div class="loading">加载中…</div>
    </div>
    <footer class="dock">
      <span class="best"></span>
      <div class="coins">
        <button type="button" class="chip bet" title="点击切换下注额">注</button>
        <span class="wallet">🪙 0</span>
        <span class="delta"></span>
      </div>
      <div class="ctrls"></div>
    </footer>
  </div>`

  const q = <T extends HTMLElement>(s: string) => root.querySelector(s) as T
  const els: PlayElements = {
    stage: q('.stage'),
    canvas: q('.game-canvas'),
    hint: q('.hint'),
    best: q('.best'),
    ctrls: q('.ctrls'),
    rotate: q('.rotate-tip'),
    toast: q('.toast'),
    sound: q('.sound'),
    wallet: q('.wallet'),
    delta: q('.delta'),
    betBox: q('.chip.bet'),
  }

  let disposed = false
  let rt: Runtime | null = null
  const clearLoading = () => q<HTMLElement>('.loading')?.remove()

  // ---------------- 玩法介绍面板 ----------------
  // 首次进入某款游戏时自动展开一次：规则不直观的游戏（扫雷赌局、轨道车、
  // 连环新接龙）玩家不看说明根本不知道目标是什么。看过之后只留手动入口，
  // 不会每次进来都挡着画面。
  const panel = q<HTMLElement>('.howto')
  const howtoBtn = q<HTMLButtonElement>('.howto-btn')
  const closeBtn = q<HTMLButtonElement>('.howto-close')
  const seenKey = `gs:${id}:howto-seen`
  const setHowto = (open: boolean): void => {
    panel.hidden = !open
    howtoBtn.setAttribute('aria-expanded', String(open))
  }
  const markSeen = (): void => {
    if (!readJSON<boolean>(seenKey, false)) writeJSON(seenKey, true)
  }
  howtoBtn.addEventListener('click', () => {
    const open = panel.hidden
    setHowto(open)
    if (open) markSeen()
  })
  // 点「知道了」同样要落盘：否则自动展开的那一次被关掉后标记没写进去，
  // 下次进来还会再弹一遍，等于这个「只看一次」根本没生效。
  closeBtn.addEventListener('click', () => {
    setHowto(false)
    markSeen()
  })
  if (steps.length && !readJSON<boolean>(seenKey, false)) setHowto(true)

  loadGame(id)
    .then((mod) => {
      if (disposed) return
      clearLoading()
      rt = new Runtime(mod, meta, seed, daily, els)
    })
    .catch((err: unknown) => {
      console.error(err)
      if (disposed) return
      const box = q<HTMLElement>('.loading')
      if (box) box.textContent = '加载失败，请检查网络后重试'
    })

  return () => {
    disposed = true
    rt?.destroy()
    document.body.classList.remove('playing')
  }
}
