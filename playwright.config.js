import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 20000,
  fullyParallel: false,
  // 3D 场景与 Canvas 出图对 GPU/CPU 敏感，串行执行避免相互拖慢导致超时
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4183',
    headless: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/dev-server.mjs',
    url: 'http://127.0.0.1:4183/',
    reuseExistingServer: true,
    timeout: 20000,
    env: { ...process.env, PORT: '4183', MODEL_MODE: 'stub' },
  },
});
