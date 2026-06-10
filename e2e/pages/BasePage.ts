import type { Page } from '@playwright/test';

export class BasePage {
  constructor(
    protected readonly page: Page,
    readonly url: string = '/',
  ) {}

  async goto(): Promise<void> {
    await this.page.goto(this.url);
    await this.page.waitForLoadState('domcontentloaded');
  }
}
