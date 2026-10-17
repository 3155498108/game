# 小游戏合集

一个**纯静态**的网页小游戏合集站点：首页列出所有游戏，点进任意游戏游玩，玩完返回首页继续选。
同一套代码同时适配手机浏览器和桌面浏览器。

- 技术栈：Vite + TypeScript（`strict: true`）+ Canvas 2D + 原生 DOM/CSS，测试用 Vitest
- **零运行时依赖**：不引入游戏引擎、状态库、物理引擎、UI 组件库、后端框架
- 站点壳主块 gzip 后约 24.1 KB，单个游戏按需加载约 4~6 KB gzip
- 纯静态部署，`dist/` 直接丢到任意静态托管即可，无后端
- 全站有**金币系统**：每局可下注、输赢结算金币，余额存在 localStorage，首页可每日签到领币
- 每款游戏都有**玩法介绍**（游戏页顶栏「玩法」按钮，首次进入自动展开一次）

---

## 快速开始

```bash
npm install

npm run dev        # 开发服务器（默认 http://localhost:5173）
npm run build      # 类型检查 + 生产构建，产物在 dist/
npm run preview    # 预览生产构建
npm test           # 运行全部 Vitest 测试
npm run typecheck  # 只做类型检查
```

要求 Node 18+（开发环境实测 Node 24）。

---

## 目录结构

```
src/
├─ core/          # 游戏内核：纯 TypeScript，零依赖，可在 node 环境单测
│  ├─ types.ts    #   统一游戏接口 GameModule / GameMeta / Action 等
│  ├─ rng.ts      #   可播种随机 mulberry32（Rng 类）
│  ├─ cards.ts    #   扑克牌数据结构
│  └─ geom.ts     #   几何工具（命中判定）
├─ render/        # 共用渲染层：Canvas 2D
│  ├─ draw.ts     #   颜色常量、圆角矩形、阴影文本、缓动函数、按钮
│  ├─ cards.ts    #   程序绘制牌面（无图片资源）
│  ├─ anim.ts     #   动画旁路缓存（不进 reduce）
│  ├─ fx.ts       #   粒子 / 闪光 / 震屏
│  └─ audio.ts    #   WebAudio 合成音效（无音频文件）
├─ shell/         # 站点壳：首屏只加载这一层
│  ├─ home.ts     #   首页游戏列表、分类、搜索、每日挑战、金币余额与签到
│  ├─ play.ts     #   游戏页外壳（含金币条：注额 / 余额 / 本局盈亏）
│  ├─ runtime.ts  #   游戏运行时：缩放适配、指针输入、rAF 循环、结算金币
│  ├─ registry.ts #   游戏注册表（自动发现 games/*/）
│  ├─ coins.ts    #   钱包：余额 / 注额 / 下注 / 结算 / 每日签到（纯本地虚拟积分）
│  ├─ storage.ts  #   localStorage 安全封装
│  └─ daily.ts    #   每日挑战种子
└─ games/
   └─ <game-id>/  # 每个游戏一个目录，互不依赖
      ├─ meta.ts         # 列表页元信息（必须具名导出 meta）
      ├─ rules.ts        # 纯逻辑规则（禁止 import DOM、禁止 Math.random）
      ├─ index.ts        # 渲染 + 输入映射，导出 GameModule
      └─ rules.test.ts   # Vitest 测试
```

---

## 架构：三层

```
站点壳（列表 / 分类 / 搜索）   ← 首屏只加载这一层
    ↓ 动态 import()
游戏内核（纯 TypeScript 状态机） ← 零依赖，node 环境可单测
    ↓
共用渲染层（Canvas 2D）          ← 牌面、棋盘、动画、音效、缩放适配
```

### 三条不可动摇的原则

1. **`reduce` 必须是纯函数** —— 相同输入产生相同输出，不读时间、不读全局随机数、不碰 DOM。这样才能单测、才能被 AI 复用。
2. **AI 与规则共享同一个 reducer** —— `aiAction` 通过遍历候选 action 并对 `reduce` 试算来选最优，**不维护第二套规则逻辑**。
3. **随机数必须可播种** —— 用 `mulberry32`，seed 从 `create(seed)` 传入。游戏逻辑里禁止 `Math.random()`，否则「每日挑战」和「复盘对局」对不上账。

### 统一游戏接口

```ts
interface GameModule<S = any, A = any> extends GameMeta {
  id: string                    // 唯一标识，kebab-case，且必须等于目录名
  name: string                  // 中文名
  category: 'card' | 'board' | 'puzzle' | 'arcade' | 'mini'
  tags: string[]
  viewport: { width: number; height: number }   // 逻辑分辨率
  orientation: 'portrait' | 'landscape' | 'both'
  players: 1 | 2 | 'ai'
  summary: string               // 一句话玩法，显示在列表页
  howto?: string[]              // 玩法介绍，3~6 条，每条一句话（见下）

  create(seed: number): S
  reduce(state: S, action: A): S              // 纯函数
  render(ctx: CanvasRenderingContext2D, s: S): void
  aiAction?(state: S): A | null               // 仅 AI 对局需要；**不是 AI 回合必须返回 null**

  // ---- 可选增强 ----
  input?(state: S, p: PointerInput): A | null  // 指针 → action（纯函数）
  key?(state: S, key: string): A | null        // 键盘（桌面便利）
  tick?(dt: number): A                         // 实时游戏每帧推进
  hint?(state: S): string                      // 提示区文字
  controls?(state: S): Control<A>[]            // 提示区按钮（天然满足 44px 触控）
  outcome?(state: S): Outcome | null           // 结算成绩
  effects?(prev: S, next: S): Effect[]         // 音效 / 粒子 / 震屏
  coins?(state: S, outcome: Outcome, bet: number): number  // 金币结算，默认按胜负算 ±注额
  aiDelay?: number                             // AI 思考延迟 ms，默认 500；0 = 每帧同步
}
```

### 玩法介绍 `howto`

每款游戏可以在 `meta.ts` 里写一段 `howto`，站点壳会在游戏页顶栏挂一个「玩法」按钮弹出；**首次进入某款游戏会自动展开一次**（记在 `gs:<id>:howto-seen`），看过之后只保留手动入口。

```ts
howto: [
  '7×9 棋盘，1 只狐狸对 4 只兔 + 1 只猎犬，你执兔方。',
  '狐狸要滑到左右两侧的底线格逃走，兔子要把它围死让它无路可走。',
  // …3~6 条为宜
]
```

写法有硬要求，`src/smoke.test.ts` 会当契约盯着：**每条只讲一个动作、必须包含怎么赢或怎么结束、3~6 条、每条 6~40 字、以句号结尾**，并且**不许出现实现细节**（常量名、坐标、函数名、`{}<>;`、下划线变量、赋值）——那是给维护者看的，不是给玩家看的。

> 文案放在 `meta.ts` 而不是集中到壳层的一个文件，是为了保持「每个游戏目录自包含」：新增游戏时不用回头改壳层。代价是 43 份中文文案都进了首屏包，壳主块从 17.7 KB gzip 涨到 **24.1 KB**。

---

## 金币系统

全站通用的**纯本地虚拟积分**：开局送 1000 枚，每局可选注额下注，赢了翻倍、输了扣掉，余额存在 `localStorage`。

> **产品边界**：这是纯本地的娱乐积分，**没有充值、兑换、交易、提现，也不上传任何数据**。想「重置」直接清掉浏览器的站点存储即可。

### 为什么结算逻辑住在站点壳而不是 `core/`

钱包要读写 `localStorage`，而本项目的硬约束是**游戏的 `rules.ts` 不得触碰全局存储**。所以：

```
shell/coins.ts   ← 钱包、下注、结算、签到（唯一允许读写 localStorage 的地方之一）
     ↓ 调用
games/<id>/index.ts  ← 只提供一个纯函数 coins(state, outcome, bet): number
```

游戏侧只拿到 `state` 和 `bet`，返回一个**金币增减量**，永远不知道钱存在哪。

### 默认结算规则

不写 `coins()` 的游戏走壳层默认规则：

| `outcome.win` | 结算 |
|---|---|
| `true` | `+bet` |
| `false` | `-bet` |
| `undefined` | **不结算**（不扣也不加） |

> 第三条最容易踩：得分型游戏**不写 `coins()` 就等于免费玩**。「不实现」的真实含义是「这个游戏不参与金币」，不是「白送」。

### 自定义结算：得分型游戏用「门票制」

4 款按分数结算的游戏（钓鱼 / 六连珠 / 轨道车 / 射靶）写了各自的 `coins()`，统一公式：

```
mult = floor(score / PAR)
mult <= 0  →  -bet      // 门票打水漂
mult >  0  →  +bet×mult
```

`PAR`（保本分数线）由探针实测得出，不是拍脑袋定的：

| 游戏 | PAR | 怎么定的 |
|---|---|---|
| 钓鱼 fishing | 150 斤 | 笨 bot 实测 129~269 |
| 六连珠 link-six | 400 分 | 随机走法实测 1130 |
| 轨道车 rail-cart | 50 分 | 不躲 bot 只有 5~78 |
| 射靶 target-shooting | 300 分 | 探针实测 |

新写的博彩类游戏（梭哈 / 轮盘 / 老虎机 / 扫雷赌局 / 百家乐）也走 `coins()`，但它们按**牌型 / 赔率**换算倍数，同样遵守**按注额倍数换算、不写死面值**——否则玩家调注额就不起作用了。

### 破产兜底

四道防线，任何一道单独失效都不会把玩家搞成负数：

1. 下注额永不超余额（`effectiveBet`）
2. 单局最多输掉本局注额，不透支
3. 赢钱封顶（`MAX_PAYOUT`），避免溢出
4. 余额夹在 ≥0

结算**只在终局触发一次**（与「刷新最佳纪录」同点、同受 `outcomeSaved` 保护）；**每日挑战不结算**，防止刷币。

### 每日签到

首页顶部有余额条与签到按钮。7 天一循环，依次发 50 / 75 / 100 / 125 / 150 / 175 / 200 枚，签完等次日。

签到判定用的是**本地日期**（`getFullYear/getMonth/getDate`）而不是 `toISOString()`——后者会把东八区凌晨 8 点之前算成前一天。

---

## 如何新增一个游戏

**不需要修改站点壳的任何代码。** 注册表用 `import.meta.glob` 自动发现 `src/games/*/`，建目录即生效。

### 步骤清单

1. **建目录**：`src/games/<game-id>/`，`<game-id>` 用 kebab-case，且**必须等于 meta 里的 `id`**（不一致会打警告，且该游戏不会出现在首页）。

2. **写 `meta.ts`** —— 注意必须是**具名导出**（注册表用 `import: 'meta'` 收集，只认具名导出；只写默认导出会导致首页游戏列表整个为空）：

   ```ts
   import type { GameMeta } from '../../core/types'

   export const meta: GameMeta = {
     id: 'my-game',                        // 必须等于目录名
     name: '我的游戏',
     category: 'puzzle',
     tags: ['单人', '益智'],
     viewport: { width: 720, height: 1280 },  // 竖屏游戏用这个
     orientation: 'portrait',
     players: 1,
     summary: '一句话玩法，显示在列表页。',
   }

   export default meta
   ```

3. **写 `rules.ts`** —— 纯逻辑，必须满足：
   - **禁止 import 任何 DOM 相关模块**（保证能在 Vitest 的 node 环境直接跑）
   - **禁止 `Math.random()`**、禁止读 `Date` / `performance` / 全局变量
   - 随机数用 `Rng`：在 state 里存一个 `rng: number`，reduce 内 `const r = new Rng(state.rng)`，最后把 `r.s` 写回 state
   - `reduce` 返回新对象，**不修改入参**
   - 动画/计时**不要**进 state——见下面第 6 条

   最小骨架：

   ```ts
   export interface State {
     cells: number[]
     over: boolean
     moves: number
     rng: number
   }

   export type Action = { type: 'tap'; index: number }

   export function create(seed: number): State {
     return { cells: new Array(16).fill(0), over: false, moves: 0, rng: seed | 0 }
   }

   export function reduce(state: State, action: Action): State {
     if (state.over) return state
     const cells = state.cells.slice()
     cells[action.index] = 1
     return { ...state, cells, moves: state.moves + 1 }
   }
   ```

4. **写 `index.ts`** —— 默认导出 `GameModule`，负责渲染和输入映射：

   ```ts
   import type { Effect, GameModule, PointerInput } from '../../core/types'
   import { background, topBar } from '../../render/draw'
   import { inRect } from '../../core/geom'
   import meta from './meta'
   import { create, reduce, type Action, type State } from './rules'

   // 布局常量必须由 render 和 input 共用，否则坐标迟早不一致
   const CELL = 96
   const ORIGIN = { x: 24, y: 300 }

   function render(ctx: CanvasRenderingContext2D, s: State): void { /* 按 720×1280 逻辑坐标作画 */ }

   function input(s: State, p: PointerInput): Action | null {
     // p.x / p.y 已经是换算好的逻辑坐标，直接用 inRect / gridHit 判定
     return null
   }

   const game: GameModule<State, Action> = { ...meta, create, reduce, render, input }
   export default game
   ```

5. **写 `rules.test.ts`** —— Vitest，node 环境。至少覆盖：
   - 规则正确性（初始状态、合法操作、胜负/结束判定、边界与越界）
   - **AI 返回的 action 必须是合法的**（有 `aiAction` 的游戏必测）
   - **`reduce` 的纯函数性**：调用后原 state 的字段未被修改；相同输入两次调用结果完全相等
   - **可复盘性**：`create(同一 seed)` 两次结果完全一致

6. **计时类游戏的处理方式**（重要）：`reduce` 里不要放时间。拆成两半——
   - 视觉：render 用 `render/anim.ts` 的 `elapsedSince(key, sig, dur)` / `tweenTo(key, target)` 画倒计时或播放动画；
   - 状态推进：暴露一个显式 action（例如 `{ type: 'ready' }`），由玩家点击触发，通常配一个 `controls()` 按钮。

   这样 `reduce` 保持纯净，计时常量也能在测试里直接断言。

7. **验证**（四条全过才算完成）：

   ```bash
   npx vitest run src/games/<game-id>   # 这个游戏自己的单测全绿
   npx vitest run src/smoke.test.ts     # 全站冒烟：这个游戏的 render / effects / 控件接线也没问题
   npx tsc --noEmit                     # 退出码 0
   npm run build                        # 构建成功
   ```

   然后 `npm run dev`，在首页确认卡片出现、点进去能完整玩完一局。

   > `src/smoke.test.ts` 是全站冒烟：用普通对象冒充 `CanvasRenderingContext2D`，按站点壳的方式
   > （`aiAction` → `controls()` → 画布点击探针 → `tick(16)`）把 43 款各推一遍。
   > **单测只驱动 `rules.ts`，够不到 `index.ts` 这一层**——`render()` 会不会抛、控件有没有真的接到
   > `reduce` 上，只有它能查（章鱼烧的渲染崩溃就是它挖出来的，见 `DECISIONS.md` 4.14）。
   > 新增游戏不用改它，glob 会自动发现。

### 写新游戏时的几个易踩点

- **坐标**：运行时已经帮你换算好了，`PointerInput.x/y` 就是 720×1280 坐标系里的值，不要再乘 scale。
- **触控目标**：需要点按钮**一律用 `controls()`**，站点壳会渲染成真正的 DOM 按钮，天然 ≥44px。
  **不要在画布上重复自绘 `controls()` 已经声明的控件**——站点壳还会自动追加一个「新的一局」，
  自绘一遍等于同一操作出现两次（rush-hour 就因此在真机上出现 6 个重复按钮，见 `DECISIONS.md` 4.5）。
  确实非要在 canvas 里画按钮（例如画布内联的游戏元素）时，逻辑坐标下的高度建议 ≥110（最窄缩放下才够 44 CSS px）。
- **不要变形**：按 720×1280 的逻辑坐标作画即可，运行时负责等比缩放居中，多余区域自动填黑边。
- **`noUnusedLocals`**：tsconfig 开了这个开关，未使用的变量和参数都会让构建失败。
  看到「某 import 未使用」时顺手查一下它是不是被删掉的调用留下的——这往往是删代码只删了一半的信号。
- **规格里显式写出的约束要逐条勾**：`link-six` 能检测「连到已消除的球」却漏了规格明确要求的「不允许自交」，就是靠逐条核对才发现的（`DECISIONS.md` 4.8）。
- **动画旁路推出来的下标，别直接拿去索引 state 里的数组**：动画签名描述的是「刚刚发生了什么」，而数组内容可能已经被后续规则改写。章鱼烧按「本次落子的格子」读颜色，消除压实后那一格是 0，查表越界拿到 `undefined`，整个 `render` 抛异常、画面黑掉（`DECISIONS.md` 4.14）。
- **音效**：在 `effects(prev, next)` 里根据前后状态差异返回 `{ kind: 'sound', name: 'place' }` 之类，不要在 `reduce` 里直接调播放函数。
- **`coins()` 要按注额倍数换算，别写死面值**：写 `return 100` 的话，玩家把注额调到 500 也只赔 100。
  正确写法是 `bet × 倍数`。
- **`coins()` 不是唯一出口**：壳层只在**终局那一步**（`checkOutcome`）读一次 `coins()`，
  和「刷新最佳纪录」同点、同受 `outcomeSaved` 保护。不要指望每个 action 都能结算。

---

## 响应式适配规则

站点壳统一处理，游戏本身不需要关心：

| 要求 | 实现 |
|---|---|
| 禁止写两套布局 | `scale = min(cssW/vpW, cssH/vpH)` 等比缩放居中，多余区域填黑边，画面永不变形 |
| 统一输入 | 全部走 Pointer Events，一套代码同时覆盖鼠标和触摸；canvas 设 `touch-action: none` 并阻止双击缩放 |
| DPR 上限 2 | 高分屏按 3 倍渲染会白白多画一倍多边形，是移动端卡顿的头号原因 |
| 安全区 | 页面容器使用 `env(safe-area-inset-*)` + `viewport-fit=cover`，刘海和底部横条不遮挡按钮 |
| 横竖屏 | 依据 `orientation`，方向不符时显示旋转提示层，**不硬转 canvas** |
| 触控目标 | DOM 按钮最小 44×44 px |
| 省电 | 页面切走（`visibilitychange` / `pagehide`）时停止 `requestAnimationFrame` |

---

## 存档与每日挑战

- `localStorage` key 规范：`gs:<gameId>:best`
- 隐私模式、配额满、JSON 损坏等读取失败情况全部有兜底回落到内存，不会让游戏崩溃
- 首页提供「每日挑战」入口：当天日期（`yyyymmdd`）作为 seed 生成固定对局，当天所有人开局一致

---

## 已实现游戏

**共 43 款**，与规格逐条对应。

| 批次 | 游戏 |
|---|---|
| 第 1 批（验证架构） | 四子棋、比大小、记忆卡牌、数字华容道、猜颜色 |
| 第 2 批（牌类） | 二十一点、接龙 gops、大富豪 daifugo、翻牌接龙 last-card、连环新接龙 gops-chain、花牌配对、快艇骰子 |
| 第 3 批（棋盘） | 五子棋、国际跳棋、画点成框、兔猎犬、中国跳棋、黑白棋、英国十字戏 cross-xi |
| 第 4 批（益智） | 六连珠 link-six、章鱼烧 takoyaki、滑块解锁 rush-hour、麻将对对消 mahjong-match |
| 第 5 批（迷你） | 坦克对决 tank-duel、轨道车 rail-cart、弹戏 pachinko、猪尾巴 pig-tail |
| 第 6 批（休闲动作） | 钓鱼 fishing、射靶 target-shooting、玩具足球 toy-football、玩具棒球 toy-baseball、玩具网球 toy-tennis、玩具拳击 toy-boxing、玩具冰壶 toy-curling、高尔夫球 golf |
| 第 7 批（共享渲染重活） | 台球简化版 pool-lite、保龄球简化版 bowling-lite |
| 第 8 批（博彩类 + 全站金币） | 梭哈 stud-poker、轮盘 roulette、三轴老虎机 slot-machine、扫雷赌局 mines、百家乐 baccarat |

每款一个目录 `src/games/<id>/`，固定 4 个文件（`meta.ts` / `rules.ts` / `index.ts` / `rules.test.ts`），新增游戏不改站点壳任何代码（注册表用 `import.meta.glob` 自动发现）。

**验收现状**：

- `npm test` → **46 个测试文件 / 1735 个用例全绿**（43 份游戏单测 1521 + 全站冒烟 133 + 金币单测 26 + 金币集成 55）
- `npx tsc --noEmit` → **零错误**
- `npm run build` → 成功；**站点壳主块 24.1 KB gzip**（上限 50 KB；43 份玩法介绍文案进了首屏包，涨了 6.4 KB），游戏块按需加载约 4~6 KB gzip
- `rules.ts` 全局无 `Math.random` / `Date` / `performance`（仅注释中出现说明性文字）；5 款新游戏的 `rules.ts` 只 import `core/` 下的模块
- 全站冒烟（`src/smoke.test.ts`）：43 款的 `render` / `effects` / `controls` 接线在整局每一步都不抛错，通用驱动能推完 28/43 款；**另有跨游戏契约测试：回合制游戏的 `aiAction` 不得连走两步**（见 `DECISIONS.md` 4.22）
- 玩法介绍（`howto`）：43 款全部写了 3~6 条，条数、长度、句号结尾、不含实现细节、不与 `summary` 重抄，由冒烟测试当契约盯着
- 金币集成（`src/coins-integration.test.ts`）：**43 款真实游戏的 `coins()` 全部灌进 `settle()` 的安全网**——10 种 outcome × 5 档注额 × 「真实开局」和「空 state」两种输入，余额恒为整数/有限/非负、不变式成立、结算可复现；9 款自定义 `coins()` 的净盈亏都随注额同比缩放
- 真机渲染抽查（`vite preview` + 内置浏览器，746×1169、497×779、375×667 三种视口）：首页、梭哈、扫雷赌局、三轴老虎机、轮盘均正常渲染，**并因此挖出并修掉老虎机赔付表的叠字缺陷**（见 `DECISIONS.md` 4.20）
- **交互链路已在真机上点通**（本轮修的两款）：狐犬棋里玩家能选中棋子、合法落点高亮、滑行生效，AI 只应一手就把回合交还；网球能打出 9 拍对拉并正常结算金币（余额 980 → 970 → 960）

**已知未验证项**：

- **43 款没有逐款做人工视觉走查**，只抽查了首页与 5 款新游戏，以及本轮修的两款（网球 / 狐犬棋）。
- 竖屏游戏在**横屏视口**下会弹出「请旋转设备」遮罩并吃掉所有点击，这是设计如此；但在桌面窄窗口里也适用，真机上若觉得烦，优先查 `runtime.ts` 的 `resize()` 门禁条件。

实现过程中踩过的坑——真 bug（坦克对决 47% 对局死循环、章鱼烧渲染崩溃、网球 AI 钉死中线、狐犬棋 AI 接管双方）、假 bug（冒烟测试自己有 5 个坑）、以及「测试写错 vs 代码写错」「已完成任务 ≠ 已停止会话」这两条归因方法——都记在 `DECISIONS.md` 第四节；不实现的 7 类游戏及原因见第一节。

实现过程中踩过的坑——真 bug（坦克对决 47% 对局死循环、章鱼烧渲染崩溃）、假 bug（冒烟测试自己有 5 个坑）、以及「测试写错 vs 代码写错」「已完成任务 ≠ 已停止会话」这两条归因方法——都记在 `DECISIONS.md` 第四节；不实现的 7 类游戏及原因见第一节。