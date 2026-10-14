/** 共用渲染层：颜色常量、圆角矩形、阴影文本、缓动函数、常用控件 */
import type { Rect } from '../core/geom'

export const COLORS = {
  bg: '#0f1b2d',
  bg2: '#16263d',
  panel: '#1f3352',
  panelLight: '#2b4468',
  line: '#3a5680',
  text: '#f4f7fb',
  textDim: '#9fb3cf',
  accent: '#ffcc33',
  accent2: '#4fd1c5',
  red: '#ef5350',
  green: '#66bb6a',
  blue: '#42a5f5',
  yellow: '#ffd54f',
  purple: '#ab47bc',
  orange: '#ffa726',
  pink: '#f06292',
  black: '#1b1b1f',
  white: '#fafafa',
  felt: '#1e6b46',
  feltDark: '#155236',
  wood: '#c99a5b',
  woodDark: '#8a6235',
  cardFace: '#fffdf7',
  cardBack: '#3949ab',
  letterbox: '#08111e',
} as const

/** 用于多色游戏（记忆、消除等）的调色板 */
export const PALETTE = ['#ef5350', '#42a5f5', '#66bb6a', '#ffd54f', '#ab47bc', '#ffa726', '#26c6da', '#f06292']

export const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif'

// ---------------- 缓动函数 ----------------
export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => t * (2 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
  },
  outBounce: (t: number) => {
    const n1 = 7.5625
    const d1 = 2.75
    if (t < 1 / d1) return n1 * t * t
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
    return n1 * (t -= 2.625 / d1) * t + 0.984375
  },
}

// ---------------- 基础图元 ----------------
export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}

export function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string | CanvasGradient,
  stroke?: string,
  lineWidth = 2,
): void {
  roundRectPath(ctx, x, y, w, h, r)
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = lineWidth
    ctx.stroke()
  }
}

export interface TextOpts {
  size?: number
  color?: string
  align?: CanvasTextAlign
  baseline?: CanvasTextBaseline
  weight?: string | number
  shadow?: string
  shadowBlur?: number
  maxWidth?: number
}

/** 阴影文本 */
export function shadowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: TextOpts = {}): void {
  ctx.save()
  ctx.font = `${o.weight ?? 'bold'} ${o.size ?? 32}px ${FONT}`
  ctx.textAlign = o.align ?? 'center'
  ctx.textBaseline = o.baseline ?? 'middle'
  ctx.shadowColor = o.shadow ?? 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = o.shadowBlur ?? 6
  ctx.shadowOffsetY = 2
  ctx.fillStyle = o.color ?? COLORS.text
  ctx.fillText(text, x, y, o.maxWidth)
  ctx.restore()
}

/** 无阴影文本 */
export function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, o: TextOpts = {}): void {
  ctx.font = `${o.weight ?? 'normal'} ${o.size ?? 28}px ${FONT}`
  ctx.textAlign = o.align ?? 'center'
  ctx.textBaseline = o.baseline ?? 'middle'
  ctx.fillStyle = o.color ?? COLORS.text
  ctx.fillText(s, x, y, o.maxWidth)
}

/** 背景：竖向渐变 */
export function background(ctx: CanvasRenderingContext2D, w: number, h: number, top: string = COLORS.bg2, bottom: string = COLORS.bg): void {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, top)
  g.addColorStop(1, bottom)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

/** 立体圆形棋子 */
export function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, opts: { ring?: string; alpha?: number } = {}): void {
  ctx.save()
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = r * 0.25
  ctx.shadowOffsetY = r * 0.08
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r)
  g.addColorStop(0, lighten(color, 0.45))
  g.addColorStop(1, color)
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = g
  ctx.fill()
  ctx.shadowColor = 'transparent'
  if (opts.ring) {
    ctx.lineWidth = Math.max(2, r * 0.12)
    ctx.strokeStyle = opts.ring
    ctx.stroke()
  }
  ctx.restore()
}

/** 画布内按钮（逻辑坐标）。注意按钮高度建议 ≥ 110 逻辑像素以保证最小缩放下 ≥44px */
export function button(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  o: { color?: string; textColor?: string; disabled?: boolean; size?: number; active?: boolean } = {},
): void {
  ctx.save()
  ctx.globalAlpha = o.disabled ? 0.4 : 1
  const base = o.color ?? COLORS.panelLight
  const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h)
  g.addColorStop(0, lighten(base, 0.15))
  g.addColorStop(1, base)
  ctx.shadowColor = 'rgba(0,0,0,0.4)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 3
  fillRoundRect(ctx, r.x, r.y, r.w, r.h, Math.min(24, r.h / 3), g)
  ctx.shadowColor = 'transparent'
  if (o.active) {
    roundRectPath(ctx, r.x, r.y, r.w, r.h, Math.min(24, r.h / 3))
    ctx.strokeStyle = COLORS.accent
    ctx.lineWidth = 5
    ctx.stroke()
  }
  text(ctx, label, r.x + r.w / 2, r.y + r.h / 2 + 1, { size: o.size ?? 34, weight: 'bold', color: o.textColor ?? COLORS.text })
  ctx.restore()
}

/** 半透明结算横幅 */
export function banner(ctx: CanvasRenderingContext2D, vw: number, vh: number, title: string, sub = '', color: string = COLORS.accent): void {
  ctx.save()
  ctx.fillStyle = 'rgba(5,10,20,0.62)'
  ctx.fillRect(0, vh / 2 - 130, vw, 260)
  shadowText(ctx, title, vw / 2, vh / 2 - (sub ? 30 : 0), { size: Math.min(80, vw / 9), color })
  if (sub) shadowText(ctx, sub, vw / 2, vh / 2 + 55, { size: Math.min(36, vw / 20), color: COLORS.text, weight: 'normal' })
  ctx.restore()
}

/** 顶部信息栏：左右两段文字 */
export function topBar(ctx: CanvasRenderingContext2D, vw: number, left: string, right = '', h = 90): void {
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fillRect(0, 0, vw, h)
  text(ctx, left, 30, h / 2, { size: 34, align: 'left', weight: 'bold' })
  if (right) text(ctx, right, vw - 30, h / 2, { size: 34, align: 'right', weight: 'bold', color: COLORS.accent })
}

// ---------------- 颜色工具 ----------------
function parseHex(c: string): [number, number, number] | null {
  if (!c.startsWith('#')) return null
  let h = c.slice(1)
  if (h.length === 3) h = h.split('').map((x) => x + x).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function lighten(c: string, amt: number): string {
  const rgb = parseHex(c)
  if (!rgb) return c
  const [r, g, b] = rgb.map((v) => Math.round(v + (255 - v) * amt))
  return `rgb(${r},${g},${b})`
}

export function darken(c: string, amt: number): string {
  const rgb = parseHex(c)
  if (!rgb) return c
  const [r, g, b] = rgb.map((v) => Math.round(v * (1 - amt)))
  return `rgb(${r},${g},${b})`
}

export function withAlpha(c: string, a: number): string {
  const rgb = parseHex(c)
  if (!rgb) return c
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`
}
