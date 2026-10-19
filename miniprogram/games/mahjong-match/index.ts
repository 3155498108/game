/**
 * 麻将对对消：渲染 + 输入映射。
 * 规则全在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas、把指针翻译成 action。
 *
 * 三条分层约定：
 * 1. **计时不进 state**：用时由本文件（渲染层）用 anim.now() 自行计时，
 *    站点壳点「新的一局」会用新种子重新 create()，渲染层据此把计时归零。
 * 2. **动画走旁路缓存**：翻牌用 progressSince（签名只含这张牌自身的可见状态，
 *    避免每翻一张牌就让全盘抖动），消除用 clears 序号做签名，提示高亮用 pulse。
 * 3. **存档**：总步数走壳的 outcome/submitBest（key 契约 gs:mahjong-match:best）；
 *    每关的最少步数与最快用时额外写到 gs:mahjong-match:lv1..lv3，
 *    写入发生在 effects()（状态迁移之后），不污染 reduce。
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { COLORS, background, ease, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { keepAlive, now, progressSince, pulse } from '../../render/anim'
import type { Point, Rect } from '../../core/geom'
import { clamp, inRect } from '../../core/geom'
import { bestKey, readJSON, writeJSON } from '../../core/storage'
import meta from './meta'
import {
  GONE,
  KINDS,
  LEVELS,
  create,
  partnerOf,
  playable,
  reduce,
  type Action,
  type State,
} from './rules'

export const VW = 720
export const VH = 1280

// ---------------- 布局：render 与 input 共用同一份常量 ----------------
/** 牌阵可用区域 */
const AREA: Rect = { x: 24, y: 214, w: 672, h: 838 }
/** 牌与牌的间隙 */
const GAP = 14
/** 底部信息面板 */
const FOOTER: Rect = { x: 40, y: 1072, w: VW - 80, h: 172 }
/** 牌面长宽比（麻将牌竖着略长） */
const ASPECT = 0.72

export interface BoardLayout {
  x: number
  y: number
  /** 单张牌宽高 */
  w: number
  h: number
  /** 整块牌阵的宽高 */
  bw: number
  bh: number
}

/** 按关卡行列数算出牌阵布局；牌阵在可用区域里居中 */
export function boardLayout(cols: number, rows: number): BoardLayout {
  const maxW = (AREA.w - (cols - 1) * GAP) / cols
  const maxH = (AREA.h - (rows - 1) * GAP) / rows
  let w = Math.min(maxW, maxH * ASPECT)
  let h = Math.min(maxH, w / ASPECT)
  const bw = cols * w + (cols - 1) * GAP
  const bh = rows * h + (rows - 1) * GAP
  return { x: (VW - bw) / 2, y: AREA.y + (AREA.h - bh) / 2, w, h, bw, bh }
}

/** 第 index 张牌的矩形 */
export function tileRect(s: State, index: number): Rect {
  const L = boardLayout(s.cols, s.rows)
  const col = index % s.cols
  const row = Math.floor(index / s.cols)
  return { x: L.x + col * (L.w + GAP), y: L.y + row * (L.h + GAP), w: L.w, h: L.h }
}

export function tileCenter(s: State, index: number): [number, number] {
  const r = tileRect(s, index)
  return [r.x + r.w / 2, r.y + r.h / 2]
}

/** 命中测试：点在牌阵内且该牌未被消除时返回下标，否则 -1 */
export function hitTile(s: State, p: Point): number {
  const L = boardLayout(s.cols, s.rows)
  if (!inRect(p, { x: L.x, y: L.y, w: L.bw, h: L.bh })) return -1
  const col = Math.floor((p.x - L.x) / (L.w + GAP))
  const row = Math.floor((p.y - L.y) / (L.h + GAP))
  if (col < 0 || col >= s.cols || row < 0 || row >= s.rows) return -1
  const i = row * s.cols + col
  // 复用规则层的 playable：已消除的牌、以及当前已选中的第一张都不可再点
  return playable(s, i) ? i : -1
}

// ---------------- 计时（只在渲染层，不进 state） ----------------

/** 每关的一条最佳成绩：最少步数 + 最快用时（毫秒） */
interface LevelRecord {
  moves: number
  ms: number
}

const clock = {
  /** 当前计时的关卡，-1 表示还没开始 */
  level: -1,
  /** 本关开始时刻（anim.now() 域） */
  startedAt: 0,
  /** 各关累计用时 */
  levelMs: LEVELS.map(() => 0),
  /** 各关是否已结算冻结 */
  captured: LEVELS.map(() => false),
  /** 是否已经发生过实际进展，用于识别壳发来的「新的一局」 */
  progressed: false,
}

let bestRecords: (LevelRecord | null)[] = LEVELS.map(() => null)
let recordsLoaded = false

function loadRecords(): void {
  if (recordsLoaded) return
  recordsLoaded = true
  bestRecords = LEVELS.map((_, i) => {
    const v = readJSON<LevelRecord | null>(`${bestKey(meta.id)}:lv${i + 1}`, null)
    return v && typeof v.moves === 'number' && typeof v.ms === 'number' ? v : null
  })
}

/** 两项成绩各自取优（最少步数 / 最快用时），有提升才落盘 */
function saveRecord(level: number, moves: number, ms: number): void {
  loadRecords()
  const prev = bestRecords[level]
  const next: LevelRecord = { moves: prev ? Math.min(prev.moves, moves) : moves, ms: prev ? Math.min(prev.ms, ms) : ms }
  if (prev && next.moves === prev.moves && next.ms === prev.ms) return
  bestRecords[level] = next
  writeJSON(`${bestKey(meta.id)}:lv${level + 1}`, next)
}

/** 本关消完时冻结用时（幂等） */
function captureLevel(s: State, t: number): void {
  if (s.moves > 0 || s.pairs > 0 || s.levelClear || s.level > 0) clock.progressed = true
  const lv = s.level
  if (!s.levelClear || lv < 0 || lv >= LEVELS.length || clock.captured[lv]) return
  clock.levelMs[lv] = t - clock.startedAt
  clock.captured[lv] = true
}

/** 与状态对齐后返回「本关已用时」；本关已消完则返回冻结值 */
function syncClock(s: State): number {
  const t = now()
  if (clock.level !== s.level) {
    clock.level = s.level
    clock.startedAt = t
    captureLevel(s, t)
    return clock.levelMs[s.level]
  }
  // 站点壳的「新的一局」会重新 create() → 回到 0 关 0 步，据此把计时归零
  if (clock.progressed && s.level === 0 && s.moves === 0 && s.pairs === 0 && !s.levelClear) {
    clock.levelMs = LEVELS.map(() => 0)
    clock.captured = LEVELS.map(() => false)
    clock.progressed = false
    clock.startedAt = t
  }
  captureLevel(s, t)
  return s.levelClear ? clock.levelMs[s.level] : t - clock.startedAt
}

/** 本关结束后的累计用时（三关全清时才需要） */
function totalMs(): number {
  return clock.levelMs.reduce((a, b) => a + b, 0)
}

function fmtMs(ms: number): string {
  const s = Math.max(0, ms) / 1000
  return s < 60 ? `${s.toFixed(1)} 秒` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

// ---------------- 牌面配色 ----------------
/** 万红、条绿、筒蓝 */
const SUIT_COLORS = ['#d32f2f', '#2e7d32', '#1565c0']
/** 东南西北中发白 */
const HONOR_COLORS = ['#1d3557', '#1d3557', '#1d3557', '#1d3557', '#d32f2f', '#2e7d32', '#1565c0']

function faceColor(face: number): string {
  const k = KINDS[face]
  if (!k) return COLORS.text
  return k.suit === 3 ? HONOR_COLORS[k.rank - 1] : SUIT_COLORS[k.suit]
}

// ---------------- 绘制 ----------------

function statusText(s: State): string {
  if (s.allDone) return '三关全部通关'
  if (s.levelClear) return '本关消完，点「下一关」继续'
  if (s.dead) return '没有可消的牌了，点「重排牌面」'
  if (s.pending) return '不是一对，点任意处盖回'
  if (s.first >= 0) return '再翻一张：同牌面且能连通即可消除'
  return '翻两张牌面相同、且能连通的麻将牌'
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  const levelMs = syncClock(s)
  // 计时显示需要持续重绘；结算后停止省电
  if (!s.levelClear && !s.allDone) keepAlive()
  loadRecords()

  background(ctx, VW, VH, '#0f6a4f', '#05301f')
  topBar(ctx, VW, '麻将对对消', `第 ${s.level + 1} 关`, 96)
  shadowText(ctx, statusText(s), VW / 2, 152, { size: 27, color: COLORS.textDim, weight: 'normal' })
  drawLevelPills(ctx, s, levelMs)

  // 牌桌底板
  const L = boardLayout(s.cols, s.rows)
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, L.x - 20, L.y - 20, L.bw + 40, L.bh + 40, 24, 'rgba(4,38,26,0.55)')
  ctx.restore()
  fillRoundRect(ctx, L.x - 20, L.y - 20, L.bw + 40, L.bh + 40, 24, 'rgba(255,255,255,0.04)', withAlpha(COLORS.accent2, 0.22), 2)

  // 每张牌当前能不能配上另一张，一次算完整盘再画
  const partners = s.faces.map((f, i) => (f === GONE ? -1 : partnerOf(s, i)))
  for (let i = 0; i < s.faces.length; i++) drawTile(ctx, s, i, partners[i])

  drawFooter(ctx, s)
  if (s.dead && !s.levelClear && !s.allDone) panel(ctx, '没有可消的牌了', [['剩余牌面已无连通解', '']], '点「重排牌面」重新摆放', COLORS.red)
  else if (s.levelClear && !s.allDone) panel(ctx, `第 ${s.level + 1} 关完成`, levelRows(s), '点「下一关」继续', COLORS.accent)
  if (s.allDone) drawSummary(ctx, s)
}

function drawLevelPills(ctx: CanvasRenderingContext2D, s: State, levelMs: number): void {
  for (let i = 0; i < LEVELS.length; i++) {
    const x = 34 + i * 78
    const done = s.level > i || (s.level === i && s.levelClear)
    const cur = s.level === i
    fillRoundRect(ctx, x, 174, 62, 34, 17, cur ? COLORS.accent : done ? 'rgba(255,204,51,0.28)' : 'rgba(255,255,255,0.12)')
    text(ctx, String(i + 1), x + 31, 192, { size: 22, weight: 'bold', color: cur ? '#2a1c00' : COLORS.text })
  }
  text(ctx, `用时 ${fmtMs(levelMs)}`, VW - 34, 192, { size: 26, weight: 'bold', color: COLORS.accent, align: 'right' })
}

function drawTile(ctx: CanvasRenderingContext2D, s: State, i: number, partner: number): void {
  const r = tileRect(s, i)
  const face = s.faces[i]
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const selected = i === s.first
  const showing = i === s.second
  const up = face !== GONE && (selected || showing)

  if (face === GONE) {
    // 已消除：留一个淡淡的空槽；刚消掉的那两张播一小段淡出
    const justCleared = s.matched.indexOf(i) >= 0
    if (justCleared) {
      const p = progressSince('mm-clear-' + i, `${s.clears}`, 320)
      if (p < 1) {
        ctx.save()
        ctx.globalAlpha = 1 - p
        ctx.translate(cx, cy)
        ctx.scale(1 - 0.4 * p, 1 - 0.4 * p)
        ctx.translate(-cx, -cy)
        drawTileFace(ctx, r, face)
        ctx.restore()
        return
      }
    }
    ctx.save()
    ctx.globalAlpha = 0.18
    fillRoundRect(ctx, r.x + 6, r.y + 6, r.w - 12, r.h - 12, 14, 'rgba(0,0,0,0)', 'rgba(255,255,255,0.4)', 2)
    ctx.restore()
    return
  }

  // 翻牌：签名只含这张牌自身的可见状态，避免每次翻牌都让全盘抖一下
  const p = progressSince('mm-face-' + i, `${up ? 1 : 0}`, 240)
  ctx.save()
  if (up && p < 1) {
    const k = 0.86 + 0.14 * ease.outCubic(p)
    ctx.translate(cx, cy)
    ctx.scale(k, k)
    ctx.translate(-cx, -cy)
  }
  if (up) {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 14
    ctx.shadowOffsetY = 6
    fillRoundRect(ctx, r.x, r.y - (selected ? 14 : 0), r.w, r.h, 14, '#fdf7e4')
    ctx.restore()
    drawTileFace(ctx, { ...r, y: r.y - (selected ? 14 : 0) }, face)
  } else {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.42)'
    ctx.shadowBlur = 12
    ctx.shadowOffsetY = 5
    fillRoundRect(ctx, r.x, r.y, r.w, r.h, 14, '#1b6b4a', '#0d3d28', 3)
    ctx.restore()
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'
    ctx.lineWidth = 2
    fillRoundRect(ctx, r.x + 9, r.y + 9, r.w - 18, r.h - 18, 10, 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.22)', 2)
    ctx.restore()
    drawBackGlyph(ctx, cx, cy, r.w)
  }
  ctx.restore()

  // 高亮：能配上牌的牌给一圈描边；已选中第一张时，它的搭档给更醒目的呼吸描边
  if (!up) {
    if (s.first >= 0 && partner === s.first && partner >= 0) {
      const beat = pulse(700)
      fillRoundRect(ctx, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 12, 'rgba(0,0,0,0)', COLORS.accent, 4)
      ctx.save()
      ctx.globalAlpha = 0.12 + 0.3 * beat
      fillRoundRect(ctx, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 12, COLORS.accent)
      ctx.restore()
    } else if (partner >= 0) {
      fillRoundRect(ctx, r.x + 4, r.y + 4, r.w - 8, r.h - 8, 12, 'rgba(0,0,0,0)', 'rgba(255,255,255,0.55)', 3)
    }
  }
  if (s.hover === i && !up && !s.levelClear && !s.allDone) {
    fillRoundRect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 13, 'rgba(0,0,0,0)', 'rgba(255,255,255,0.85)', 3)
  }
}

/** 牌面：汉字主字 + 花色小字，纯程序绘制 */
function drawTileFace(ctx: CanvasRenderingContext2D, r: Rect, face: number): void {
  const k = KINDS[face]
  if (!k) return
  const color = faceColor(face)
  if (k.suit === 3) {
    text(ctx, k.text, r.x + r.w / 2, r.y + r.h / 2, { size: r.w * 0.62, weight: 'bold', color })
    return
  }
  text(ctx, k.suitText, r.x + r.w / 2, r.y + r.h * 0.18, { size: r.w * 0.24, weight: 'bold', color })
  text(ctx, k.text, r.x + r.w / 2, r.y + r.h * 0.53, { size: r.w * 0.46, weight: 'bold', color })
  text(ctx, k.suitText, r.x + r.w / 2, r.y + r.h * 0.84, { size: r.w * 0.2, weight: 'bold', color })
}

/** 牌背花纹：一枚菱形加两点 */
function drawBackGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number): void {
  const s = w * 0.2
  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.34)'
  ctx.beginPath()
  ctx.moveTo(cx, cy - s)
  ctx.lineTo(cx + s, cy)
  ctx.lineTo(cx, cy + s)
  ctx.lineTo(cx - s, cy)
  ctx.closePath()
  ctx.fill()
  ctx.fillRect(cx - w * 0.06, cy + s * 0.4, w * 0.12, w * 0.12)
  ctx.fillRect(cx + w * 0.02, cy + s * 0.4, w * 0.12, w * 0.12)
  ctx.restore()
}

function drawFooter(ctx: CanvasRenderingContext2D, s: State): void {
  const left = countTiles(s.faces)
  const rec = bestRecords[s.level]
  fillRoundRect(ctx, FOOTER.x, FOOTER.y, FOOTER.w, FOOTER.h, 22, 'rgba(0,0,0,0.28)', 'rgba(255,255,255,0.1)', 2)
  text(
    ctx,
    rec ? `本关最佳 ${rec.moves} 步 · ${fmtMs(rec.ms)}` : `第 ${s.level + 1} 关 · ${LEVELS[s.level].name}`,
    VW / 2,
    FOOTER.y + 36,
    { size: 26, color: COLORS.textDim },
  )
  const cols = [FOOTER.x + FOOTER.w / 6, FOOTER.x + FOOTER.w / 2, FOOTER.x + (FOOTER.w * 5) / 6]
  const stats: Array<[string, string]> = [
    ['已用步数', String(s.moves)],
    ['剩余牌数', String(left)],
    ['配对成功', String(s.pairs)],
  ]
  for (let k = 0; k < stats.length; k++) {
    text(ctx, stats[k][0], cols[k], FOOTER.y + 88, { size: 24, color: COLORS.textDim })
    text(ctx, stats[k][1], cols[k], FOOTER.y + 132, { size: 40, weight: 'bold', color: k === 0 ? COLORS.accent : COLORS.text })
  }
}

function countTiles(faces: readonly number[]): number {
  let n = 0
  for (let i = 0; i < faces.length; i++) if (faces[i] !== GONE) n++
  return n
}

// ---------------- 浮层面板 ----------------

function panel(ctx: CanvasRenderingContext2D, title: string, rows: Array<[string, string]>, foot: string, color: string): void {
  const top = 400
  const h = 260 + rows.length * 56
  ctx.save()
  ctx.fillStyle = 'rgba(3,26,18,0.86)'
  ctx.fillRect(0, 240, VW, VH - 300)
  ctx.restore()
  drawPanelBox(ctx, top, h)
  shadowText(ctx, title, VW / 2, top + 76, { size: 52, color })
  for (let i = 0; i < rows.length; i++) panelRow(ctx, top + 150 + i * 56, rows[i][0], rows[i][1])
  text(ctx, foot, VW / 2, top + h - 56, { size: 28, color: COLORS.textDim })
}

function drawPanelBox(ctx: CanvasRenderingContext2D, top: number, h: number): void {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 30
  ctx.shadowOffsetY = 12
  fillRoundRect(ctx, 70, top, VW - 140, h, 28, 'rgba(6,42,30,0.96)')
  ctx.restore()
  fillRoundRect(ctx, 70, top, VW - 140, h, 28, 'rgba(0,0,0,0)', COLORS.accent2, 2)
}

function panelRow(ctx: CanvasRenderingContext2D, y: number, left: string, right: string): void {
  text(ctx, left, 110, y, { size: 29, align: 'left', color: COLORS.text })
  text(ctx, right, VW - 110, y, { size: 31, weight: 'bold', align: 'right', color: COLORS.accent })
}

/** 本关成绩行：步数 / 用时 / 历史最佳 */
function levelRows(s: State): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['本关步数', `${s.moves} 步`],
    ['本关用时', fmtMs(clock.levelMs[s.level])],
  ]
  const rec = bestRecords[s.level]
  if (rec) rows.push(['本关最佳', `${rec.moves} 步 · ${fmtMs(rec.ms)}`])
  return rows
}

function drawSummary(ctx: CanvasRenderingContext2D, s: State): void {
  const top = 300
  const h = 300 + LEVELS.length * 54 + 150
  ctx.save()
  ctx.fillStyle = 'rgba(3,26,18,0.88)'
  ctx.fillRect(0, 180, VW, VH - 240)
  ctx.restore()
  drawPanelBox(ctx, top, h)
  shadowText(ctx, '全部通关！', VW / 2, top + 74, { size: 54, color: COLORS.accent, shadowBlur: 12 })
  for (let i = 0; i < LEVELS.length; i++) {
    const rec = bestRecords[i]
    panelRow(ctx, top + 146 + i * 54, `第 ${i + 1} 关 ${LEVELS[i].name}`, rec ? `${rec.moves} 步 · ${fmtMs(rec.ms)}` : '—')
  }
  text(ctx, `总步数 ${s.totalMoves} · 总用时 ${fmtMs(totalMs())}`, VW / 2, top + h - 96, { size: 32, weight: 'bold', color: COLORS.accent })
  text(ctx, '点「新的一局」挑战更少步数、更快用时', VW / 2, top + h - 46, { size: 26, color: COLORS.textDim })
}

// ---------------- 模块接口 ----------------

function input(s: State, p: PointerInput): Action | null {
  if (p.kind === 'move') {
    if (s.allDone || s.levelClear || s.pending) return s.hover === -1 ? null : { type: 'leave' }
    const i = hitTile(s, p)
    return s.hover === i ? null : { type: 'hover', index: i }
  }
  if (p.kind !== 'down') return null
  if (s.allDone || s.levelClear) return null
  // 翻错时点画面任意处盖回（主路径）
  if (s.pending) return { type: 'settle' }
  const i = hitTile(s, p)
  return i < 0 ? null : { type: 'pick', index: i }
}

function key(s: State, k: string): Action | null {
  if (s.levelClear && !s.allDone && (k === 'Enter' || k === ' ')) return { type: 'next' }
  if (s.allDone || s.levelClear) return null
  if (k === ' ' || k === 'Enter') {
    if (s.pending) return { type: 'settle' }
    return s.hover < 0 ? null : { type: 'pick', index: s.hover }
  }
  const step = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : k === 'ArrowDown' ? s.cols : k === 'ArrowUp' ? -s.cols : 0
  if (step === 0) return null
  const from = s.hover < 0 ? 0 : s.hover
  const index = clamp(from + step, 0, s.faces.length - 1)
  return index === s.hover ? null : { type: 'hover', index }
}

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  loadRecords()
  if (next.clears > prev.clears) {
    out.push({ kind: 'sound', name: 'score' })
    for (const i of next.matched) {
      const [x, y] = tileCenter(next, i)
      out.push({ kind: 'burst', x, y, color: faceColor(prev.faces[i]), count: 14 })
    }
  }
  if (next.first >= 0 && prev.first < 0) out.push({ kind: 'sound', name: 'flip' })
  if (next.pending && !prev.pending) out.push({ kind: 'sound', name: 'error' })
  if (prev.pending && !next.pending && next.clears === prev.clears) out.push({ kind: 'sound', name: 'click' })
  if (prev.dead && !next.dead && next.clears === prev.clears) out.push({ kind: 'sound', name: 'place' })

  if (next.levelClear && !prev.levelClear) {
    captureLevel(next, now())
    saveRecord(next.level, next.moves, clock.levelMs[next.level])
    out.push({ kind: 'sound', name: 'win' })
    out.push({ kind: 'flash', color: 'rgba(255,204,51,0.25)' })
  }
  if (next.dead && !prev.dead) out.push({ kind: 'sound', name: 'lose' })
  if (next.allDone && !prev.allDone) {
    out.push({ kind: 'sound', name: 'win' })
    out.push({ kind: 'shake', power: 6 })
  }
  if (next.level !== prev.level) out.push({ kind: 'sound', name: 'place' })
  return out
}

function outcome(s: State): Outcome | null {
  if (!s.allDone) return null
  return { score: s.totalMoves, better: 'lower', unit: ' 步', win: true }
}

function controls(s: State): Control<Action>[] {
  if (s.allDone) return []
  if (s.levelClear) return [{ label: '下一关', action: { type: 'next' }, primary: true }]
  if (s.dead) return [{ label: '重排牌面', action: { type: 'reshuffle' }, primary: true }]
  if (s.pending) return [{ label: '盖回这两张', action: { type: 'settle' }, primary: true }]
  return []
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  input,
  key,
  effects,
  outcome,
  controls,
  hint: (s) =>
    s.allDone
      ? `三关全部通关，总步数 ${s.totalMoves}`
      : s.levelClear
        ? `第 ${s.level + 1} 关完成，共 ${s.moves} 步，点「下一关」继续`
        : s.dead
          ? '剩余牌面已无连通解，点「重排牌面」重新摆一摆'
          : s.pending
            ? '不是一对，点画面任意处或点「盖回这两张」'
            : '翻两张牌面相同、且中间有连通路径的麻将牌；最多拐一次弯，可绕出盘面',
}

export default game