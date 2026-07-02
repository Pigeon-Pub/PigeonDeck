import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // 单 worker：扩展测试需要持久化上下文，不能并行
  workers: 1,
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  use: {
    // E2E 默认不使用浏览器（由 launchExtensionBrowser 自行管理 context）
    trace: 'on-first-retry',
  },
  // 不使用全局 projects，extension 测试自己管理 context
});
