/** 游戏页：顶部返回按钮 + 画布 + 游戏内提示区 */
import { CATEGORY_LABEL } from '../core/types'
import { findMeta, loadGame } from './registry'
import { Runtime, newSeed, type PlayElements } from './runtime'

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

  root.innerHTML = `
  <div class="play" data-orientation="${meta.orientation}">
    <header class="bar">
      <a class="btn back" href="#/" aria-label="返回首页">‹ 返回</a>
      <div class="title">
        <h1>${meta.name}<small>${CATEGORY_LABEL[meta.category]}</small></h1>
        <p class="hint" aria-live="polite">加载中…</p>
      </div>
      <button type="button" class="btn icon sound" aria-label="音效">🔊</button>
    </header>
    <div class="stage">
      <canvas class="game-canvas" aria-label="${meta.name} 游戏画面"></canvas>
      <div class="toast" hidden></div>
      <div class="rotate-tip" hidden>
        <div class="phone ${meta.orientation}"></div>
        <p>本游戏需要${want}游玩<br/>请旋转设备</p>
        <button type="button" class="btn ghost">仍然继续</button>
      </div>
      <div class="loading">加载中…</div>
    </div>
    <footer class="dock">
      <span class="best"></span>
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
  }

  let disposed = false
  let rt: Runtime | null = null
  const clearLoading = () => q<HTMLElement>('.loading')?.remove()
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
