/**
 * 拼 HTML 时的最小工具集。
 *
 * 单独成文件是因为「游戏文案要插进 innerHTML」这件事现在有三个消费方
 * （首页卡片、游戏页玩法介绍、运行时按钮区）。三处各抄一份转义函数的那天，
 * 就一定会有一处漏掉某个字符——这里只留一份，改一次全站生效。
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** 转义文本后插入 innerHTML：`& < > " '` 全部变成实体。 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c])
}
