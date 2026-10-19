/**
 * 6 连珠：渲染 + 输入映射。
 * 规则全部在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas、把指针翻译成 action。
 *
 * 动画与计时不进 state：
 * - 消除反馈用 anim.elapsedSince('ls6-clear-<格>', clears) 按「本次消除序号 + 格子」做缩放落位；
 * - 分数滚动用 anim.tweenTo，可消除提示用 anim.pulse；
 * - 粒子 / 音效通过 effects() 交给站点壳执行。
 */
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import { COLORS, PALETTE, background, banner, disc, ease, fillRoundRect, shadowText, text, topBar, withAlpha } from '../../render/draw'
import { progressSince, pulse, tweenTo } from '../../render/anim'
import { gridHit } from '../../core/geom'
import meta from './meta'
import { CELL_COUNT, COLS, COLORS as BALL_KINDS, MATCH_MIN, ROWS, create, reduce, type Action, type State } from './rules'

export const VW = 720
export const VH = 1280

// ---------------- 布局：render 与 input 共用同一份常量 ----------------
/** 单格 88 逻辑像素（含 8 的间隙，pitch 96），远大于 44px 触控下限 */
export const CELL = 88
export const GAP = 8
export const PITCH = CELL + GAP
export const BALL_R = 40
/** 棋盘左上角 */
export const BOARD_X = Math.round((VW - (COLS * PITCH - GAP)) / 2)
export const BOARD_Y = 196
export const BOARD_W = COLS * PITCH - GAP
export const BOARD_H = ROWS * PITCH - GAP
/** 棋盘底板（含外边距） */
export const BOARD_RECT = { x: BOARD_X - 16, y: BOARD_Y - 16, w: BOARD_W + 32, h: BOARD_H + 32 }
export const FOOTER = { x: 32, y: 1080, w: VW - 64, h: 152 }

/** 球色对应的调色板（rules.ts 只存颜色编号，取色在这里做） */
export const BALL_COLORS: string[] = PALETTE.slice(0, BALL_KINDS)

function colorOf(kind: number): string {
  return BALL_COLORS[(kind - 1) % BALL_COLORS.length] || COLORS.accent
}

/** 第 index 格的中心点 */
export function centerOf(index: number): [number, number] {
  const col = index % COLS
  const row = Math.floor(index / COLS)
  return [BOARD_X + col * PITCH + CELL / 2, BOARD_Y + row * PITCH + CELL / 2]
}

/** 命中测试：返回格子索引，点在棋盘外返回 -1 */
export function hitCell(p: { x: number; y: number }): number {
  const hit = gridHit(p, BOARD_X, BOARD_Y, PITCH, PITCH, COLS, ROWS)
  return hit ? hit[1] * COLS + hit[0] : -1
}

// ---------------- 绘制 ----------------

function statusText(s: State): string {
  if (s.path.length >= MATCH_MIN) return `已连 ${s.path.length} 个 · 松手消除`
  if (s.path.length > 0) return `已连 ${s.path.length} 个 · 还差 ${MATCH_MIN - s.path.length} 个`
  return '按住一个球拖动，连出 4 个以上同色球'
}

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH, '#123f6b', '#0b1c33')
  const shownScore = Math.round(tweenTo('ls6-score', s.score, 320))
  topBar(ctx, VW, '6 连珠', `分数 ${shownScore}`, 96)
  shadowText(ctx, statusText(s), VW / 2, 152, { size: 27, color: COLORS.textDim, weight: 'normal' })

  // 棋盘底板
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, BOARD_RECT.x, BOARD_RECT.y, BOARD_RECT.w, BOARD_RECT.h, 26, 'rgba(6,16,32,0.55)')
  ctx.restore()
  fillRoundRect(ctx, BOARD_RECT.x, BOARD_RECT.y, BOARD_RECT.w, BOARD_RECT.h, 26, 'rgba(255,255,255,0.04)', COLORS.line, 2)

  for (let i = 0; i < CELL_COUNT; i++) drawCell(ctx, s, i)

  drawPath(ctx, s)
  drawHover(ctx, s)
  drawFooter(ctx, s, shownScore)

  if (s.combo >= 2) {
    const beat = pulse(760)
    shadowText(ctx, `连击 ×${s.combo}`, VW / 2, VH - 168, {
      size: 40,
      color: COLORS.accent,
      shadowBlur: 10 + 16 * beat,
    })
  }

  if (s.over) banner(ctx, VW, VH, '无可消除', `共洗牌 ${s.shuffles} 次 · 得分 ${s.score}`)
}

function drawCell(ctx: CanvasRenderingContext2D, s: State, i: number): void {
  const [cx, cy] = centerOf(i)
  const kind = s.cells[i]
  if (kind === 0) {
    ctx.save()
    ctx.fillStyle = 'rgba(255,255,255,0.07)'
    ctx.beginPath()
    ctx.arc(cx, cy, BALL_R, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }
  // 消除反馈：只按「本次消除序号 + 格子索引」取进度，纯视觉，不参与规则
  const cleared = s.lastCleared.indexOf(i) >= 0
  const p = cleared ? progressSince('ls6-clear-' + i, `${s.clears}`, 340, ease.outBack) : 1
  const inPath = s.path.indexOf(i) >= 0
  ctx.save()
  if (cleared && p < 1) {
    ctx.translate(cx, cy - 34 * (1 - p))
    ctx.scale(0.35 + 0.65 * p, 0.35 + 0.65 * p)
    ctx.translate(-cx, -cy)
  }
  disc(ctx, cx, cy, BALL_R, colorOf(kind))
  if (inPath) {
    ctx.save()
    ctx.lineWidth = 5
    ctx.strokeStyle = s.path.length >= MATCH_MIN ? COLORS.accent : withAlpha(COLORS.white, 0.75)
    ctx.beginPath()
    ctx.arc(cx, cy, BALL_R - 1, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  ctx.restore()
}

/** 连线折线：只画 state.path，渲染层不做任何规则判断 */
function drawPath(ctx: CanvasRenderingContext2D, s: State): void {
  if (s.path.length < 2) return
  const color = colorOf(s.cells[s.path[0]])
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 26
  strokePath(ctx, s)
  ctx.strokeStyle = withAlpha(color, 0.96)
  ctx.lineWidth = 16
  strokePath(ctx, s)
  if (s.path.length >= MATCH_MIN) {
    ctx.strokeStyle = withAlpha(COLORS.white, 0.55)
    ctx.lineWidth = 5
    strokePath(ctx, s)
  }
  ctx.restore()
}

function strokePath(ctx: CanvasRenderingContext2D, s: State): void {
  ctx.beginPath()
  for (let k = 0; k < s.path.length; k++) {
    const [x, y] = centerOf(s.path[k])
    if (k === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

function drawHover(ctx: CanvasRenderingContext2D, s: State): void {
  if (s.hoverCell < 0 || s.path.length > 0) return
  if (s.cells[s.hoverCell] === 0) return
  const [cx, cy] = centerOf(s.hoverCell)
  ctx.save()
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.beginPath()
  ctx.arc(cx, cy, BALL_R + 5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function drawFooter(ctx: CanvasRenderingContext2D, s: State, shownScore: number): void {
  fillRoundRect(ctx, FOOTER.x, FOOTER.y, FOOTER.w, FOOTER.h, 22, 'rgba(255,255,255,0.07)', 'rgba(255,255,255,0.12)', 2)
  const cols = [FOOTER.x + FOOTER.w / 6, FOOTER.x + FOOTER.w / 2, FOOTER.x + (FOOTER.w * 5) / 6]
  const stats: Array<[string, string]> = [
    ['分数', String(shownScore)],
    ['消除', `${s.clears} 次`],
    ['洗牌', `${s.shuffles} 次`],
  ]
  text(ctx, `最高连击 ×${s.bestCombo}`, FOOTER.x + FOOTER.w / 2, FOOTER.y + 38, { size: 26, color: COLORS.textDim })
  for (let k = 0; k < stats.length; k++) {
    text(ctx, stats[k][0], cols[k], FOOTER.y + 82, { size: 24, color: COLORS.textDim })
    text(ctx, stats[k][1], cols[k], FOOTER.y + 118, { size: 34, weight: 'bold', color: k === 0 ? COLORS.accent : COLORS.text })
  }
}

// ---------------- 模块接口 ----------------

function input(s: State, p: PointerInput): Action | null {
  const cell = hitCell(p)
  if (p.kind === 'down') {
    // 棋盘外按下视为松手，用于中途放弃正在连的线
    return cell < 0 ? { type: 'up' } : { type: 'down', cell }
  }
  if (p.kind === 'move') return cell === s.hoverCell ? null : { type: 'move', cell }
  if (p.kind === 'up') return { type: 'up' }
  return null
}

function effects(prev: State, next: State): Effect[] {
  const out: Effect[] = []
  if (next.path.length > prev.path.length) out.push({ kind: 'sound', name: prev.path.length === 0 ? 'click' : 'tick' })
  else if (prev.path.length > next.path.length && prev.path.length > 0) out.push({ kind: 'sound', name: 'click' })

  if (next.clears > prev.clears) {
    out.push({ kind: 'sound', name: 'score' })
    for (const i of next.lastCleared) {
      const [x, y] = centerOf(i)
      out.push({ kind: 'burst', x, y, color: colorOf(prev.cells[i]), count: 12 })
    }
    if (next.lastCleared.length >= 6) out.push({ kind: 'shake', power: 8 })
    if (next.combo >= 3) out.push({ kind: 'flash', color: 'rgba(255,204,51,0.25)' })
  }
  if (next.shuffles > prev.shuffles) out.push({ kind: 'sound', name: 'place' })
  if (next.over && !prev.over) out.push({ kind: 'sound', name: 'lose' })
  return out
}

/**
 * 金币结算：门票制。
 *
 * `outcome.win` 这里原本是**写死的 `false`**——以前只用于展示，不影响任何逻辑；
 * 接上金币系统之后它变成了语义上吃重的东西（默认规则会判定「每局都输」）。
 * 连珠是单人消除游戏，本来就没有输赢可言，所以改成按分数结算。
 *
 * `PAR = 400 分`：单次消除是 `count² × 5 + (连击-1) × 20`，连 4~5 个球约 80~145 分，
 * 一盘清到无可消除时通常能打十几次，也就是 1000 分上下。400 意味着
 * 「清掉大半盘」刚好回本，PAR 400 分。
 */
const PAR = 400

function coins(_s: State, o: Outcome, bet: number): number {
  if (bet <= 0) return 0
  const score = typeof o.score === 'number' && Number.isFinite(o.score) ? o.score : 0
  const mult = Math.floor(score / PAR)
  return mult <= 0 ? -bet : bet * mult
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  input,
  effects,
  outcome: (s) => (s.over ? { score: s.score, better: 'higher', unit: ' 分' } : null),
  coins,
  controls: (s) => [{ label: '洗牌', action: { type: 'shuffle' }, disabled: s.over }],
  hint: (s) =>
    s.over
      ? '本局已无可消除的连线，点「新的一局」重新开始'
      : s.path.length >= MATCH_MIN
        ? `已连 ${s.path.length} 个同色球，松手即可消除`
        : s.path.length > 0
          ? `已连 ${s.path.length} 个，再连 ${MATCH_MIN - s.path.length} 个就能消除`
          : '按住一个球拖动，自动吸附相邻同色球，连成 4 个即可消除',
}

export default game
