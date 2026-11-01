// End-to-end run against `dist` served the way Netlify serves it (headers
// from public/_headers, rules from public/_redirects), so the Content
// Security Policy and caching headers are exercised before a deploy. Runs
// the smoke, media, PWA and site sign-in specs on the desktop project only.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  fullyParallel: false,
  projects: [
    { name: 'netlify-desktop', use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4174', viewport: { height: 900, width: 1440 } } },
  ],
  reporter: [['list']],
  retries: 1,
  testDir: 'tests/e2e',
  testMatch: ['smoke.spec.ts', 'media.spec.ts', 'pwa-resilience.spec.ts', 'today-path.spec.ts', 'site-access.spec.ts'],
  timeout: 60000,
  use: { trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/serve-dist.mjs 4174 dist',
    reuseExistingServer: true,
    timeout: 30000,
    url: 'http://127.0.0.1:4174/',
  },
  workers: 1,
});
