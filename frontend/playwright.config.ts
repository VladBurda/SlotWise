import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    actionTimeout: 10000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
  webServer:
    process.env.SLOTWISE_FULL_STACK === '1'
      ? undefined
      : {
          command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1',
          url: 'http://127.0.0.1:5173',
          reuseExistingServer: !process.env.CI,
        },
});
