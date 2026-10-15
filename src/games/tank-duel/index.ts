/**
 * 坦克对决渲染 + 输入映射。
 * 规则与 AI 全在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas 以及把指针 / 键盘翻译成 action。
 *
 * 说明：
 * - 四个动作（前进 / 左转 / 右转 / 开火）全部走 controls()，由站点壳渲染成真正的 DOM 按钮，
 *   天然满足 44px 触控目标 —— 横屏下画布缩放比很小，画布内按钮会点不中，因此不在画布上重画它们。
 * - 动画（位置平移、炮塔转向、炮弹飞行）一律走 render/anim.ts 旁路，state 里不含任何时间信息。
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import {
  COLORS,
  background,
  banner,
  darken,
  disc,
  fillRoundRect,
  roundRectPath,
  shadowText,
  text,
  topBar,
  withAlpha,
} from '../../render/draw'
import { progressSince, tweenTo } from '../../render/anim'
import { gridHit, lerp } from '../../core/geom'
import meta from './meta'
import {
  COLS,
  DIR_DC,
  DIR_DR,
  DIR_NAME,
  HUMAN,
  MOVE_LIMIT,
  ROWS,
  aiAction,
  aligned,
  clearLine,
  colOf,
  create,
  idx,
  legalActions,
  other,
  reduce,
  rowOf,
  shotHits,
  tankOf,
  type Action,
  type Dir,
  type State,
} from './rules'

const VW = 720
const VH = 1280

/** 战场格子边长：10 列 × 8 行 = 640 × 512 */
const CELL = 64
const BOARD_X = (VW - COLS * CELL) / 2
const BOARD_Y = 236

/** 战场底板（含外边距）：渲染与命中判定共用这一份坐标 */
const PANEL = { x: BOARD_X - 20, y: BOARD_Y - 20, w: COLS * CELL + 40, h: ROWS * CELL + 40 } as const

/** 棋盘内两辆坦克的主题色 */
const TANK_COLOR = { 1: COLORS.accent2, 2: COLORS.red } as const

const px = (col: number): number => BOARD_X + (col + 0.5) * CELL
const py = (row: number): number => BOARD_Y + (row + 0.5) * CELL
const cellX = (i: number): number => px(colOf(i))
const cellY = (i: number): number => py(rowOf(i))

/**
 * 炮塔角度的连续值缓存（渲染侧，不进 state）。
 * 朝向只有 0..3，直接插值会让 3→0 逆转一整圈，这里记下上一帧的目标角度，
 * 把新目标折算到离它最近的那一侧，转向就总是走 90°。
 */
const angMemo: number[] = [0, 0]

function tankAngle(p: 1 | 2, dir: Dir): number {
  let target = dir
  while (target - angMemo[p - 1] > 2) target -= 4
  while (angMemo[p - 1] - target > 2) target += 4
  angMemo[p - 1] = target
  return tweenTo(`td-ang-${p}`, target, 170)
}

// ---------------- 文案 ----------------

function statusRight(s: State): string {
  if (s.over) return ''
  return s.turn === HUMAN ? '你的回合' : '电脑行动中'
}

function statusLine(s: State): string {
  if (s.over) return `本局共 ${s.moves} 手`
  const me = tankOf(s, s.turn)
  const foe = tankOf(s, other(s.turn))
  if (shotHits(s, me)) return '炮口已对准对方，开火！'
  if (aligned(me, foe)) return clearLine(s, me, foe) ? '已对齐：转向对准后即可开火' : '已对齐，但中间隔着掩体'
  return '未对齐：先移动逼近对方'
}

function endSub(s: State): string {
  const byShot = s.last !== null && s.last.hit
  const n = `第 ${s.moves} 手`
  if (s.winner === HUMAN) return byShot ? `${n}击毁对方坦克` : '回合用尽，位置占优'
  return byShot ? `${n}被电脑击毁` : '回合用尽，位置落后'
}

// ---------------- 绘制 ----------------

function render(ctx: CanvasRenderingContext2D, s: State): void {
  background(ctx, VW, VH)
  topBar(ctx, VW, `第 ${s.moves} 手`, statusRight(s), 96)
  shadowText(ctx, statusLine(s), VW / 2, 152, { size: 26, color: COLORS.textDim, weight: 'normal' })

  // 当前行动方的高亮环：换人时淡入，动画走旁路，不进 state
  const hi = progressSince('td-hi', `${s.turn}`, 300)
  drawBoard(ctx, s)
  drawTank(ctx, s, 1, hi)
  drawTank(ctx, s, 2, hi)
  drawShot(ctx, s)
  drawCards(ctx, s)
  drawFooter(ctx, s)

  if (s.over) {
    const win = s.winner === HUMAN
    banner(ctx, VW, VH, win ? '胜利' : '失败', endSub(s), win ? COLORS.accent : COLORS.red)
  }
}

function drawBoard(ctx: CanvasRenderingContext2D, s: State): void {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 20, COLORS.bg2)
  ctx.restore()
  fillRoundRect(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 20, 'rgba(0,0,0,0)', COLORS.line, 3)

  // 棋盘格：深浅相间，方便数格子
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = idx(col, row)
      const fill = (col + row) % 2 === 0 ? COLORS.panel : COLORS.bg2
      ctx.fillStyle = fill
      ctx.fillRect(BOARD_X + col * CELL, BOARD_Y + row * CELL, CELL, CELL)
      if (s.walls[i] === 1) {
        fillRoundRect(ctx, BOARD_X + col * CELL + 5, BOARD_Y + row * CELL + 5, CELL - 10, CELL - 10, 8, '#4a5568')
        ctx.fillStyle = withAlpha('#000000', 0.18)
        ctx.fillRect(BOARD_X + col * CELL + 5, BOARD_Y + row * CELL + CELL - 15, CELL - 10, 10)
      }
    }
  }

  ctx.strokeStyle = withAlpha(COLORS.line, 0.55)
  ctx.lineWidth = 1
  for (let col = 1; col < COLS; col++) {
    ctx.beginPath()
    ctx.moveTo(BOARD_X + col * CELL, BOARD_Y)
    ctx.lineTo(BOARD_X + col * CELL, BOARD_Y + ROWS * CELL)
    ctx.stroke()
  }
  for (let row = 1; row < ROWS; row++) {
    ctx.beginPath()
    ctx.moveTo(BOARD_X, BOARD_Y + row * CELL)
    ctx.lineTo(BOARD_X + COLS * CELL, BOARD_Y + row * CELL)
    ctx.stroke()
  }
}

/** 画一辆坦克：位置与炮塔角度都从旁路补间读取，因此移动 / 转向是平滑的 */
function drawTank(ctx: CanvasRenderingContext2D, s: State, p: 1 | 2, hi: number): void {
  const t = tankOf(s, p)
  const color = TANK_COLOR[p]
  const i = idx(t.col, t.row)
  const x = tweenTo(`td-x-${p}`, cellX(i), 200)
  const y = tweenTo(`td-y-${p}`, cellY(i), 200)

  if (hi > 0 && s.turn === p && !s.over) {
    ctx.save()
    ctx.globalAlpha = hi
    ctx.strokeStyle = COLORS.accent
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(x, y, CELL * 0.44, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(tankAngle(p, t.dir) * (Math.PI / 2))
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 9
  ctx.shadowOffsetY = 3
  // 履带
  fillRoundRect(ctx, -CELL * 0.33, -CELL * 0.3, CELL * 0.66, CELL * 0.6, 12, darken(color, 0.52))
  ctx.shadowColor = 'transparent'
  // 炮管（本地坐标里「上」就是当前朝向）
  fillRoundRect(ctx, -6, -CELL * 0.5, 12, CELL * 0.32, 5, darken(color, 0.28))
  // 车身
  fillRoundRect(ctx, -CELL * 0.27, -CELL * 0.24, CELL * 0.54, CELL * 0.48, 10, color)
  // 炮塔
  disc(ctx, 0, -CELL * 0.02, CELL * 0.15, darken(color, 0.12))
  ctx.restore()
}

/** 炮弹：沿上一手记录的路径飞，命中或撞墙后停住 */
function drawShot(ctx: CanvasRenderingContext2D, s: State): void {
  const last = s.last
  if (!last || last.kind !== 'shoot' || last.path.length === 0) return
  const prog = progressSince('td-shot', `${s.moves}:${last.by}`, 380)

  // 折线顶点：起点是坦克中心，其后是炮弹经过的每一格中心
  const pts: number[] = [px(last.from.col), py(last.from.row)]
  for (const c of last.path) pts.push(cellX(c), cellY(c))
  if (last.endCell < 0) {
    // 打飞出界：再往外补一个点，让炮弹飞出画面而不是凭空消失
    const tail = last.path[last.path.length - 1]
    pts.push(px(colOf(tail) + DIR_DC[last.from.dir]), py(rowOf(tail) + DIR_DR[last.from.dir]))
  }

  ctx.save()
  roundRectPath(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 20)
  ctx.clip()

  const segs = pts.length / 2 - 1
  const f = prog * segs
  const i = Math.min(segs - 1, Math.floor(f))
  const t = f - i
  const bx = lerp(pts[i * 2], pts[i * 2 + 2], t)
  const by = lerp(pts[i * 2 + 1], pts[i * 2 + 3], t)

  // 拖尾
  ctx.fillStyle = withAlpha(COLORS.accent, 0.3)
  for (let k = 1; k <= 3; k++) {
    const d = t - k * 0.09
    if (d < 0) break
    ctx.globalAlpha = 0.4 - k * 0.1
    ctx.beginPath()
    ctx.arc(lerp(pts[i * 2], pts[i * 2 + 2], d), lerp(pts[i * 2 + 1], pts[i * 2 + 3], d), 6 - k, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.globalAlpha = 1
  ctx.fillStyle = COLORS.accent
  ctx.beginPath()
  ctx.arc(bx, by, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** 底部两辆坦克的状态卡 */
function drawCards(ctx: CanvasRenderingContext2D, s: State): void {
  const cards: Array<{ x: number; p: 1 | 2; name: string }> = [
    { x: 40, p: 1, name: '你' },
    { x: 380, p: 2, name: '电脑' },
  ]
  for (const c of cards) {
    const t = tankOf(s, c.p)
    const on = !s.over && s.turn === c.p
    fillRoundRect(ctx, c.x, 806, 300, 148, 18, 'rgba(0,0,0,0.25)', on ? TANK_COLOR[c.p] : COLORS.line, on ? 4 : 2)
    text(ctx, c.name, c.x + 150, 842, { size: 30, weight: 'bold', color: TANK_COLOR[c.p] })
    text(ctx, `朝向 ${DIR_NAME[t.dir]}`, c.x + 150, 888, { size: 24, color: COLORS.text })
    text(ctx, `第 ${t.col + 1} 列 · 第 ${t.row + 1} 行`, c.x + 150, 924, {
      size: 22,
      color: COLORS.textDim,
    })
  }
}

function drawFooter(ctx: CanvasRenderingContext2D, s: State): void {
  text(ctx, '每回合在 前进 / 转向 / 开火 中三选一', VW / 2, 1000, { size: 25, color: COLORS.text })
  text(ctx, '炮弹沿炮口直线飞：先撞墙就打空，撞到坦克即胜', VW / 2, 1042, { size: 21, color: COLORS.textDim })
  const left = s.over ? `本局 ${s.moves} 手` : `回合上限剩余 ${MOVE_LIMIT - s.moves}`
  text(ctx, left, VW / 2, 1092, { size: 21, color: COLORS.textDim })
}

// ---------------- 副作用与结算 ----------------

function effects(prev: State, next: State): Effect[] {
  const b = next.last
  // 非法动作会原样返回同一个 state，引用相等即表示「什么都没发生」
  if (!b || b === prev.last) return []
  const out: Effect[] = []

  if (next.over && !prev.over) {
    out.push({ kind: 'sound', name: b.by === HUMAN ? 'win' : 'lose' })
    out.push({ kind: 'flash', color: b.by === HUMAN ? 'rgba(255,204,51,0.26)' : 'rgba(239,83,80,0.22)' })
  } else if (b.kind === 'move') {
    out.push({ kind: 'sound', name: 'tick' })
  } else if (b.kind === 'turn') {
    out.push({ kind: 'sound', name: 'click' })
  } else {
    out.push({ kind: 'sound', name: b.hit ? 'hit' : 'error' })
  }

  if (b.kind === 'shoot' && b.endCell >= 0) {
    out.push({
      kind: 'burst',
      x: cellX(b.endCell),
      y: cellY(b.endCell),
      color: b.hit ? COLORS.accent : COLORS.textDim,
      count: b.hit ? 24 : 8,
    })
  }
  if (b.hit) out.push({ kind: 'shake', power: 12 })
  return out
}

function outcome(s: State): Outcome | null {
  if (!s.over) return null
  // 赢了记「用了几手」，越少越好；输了记 0
  return {
    score: s.winner === HUMAN ? 1000 - s.moves : 0,
    better: 'higher',
    unit: '回合',
    win: s.winner === HUMAN,
  }
}

// ---------------- 输入 ----------------

/** 便捷操作：点自己坦克正前方那一格 = 前进一格 */
function input(s: State, p: PointerInput): Action | null {
  if (s.over || s.turn !== HUMAN || p.kind !== 'down') return null
  const hit = gridHit({ x: p.x, y: p.y }, BOARD_X, BOARD_Y, CELL, CELL, COLS, ROWS)
  if (!hit) return null
  const [col, row] = hit
  const t = s.p1
  if (col !== t.col + DIR_DC[t.dir] || row !== t.row + DIR_DR[t.dir]) return null
  return { type: 'move' }
}

function key(s: State, k: string): Action | null {
  if (s.over || s.turn !== HUMAN) return null
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') return { type: 'turn', delta: -1 }
  if (k === 'ArrowRight' || k === 'd' || k === 'D') return { type: 'turn', delta: 1 }
  if (k === 'ArrowUp' || k === 'w' || k === 'W') return { type: 'move' }
  if (k === ' ' || k === 'Enter') return { type: 'shoot' }
  return null
}

/** 四个动作全部交给站点壳渲染成 DOM 按钮：横屏下画布缩放很小，画布内按钮点不中 */
function controls(s: State): Control<Action>[] {
  const can = !s.over && s.turn === HUMAN
  return [
    { label: '前进', action: { type: 'move' }, disabled: !canMove(s) },
    { label: '左转', action: { type: 'turn', delta: -1 }, disabled: !can },
    { label: '右转', action: { type: 'turn', delta: 1 }, disabled: !can },
    { label: '开火', action: { type: 'shoot' }, disabled: !can },
  ]
}

/** 前进被堵时把按钮置灰（转向与开火永远可用） */
function canMove(s: State): boolean {
  if (s.over || s.turn !== HUMAN) return false
  return legalActions(s).some((a) => a.type === 'move')
}

const game: GameModule<State, Action> = {
  ...meta,
  create,
  reduce,
  render,
  aiAction,
  input,
  key,
  effects,
  outcome,
  controls,
  hint: (s) =>
    s.over
      ? '本局结束，点「新的一局」再来一次'
      : s.turn === HUMAN
        ? '轮到你：前进 / 左转 / 右转 / 开火，每回合只能选一个'
        : '电脑行动中…',
  aiDelay: 420,
}

export default game
