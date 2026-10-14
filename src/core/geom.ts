/** 纯几何工具（无 DOM），供规则与输入映射使用 */

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function inRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** 网格命中：返回 [col,row] 或 null */
export function gridHit(
  p: Point,
  originX: number,
  originY: number,
  cellW: number,
  cellH: number,
  cols: number,
  rows: number,
): [number, number] | null {
  const c = Math.floor((p.x - originX) / cellW)
  const r = Math.floor((p.y - originY) / cellH)
  if (c < 0 || r < 0 || c >= cols || r >= rows) return null
  return [c, r]
}

/** 把固定宽度按钮横向排成一行，返回各按钮矩形（居中） */
export function rowLayout(count: number, y: number, w: number, h: number, gap: number, totalW: number): Rect[] {
  const full = count * w + (count - 1) * gap
  const x0 = (totalW - full) / 2
  return Array.from({ length: count }, (_, i) => ({ x: x0 + i * (w + gap), y, w, h }))
}
