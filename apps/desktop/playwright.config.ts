import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:1420', viewport: { width: 1280, height: 800 } },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    // Proxy for macOS WKWebView (Tauri's webview on Mac)
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: { command: 'pnpm dev', url: 'http://localhost:1420', reuseExistingServer: true, timeout: 60_000 },
});
