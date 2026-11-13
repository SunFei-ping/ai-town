import { defineConfig, devices } from '@playwright/test';

const remote = process.env.E2E_REMOTE === '1';
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4183';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 20000,
  fullyParallel: false,
  // 3D 场景与 Canvas 出图对 GPU/CPU 敏感，串行执行避免相互拖慢导致超时
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    headless: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // E2E_REMOTE=1 时不启动本地桩服务，直接打远端真实环境
  webServer: remote
    ? undefined
    : {
        command: 'node scripts/dev-server.mjs',
        url: 'http://127.0.0.1:4183/',
        reuseExistingServer: true,
        timeout: 20000,
        env: { ...process.env, PORT: '4183', MODEL_MODE: 'stub' },
      },
});
