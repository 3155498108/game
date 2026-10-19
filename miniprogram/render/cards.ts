/** 共用牌面绘制（纯程序绘制，无图片资源） */
import type { Card } from '../core/cards'
import { SUIT_SYMBOL, isJoker, isRed, rankLabel } from '../core/cards'
import { COLORS, FONT, fillRoundRect, roundRectPath } from './draw'

export interface CardDrawOpts {
  faceUp?: boolean
  highlight?: boolean
  dim?: boolean
  /** 0..1，翻牌动画进度（0.5 时最窄） */
  flip?: number
  selected?: boolean
}

export function drawCard(ctx: CanvasRenderingContext2D, card: Card | null, x: number, y: number, w: number, h: number, o: CardDrawOpts = {}): void {
  const faceUp = o.faceUp ?? card !== null
  ctx.save()
  // 翻牌：水平压缩
  if (o.flip !== undefined && o.flip < 1) {
    const k = Math.abs(Math.cos(o.flip * Math.PI))
    ctx.translate(x + w / 2, 0)
    ctx.scale(Math.max(0.02, k), 1)
    ctx.translate(-(x + w / 2), 0)
  }
  if (o.selected) y -= h * 0.12
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 3
  const r = Math.min(w, h) * 0.1
  if (!faceUp || !card) {
    fillRoundRect(ctx, x, y, w, h, r, COLORS.cardBack)
    ctx.shadowColor = 'transparent'
    roundRectPath(ctx, x + w * 0.08, y + w * 0.08, w * 0.84, h - w * 0.16, r * 0.7)
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 2
    ctx.stroke()
    // 菱形花纹
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    const cx = x + w / 2
    const cy = y + h / 2
    ctx.beginPath()
    ctx.moveTo(cx, cy - h * 0.22)
    ctx.lineTo(cx + w * 0.25, cy)
    ctx.lineTo(cx, cy + h * 0.22)
    ctx.lineTo(cx - w * 0.25, cy)
    ctx.closePath()
    ctx.fill()
  } else {
    fillRoundRect(ctx, x, y, w, h, r, COLORS.cardFace, o.highlight ? COLORS.accent : '#c9c4b8', o.highlight ? 5 : 1.5)
    ctx.shadowColor = 'transparent'
    const color = isJoker(card) ? (card.rank === 15 ? '#c62828' : '#333') : isRed(card) ? '#d32f2f' : '#1d1d1d'
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (isJoker(card)) {
      ctx.font = `bold ${Math.round(w * 0.42)}px ${FONT}`
      ctx.fillText('★', x + w / 2, y + h * 0.42)
      ctx.font = `bold ${Math.round(w * 0.2)}px ${FONT}`
      ctx.fillText(rankLabel(card.rank), x + w / 2, y + h * 0.75)
    } else {
      const lbl = rankLabel(card.rank)
      ctx.font = `bold ${Math.round(w * (lbl.length > 1 ? 0.28 : 0.32))}px ${FONT}`
      ctx.textAlign = 'left'
      ctx.fillText(lbl, x + w * 0.08, y + h * 0.13)
      ctx.font = `${Math.round(w * 0.24)}px ${FONT}`
      ctx.fillText(SUIT_SYMBOL[card.suit], x + w * 0.08, y + h * 0.3)
      ctx.textAlign = 'center'
      ctx.font = `${Math.round(w * 0.55)}px ${FONT}`
      ctx.fillText(SUIT_SYMBOL[card.suit], x + w * 0.58, y + h * 0.64)
    }
  }
  if (o.dim) {
    roundRectPath(ctx, x, y, w, h, r)
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fill()
  }
  ctx.restore()
}

/** 横向扇形排列手牌的位置计算（纯计算，可用于 input 命中） */
export function handLayout(n: number, vw: number, y: number, cardW: number, cardH: number, margin = 20): { x: number; y: number; w: number; h: number }[] {
  if (n === 0) return []
  const avail = vw - margin * 2
  const step = n === 1 ? 0 : Math.min(cardW + 10, (avail - cardW) / (n - 1))
  const total = step * (n - 1) + cardW
  const x0 = (vw - total) / 2
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * step, y, w: i === n - 1 ? cardW : Math.max(step, 1), h: cardH }))
}
