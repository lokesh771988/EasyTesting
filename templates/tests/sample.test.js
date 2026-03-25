/**
 * Simple test (no Page Object Model).
 * Run: npx cstesting tests/
 */

const cstesting = require('cstesting');
const { describe, it, expect, beforeAll, afterAll } = cstesting;

describe('Sample', () => {
  let browser;

  beforeAll(async () => {
    browser = await cstesting.createBrowser({ headless: true });
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
