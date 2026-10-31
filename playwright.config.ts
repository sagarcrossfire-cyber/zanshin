import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  fullyParallel: false,
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:4173' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173', viewport: { height: 900, width: 1440 } } },
  ],
  reporter: [['list']],
  retries: 1,
  testDir: 'tests/e2e',
  timeout: 60000,
  use: { trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort --host 127.0.0.1',
    reuseExistingServer: true,
    timeout: 90000,
    url: 'http://127.0.0.1:4173/',
  },
  workers: 1,
});
