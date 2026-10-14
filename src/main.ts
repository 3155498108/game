/** 站点壳入口：hash 路由（纯静态部署友好） */
import './style.css'
import { mountHome } from './shell/home'
import { mountPlay } from './shell/play'

const root = document.getElementById('app') as HTMLElement
let unmount: (() => void) | null = null
let homeScroll = 0

function route(): void {
  const hash = location.hash.replace(/^#/, '') || '/'
  const [path, qs = ''] = hash.split('?')
  const wasHome = !document.body.classList.contains('playing') && unmount !== null
  if (wasHome) homeScroll = window.scrollY
  unmount?.()
  unmount = null
  const m = /^\/play\/([a-z0-9-]+)$/.exec(path)
  if (m) {
    unmount = mountPlay(root, m[1], new URLSearchParams(qs))
    window.scrollTo(0, 0)
  } else {
    unmount = mountHome(root)
    window.scrollTo(0, homeScroll)
  }
}

window.addEventListener('hashchange', route)
route()
