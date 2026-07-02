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
    trace: 'on-first-retry',
  },
});
