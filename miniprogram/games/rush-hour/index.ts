/**
 * 滑块解锁（Rush Hour）渲染 + 输入映射。
 * 规则全在 rules.ts（纯逻辑），本文件只负责把状态画到 Canvas、把指针翻译成 action。
 *
 * 两条旁路都不进 state / reduce：
 *   1. 拖拽预览：模块级 drag 缓存跟随手指，抬手时才发一次 slide —— 一次拖动算一步，与跨了几格无关；
 *   2. 落位动画：progressSince 以 (seq, 车 id, from>to) 为签名插值，动画只负责把过程补出来。
 * 可滑动范围一律取自 rules 的 slideRange，本文件绝不重算碰撞。
 */
import type { Control, Effect, GameModule, Outcome, PointerInput } from '../../core/types'
import {
  COLORS,
  background,
  banner,
  darken,
  fillRoundRect,
  lighten,
  shadowText,
  text,
  topBar,
  withAlpha,
} from '../../render/draw'
import { keepAlive, progressSince, resetAnims, tweenTo } from '../../render/anim'
import type { Rect } from '../../core/geom'
import { clamp, inRect } from '../../core/geom'
import meta from './meta'
import {
  LEVELS,
  SIZE,
  TARGET_ID,
  carIdAt,
  create,
  findCar,
  reduce,
  slideRange,
  targetCar,
  type Action,
  type Car,
  type State,
} from './rules'

// ---------------- 布局常量（render / input 共用，坐标永远一致） ----------------
export const VW = 720
export const VH = 1280
/** 单格边长 */
const CELL = 94
/** 格间缝隙 */
const GAP = 8
/** 格子步距 */
const PITCH = CELL + GAP
/** 车与格线之间的内缩 */
const INSET = 4
/** 棋盘边长（逻辑像素） */
const BOARD_W = SIZE * CELL + (SIZE - 1) * GAP
/** 棋盘左上角 */
export const BOARD_X = 36
export const BOARD_Y = 214
/** 棋盘底板：输入命中与渲染共用 */
export const BOARD_RECT: Rect = { x: BOARD_X - 14, y: BOARD_Y - 14, w: BOARD_W + 28, h: BOARD_W + 28 }
/** 右侧出口通道 */
export const EXIT_RECT: Rect = { x: BOARD_X + BOARD_W + 8, y: BOARD_Y, w: 58, h: BOARD_W }
/** 落位动画时长（毫秒） */
const SLIDE_MS = 180

// ---------------- 拖拽旁路缓存（不进 state） ----------------
interface Drag {
  /** 正在拖的车 id */
  id: string
  /** 车是否横向 */
  horiz: boolean
  /** 车头原始位置（横车为 col，竖车为 row） */
  base: number
  /** 可滑到的最左 / 最右位置，来自 slideRange */
  lo: number
  hi: number
  /** 当前车头位置（可带小数，跟手） */
  pos: number
}

let drag: Drag | null = null
/** 当前动画缓存对应的关卡，用于换关时清场 */
let animLevel = -1

/** 车在棋盘上的矩形（pos 为车头位置，可带小数） */
function carRect(car: Car, pos: number): Rect {
  const along = car.len * CELL + (car.len - 1) * GAP - INSET * 2
  return car.horiz
    ? { x: BOARD_X + pos * PITCH + INSET, y: BOARD_Y + car.row * PITCH + INSET, w: along, h: CELL - INSET * 2 }
    : { x: BOARD_X + car.col * PITCH + INSET, y: BOARD_Y + pos * PITCH + INSET, w: CELL - INSET * 2, h: along }
}

/** 指针命中的格子下标，落在棋盘外返回 null */
function cellAt(x: number, y: number): number | null {
  const c = Math.floor((x - BOARD_X) / PITCH)
  const r = Math.floor((y - BOARD_Y) / PITCH)
  if (c < 0 || r < 0 || c >= SIZE || r >= SIZE) return null
  return r * SIZE + c
}

// ---------------- 绘制 ----------------

function drawBoard(ctx: CanvasRenderingContext2D, state: State): void {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  fillRoundRect(ctx, BOARD_RECT.x, BOARD_RECT.y, BOARD_RECT.w, BOARD_RECT.h, 26, withAlpha('#08131f', 0.92))
  ctx.restore()
  fillRoundRect(ctx, BOARD_RECT.x, BOARD_RECT.y, BOARD_RECT.w, BOARD_RECT.h, 26, 'rgba(255,255,255,0.06)', COLORS.line, 2)

  const t = targetCar(state.cars)
  for (let r = 0; r < SIZE; r++) {
    const lane = t !== null && t.horiz && t.row === r
    for (let c = 0; c < SIZE; c++) {
      fillRoundRect(
        ctx,
        BOARD_X + c * PITCH + 3,
        BOARD_Y + r * PITCH + 3,
        CELL - 6,
        CELL - 6,
        12,
        lane ? 'rgba(239,83,80,0.10)' : 'rgba(255,255,255,0.04)',
        'rgba(255,255,255,0.06)',
        1,
      )
    }
  }
}

/** 右侧出口通道：红车所在行画三个箭头，路径打通时高亮 */
function drawExit(ctx: CanvasRenderingContext2D, state: State): void {
  fillRoundRect(ctx, EXIT_RECT.x, EXIT_RECT.y, EXIT_RECT.w, EXIT_RECT.h, 18, 'rgba(255,255,255,0.05)', withAlpha(COLORS.accent, 0.25), 2)
  const t = targetCar(state.cars)
  if (!t || !t.horiz) {
    text(ctx, '出口', EXIT_RECT.x + EXIT_RECT.w / 2, EXIT_RECT.y + EXIT_RECT.h / 2, { size: 22, color: COLORS.textDim })
    return
  }
  const [, hi] = slideRange(state.cars, t)
  const clear = hi >= SIZE - t.len
  const cy = BOARD_Y + t.row * PITCH + CELL / 2
  ctx.save()
  ctx.fillStyle = state.solved ? COLORS.green : clear ? COLORS.accent : COLORS.textDim
  ctx.globalAlpha = clear || state.solved ? 1 : 0.5
  for (let i = 0; i < 3; i++) {
    const x = EXIT_RECT.x + 11 + i * 15
    ctx.beginPath()
    ctx.moveTo(x + 10, cy)
    ctx.lineTo(x, cy - 12)
    ctx.lineTo(x, cy + 12)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

function drawCar(ctx: CanvasRenderingContext2D, car: Car, pos: number, selected: boolean, glow: number): void {
  const r = carRect(car, pos)
  const g = car.horiz ? ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h) : ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y)
  g.addColorStop(0, lighten(car.color, 0.32))
  g.addColorStop(1, darken(car.color, 0.16))
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 18
  ctx.shadowOffsetY = 7
  fillRoundRect(ctx, r.x, r.y, r.w, r.h, 16, g)
  ctx.restore()

  // 车窗高光条
  if (car.horiz) fillRoundRect(ctx, r.x + 16, r.y + 15, r.w - 32, 18, 9, 'rgba(255,255,255,0.22)')
  else fillRoundRect(ctx, r.x + 15, r.y + 16, 18, r.h - 32, 9, 'rgba(255,255,255,0.22)')

  if (car.target) {
    // 目标车：描白边，箭头指向出口；通关瞬间叠一层光晕
    fillRoundRect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 14, 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.85)', 3)
    if (glow > 0) {
      ctx.save()
      ctx.globalAlpha = glow * 0.75
      fillRoundRect(ctx, r.x - 10, r.y - 10, r.w + 20, r.h + 20, 24, 'rgba(0,0,0,0)', COLORS.green, 6)
      ctx.restore()
    }
    if (car.horiz) {
      const cx = r.x + r.w - 26
      const cy = r.y + r.h / 2
      ctx.save()
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.beginPath()
      ctx.moveTo(cx + 11, cy)
      ctx.lineTo(cx - 6, cy - 12)
      ctx.lineTo(cx - 6, cy + 12)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  }

  if (selected) {
    fillRoundRect(ctx, r.x - 5, r.y - 5, r.w + 10, r.h + 10, 20, 'rgba(0,0,0,0)', COLORS.accent, 5)
  }
}

function drawCars(ctx: CanvasRenderingContext2D, state: State): void {
  const lm = state.lastMove
  const sig = lm === null ? 'none' : `${state.seq}:${lm.id}:${lm.from}>${lm.to}`
  const p = lm === null ? 1 : progressSince('rh-slide', sig, SLIDE_MS)
  const glow = tweenTo('rh-glow', state.solved ? 1 : 0, 320)
  if (drag !== null) keepAlive()
  for (const car of state.cars) {
    let pos = car.horiz ? car.col : car.row
    if (drag !== null && drag.id === car.id) pos = drag.pos
    else if (lm !== null && lm.id === car.id) pos = lm.from + (lm.to - lm.from) * p
    drawCar(ctx, car, pos, state.selected === car.id, car.target ? glow : 0)
  }
}

function drawFooter(ctx: CanvasRenderingContext2D, state: State): void {
  const tip = state.solved
    ? `「${LEVELS[state.level].name}」通关，${state.moves} 步`
    : '按住车沿它自己的方向拖动 · 不能重叠也不能穿车'
  fillRoundRect(ctx, 36, 858, VW - 72, 96, 22, 'rgba(255,255,255,0.08)')
  text(ctx, tip, VW / 2, 906, { size: 26, weight: 'bold' })

  // 换关 / 重开交给站点壳的控件区（controls），画布上不再自绘第二套按钮 ——
  // 否则同一个操作会在画面里出现两次，玩家会以为按错了却没反应。
  text(ctx, `共 ${LEVELS.length} 关 · 方向键滑动选中车 · Tab 换车`, VW / 2, 1000, { size: 22, color: COLORS.textDim })
}

function drawWin(ctx: CanvasRenderingContext2D, state: State): void {
  const last = state.level === LEVELS.length - 1
  banner(ctx, VW, VH, last ? '全部通关！' : '过关！', `「${LEVELS[state.level].name}」用了 ${state.moves} 步`, last ? COLORS.green : COLORS.accent)
  const rec = state.records[state.level]
  const line = rec >= 0 && rec < state.moves ? `本关纪录 ${rec} 步，再来一次更少步` : '本关新纪录！'
  text(ctx, line, VW / 2, 742, { size: 26, color: COLORS.accent, weight: 'bold' })
}

function render(ctx: CanvasRenderingContext2D, state: State): void {
  // 换关时清空动画与拖拽缓存，避免上一关的残影
  if (state.level !== animLevel) {
    animLevel = state.level
    drag = null
    resetAnims()
  }
  background(ctx, VW, VH, '#1b3350', '#0b1728')
  topBar(ctx, VW, '滑块解锁', `${state.moves} 步`, 96)
  shadowText(ctx, `第 ${state.level + 1} / ${LEVELS.length} 关 · ${LEVELS[state.level].name}`, VW / 2, 152, { size: 30 })
  const rec = state.records[state.level]
  text(ctx, rec >= 0 ? `本关最佳 ${rec} 步` : '本关还没有纪录', VW / 2, 186, { size: 22, color: COLORS.textDim })

  drawBoard(ctx, state)
  drawExit(ctx, state)
  drawCars(ctx, state)
  drawFooter(ctx, state)
  if (state.solved) drawWin(ctx, state)
}

// ---------------- 副作用 / 结算 ----------------

function effects(prev: State, next: State): Effect[] {
  if (next === prev) return []
  if (next.solved && !prev.solved) {
    const t = targetCar(next.cars)
    const out: Effect[] = [
      { kind: 'sound', name: 'win' },
      { kind: 'flash', color: 'rgba(255,204,51,0.28)' },
    ]
    if (t) {
      const r = carRect(t, t.horiz ? t.col : t.row)
      out.push({ kind: 'burst', x: r.x + r.w / 2, y: r.y + r.h / 2, color: COLORS.green, count: 26 })
    }
    return out
  }
  if (next.level !== prev.level) return [{ kind: 'sound', name: 'click' }]
  if (next.seq !== prev.seq) return [{ kind: 'sound', name: 'place' }]
  return [{ kind: 'sound', name: 'click' }]
}

function outcome(state: State): Outcome | null {
  if (!state.solved) return null
  return { score: state.moves, better: 'lower', unit: ' 步', win: true }
}

function hint(state: State): string {
  if (state.solved) return `第 ${state.level + 1} 关完成，用了 ${state.moves} 步，点「下一关」继续`
  return `第 ${state.level + 1} / ${LEVELS.length} 关 · ${LEVELS[state.level].name} · 已走 ${state.moves} 步：按住任意一辆车沿它自己的方向拖动`
}

function controls(state: State): Control<Action>[] {
  const last = state.level === LEVELS.length - 1
  return [
    { label: '上一关', action: { type: 'level', index: (state.level - 1 + LEVELS.length) % LEVELS.length } },
    {
      label: last ? '回到第 1 关' : '下一关',
      action: { type: 'level', index: last ? 0 : state.level + 1 },
      primary: state.solved,
    },
    { label: '重开本关', action: { type: 'level', index: state.level }, disabled: state.moves === 0 && !state.solved },
  ]
}

// ---------------- 输入 ----------------

/** 按下：命中车就起一次拖拽（范围来自 slideRange）；在出口通道按下则把红车直接拉到出口 */
function beginDrag(state: State, p: PointerInput): Action | null {
  const t = targetCar(state.cars)
  const onExit = t !== null && t.horiz && inRect(p, EXIT_RECT)
  let car: Car | null = null
  if (onExit) {
    car = t
  } else {
    const cell = cellAt(p.x, p.y)
    if (cell === null) return null
    const id = carIdAt(state.cars, cell)
    if (id === null) return null
    car = findCar(state.cars, id)
  }
  if (car === null) return null
  const [lo, hi] = slideRange(state.cars, car)
  const base = car.horiz ? car.col : car.row
  // 按在出口通道上：车头直接落在能到的最右端
  drag = { id: car.id, horiz: car.horiz, base, lo, hi, pos: onExit ? hi : base }
  return { type: 'select', id: car.id }
}

/** 拖动：车头跟随指针（指针落在第几格就是第几格），并被 slideRange 给出的区间夹住 */
function trackDrag(p: PointerInput): void {
  if (drag === null) return
  const head = (drag.horiz ? p.x - BOARD_X : p.y - BOARD_Y) / PITCH
  drag.pos = clamp(head, drag.lo, drag.hi)
}

/** 抬手：吸附到最近整格并发出一次 slide；没挪动就只当作选中 */
function endDrag(): Action | null {
  const d = drag
  drag = null
  if (d === null) return null
  const delta = clamp(Math.round(d.pos), d.lo, d.hi) - d.base
  return delta === 0 ? { type: 'select', id: d.id } : { type: 'slide', id: d.id, delta }
}

function input(state: State, p: PointerInput): Action | null {
  if (p.kind === 'down') {
    if (state.solved) return null
    return beginDrag(state, p)
  }
  if (p.kind === 'move') {
    if (p.pressed) trackDrag(p)
    return null
  }
  return endDrag()
}

function key(state: State, k: string): Action | null {
  const last = state.level === LEVELS.length - 1
  if (k === 'n' || k === 'N' || k === ']') return { type: 'level', index: last ? 0 : state.level + 1 }
  if (k === 'p' || k === 'P' || k === '[') return { type: 'level', index: (state.level - 1 + LEVELS.length) % LEVELS.length }
  if (k === 'r' || k === 'R') return { type: 'level', index: state.level }
  if (state.solved) return null

  const ids = state.cars.map((c) => c.id)
  if (k === 'Tab') {
    const i = state.selected === null ? -1 : ids.indexOf(state.selected)
    return { type: 'select', id: ids[(i + 1) % ids.length] }
  }
  const id = state.selected ?? TARGET_ID
  if (k === 'Enter' || k === ' ') {
    const car = findCar(state.cars, id)
    if (!car) return null
    const base = car.horiz ? car.col : car.row
    const [, hi] = slideRange(state.cars, car)
    return hi > base ? { type: 'slide', id, delta: hi - base } : null
  }
  if (k === 'ArrowLeft' || k === 'ArrowUp') return { type: 'slide', id, delta: -1 }
  if (k === 'ArrowRight' || k === 'ArrowDown') return { type: 'slide', id, delta: 1 }
  return null
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
  hint,
  controls,
}

export default game
