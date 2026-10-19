/**
 * Vite 的 `import.meta.glob` 的最小类型声明。
 *
 * 只有**测试**用它——漂移检查（`src/miniprogram-sync.test.ts`）与 Canvas API 守卫
 * 需要把源码当文本读出来做断言。
 *
 * 小程序运行时代码**不用**它：那边靠 `scripts/sync-miniprogram.mjs` 复制文件，
 * 不靠 import。所以这份声明只服务于测试，而测试跑在 Vitest 里，
 * 走的正是 Vite 的转换管线——这个 API 在那里是真的存在的。
 *
 * 为什么不在 `miniprogram/tsconfig.json` 里加 `"types": ["vite/client"]`：
 * 那是给整个小程序工程引入一整套 Vite 类型，而实际上只有测试需要它们。
 * 这里只声明用到的那一个成员，依赖面保持在最小。
 */
interface ImportMeta {
  glob(
    pattern: string,
    options?: { query?: string; import?: string; eager?: boolean },
  ): Record<string, unknown>
}
