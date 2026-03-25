/**
 * Simple test (no Page Object Model).
 * Run: npx cstesting tests/
 */

import { describe, it, expect, beforeAll, afterAll, createBrowser } from 'cstesting';

describe('Sample', () => {
  let browser: Awaited<ReturnType<typeof createBrowser>>;

  beforeAll(async () => {
    browser = await createBrowser({ headless: true });
  });

  afterAll(async () => {
    if (browser) await browser.close();
  });

  it('should load example.com and get title', async () => {
    await browser.goto('https://example.com');
    await browser.waitForLoad();
    const title = await browser.evaluate('document.title');
    expect(title).toContain('Example');
  });
});
