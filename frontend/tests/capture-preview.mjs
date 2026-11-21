// Manual visual QA against the real local API. No intercepted responses.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

await mkdir('../docs/screenshots', { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  await page.goto('http://127.0.0.1:5173/');
  await page.getByText('Live connection checks', { exact: false }).waitFor();
  await page.screenshot({
    path: '../docs/screenshots/foundation-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '../docs/screenshots/foundation-mobile.png',
    fullPage: true,
  });
} finally {
  await browser.close();
}
