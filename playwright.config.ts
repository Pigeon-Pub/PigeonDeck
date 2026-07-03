import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // 单 worker：扩展测试需要持久化上下文，不能并行
  workers: 1,
  // headed 扩展测试对机器负载敏感（尤其 move 句柄拖拽 / 粒度连点，见 move.spec
  // 注释）；给 1 次重试吸收冷启动/负载下的偶发 flake，保证门禁确定性绿。
  retries: 1,
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  use: {
    trace: 'on-first-retry',
  },
});
