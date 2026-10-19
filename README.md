# 小游戏合集

一个**纯静态**的网页小游戏合集站点：首页列出所有游戏，点进任意游戏游玩，玩完返回首页继续选。
同一套代码同时适配手机浏览器和桌面浏览器。

- 技术栈：Vite + TypeScript（`strict: true`）+ Canvas 2D + 原生 DOM/CSS，测试用 Vitest
- **零运行时依赖**：不引入游戏引擎、状态库、物理引擎、UI 组件库、后端框架
- 站点壳主块 gzip 后约 24.5 KB，单个游戏按需加载约 4~6 KB gzip
- 纯静态部署，`dist/` 直接丢到任意静态托管即可，无后端
- 另有一套**微信小程序版**在 `miniprogram/`（已收录全部 44 款游戏），见下方「微信小程序版」
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
│  ├─ storage.ts  #   存档逻辑（JSON 读写 / 最佳纪录 / 内存兜底），后端由壳层注入
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
│  ├─ storage.ts  #   localStorage 后端适配器（逻辑在 core/storage.ts）
│  └─ daily.ts    #   每日挑战种子
└─ games/
   └─ <game-id>/  # 每个游戏一个目录，互不依赖
      ├─ meta.ts         # 列表页元信息（必须具名导出 meta）
      ├─ rules.ts        # 纯逻辑规则（禁止 import DOM、禁止 Math.random）
      ├─ index.ts        # 渲染 + 输入映射，导出 GameModule
      └─ rules.test.ts   # Vitest 测试

scripts/
└─ sync-miniprogram.mjs  # 同步脚本：把 src/ 的共享层逐字节复制到 miniprogram/，并据移植清单生成 shell/registry.ts（--check 只校验）

miniprogram/            # 微信小程序版（全部 44 款游戏），详见下方小节
├─ core/ render/        #   ← 共享层，由同步脚本生成，勿手改
├─ games/               #   ← 同上，只含 miniprogram/ported-games.json 里列出的游戏
├─ shell/ pages/        #   ← 小程序专属：DOM → WXML、Pointer Events → bindtouch*、存储 → wx.*
├─ ported-games.json    #   已移植游戏清单（唯一真相源）
└─ tests/               #   小程序壳层冒烟测试（不进小程序包）
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

> 文案放在 `meta.ts` 而不是集中到壳层的一个文件，是为了保持「每个游戏目录自包含」：新增游戏时不用回头改壳层。代价是 44 份中文文案都进了首屏包，壳主块从 17.7 KB gzip 涨到 **24.5 KB**。

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

5 款按分数结算的游戏（钓鱼 / 六连珠 / 轨道车 / 射靶 / 随机迷宫）写了各自的 `coins()`，统一公式：

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
| 随机迷宫 maze | 2 关 | 走完最短路约 16~30 步，2 关才回本 |

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
   > （`aiAction` → `controls()` → 画布点击探针 → `tick(16)`）把 44 款各推一遍。
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

## 微信小程序版

`miniprogram/` 下是同一套游戏的微信小程序版本，用微信开发者工具打开该目录即可。**已收录网页版全部 44 款游戏**，AppID 复用 `wxf3e6493929015452`。

> **为什么还放在同一个仓库里**：代码重叠度 79%，但**目录隔离已经拿到了代码隔离的绝大部分收益**；真正需要单独仓库的理由是「发布节奏分叉」，而那用按路径触发的 CI 就能解决。共享层已经做到逐字节零差异，将来真要拆就是纯机械操作。完整分析见 `DECISIONS.md` 4.33。

之所以能搬得这么快，是因为三层架构早就把边界画在了正确的位置：

| 层 | 小程序版处理 |
|---|---|
| `core/`、`games/*/rules.ts` | **原样复制**，零改动（`rules.ts` 本来就只依赖 `core/`） |
| `games/*/index.ts` | **原样复制**，它只接受一个 `CanvasRenderingContext2D`，两端同构 |
| `render/{draw,fx}.ts` | 原样复制；`anim.ts` 也原样复制，靠 `shell/perf.ts` 补 `performance` 垫片 |
| `render/audio.ts` | 保留原接口，实现降级为震动（见下） |
| `shell/` | 全部重写：DOM → WXML、Pointer Events → `bindtouch*`、`localStorage` → `wx.*StorageSync`、`import.meta.glob` → **生成注册表** |

共享层（`core/` + `render/{draw,anim,fx}` + `games/`，共 141 个文件）与网页版**逐字节相同**——唯一例外 `render/audio.ts` 只被壳层引用，任何游戏都不 import 它。

几处值得先知道的取舍（完整论证见 `DECISIONS.md` 4.32、4.33、4.35、4.36、4.37）：

- **音效降级为震动**：小程序的 `WebAudioContext` 只能播文件、不能像振荡器那样现场造波形，还原音色需要塞 9 个音频文件进 2MB 主包。所以 `play()` / `setMuted()` 等签名一字不改，实现换成 `wx.vibrateShort` / `wx.vibrateLong`——`runtime.ts` 一行都不用改，反馈通道从耳朵换到了手。
- **`performance` 靠垫片而不是改源码**：共享代码 `render/anim.ts` 读全局 `performance.now()`，小程序默认没有这个对象。那个 `0` 兜底在小程序里是**坏的**（所有动画卡在 0 时刻）。改 `anim.ts` 会让共享层出现「手改副本」，所以改为在 `shell/perf.ts` 装一个单调时钟垫片——顺带修掉 `Date.now()` 是墙钟、回拨会算出负数时长的问题。
- **横竖屏策略照规格第 5 条实现**：「视口方向与游戏要求不符就显示旋转提示层，**不要硬转 canvas**」。`app.json` 的 `pageOrientation` 用 `auto`（否则横屏游戏永远满足不了要求），方向不符时弹提示 + 停帧 + 拦输入，转屏后重新量画布再重算缩放。44 款里有 10 款是横屏——第一版试点漏了这条，玩具网球在真机上是坏的，见 `DECISIONS.md` 4.35。
- **注册表由清单生成**：小程序打包器要求依赖静态可分析，没有 `import.meta.glob` 这样的自动发现机制。于是 `miniprogram/ported-games.json` 是唯一真相源，`npm run sync:mini` 据此复制代码**并生成** `miniprogram/shell/registry.ts`。这与网页版的 `import.meta.glob` 目的相同——**「加一款游戏不需要改站点壳」**。
- **44 款全进主包也放得下**：源码 1.19 MB，按实测的 37.7% minify 压缩比约 **449 KB**，占 2 MB 上限的 22%，**不需要分包**。代价是 44 款游戏的模块会在启动时全部求值（网页版是动态 `import()` 按需加载）——这是两端明确不同的一点。
- **存档逻辑在 `core/`，壳层只留后端适配器**：网页版与小程序版原本各有一份手写的 `shell/storage.ts`，靠人工保持 API 一致。现在逻辑搬进 `core/storage.ts`（两端逐字节相同），平台差异只剩两处——**存储后端**（`localStorage` ↔ `wx.*StorageSync`）与**墙上时钟**（`core/` 不碰 `Date`，时间戳由壳层传进来）。附带好处：内存兜底（隐私模式 / 配额满时不让存档整个丢掉）以前只有网页版有，**现在两端都有**。见 `DECISIONS.md` 4.37。
- **三道「以前靠运气」的护栏**（`DECISIONS.md` 4.36、4.37）：Canvas API 白名单（小程序上下文不是浏览器实现，类型检查抓不到）、**越层依赖禁止**（共享层一条都不许 import 站点壳，白名单已随欠账还清而拆除）、清单↔注册表一致性。
- **验证状态**：类型检查、85 例小程序相关测试均通过（与网页版那份同时绿才算没退步），但**尚未在真机 / 模拟器上跑过**——微信开发者工具的 CLI 需要先在「设置 → 安全设置」里手动开启服务端口，这一步必须手动完成，因此预览环节尚未执行。

### 移植一款新游戏到小程序

```bash
# 1. 在 src/games/<id>/ 写好 4 个文件（与网页版同一套代码）
# 2. 把 id 加进 miniprogram/ported-games.json
npm run sync:mini     # 复制共享层 + 重新生成注册表
npm test              # 漂移检查会验：清单↔注册表一致、共享层零差异、无孤儿、import 可解析且不越层、无浏览器 API
```

**加一款游戏的成本 = 改一行清单 + 跑一条命令。** 不用碰注册表，也不用手抄任何文件。

`npm test` 里有一条**漂移检查**（`src/miniprogram-sync.test.ts`）在盯着共享层：改了 `src/` 却忘了同步到 `miniprogram/`，它会直接变红——这类漂移本来是**不产生任何报错**的，两边测试各自都绿，只有真机上才会显形。详见 `DECISIONS.md` 4.34。

开发与验证：

```bash
npx tsc --noEmit -p miniprogram/tsconfig.json   # 小程序单独类型检查
npx vitest run miniprogram/tests                 # 小程序壳层 76 例
```

---

## 已实现游戏

**共 44 款**，与规格逐条对应（随机迷宫为第 9 批新增）。

| 批次 | 游戏 |
|---|---|
| 第 1 批（验证架构） | 四子棋、比大小、记忆卡牌、数字华容道、猜颜色 |
| 第 2 批（牌类） | 二十一点、接龙 gops、大富豪 daifugo、翻牌接龙 last-card、连环新接龙 gops-chain、花牌配对、快艇骰子 |
| 第 3 批（棋盘） | 五子棋、国际跳棋、画点成框、狐犬棋 rabbits-and-hounds、中国跳棋、黑白棋、英国十字戏 cross-xi |
| 第 4 批（益智） | 六连珠 link-six、章鱼烧 takoyaki、滑块解锁 rush-hour、麻将对对消 mahjong-match |
| 第 5 批（迷你） | 坦克对决 tank-duel、轨道车 rail-cart、弹戏 pachinko、猪尾巴 pig-tail |
| 第 6 批（休闲动作） | 钓鱼 fishing、射靶 target-shooting、玩具足球 toy-football、玩具棒球 toy-baseball、玩具网球 toy-tennis、玩具拳击 toy-boxing、玩具冰壶 toy-curling、高尔夫球 golf |
| 第 7 批（共享渲染重活） | 台球简化版 pool-lite、保龄球简化版 bowling-lite |
| 第 8 批（博彩类 + 全站金币） | 梭哈 stud-poker、轮盘 roulette、三轴老虎机 slot-machine、扫雷赌局 mines、百家乐 baccarat |
| 第 9 批（程序生成） | 随机迷宫 maze |

每款一个目录 `src/games/<id>/`，固定 4 个文件（`meta.ts` / `rules.ts` / `index.ts` / `rules.test.ts`），新增游戏不改站点壳任何代码（注册表用 `import.meta.glob` 自动发现）。

> **加游戏必须同步改两处写死的数量**：`src/smoke.test.ts` 的 `GAME_COUNT`，以及 `src/coins-integration.test.ts` 的 `expect(ALL.length).toBe(N)`。
> 漏改的话 `tsc` 与 `build` 照样通过，只有测试会红——这正是把数量提成具名常量的原因（见 `DECISIONS.md` 4.31）。

**验收现状**：

- `npm test` → **53 个测试文件 / 1898 个用例全绿**（44 份游戏单测 1572 + 全站冒烟 136 + 金币单测 26 + 金币集成 57 + 小程序 85 + 共享层存档 17 + 存储适配器 5）
- `npx tsc --noEmit` → **零错误**
- `npm run build` → 成功；**站点壳主块 24.53 KB gzip**（51.03 kB raw；44 份玩法介绍文案进了首屏包，涨了 6.4 KB），游戏块按需加载约 4~6 KB gzip
- `rules.ts` 全局无 `Math.random` / `Date` / `performance`（仅注释中出现说明性文字）；5 款新游戏的 `rules.ts` 只 import `core/` 下的模块
- 全站冒烟（`src/smoke.test.ts`）：44 款的 `render` / `effects` / `controls` 接线在整局每一步都不抛错，通用驱动能推完 **29/44** 款；**另有跨游戏契约测试：回合制游戏的 `aiAction` 不得连走两步**（见 `DECISIONS.md` 4.22）
- 玩法介绍（`howto`）：44 款全部写了 3~6 条，条数、长度、句号结尾、不含实现细节、不与 `summary` 重抄，由冒烟测试当契约盯着
- 金币集成（`src/coins-integration.test.ts`）：**44 款真实游戏的 `coins()` 全部灌进 `settle()` 的安全网**——10 种 outcome × 5 档注额 × 「真实开局」和「空 state」两种输入，余额恒为整数/有限/非负、不变式成立、结算可复现；10 款自定义 `coins()` 的净盈亏都随注额同比缩放
- 真机渲染抽查（`vite preview` + 内置浏览器，746×1169、497×779、375×667 三种视口）：首页、梭哈、扫雷赌局、三轴老虎机、轮盘均正常渲染，**并因此挖出并修掉老虎机赔付表的叠字缺陷**（见 `DECISIONS.md` 4.20）；本轮重写的狐犬棋渲染亦已核对（矛尖形 27 点棋盘、三犬在左列、兔居中、开局无绿区——此时犬占满最左列，兔子无处可绕，这一点本身就该是对的）；**随机迷宫**亦已核对——9×9 墙线清晰、左上起点圆点、右下终点靶环、`步数 0 / 45 · 最短 30 步` 三处读数无叠字，控制台零报错
- 狐犬棋（`rabbits-and-hounds`）已按公开资料**重写为经典 Hare & Hounds**：1 兔 vs 3 犬、只走到相邻一格、猎犬不能后退、兔子绕到犬阵**左后方**才算赢；此后按用户要求进一步**取消斜向（只走横竖）并支持开局选边**（执三犬「较难」/ 执一兔「较易」，见 `DECISIONS.md` 4.28）。53 条用例覆盖棋盘拓扑、正交走法、开局选边、胜负判定、僵局裁决、`reduce` 纯度与 AI 契约
- 上一版 README 里那句「自对弈里深度 6 的猎犬 4/4 局不输」**已更正**：那 4 局全是 120 手平局，`winner !== 'hare'` 在「双方都没赢」时也会通过。真正的问题是 `sideStreak` 被兔子每一步清零，**猎犬连续横移十次判负这条分支从来没被执行过**（150 局 0 胜）；修好后同条件 10/16 胜。见 `DECISIONS.md` 4.27
- 顺带修掉 `evaluate()` 里方向反了的一项：它给「犬阵越靠右」加分，而猎犬恰恰要向右推进，等于叫搜索器别前进。改记「兔子往左的空出口」（`DECISIONS.md` 4.29）
- **随机迷宫（`maze`）**：每关现生成一张完美迷宫，递归回溯 DFS 保证全图连通、无环、任意两点恰好一条路，48 条用例把生成树性质逐条穷举钉死（`DECISIONS.md` 4.31）
- **微信小程序版（`miniprogram/`）**：`npx tsc --noEmit -p miniprogram/tsconfig.json` → 零错误；小程序相关测试 **85 例全绿**（覆盖注册表、缩放坐标反算、**44 款游戏全部跑通**、结算链路、音效降级、`performance` 垫片的单调性、横竖屏策略 8 例、Canvas API 守卫、共享层漂移检查 9 例）；`npx vitest run` 两套壳层测试同时绿。`npm run build` 产物 51.03 kB raw / 24.53 kB gzip（较上轮 +0.03 kB，来自新增的 `core/storage.ts`），小程序不影响网页版
- **共享层漂移检查（`src/miniprogram-sync.test.ts`）**：9 例，验共享层逐字节相同、无孤儿文件、移植清单与注册表一致、相对 import 可解析**且不越层**、游戏逻辑与渲染层无浏览器 API。`npm run sync:mini` 复制并生成注册表，`npm run check:mini` 校验
- **越层依赖已清零**：44 款里唯一一处越层（`mahjong-match` → `shell/storage`）已还清——存档逻辑搬进 `core/storage.ts`，壳层只剩后端适配器。越层检查因此从「白名单（允许 1 条）」升级成「**禁止（一条都不许有）**」，并用两条独立实现（按解析路径 / 按源码字样）互为兜底。见 `DECISIONS.md` 4.37
- **存档分层（`src/core/storage.ts`）**：网页版与小程序版原先各有一份手写 `shell/storage.ts`，靠人工保持 API 一致；现在逻辑共享、后端由壳层注入。附带把「隐私模式 / 配额满时不让存档整个丢掉」的内存兜底从**只有网页版有**变成**两端都有**。`core/` 不碰 `Date`（时间戳由壳层传进来），有一条用例直接扫源码盯着这条纪律
- **小程序版补上了规格第 5 条「横竖屏策略」**：44 款里 10 款是横屏，第一版试点把 `pageOrientation` 写死 portrait，玩具网球在真机上是坏的；现已按规格补上提示层（不硬转 canvas）、转屏重测量与 8 例朝向测试（`DECISIONS.md` 4.35）
- **小程序版暂不单独开仓库**：共享层零差异，目录隔离已经拿到代码隔离的绝大部分收益；剩下的发布节奏差异用按路径触发的 CI 就能解决，不必用仓库边界。分析见 `DECISIONS.md` 4.33

**交互链路的验证状态（务必按这一类读，别当成「都点过了」）**：

- **已由测试覆盖**：`smoke.test.ts` 的通用驱动用真实视口坐标调 `g.input(s, {kind, x, y, pressed})` 把整局推完，狐犬棋与随机迷宫都在能推完的 **29/44** 名单里——狐犬棋的 `hitCell` / `canStep` / `select` / `step`、迷宫的 `cellAtPoint` / `tapAction` / `swipeAction` 这两条坐标映射链路是被真实走过的。
- **本轮未验**：新增的开局选边卡片画在 canvas 内，而本环境的内置 Browser 点不穿 canvas 的 `pointer*` 绑定（DOM 按钮走 `click` 可以），叠加 FilePanel 标签页 rAF 停摆——**画布内的点击无法人工验证**，排查过程记在 `DECISIONS.md` 4.26。渲染侧已核对：首屏显示两张选边卡、玩法面板 6 条新文案正确渲染、`.hint` 读到「开局先选一边：三只…」。选边之后的整局推进由 53 条用例 + 全站冒烟覆盖。上一版 README 里「交互链路已在真机上点通」那句按这个口径是不准确的，已撤回。

**已知未验证项**：

- **44 款没有逐款做人工视觉走查**，只抽查了首页与 5 款新游戏，以及本轮做的三款（网球 / 狐犬棋 / 随机迷宫）。
- **小程序版尚未在真机或模拟器上跑过**：类型检查与 85 例小程序相关测试都过了，但微信开发者工具 CLI 需要先手动开启服务端口，预览与真机验证还没执行（见上方「微信小程序版」的验证状态）。
- **画布内的指针交互在本环境无法人工验证**（见上）。这不是应用缺陷，但意味着触摸手感的回归只能靠真机手测发现。
- 竖屏游戏在**横屏视口**下会弹出「请旋转设备」遮罩并吃掉所有点击，这是设计如此；但在桌面窄窗口里也适用，真机上若觉得烦，优先查 `runtime.ts` 的 `resize()` 门禁条件。

实现过程中踩过的坑——真 bug（坦克对决 47% 对局死循环、章鱼烧渲染崩溃、网球 AI 钉死中线、网球 97.7% 失分其实是超时判负、狐犬棋 AI 接管双方、狐犬棋逃脱方向写反两次、狐犬棋僵局计数被清零导致猎犬永远赢不了）、假 bug（冒烟测试自己有 5 个坑）、以及「先量分布再改代码」「规格是权威，测试不是」「能读 DOM 就别读像素」「一个测不到的断言不是保险」这几条归因方法——都记在 `DECISIONS.md` 第四节；不实现的 7 类游戏及原因见第一节。