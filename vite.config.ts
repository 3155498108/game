import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    modulePreload: { polyfill: false },
    reportCompressedSize: true,
  },
  test: {
    environment: 'node',
    // miniprogram/tests 也在这里跑：微信小程序的壳层与网页版壳层是两套接线，
    // 网页版那份冒烟覆盖不到它。两边必须同时绿才算「移植没退步」。
    include: ['src/**/*.test.ts', 'miniprogram/tests/**/*.test.ts'],
  },
})
