/**
 * 小程序入口。刻意保持为空壳：
 * 网页版把金币 / 存档 / 每日挑战的初始化都放在各页面的 onLoad，
 * 这里再往 App 上挂一份 globalData 只会制造「两处真相」。
 *
 * 唯一的例外是 `performance` 垫片：它必须在任何页面加载之前装好，
 * 因为共享层 `render/anim.ts` 直接读全局 `performance.now()`，
 * 而小程序默认没有这个对象（详见 shell/perf.ts 的说明）。
 */
import { installPerfShim } from './shell/perf'

installPerfShim()

App({
  globalData: {
    /** 站点壳版本号，方便真机上确认装的是哪一份包 */
    version: '0.1.0-pilot',
  },
})
