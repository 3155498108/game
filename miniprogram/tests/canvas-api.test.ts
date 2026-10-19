/**
 * Canvas API 守卫。
 *
 * ## 防什么
 *
 * 小程序 `type="2d"` 的画布上下文虽然也叫 `CanvasRenderingContext2D`，
 * 但**它不是浏览器的实现**，支持的成员是微信自己定的一份子集。
 * 而本项目小程序侧的 tsconfig 里 `lib` 带着 `"DOM"`（为了拿到 `CanvasRenderingContext2D`
 * 这个类型），于是 `ctx.随便什么()` 在类型检查时**一律通过**——
 * 缺了只会在真机上炸，而真机是唯一能暴露这件事的地方。
 *
 * 所以这里把「小程序支持哪些 ctx 成员」钉成白名单：
 * 任何一个游戏用了名单外的成员，测试立刻变红，要求人先去核对官方文档再放行。
 *
 * ## 白名单怎么来的
 *
 * 取自本仓库 44 款游戏 + `render/` **实际用到的成员全集**，逐个对照 Canvas 2D
 * 标准接口（小程序 canvas 2d 的官方定位就是「与 H5 Canvas 2D 对齐」）。
 *
 * 名单外的成员**不是「一定不支持」，而是「需要人确认」**——
 * 这也是这份名单存在的意义：把「靠记忆判断支不支持」变成「一张要维护的表」。
 */
import { describe, expect, it } from 'vitest'

/** 小程序 canvas 2d 支持的 ctx 成员（方法与属性都在内） */
const SUPPORTED = new Set([
  // 路径
  'arc',
  'arcTo',
  'beginPath',
  'bezierCurveTo',
  'closePath',
  'ellipse',
  'lineTo',
  'moveTo',
  'quadraticCurveTo',
  'rect',
  // 绘制
  'clip',
  'fill',
  'fillRect',
  'stroke',
  'strokeRect',
  // 渐变
  'createLinearGradient',
  'createRadialGradient',
  // 变换
  'restore',
  'rotate',
  'save',
  'scale',
  'translate',
  // 线条
  'lineCap',
  'lineDashOffset',
  'lineJoin',
  'lineWidth',
  'setLineDash',
  'strokeStyle',
  // 文本
  'fillText',
  'font',
  'textAlign',
  'textBaseline',
  // 阴影与透明度
  'globalAlpha',
  'shadowBlur',
  'shadowColor',
  'shadowOffsetY',
  // 填充色
  'fillStyle',
])

const gameFiles = import.meta.glob('/miniprogram/games/*/index.ts', { query: '?raw', import: 'default', eager: true }) as unknown as Record<string, string>
const renderFiles = import.meta.glob('/miniprogram/render/*.ts', { query: '?raw', import: 'default', eager: true }) as unknown as Record<string, string>

/** 剥掉注释，避免注释里的字样被当成真调用 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1')
}

describe('Canvas API 守卫', () => {
  it('所有游戏与渲染层用到的 ctx 成员都在小程序支持名单内', () => {
    /** 成员 → 用了它的文件 */
    const used = new Map<string, Set<string>>()
    for (const [file, src] of Object.entries({ ...gameFiles, ...renderFiles })) {
      const body = stripComments(src)
      for (const m of body.matchAll(/\bctx\.([A-Za-z][A-Za-z0-9]*)/g)) {
        const member = m[1]
        if (!used.has(member)) used.set(member, new Set())
        used.get(member)!.add(file)
      }
    }

    const unknown = [...used.entries()]
      .filter(([member]) => !SUPPORTED.has(member))
      .map(([member, files]) => `${member}（${[...files].sort().join(', ')}）`)

    expect(
      unknown,
      '这些 ctx 成员不在小程序 canvas 2d 的已知支持名单里：先去核对官方文档，确认支持再加进 SUPPORTED',
    ).toEqual([])
  })

  it('白名单本身不是空的，且覆盖了实际用到的成员', () => {
    // 防止「名单被清空 → 检查恒真」这种退化
    expect(SUPPORTED.size).toBeGreaterThan(20)
    const used = new Set<string>()
    for (const src of Object.values({ ...gameFiles, ...renderFiles })) {
      for (const m of stripComments(src).matchAll(/\bctx\.([A-Za-z][A-Za-z0-9]*)/g)) used.add(m[1])
    }
    expect(used.size).toBeGreaterThan(20)
    for (const member of used) {
      expect(SUPPORTED.has(member), `${member} 用了但不在名单里`).toBe(true)
    }
  })
})
