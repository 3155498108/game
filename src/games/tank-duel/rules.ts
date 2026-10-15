/**
 * 坦克对决（tank-duel）规则 —— 纯逻辑，零 DOM / 零 Date / 零 performance / 零 Math.random。
 *
 * ============================ 规则裁决（写在这里，便于日后核对） ============================
 *
 * 【1】战场：COLS × ROWS = 10×8 的网格。掩体是「墙」，炮弹打不穿。
 *
 * 【2】两辆坦克分居两端：玩家（1）在最左一列，电脑（2）在最右一列。
 *      开局的行号与全部墙都由 seed 决定，且整盘按 **180° 旋转对称** 摆放 ——
 *      目的只有一个：保证同一个 seed 下双方条件完全对等，绝不存在「电脑天生占便宜」。
 *
 * 【3】每回合只能做三件事之一：沿当前朝向前进 1 格 / 左转或右转 90° / 朝当前朝向开火。
 *      前进格越界、被墙或被坦克挡住时该动作非法（不消耗回合）；转向与开火永远合法。
 *
 * 【4】开火：炮弹沿炮口直线飞出，沿途遇到的**第一个障碍**决定结果 ——
 *      先撞到对方的坦克则命中（命中即胜，对局当场结束），先撞到墙或直接飞出棋盘则打空。
 *
 * 【5】终局兜底：走到 MOVE_LIMIT 回合仍无人命中，则按「谁的位置更好」裁决。
 *      裁决**永远**给出一方胜者（位置分完全相同时判给此刻轮到行动的一方），不会平局收场，
 *      因此 AI 对局必然走到终局且一定分出胜负。
 *
 * ============================ 设计要点 ============================
 * - 索引 idx(col,row) = row * COLS + col 是唯一真值来源，渲染与命中判定共用它。
 * - AI 与规则共享同一个 reduce：候选动作取自 legalActions，逐个喂给 reduce 试算后打分，
 *   不维护第二套规则逻辑；同分用 state.rng 打散，保证「相同状态 → 相同动作」可完整复盘。
 * - 动画与计时一律不进 state（走 render/anim.ts 旁路），reduce 只负责搬状态。
 */
import { Rng } from '../../core/rng'

export type Player = 1 | 2
/** 朝向：0 = 上、1 = 右、2 = 下、3 = 左（顺时针递增） */
export type Dir = 0 | 1 | 2 | 3

export const HUMAN: Player = 1
export const COMPUTER: Player = 2

/** 战场尺寸：10 列 × 8 行 */
export const COLS = 10
export const ROWS = 8
export const CELLS = COLS * ROWS

/** 朝向 → 单位向量 / 名称，渲染、输入、AI 共用这一份 */
export const DIR_DC: readonly number[] = [0, 1, 0, -1]
export const DIR_DR: readonly number[] = [-1, 0, 1, 0]
export const DIR_NAME: readonly string[] = ['上', '右', '下', '左']

/** 开局每侧摆放的墙数（两侧互为 180° 旋转，共 WALL_PAIRS × 2 面墙） */
export const WALL_PAIRS = 4

/**
 * 回合上限兜底：走到这里还没人命中就按位置裁决。
 * 网格上最远的一对格子曼哈顿距离是 17，正常对局在 40 手内就能分胜负，
 * 这个上限只为「双方互相躲猫猫」的死循环兜底，取值远高于实测值。
 */
export const MOVE_LIMIT = 120

// ---------------- 坐标 ----------------

export const idx = (col: number, row: number): number => row * COLS + col
export const colOf = (i: number): number => i % COLS
export const rowOf = (i: number): number => Math.floor(i / COLS)
export const inBounds = (col: number, row: number): boolean => col >= 0 && col < COLS && row >= 0 && row < ROWS
export const other = (p: Player): Player => (p === 1 ? 2 : 1)

/** 180° 旋转对称的对应格：用于成对生成掩体 */
export const mirrorCell = (i: number): number => idx(COLS - 1 - colOf(i), ROWS - 1 - rowOf(i))

/** 朝向按 delta（+1 右转 / -1 左转）旋转 90° */
export function turnDir(dir: Dir, delta: number): Dir {
  return (((dir + delta) % 4) + 4) % 4 as Dir
}

// ---------------- 状态 ----------------

export interface Tank {
  col: number
  row: number
  dir: Dir
}

/** 上一手的完整记录：渲染插值与 effects 用，不含任何计时 / 动画信息 */
export interface LastAction {
  by: Player
  kind: 'move' | 'turn' | 'shoot'
  /** 出手前的位置与朝向（渲染插值用） */
  from: Tank
  /** 炮弹路径，仅开火有值：依次经过的格子，含终点格 */
  path: number[]
  /** 炮弹停留格；-1 = 一路飞出棋盘；非开火动作时为坦克所在格 */
  endCell: number
  /** 本次开火是否命中 */
  hit: boolean
}

export interface State {
  /** 一维战场，索引与 idx() 一致：1 = 墙，0 = 空 */
  walls: number[]
  p1: Tank
  p2: Tank
  turn: Player
  over: boolean
  /** 0 = 未分胜负（终局时永远非 0，本游戏不产生平局） */
  winner: Player | 0
  last: LastAction | null
  moves: number
  /** 可播种随机游标，由 create(seed) 注入；AI 同分打散用它 */
  rng: number
}

export type Action =
  /** 沿当前朝向前进 1 格 */
  | { type: 'move' }
  /** 左转 / 右转 90° */
  | { type: 'turn'; delta: 1 | -1 }
  /** 朝当前朝向开火 */
  | { type: 'shoot' }

// ---------------- 开局 ----------------

/**
 * 按 seed 生成一局：起始行 + 成对的掩体。
 *
 * 掩体一律成对生成（第 1 步规则【2】），因此 180° 旋转后局面与原来完全一致，
 * 玩家的处境与电脑的处境严格对等。
 */
export function create(seed: number): State {
  const r = new Rng(seed)
  const startRow = r.int(ROWS)
  const taken = new Set<number>([idx(0, startRow), idx(COLS - 1, ROWS - 1 - startRow)])
  const walls = new Array<number>(CELLS).fill(0)

  for (let k = 0; k < WALL_PAIRS; k++) {
    // 随机试若干次，直到找到一对都没被占用的格子（占用 = 开局坦克位或已放好的墙）
    for (let attempt = 0; attempt < 64; attempt++) {
      const i = r.int(CELLS)
      const j = mirrorCell(i)
      if (taken.has(i) || taken.has(j)) continue
      walls[i] = 1
      walls[j] = 1
      taken.add(i)
      taken.add(j)
      break
    }
  }

  return {
    walls,
    // 玩家在左端朝右，电脑在右端朝左：开局即「隔空对峙」
    p1: { col: 0, row: startRow, dir: 1 },
    p2: { col: COLS - 1, row: ROWS - 1 - startRow, dir: 3 },
    turn: 1,
    over: false,
    winner: 0,
    last: null,
    moves: 0,
    rng: seed | 0,
  }
}

// ---------------- 查询 ----------------

export function tankOf(state: State, p: Player): Tank {
  return p === 1 ? state.p1 : state.p2
}

/** 该格上的坦克归属，0 = 没有坦克 */
export function tankAt(state: State, col: number, row: number): Player | 0 {
  if (state.p1.col === col && state.p1.row === row) return 1
  if (state.p2.col === col && state.p2.row === row) return 2
  return 0
}

/** 该格是否可通行：界内、无墙、无坦克 */
export function isFree(state: State, col: number, row: number): boolean {
  return inBounds(col, row) && state.walls[idx(col, row)] === 0 && tankAt(state, col, row) === 0
}

/** 两辆坦克是否同一行或同一列 */
export function aligned(a: Tank, b: Tank): boolean {
  return a.col === b.col || a.row === b.row
}

/** 炮口是否正对对方：同一行/列，且朝向指向对方 */
export function facesToward(a: Tank, b: Tank): boolean {
  if (a.col === b.col) return DIR_DR[a.dir] === Math.sign(b.row - a.row)
  if (a.row === b.row) return DIR_DC[a.dir] === Math.sign(b.col - a.col)
  return false
}

/** 同一行/列且中间没有墙（只看掩体，坦克自身不算障碍） */
export function clearLine(state: State, a: Tank, b: Tank): boolean {
  if (!aligned(a, b)) return false
  const dc = Math.sign(b.col - a.col)
  const dr = Math.sign(b.row - a.row)
  let col = a.col + dc
  let row = a.row + dr
  while (col !== b.col || row !== b.row) {
    if (state.walls[idx(col, row)] === 1) return false
    col += dc
    row += dr
  }
  return true
}

export interface ShotTrace {
  /** 炮弹依次经过的格子（含终点格；终点是墙或坦克） */
  path: number[]
  /** 命中的坦克归属；0 = 没打中坦克（被墙挡住或直接打空） */
  hitPlayer: Player | 0
  /** 炮弹停留的格子；-1 = 一路飞出棋盘 */
  endCell: number
}

/**
 * 沿朝向打一枪的完整射线判定（第 1 步规则【4】）。
 * 从坦克正前方一格开始逐格推进，遇到的第一个障碍即终止：
 * 墙 → 打空停在该格；坦克 → 命中停在该格；出界 → 打空并飞出棋盘。
 */
export function traceShot(state: State, t: Tank): ShotTrace {
  const path: number[] = []
  const dc = DIR_DC[t.dir]
  const dr = DIR_DR[t.dir]
  let col = t.col + dc
  let row = t.row + dr
  for (;;) {
    if (!inBounds(col, row)) return { path, hitPlayer: 0, endCell: -1 }
    const i = idx(col, row)
    path.push(i)
    if (state.walls[i] === 1) return { path, hitPlayer: 0, endCell: i }
    const who = tankAt(state, col, row)
    if (who !== 0) return { path, hitPlayer: who, endCell: i }
    col += dc
    row += dr
  }
}

/** 从该坦克的当前朝向开火能否命中（AI 评估与提示都用它） */
export function shotHits(state: State, t: Tank): boolean {
  return traceShot(state, t).hitPlayer !== 0
}

// ---------------- 终局 ----------------

/**
 * 位置分（越大越好）：双方用完全相同的公式计算，因此对称局面的分数必然相等。
 * 只在 MOVE_LIMIT 兜底裁决时使用。
 */
function positionScore(state: State, p: Player): number {
  const me = tankOf(state, p)
  const foe = tankOf(state, other(p))
  let s = 0
  if (shotHits(state, me)) s += 10_000
  if (aligned(me, foe)) s += 800
  if (facesToward(me, foe)) s += 300
  if (clearLine(state, me, foe)) s += 200
  s -= 40 * (Math.abs(me.col - foe.col) + Math.abs(me.row - foe.row))
  return s
}

/**
 * MOVE_LIMIT 仍未分胜负时的裁决：位置分高者胜；
 * 分数完全相等（真实对称局面）时判给此刻轮到行动的一方。
 * **永远返回一方，绝不返回 0** —— 保证 AI 对局必然分出胜负。
 */
export function decideByPosition(state: State): Player {
  const s1 = positionScore(state, 1)
  const s2 = positionScore(state, 2)
  if (s1 !== s2) return s1 > s2 ? 1 : 2
  return state.turn
}

/** 每步动作之后收尾：到达回合上限就按位置裁决，绝不卡死 */
function settle(state: State): State {
  if (state.moves >= MOVE_LIMIT) return { ...state, over: true, winner: decideByPosition(state) }
  return state
}

// ---------------- 动作 ----------------

/** 前进一格后的落点；不可通行时返回 null */
export function stepAhead(state: State, t: Tank): { col: number; row: number } | null {
  const col = t.col + DIR_DC[t.dir]
  const row = t.row + DIR_DR[t.dir]
  return isFree(state, col, row) ? { col, row } : null
}

/** 当前走子方的全部合法动作 */
export function legalActions(state: State): Action[] {
  if (state.over) return []
  const out: Action[] = []
  if (stepAhead(state, tankOf(state, state.turn))) out.push({ type: 'move' })
  out.push({ type: 'turn', delta: -1 })
  out.push({ type: 'turn', delta: 1 })
  out.push({ type: 'shoot' })
  return out
}

/** 落定一手：换坦克、换回合、累加手数，再收尾 */
function commit(state: State, p: Player, tank: Tank, last: LastAction): State {
  const moved: State = p === 1 ? { ...state, p1: tank } : { ...state, p2: tank }
  return settle({ ...moved, turn: other(p), moves: state.moves + 1, last })
}

/** 纯函数状态迁移：不修改入参。非法动作原样返回（引用相等），站点壳据此忽略 */
export function reduce(state: State, action: Action): State {
  if (state.over) return state
  const me = tankOf(state, state.turn)
  switch (action.type) {
    case 'move': {
      const ahead = stepAhead(state, me)
      if (!ahead) return state
      const moved: Tank = { col: ahead.col, row: ahead.row, dir: me.dir }
      return commit(state, state.turn, moved, {
        by: state.turn,
        kind: 'move',
        from: { ...me },
        path: [],
        endCell: idx(ahead.col, ahead.row),
        hit: false,
      })
    }

    case 'turn': {
      if (action.delta !== 1 && action.delta !== -1) return state
      const turned: Tank = { col: me.col, row: me.row, dir: turnDir(me.dir, action.delta) }
      return commit(state, state.turn, turned, {
        by: state.turn,
        kind: 'turn',
        from: { ...me },
        path: [],
        endCell: idx(me.col, me.row),
        hit: false,
      })
    }

    case 'shoot': {
      const trace = traceShot(state, me)
      const last: LastAction = {
        by: state.turn,
        kind: 'shoot',
        from: { ...me },
        path: trace.path,
        endCell: trace.endCell,
        hit: trace.hitPlayer !== 0,
      }
      const fired: State = { ...state, turn: other(state.turn), moves: state.moves + 1, last }
      // 命中即终局：不存在「打中了还能继续玩」的分支
      if (last.hit) return { ...fired, over: true, winner: state.turn }
      // 打空也必须走结算 —— 少了这一步，shoot 就成了唯一不收口的分支，
      // 双方无限互射时 moves 永远触发不到回合上限，对局永不分胜负（实测 60 个种子里
      // 28 个如此，站点壳按 over 收场就是界面死循环）。
      return settle(fired)
    }
  }
}

// ---------------- 评估与 AI ----------------

/** 胜负压过一切，其余按「命中 → 威胁 → 对齐 → 逼近」递减 */
const W_WIN = 1_000_000
/** 这一手开火就能命中 —— 最强信号，远大于其它项 */
const W_HIT = 20_000
/** 对方这一手开火就能命中我 —— 负债，压低「站到对方枪口前」的走法 */
const W_THREAT = 9_000
/** 与对方同行/同列：规格要求「同一行/列则转向并射击」 */
const W_ALIGN = 1_200
/** 炮口正对对方（多半再转一步或一步就能开火） */
const W_AIM = 400
/** 与对方之间无遮挡（对齐但被墙挡住时拿不到这一项） */
const W_LOS = 200
/** 曼哈顿距离：每靠近一格的收益 */
const W_DIST = 260

/**
 * 纯启发式评估（me 视角，越大越好），关于「己方 / 对方」完全反对称：
 *   1) 我这一手就能命中 → +W_HIT（规格里的「转向并射击」正是靠这一项选出来的）；
 *   2) 对方这一手就能命中我 → −W_THREAT（避免傻站在对方枪口前）；
 *   3) 与对方同行/同列 → +W_ALIGN，配合第 1 项推出「对齐后转向即可开火」；
 *   4) 炮口正对对方 / 中间无墙 → 小额加成；
 *   5) 曼哈顿距离每格 −W_DIST —— 距离是规格里「否则朝对方方向移动逼近」的主项。
 */
export function evaluate(state: State, me: Player): number {
  if (state.over) return state.winner === 0 ? 0 : state.winner === me ? W_WIN : -W_WIN
  const a = tankOf(state, me)
  const b = tankOf(state, other(me))
  let s = 0
  if (shotHits(state, a)) s += W_HIT
  if (shotHits(state, b)) s -= W_THREAT
  if (aligned(a, b)) s += W_ALIGN
  if (facesToward(a, b)) s += W_AIM
  if (clearLine(state, a, b)) s += W_LOS
  s -= W_DIST * (Math.abs(a.col - b.col) + Math.abs(a.row - b.row))
  return s
}

/**
 * 为 me 挑最优动作：遍历 legalActions → 逐个喂**同一个 reduce** 试算 → 对试算结果打分。
 * 绝不维护第二套规则逻辑。同分用 state.rng 打散，保证「相同状态 → 相同动作」可复盘。
 */
export function bestAction(state: State, me: Player): Action | null {
  if (state.over || state.turn !== me) return null
  const acts = legalActions(state)
  if (acts.length === 0) return null

  let top = -Infinity
  const tied: Action[] = []
  for (const a of acts) {
    const v = evaluate(reduce(state, a), me)
    if (v > top) {
      top = v
      tied.length = 0
      tied.push(a)
    } else if (v === top) {
      tied.push(a)
    }
  }
  return tied.length === 1 ? tied[0] : tied[new Rng(state.rng).int(tied.length)]
}

/** 轮到电脑时返回动作；不是它的回合或已终局时返回 null */
export function aiAction(state: State): Action | null {
  return bestAction(state, COMPUTER)
}
