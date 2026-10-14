/**
 * 中国跳棋渲染 + 输入映射。
 * 规则全在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas、把逻辑坐标的指针事件翻译成 action。
 *
 * 坐标系只有一份：格子 (q,r) 的像素位置由 rules 的 qOf/rOf 统一换算，
 * 渲染画格子和输入命中判定都走 cellCenter()，点击不会错位。
 *
 * 动画说明：棋子沿 last.path 逐格滑动走 render/anim.ts 旁路（elapsedSince），
 * 落点结果已经由 state 定好，不存在「动画中不可点击」的状态。
 */
import type { Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import {
  COLORS,
  background,
  banner,
  disc,
  ease,
  fillRoundRect,
  shadowText,
  text,
  topBar,
  withAlpha,
} from '../../render/draw'
import { elapsedSince, keepAlive, pulse } from '../../render/anim'
import meta from './meta'
import {
  CELL_COUNT,
  HOME_CELLS,
  HOME_STAR,
  KIND_STAR,
  aiAction,
  countPieces,
  create,
  findMove,
  kindOf,
  movesFrom,
  opponent,
  qOf,
  rOf,
  reduce,
  targetOf,
  type Action,
  type Player,
  type State,
} from './rules'

// ---------------- 布局常量（渲染与输入共用） ----------------

const VW = 720
const VH = 1280
/** 六边形外接圆半径（逻辑像素）：格宽 = √3 × 30 ≈ 52，格高 = 60 */
const HEX_R = 30
/** 水平列距 */
const COL_STEP = HEX_R * Math.sqrt(3)
/** 行距 */
const ROW_STEP = HEX_R * 1.5
/** 星形棋盘中心 */
const BOARD_CX = 360
const BOARD_CY = 508
/** 落点热区半径（逻辑像素）：直径 58 ≥ 44 的触控下限 */
const HIT_R = 29
/** 每一跳的动画时长 */
const STEP_MS = 150
/** 棋子半径 */
const PIECE_R = HEX_R * 0.84

const PLAYER_COLOR = COLORS.yellow
const AI_COLOR = COLORS.blue

/** 格子编号 → 逻辑像素坐标（渲染与命中判定共用同一份） */
function cellCenter(id: number): [number, number] {
  const q = qOf(id)
  const r = rOf(id)
  return [BOARD_CX + COL_STEP * (q + r / 2), BOARD_CY + ROW_STEP * r]
}

/** 命中判定：离指针最近的孔（≤ HIT_R），没有则返回 -1 */
function hitCell(x: number, y: number): number {
  let best = -1
  let bestD = HIT_R * HIT_R
  for (let id = 0; id < CELL_COUNT; id++) {
    const [cx, cy] = cellCenter(id)
    const d = (cx - x) * (cx - x) + (cy - y) * (cy - y)
    if (d < bestD) {
      bestD = d
      best = id
    }
  }
  return best
}

const colorOf = (p: Player): string => (p === 1 ? PLAYER_COLOR : AI_COLOR)

// ---------------- 文案 ----------------

function statusText(s: State): [string, string] {
  if (s.over) {
    if (s.winner === 1) return ['你赢了！', '你把棋子送上了对方的中心星格']
    if (s.winner === 2) return ['电脑获胜', '它比你先占住了中心星格']
    return ['平局', '双方都没能登上星格']
  }
  if (s.turn === 1) return ['轮到你', '有子可吃必须吃；连跳要一次走完']
  return ['电脑思考中', '它会优先吃子，其次往星格推进']
}

function tipText(s: State): string {
  if (s.over) return '点「新的一局」再来一次'
  if (s.turn === 2) return '电脑正在算最佳的一步…'
  return '点自己的棋子选中，再点高亮落点走完'
}

// ---------------- 绘制 ----------------

/** 五角星（目标格标记） */
function starGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const px = x + Math.cos(a) * rad
    const py = y + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

/** 在任意坐标画一枚棋子 */
function drawPieceAt(ctx: CanvasRenderingContext2D, x: number, y: number, p: Player, alpha = 1, scale = 1): void {
  disc(ctx, x, y, PIECE_R * scale, colorOf(p), { alpha, ring: withAlpha('#000000', 0.35) })
}

interface MoveAnim {
  steps: number
  raw: number
  seg: number
  t: number
}

/** 最近一手的动画进度（0~1），state 不参与 */
function moveAnim(s: State): MoveAnim | null {
  if (s.last === null) return null
  const steps = Math.max(1, s.last.path.length - 1)
  const dur = steps * STEP_MS
  const raw = Math.min(1, elapsedSince('cc-move', String(s.moves), dur) / dur)
  const stepF = raw * steps
  const seg = Math.min(steps - 1, Math.floor(stepF))
  return { steps, raw, seg, t: ease.inOutQuad(Math.min(1, stepF - seg)) }
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  keepAlive()
  background(ctx, VW, VH, '#1b3350', '#0b1728')

  const [main, sub] = statusText(state)
  topBar(ctx, VW, main, `第 ${state.moves} 步`, 92)
  shadowText(ctx, sub, VW / 2, 140, { size: 25, color: COLORS.textDim, weight: 'normal' })
  drawSides(ctx, state)

  // 棋盘底板
  const px = BOARD_CX - COL_STEP * 6 - 46
  const py = BOARD_CY - ROW_STEP * 6 - 40
  const pw = COL_STEP * 12 + 92
  const ph = ROW_STEP * 12 + 80
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, px, py, pw, ph, 26, withAlpha('#0a1620', 0.92))
  ctx.restore()
  fillRoundRect(ctx, px, py, pw, ph, 26, 'rgba(255,255,255,0.06)', COLORS.line, 2)

  const homeOf = new Uint8Array(CELL_COUNT)
  for (const id of HOME_CELLS[1]) homeOf[id] = 1
  for (const id of HOME_CELLS[2]) homeOf[id] = 2

  // 孔位：自家起始区染色，星格画五角星
  for (let id = 0; id < CELL_COUNT; id++) {
    const [x, y] = cellCenter(id)
    const owner = homeOf[id]
    disc(ctx, x, y, HEX_R * 0.86, owner === 1 ? withAlpha(PLAYER_COLOR, 0.16) : owner === 2 ? withAlpha(AI_COLOR, 0.16) : '#20405f')
    disc(ctx, x, y, HEX_R * 0.3, owner === 1 ? withAlpha(PLAYER_COLOR, 0.5) : owner === 2 ? withAlpha(AI_COLOR, 0.5) : '#2c5479')
    if (kindOf(id) === KIND_STAR) {
      const mine = HOME_STAR[1] === id ? 1 : 2
      const beat = 0.72 + 0.28 * pulse(1500)
      starGlyph(ctx, x, y, HEX_R * 0.66, withAlpha(colorOf(mine), 0.35 + 0.45 * beat))
      starGlyph(ctx, x, y, HEX_R * 0.4, withAlpha('#ffffff', 0.4 + 0.25 * beat))
    }
  }

  const anim = moveAnim(state)

  // 可落点提示：只有轮到自己时才画，且只提示选中那颗棋子的落点
  if (!state.over && state.turn === 1) {
    const list = state.selected >= 0 ? movesFrom(state.cells, state.selected, 1) : []
    for (const m of list) {
      const [x, y] = cellCenter(m.to)
      const jump = m.path.length > 2
      disc(ctx, x, y, HEX_R * (jump ? 0.34 : 0.24), COLORS.accent, { alpha: jump ? 0.85 : 0.5 })
      if (jump) {
        ctx.save()
        ctx.globalAlpha = 0.5
        ctx.strokeStyle = COLORS.accent
        ctx.lineWidth = 3
        ctx.setLineDash([6, 6])
        ctx.beginPath()
        ctx.arc(x, y, HEX_R * 0.62, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
    }
  }

  // 上一步路径（动画中画虚线轨迹）
  if (state.last !== null && anim !== null && anim.raw < 1) {
    ctx.save()
    ctx.globalAlpha = 0.45
    ctx.strokeStyle = COLORS.accent
    ctx.lineWidth = 4
    ctx.setLineDash([8, 8])
    ctx.beginPath()
    for (let k = 0; k < state.last.path.length; k++) {
      const [x, y] = cellCenter(state.last.path[k])
      if (k === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.restore()
  }

  // 被吃掉的棋子：逐跳消散
  if (state.last !== null && anim !== null && anim.raw < 1) {
    const stepF = anim.raw * anim.steps
    for (let k = 0; k < state.last.captures.length; k++) {
      const local = stepF - k
      if (local <= 0 || local >= 1) continue
      const a = 1 - Math.min(1, local / 0.4)
      if (a <= 0) continue
      const [x, y] = cellCenter(state.last.captures[k])
      drawPieceAt(ctx, x, y, opponent(state.last.player), a * 0.9, 0.55 + 0.45 * a)
    }
  }

  // 盘面棋子（正在滑行的落点格交给动画棋子接管）
  const flying = state.last !== null && anim !== null && anim.raw < 1 ? state.last.to : -1
  const beat = 0.5 + 0.5 * pulse(1400)
  for (let id = 0; id < CELL_COUNT; id++) {
    const p = state.cells[id]
    if (p === 0 || id === flying) continue
    const [x, y] = cellCenter(id)
    drawPieceAt(ctx, x, y, p as Player)
    if (id === state.selected) {
      ctx.save()
      ctx.globalAlpha = 0.4 + 0.4 * beat
      ctx.strokeStyle = COLORS.accent
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.arc(x, y, PIECE_R * 1.16, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  // 滑动中的棋子：结果已由 state 定好，这里只补一段逐格位移
  if (state.last !== null && anim !== null && anim.raw < 1 && state.cells[flying] !== 0) {
    const [ax, ay] = cellCenter(state.last.path[anim.seg])
    const [bx, by] = cellCenter(state.last.path[anim.seg + 1])
    drawPieceAt(ctx, ax + (bx - ax) * anim.t, ay + (by - ay) * anim.t, state.last.player)
  }

  drawFooter(ctx, state)

  if (state.over) {
    banner(ctx, VW, VH, state.winner === 1 ? '胜利' : state.winner === 2 ? '失败' : '平局', main, state.winner === 1 ? COLORS.accent : COLORS.red)
  }
}

function drawSides(ctx: CanvasRenderingContext2D, s: State): void {
  const pill = (x: number, player: Player, label: string, active: boolean): void => {
    fillRoundRect(ctx, x, 168, 300, 64, 18, active ? withAlpha(colorOf(player), 0.18) : 'rgba(255,255,255,0.07)', active ? colorOf(player) : COLORS.line, active ? 3 : 1)
    disc(ctx, x + 40, 200, 17, colorOf(player))
    const left = countPieces(s.cells, player)
    const right = s.turn === player && !s.over ? '●' : ''
    text(ctx, label, x + 70, 201, { size: 25, align: 'left', weight: 'bold', color: active ? COLORS.accent : COLORS.text })
    text(ctx, `剩 ${left}${right}`, x + 276, 201, { size: 25, align: 'right', weight: 'bold', color: colorOf(player) })
  }
  pill(60, 1, '你', !s.over && s.turn === 1)
  pill(360, 2, '电脑', !s.over && s.turn === 2)
}

function drawFooter(ctx: CanvasRenderingContext2D, s: State): void {
  const y = BOARD_CY + ROW_STEP * 6 + 66
  fillRoundRect(ctx, 60, y, VW - 120, 110, 22, 'rgba(255,255,255,0.08)')
  text(ctx, tipText(s), VW / 2, y + 56, { size: 27, weight: 'bold' })
}

// ---------------- 输入 ----------------

function input(state: State, p: PointerInput): Action | null {
  if (state.over || state.turn !== 1) return null
  if (p.kind !== 'down') return null
  const id = hitCell(p.x, p.y)
  if (id < 0) return state.selected !== -1 ? { type: 'clear' } : null

  if (state.selected >= 0) {
    const mv = findMove(state.cells, state.selected, id, 1)
    if (mv !== null) return { type: 'move', from: mv.from, to: mv.to, path: mv.path.slice() }
  }
  if (state.cells[id] === 1 && movesFrom(state.cells, id, 1).length > 0) {
    return state.selected === id ? null : { type: 'select', from: id }
  }
  return state.selected !== -1 ? { type: 'clear' } : null
}

// ---------------- 副作用与成绩 ----------------

function effects(prev: State, next: State): Effect[] {
  if (next.moves === prev.moves) {
    return prev.selected !== next.selected ? [{ kind: 'sound', name: 'click' }] : []
  }
  const last = next.last
  const caps = last === null ? 0 : last.captures.length

  if (next.over) {
    const out: Effect[] =
      next.winner === 1
        ? [
            { kind: 'sound', name: 'win' },
            { kind: 'flash', color: 'rgba(255,204,51,0.28)' },
          ]
        : [
            { kind: 'sound', name: 'lose' },
            { kind: 'shake', power: 9 },
          ]
    if (last !== null) {
      const [x, y] = cellCenter(last.to)
      out.push({ kind: 'burst', x, y, color: next.winner === 1 ? COLORS.accent : COLORS.red, count: 26 })
    }
    return out
  }

  if (caps > 0) {
    const out: Effect[] = [{ kind: 'sound', name: caps >= 2 ? 'score' : 'hit' }]
    for (const c of last === null ? [] : last.captures) {
      const [x, y] = cellCenter(c)
      out.push({ kind: 'burst', x, y, color: COLORS.accent, count: 10 + caps * 4 })
    }
    if (caps >= 3) out.push({ kind: 'shake', power: 6 })
    return out
  }

  if (last !== null && last.to === targetOf(last.player)) {
    const [x, y] = cellCenter(last.to)
    return [
      { kind: 'sound', name: 'flip' },
      { kind: 'burst', x, y, color: COLORS.accent, count: 24 },
    ]
  }

  return [{ kind: 'sound', name: 'place' }]
}

function outcome(state: State): Outcome | null {
  if (!state.over) return null
  return { score: state.winner === 1 ? 1 : 0, better: 'higher', unit: ' 胜', win: state.winner === 1 }
}

function hintText(s: State): string {
  if (s.over) return s.winner === 1 ? '你赢了，点「新的一局」再玩一盘' : '这局输了，点「新的一局」再玩一盘'
  if (s.turn === 2) return '电脑思考中…'
  if (s.selected >= 0) return '轮到你：点高亮落点走完这一步'
  return '轮到你：点自己的棋子选中，再点落点'
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  aiAction,
  input,
  effects,
  outcome,
  hint: hintText,
  controls: (s) => (s.over || s.turn !== 1 ? [] : [{ label: '帮我走一步', action: { type: 'hint' }, primary: true }]),
  aiDelay: 300,
}

export default game