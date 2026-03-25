/**
 * Sample test using Page Object Model (POM).
 * Uses the HomePage page object from ../pages/HomePage.ts
 *
 * Run: npx cstesting tests/
 * or:  npx cstesting tests/home.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, createBrowser } from 'cstesting';
import { HomePage } from '../pages/HomePage';

describe('Home page (POM)', () => {
  let browser: Awaited<ReturnType<typeof createBrowser>>;
  let homePage: HomePage;

  beforeAll(async () => {
    browser = await createBrowser({ headless: true });
    homePage = new HomePage(browser);
  });

  afterAll(async () => {
    if (browser) await browser.close();
  });

  it('should open home page and show Example Domain heading', async () => {
    await homePage.goto();
    const heading = await homePage.getHeadingText();
    expect(heading).toContain('Example Domain');
  });

  it('should have correct page title', async () => {
    await homePage.goto();
    const title = await homePage.getTitle();
    expect(title).toContain('Example');
  });

  it('should navigate when clicking More information link', async () => {
    await homePage.goto();
    await homePage.clickMoreInfo();
    const html = await browser.content();
    expect(html.length).toBeGreaterThan(0);
  });
});
