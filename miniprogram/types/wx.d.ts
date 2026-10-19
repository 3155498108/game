/**
 * 微信小程序全局 API 的**最小**类型声明。
 *
 * 只声明本项目真正用到的成员——写全 `wx.*` 的类型既没必要，也会引入一堆
 * 用不上的噪音，反而让「这里到底依赖了哪些平台 API」变得看不清。
 * 依赖面小本身就是小程序移植的一个收益：这份清单就是全部的平台耦合点。
 */

declare const wx: {
  // ---- 存储 ----
  getStorageSync(key: string): unknown
  setStorageSync(key: string, value: unknown): void
  removeStorageSync(key: string): void

  // ---- 窗口信息 ----
  getWindowInfo(): {
    pixelRatio: number
    windowWidth: number
    windowHeight: number
    statusBarHeight: number
  }

  /** 屏幕旋转时触发。`size` 是新的窗口尺寸，壳层据此重新量画布 */
  onWindowResize(cb: (res: { size: { windowWidth: number; windowHeight: number } }) => void): void
  offWindowResize(cb?: (res: { size: { windowWidth: number; windowHeight: number } }) => void): void

  // ---- 节点查询 ----
  createSelectorQuery(): {
    select(selector: string): {
      fields(options: { node?: boolean; size?: boolean; rect?: boolean; id?: boolean }): {
        exec(cb: (res: unknown[]) => void): void
      }
    }
    selectViewport(): { exec(cb: (res: unknown[]) => void): void }
  }

  // ---- 反馈 ----
  vibrateShort(options?: { type?: 'heavy' | 'medium' | 'light' }): void
  vibrateLong(options?: { type?: 'heavy' | 'medium' | 'light' }): void

  // ---- 导航 ----
  navigateTo(options: { url: string }): void
  navigateBack(options?: { delta?: number }): void
  switchTab(options: { url: string }): void
  setNavigationBarTitle(options: { title: string }): void
}

/**
 * `Page` / `App` 的入参刻意声明成 `any`。
 *
 * 小程序页面对象里的 `this` 是框架注入的实例，既不是我们写的类也不是任何具名类型；
 * 写死一个精确签名只会把 `this` 推成 `unknown`，然后在每个方法体里报
 * 「Object is of type 'unknown'」。这里选择放弃对页面对象的静态检查——
 * 页面层薄、逻辑都在 `shell/` 与 `games/`（那两层是全类型检查的），
 * 真正容易出错的地方并没有因此失去保护。
 */
declare function App(options: any): void
declare function Page(options: any): void
declare function Component(options: any): void

/** WXML 事件对象里用到的字段 */
interface MiniTouch {
  identifier?: number
  x?: number
  y?: number
  clientX?: number
  clientY?: number
}

interface MiniTouchEvent {
  type: string
  touches: MiniTouch[]
  changedTouches: MiniTouch[]
  timeStamp: number
}

interface MiniEvent {
  type: string
  currentTarget: { id: string; dataset: Record<string, unknown> }
  detail: Record<string, unknown>
}
