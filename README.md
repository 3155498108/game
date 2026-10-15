# 小游戏合集

一个**纯静态**的网页小游戏合集站点：首页列出所有游戏，点进任意游戏游玩，玩完返回首页继续选。
同一套代码同时适配手机浏览器和桌面浏览器。

- 技术栈：Vite + TypeScript（`strict: true`）+ Canvas 2D + 原生 DOM/CSS，测试用 Vitest
- **零运行时依赖**：不引入游戏引擎、状态库、物理引擎、UI 组件库、后端框架
- 站点壳 gzip 后约 5.8 KB，单个游戏按需加载约 9.4 KB gzip
- 纯静态部署，`dist/` 直接丢到任意静态托管即可，无后端

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
│  ├─ home.ts     #   首页游戏列表、分类、搜索、每日挑战
│  ├─ play.ts     #   游戏页外壳
│  ├─ runtime.ts  #   游戏运行时：缩放适配、指针输入、rAF 循环
│  ├─ registry.ts #   游戏注册表（自动发现 games/*/）
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

  create(seed: number): S
  reduce(state: S, action: A): S              // 纯函数
  render(ctx: CanvasRenderingContext2D, s: S): void
  aiAction?(state: S): A | null               // 仅 AI 对局需要

  // ---- 可选增强 ----
  input?(state: S, p: PointerInput): A | null  // 指针 → action（纯函数）
  key?(state: S, key: string): A | null        // 键盘（桌面便利）
  tick?(dt: number): A                         // 实时游戏每帧推进
  hint?(state: S): string                      // 提示区文字
  controls?(state: S): Control<A>[]            // 提示区按钮（天然满足 44px 触控）
  outcome?(state: S): Outcome | null           // 结算成绩
  effects?(prev: S, next: S): Effect[]         // 音效 / 粒子 / 震屏
  aiDelay?: number                             // AI 思考延迟 ms，默认 500；0 = 每帧同步
}
```

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
   > （`aiAction` → `controls()` → 画布点击探针 → `tick(16)`）把 38 款各推一遍。
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

**共 38 款**，与规格逐条对应。

| 批次 | 游戏 |
|---|---|
| 第 1 批（验证架构） | 四子棋、比大小、记忆卡牌、数字华容道、猜颜色 |
| 第 2 批（牌类） | 二十一点、接龙 gops、大富豪 daifugo、翻牌接龙 last-card、连环新接龙 gops-chain、花牌配对、快艇骰子 |
| 第 3 批（棋盘） | 五子棋、国际跳棋、画点成框、兔猎犬、中国跳棋、黑白棋、英国十字戏 cross-xi |
| 第 4 批（益智） | 六连珠 link-six、章鱼烧 takoyaki、滑块解锁 rush-hour、麻将对对消 mahjong-match |
| 第 5 批（迷你） | 坦克对决 tank-duel、轨道车 rail-cart、弹戏 pachinko、猪尾巴 pig-tail |
| 第 6 批（休闲动作） | 钓鱼 fishing、射靶 target-shooting、玩具足球 toy-football、玩具棒球 toy-baseball、玩具网球 toy-tennis、玩具拳击 toy-boxing、玩具冰壶 toy-curling、高尔夫球 golf |
| 第 7 批（共享渲染重活） | 台球简化版 pool-lite、保龄球简化版 bowling-lite |

每款一个目录 `src/games/<id>/`，固定 4 个文件（`meta.ts` / `rules.ts` / `index.ts` / `rules.test.ts`），新增游戏不改站点壳任何代码（注册表用 `import.meta.glob` 自动发现）。

**验收现状**（全部实测通过）：

- `npm test` → **39 个测试文件 / 1421 个用例全绿**（38 份游戏单测 + 1 份全站冒烟）
- `npx tsc --noEmit` → **零错误**
- `npm run build` → 成功；**站点壳主块 15.6 KB gzip**（上限 50 KB），41 个游戏块各 3.5~6 KB gzip 按需加载
- **38 款在 375×667 与 1440×900 两个视口下均无横向溢出**，顶栏/操作区跟随画面宽度居中
- `rules.ts` 全局无 `Math.random` / `Date` / `performance`（仅注释中出现说明性文字）
- 全站冒烟（`src/smoke.test.ts`）：38 款的 `render` / `effects` / `controls` 接线在整局每一步都不抛错，通用驱动能推完 25/38 款

实现过程中踩过的坑——真 bug（坦克对决 47% 对局死循环、章鱼烧渲染崩溃）、假 bug（冒烟测试自己有 5 个坑）、以及「测试写错 vs 代码写错」的归因方法——都记在 `DECISIONS.md` 第四节；不实现的 7 类游戏及原因见第一节。