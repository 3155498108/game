/**
 * 麻将对对消规则（纯逻辑，零 DOM 依赖，可在 node 环境单测）。
 *
 * ── 玩法裁决（实现前定死，避免日后反复） ──────────────────────────────
 * 1. **消除条件 = 牌面完全相同 + 存在连通路径**。
 *    「牌面相同」指花色与点数都相同（同点数不同花色算「不同」，会盖回）；
 *    于是牌阵里天然存在「长得极像却配不上」的牌，对应规格里的「牌面可完全相同也可有部分异色」。
 * 2. **连通 = 至多拐弯 1 次（最多两段直线）**，即直线或 L 形。
 * 3. **牌阵外扩一圈视为空格**（连连看的标准做法，路径允许绕出盘面）。
 *    需要说明的是：拐点必然落在「两牌所在行 × 两牌所在列」的交点上，那永远在盘内，
 *    所以在 ≤1 次拐弯的限制下这一圈外扩实际上不会被走到；仍保留坐标式判定，
 *    是为了 (a) 语义上与经典连连看一致，(b) 日后放宽拐弯次数时不必重写判定。
 *    代价是需要 2 次拐弯才能绕出盘面的路线，本规则一律判为不可消（见 rules.test.ts）。
 * 4. **步数只在成功消除时 +1**；翻牌配对失败（盖回）不计步，这样「最少步数」才等于
 *    「消除次数」，玩家无法靠乱点刷低数字。
 * 5. **用时不进 State**：时间戳会破坏 reduce 的纯函数性。用时由 index.ts 在渲染层
 *    自行计时，本文件只有可复盘的纯数据。
 *
 * ── 其他硬约束 ────────────────────────────────────────────────────────
 * - 随机全部走 core/rng 的 Rng，种子由 create(seed) 注入，禁止 Math.random。
 * - 牌面永远成对生成（先造对子表再打散），再跑一次可解性检查；
 *   不通过就用同一个 Rng 重新洗，最多 MAX_GEN_ATTEMPTS 次，
 *   用尽仍不通过则回落到 adjacentLayout —— 把同花色的两张摆成水平相邻，
 *   任何消除顺序下每一对都至少有一格是空的，因此必然可解。
 * - 索引约定：faces 的下标 = row * cols + col，row 0 在最上面。
 */
import { Rng } from '../../core/rng'

/** 已消除的格子在 faces 中的记号 */
export const GONE = -1

/** 关卡定义：牌阵逐关变大，牌数 8 → 16 → 24（恒为偶数） */
export interface LevelDef {
  name: string
  cols: number
  rows: number
}

/** 三关：2×4 → 4×4 → 4×6。列数恒为偶数，保证兜底布局里对子不会跨行 */
export const LEVELS: readonly LevelDef[] = [
  { name: '热身 2×4', cols: 4, rows: 2 },
  { name: '进阶 4×4', cols: 4, rows: 4 },
  { name: '终局 4×6', cols: 4, rows: 6 },
]

/** 生成一关时最多重试次数；用尽仍判不出可解则回落到保证可解的兜底构造 */
export const MAX_GEN_ATTEMPTS = 200

// ---------------- 牌面目录（34 种麻将牌） ----------------

/** 花色名：万 / 条 / 筒 */
export const SUIT_NAMES = ['万', '条', '筒'] as const
/** 字牌：东南西北中发白 */
export const HONOR_NAMES = ['东', '南', '西', '北', '中', '发', '白'] as const
/** 汉字数字 */
export const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'] as const

export interface TileKind {
  /** 0=万 1=条 2=筒 3=字牌 */
  suit: number
  /** 数牌 1..9，字牌 1..7 */
  rank: number
  /** 牌面主文字 */
  text: string
  /** 牌面副文字（花色字；字牌为空） */
  suitText: string
}

function buildKinds(): TileKind[] {
  const out: TileKind[] = []
  for (let s = 0; s < SUIT_NAMES.length; s++) {
    for (let r = 1; r <= 9; r++) out.push({ suit: s, rank: r, text: NUMERALS[r - 1], suitText: SUIT_NAMES[s] })
  }
  for (let h = 0; h < HONOR_NAMES.length; h++) out.push({ suit: 3, rank: h + 1, text: HONOR_NAMES[h], suitText: '' })
  return out
}

/** 全部牌面；faces 里存的是本表的下标 */
export const KINDS: readonly TileKind[] = buildKinds()

/** 每种花色占用的下标段长度（数牌 9 种） */
const SUIT_STRIDE = 9

/** (花色, 点数) → 牌面下标 */
export function kindId(suit: number, rank: number): number {
  return suit * SUIT_STRIDE + (rank - 1)
}

// ---------------- 初始牌面生成 ----------------

/**
 * 挑 count 种牌面（count 必须为偶数）。
 * 按「同点数、不同花色」成组挑选，于是牌阵里天然带着「长得极像却配不上」的干扰牌。
 */
export function pickKinds(r: Rng, count: number): number[] {
  const ranks = r.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])
  const out: number[] = []
  let i = 0
  while (out.length < count) {
    const rank = ranks[i % ranks.length]
    const suits = r.shuffle([0, 1, 2])
    out.push(kindId(suits[0], rank))
    if (out.length < count) out.push(kindId(suits[1], rank))
    i++
  }
  return out
}

/** 一组牌面，每种各 2 张，长度恒为偶数 */
export function deckOf(kinds: readonly number[]): number[] {
  const deck: number[] = []
  for (const k of kinds) deck.push(k, k)
  return deck
}

/**
 * 兜底布局：每种牌面的两张摆成水平相邻（列数恒为偶数，不会跨行）。
 * 相邻两格之间没有中间格，所以无论先消哪一对都必定连通 —— 必然可解。
 * 入参 tiles 里每种牌面恰好 2 张（消除总是成对发生，故恒成立）。
 */
export function adjacentLayout(tiles: readonly number[], cols: number, rows: number): number[] {
  const counts = new Map<number, number>()
  for (const f of tiles) counts.set(f, (counts.get(f) ?? 0) + 1)
  const seq: number[] = []
  for (const [face, n] of counts) for (let k = 0; k < n; k++) seq.push(face)
  const out = new Array<number>(cols * rows).fill(GONE)
  for (let i = 0; i + 1 < out.length; i += 2) {
    out[i] = seq[i]
    out[i + 1] = seq[i]
  }
  return out
}

/**
 * 生成一个保证能消完的牌面数组。
 * 成对造牌 → 打散 → 用贪心消除验一遍可解性；不通过就换一次洗牌，最多 MAX_GEN_ATTEMPTS 次。
 */
export function generateFaces(r: Rng, cols: number, rows: number): number[] {
  const count = cols * rows
  const kinds = pickKinds(r, count / 2)
  const deck = deckOf(kinds)
  for (let attempt = 0; attempt < MAX_GEN_ATTEMPTS; attempt++) {
    const faces = r.shuffle(deck)
    if (isSolvable(faces, cols, rows)) return faces
  }
  return adjacentLayout(deck, cols, rows)
}

/**
 * 把剩余的牌重新摆成可解局面（死局救援）。
 * 先随机重排并验可解性，用尽次数再回落到相邻兜底布局。
 */
export function relayoutRemaining(r: Rng, tiles: readonly number[], cols: number, rows: number): number[] {
  for (let attempt = 0; attempt < MAX_GEN_ATTEMPTS; attempt++) {
    const shuffled = r.shuffle(tiles)
    const out = new Array<number>(cols * rows).fill(GONE)
    for (let i = 0; i < shuffled.length; i++) out[i] = shuffled[i]
    if (isSolvable(out, cols, rows)) return out
  }
  return adjacentLayout(tiles, cols, rows)
}

// ---------------- 连通判定 ----------------

/** 索引是否落在盘面内（顺带排除小数与 NaN） */
export function validIndex(index: number, cols: number, rows: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < cols * rows
}

/**
 * 盘面外扩一圈后的坐标里 (pr, pc) 是否为空。
 * 牌阵外的空间一律视为空；比这一圈更远的地方不参与判定（直接算「挡住」）。
 * pr / pc 用外扩坐标：0 与 rows+1 / cols+1 是盘外那一圈。
 */
export function isFreeAt(faces: readonly number[], cols: number, rows: number, pr: number, pc: number): boolean {
  if (pr < 0 || pr > rows + 1 || pc < 0 || pc > cols + 1) return false
  if (pr === 0 || pr === rows + 1 || pc === 0 || pc === cols + 1) return true
  return faces[(pr - 1) * cols + (pc - 1)] === GONE
}

/** a、b 自身的格子视作空，其余按 isFreeAt 判定 */
function blockedAt(faces: readonly number[], cols: number, rows: number, pr: number, pc: number, a: number, b: number): boolean {
  if (pr < 0 || pr > rows + 1 || pc < 0 || pc > cols + 1) return true
  if (pr === 0 || pr === rows + 1 || pc === 0 || pc === cols + 1) return false
  const i = (pr - 1) * cols + (pc - 1)
  if (i === a || i === b) return false
  return faces[i] !== GONE
}

/** 同一行内 [c1,c2] 闭区间是否畅通（含两端） */
function rowClear(faces: readonly number[], cols: number, rows: number, pr: number, c1: number, c2: number, a: number, b: number): boolean {
  const lo = c1 < c2 ? c1 : c2
  const hi = c1 < c2 ? c2 : c1
  for (let pc = lo; pc <= hi; pc++) if (blockedAt(faces, cols, rows, pr, pc, a, b)) return false
  return true
}

/** 同一列内 [r1,r2] 闭区间是否畅通（含两端） */
function colClear(faces: readonly number[], cols: number, rows: number, pc: number, r1: number, r2: number, a: number, b: number): boolean {
  const lo = r1 < r2 ? r1 : r2
  const hi = r1 < r2 ? r2 : r1
  for (let pr = lo; pr <= hi; pr++) if (blockedAt(faces, cols, rows, pr, pc, a, b)) return false
  return true
}

/**
 * 两张牌能否连成一对：牌面相同，且存在 ≤1 次拐弯的连通路径。
 * 依次尝试：直线横、直线竖、L 形（左上角拐点）、L 形（右下角拐点）。
 */
export function canConnect(faces: readonly number[], cols: number, rows: number, a: number, b: number): boolean {
  if (a === b || !validIndex(a, cols, rows) || !validIndex(b, cols, rows)) return false
  if (faces[a] === GONE || faces[b] === GONE) return false
  if (faces[a] !== faces[b]) return false
  // 盘内坐标 → 外扩坐标
  const ar = Math.floor(a / cols) + 1
  const ac = (a % cols) + 1
  const br = Math.floor(b / cols) + 1
  const bc = (b % cols) + 1
  if (ar === br && rowClear(faces, cols, rows, ar, ac, bc, a, b)) return true
  if (ac === bc && colClear(faces, cols, rows, ac, ar, br, a, b)) return true
  // 拐点 (ar, bc)
  if (rowClear(faces, cols, rows, ar, ac, bc, a, b) && colClear(faces, cols, rows, bc, ar, br, a, b)) return true
  // 拐点 (br, ac)
  if (colClear(faces, cols, rows, ac, ar, br, a, b) && rowClear(faces, cols, rows, br, ac, bc, a, b)) return true
  return false
}

/** 指定牌面的一对里，第一个能与它连通的下标；没有则 -1 */
export function partnerOfIn(faces: readonly number[], cols: number, rows: number, index: number): number {
  if (!validIndex(index, cols, rows) || faces[index] === GONE) return -1
  for (let j = 0; j < faces.length; j++) {
    if (j === index || faces[j] !== faces[index]) continue
    if (canConnect(faces, cols, rows, index, j)) return j
  }
  return -1
}

/** 盘面上是否还存在任意一对可消的牌 */
export function hasAnyMoveIn(faces: readonly number[], cols: number, rows: number): boolean {
  for (let i = 0; i < faces.length; i++) {
    if (faces[i] === GONE) continue
    for (let j = i + 1; j < faces.length; j++) {
      if (faces[j] === GONE || faces[j] !== faces[i]) continue
      if (canConnect(faces, cols, rows, i, j)) return true
    }
  }
  return false
}

/**
 * 贪心消完一遍，能全消掉才算可解。
 * 贪心是保守判据（可能把可解局面判成不可解），但用于「生成时挑牌面」足够安全：
 * 只有贪心能消完的局面才被采用。
 */
export function isSolvable(faces: readonly number[], cols: number, rows: number): boolean {
  const work = faces.slice()
  for (;;) {
    let removed = false
    search: for (let i = 0; i < work.length; i++) {
      if (work[i] === GONE) continue
      for (let j = i + 1; j < work.length; j++) {
        if (work[j] === GONE || work[j] !== work[i]) continue
        if (!canConnect(work, cols, rows, i, j)) continue
        work[i] = GONE
        work[j] = GONE
        removed = true
        break search
      }
    }
    if (!removed) break
  }
  return countTiles(work) === 0
}

/** 盘面上剩余的牌数 */
export function countTiles(faces: readonly number[]): number {
  let n = 0
  for (let i = 0; i < faces.length; i++) if (faces[i] !== GONE) n++
  return n
}

/** 每种牌面的剩余张数（用于测试断言「计数守恒且恒为偶数」） */
export function faceCounts(faces: readonly number[], kinds: number): number[] {
  const out = new Array<number>(kinds).fill(0)
  for (let i = 0; i < faces.length; i++) {
    if (faces[i] !== GONE && faces[i] < kinds) out[faces[i]] += 1
  }
  return out
}

// ---------------- 状态机 ----------------

export interface State {
  /** 当前关卡下标（0 起） */
  level: number
  /** 当前牌阵列数 */
  cols: number
  /** 当前牌阵行数 */
  rows: number
  /** 每格的牌面下标，GONE 表示已消除 */
  faces: number[]
  /** 第一张已翻开的牌，-1 表示无 */
  first: number
  /** 第二张已翻开的牌，-1 表示无 */
  second: number
  /** 两张不匹配，等待盖回 */
  pending: boolean
  /** 最近一次消除的两张牌索引（动画与粒子用） */
  matched: number[]
  /** 本关步数：只在成功消除时 +1 */
  moves: number
  /** 本关配对成功数 */
  pairs: number
  /** 三关累计步数 */
  totalMoves: number
  /** 三关累计配对数 */
  totalPairs: number
  /** 成功消除的累计次数，仅用于渲染动画签名 */
  clears: number
  /** 最近一次翻开的牌，-1 表示无，仅用于渲染动画 */
  lastFlip: number
  /** 悬停的牌，-1 表示无 */
  hover: number
  /** 本关是否已消完 */
  levelClear: boolean
  /** 还有牌但无牌可消（死局，可重排救援） */
  dead: boolean
  /** 三关是否全部完成 */
  allDone: boolean
  /** 本次会话每关的最少步数，-1 表示还没通关 */
  bestMoves: number[]
  /** 可播种随机游标 */
  rng: number
}

export type Action =
  /** 翻牌：翻第一张，或与已翻开的张配对（相同且连通则消除，否则盖回） */
  | { type: 'pick'; index: number }
  /** 盖回两张不匹配的牌 */
  | { type: 'settle' }
  /** 进入下一关（本关已消完时有效） */
  | { type: 'next' }
  /** 死局重排 */
  | { type: 'reshuffle' }
  | { type: 'hover'; index: number }
  | { type: 'leave' }

export function create(seed: number): State {
  const lv = LEVELS[0]
  const r = new Rng(seed)
  const faces = generateFaces(r, lv.cols, lv.rows)
  return {
    level: 0,
    cols: lv.cols,
    rows: lv.rows,
    faces,
    first: -1,
    second: -1,
    pending: false,
    matched: [],
    moves: 0,
    pairs: 0,
    totalMoves: 0,
    totalPairs: 0,
    clears: 0,
    lastFlip: -1,
    hover: -1,
    levelClear: false,
    dead: false,
    allDone: false,
    bestMoves: LEVELS.map(() => -1),
    rng: r.s,
  }
}

/** 本关是否已消完 */
export function isComplete(state: State): boolean {
  return countTiles(state.faces) === 0
}

/** 该格是否还能被翻（存在、未被选为第一张） */
export function playable(state: State, index: number): boolean {
  return validIndex(index, state.cols, state.rows) && state.faces[index] !== GONE && state.faces[index] >= 0 && index !== state.first
}

/** 当前是否还有任意一对可消 */
export function hasAnyMove(state: State): boolean {
  return !isComplete(state) && hasAnyMoveIn(state.faces, state.cols, state.rows)
}

/** 该牌当前能配上的另一张（渲染高亮 / 提示用），-1 表示无 */
export function partnerOf(state: State, index: number): number {
  return partnerOfIn(state.faces, state.cols, state.rows, index)
}

/** 纯函数状态迁移：不读时间、不读全局随机数、不修改入参；非法动作返回入参本身 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'leave':
      // 本关结束（含死局结算画面）后不再接受任何操作
      if (state.allDone || state.levelClear) return state
      return state.hover === -1 ? state : { ...state, hover: -1 }

    case 'hover': {
      const i = action.index
      if (state.allDone || state.levelClear || state.pending) return state
      if (i !== -1 && !playable(state, i)) return state
      return state.hover === i ? state : { ...state, hover: i }
    }

    case 'pick': {
      if (state.allDone || state.levelClear || state.pending) return state
      const i = action.index
      if (!playable(state, i)) return state
      // 翻第一张
      if (state.first < 0) return { ...state, first: i, lastFlip: i, hover: i }
      // 翻第二张
      const j = state.first
      if (canConnect(state.faces, state.cols, state.rows, j, i)) {
        const faces = state.faces.slice()
        faces[j] = GONE
        faces[i] = GONE
        const moves = state.moves + 1
        const levelClear = countTiles(faces) === 0
        const base: State = {
          ...state,
          faces,
          first: -1,
          second: -1,
          pending: false,
          matched: [j, i],
          moves,
          pairs: state.pairs + 1,
          totalMoves: state.totalMoves + 1,
          totalPairs: state.totalPairs + 1,
          clears: state.clears + 1,
          lastFlip: i,
          hover: i,
          levelClear,
          allDone: levelClear && state.level === LEVELS.length - 1,
          bestMoves: levelClear ? withRecord(state.bestMoves, state.level, moves) : state.bestMoves,
        }
        return levelClear ? base : { ...base, dead: !hasAnyMove(base) }
      }
      // 牌面不同或连不通：盖回，不计步
      return { ...state, second: i, pending: true, lastFlip: i, hover: i }
    }

    case 'settle': {
      if (!state.pending) return state
      return { ...state, first: -1, second: -1, pending: false }
    }

    case 'next': {
      if (!state.levelClear || state.allDone) return state
      const index = state.level + 1
      if (index >= LEVELS.length) return state
      const lv = LEVELS[index]
      const r = new Rng(state.rng)
      const faces = generateFaces(r, lv.cols, lv.rows)
      return {
        ...state,
        level: index,
        cols: lv.cols,
        rows: lv.rows,
        faces,
        first: -1,
        second: -1,
        pending: false,
        matched: [],
        moves: 0,
        pairs: 0,
        clears: 0,
        lastFlip: -1,
        hover: -1,
        levelClear: false,
        dead: false,
        rng: r.s,
      }
    }

    case 'reshuffle': {
      if (!state.dead || state.allDone) return state
      const r = new Rng(state.rng)
      const left: number[] = []
      for (let i = 0; i < state.faces.length; i++) if (state.faces[i] !== GONE) left.push(state.faces[i])
      const faces = relayoutRemaining(r, left, state.cols, state.rows)
      return { ...state, faces, first: -1, second: -1, pending: false, matched: [], dead: false, lastFlip: -1, rng: r.s }
    }

    default:
      return state
  }
}

/** 把本关步数写进会话纪录（只保留更少的步数），返回新数组 */
function withRecord(records: readonly number[], level: number, moves: number): number[] {
  const out = records.slice()
  if (out[level] < 0 || moves < out[level]) out[level] = moves
  return out
}

/** 翻某张牌的直观别名，便于测试复用同一入口 */
export function pick(state: State, index: number): State {
  return reduce(state, { type: 'pick', index })
}