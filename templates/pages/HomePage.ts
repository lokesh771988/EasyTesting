/**
 * Page Object: Home page (example.com).
 * Centralizes selectors and page actions — use in tests for maintainability.
 *
 * Usage in tests:
 *   import { HomePage } from '../pages/HomePage';
 *   const page = new HomePage(browser);
 *   await page.goto();
 *   await page.clickMoreInfo();
 */

import type { BrowserApi } from 'cstesting';

export class HomePage {
  constructor(private browser: BrowserApi) {}

  /** Page URL */
  get url(): string {
    return 'https://example.com';
  }

  /** Navigate to the home page */
  async goto(): Promise<void> {
    await this.browser.goto(this.url);
    await this.browser.waitForLoad();
  }

  /** Get the main heading text (Example Domain) */
  async getHeadingText(): Promise<string> {
    const text = await this.browser.evaluate(
      "document.querySelector('h1') ? document.querySelector('h1').textContent : ''"
    );
    return text as string;
  }

  /** Click the "More information..." link */
  async clickMoreInfo(): Promise<void> {
    const link = this.browser.locator('a');
    await link.click();
    await this.browser.waitForLoad();
  }

  /** Get page title via evaluate */
  async getTitle(): Promise<string> {
    return this.browser.evaluate('document.title') as Promise<string>;
  }
}
