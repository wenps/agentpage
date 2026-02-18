/**
 * Browser controller — Playwright-based browser control.
 * Provides navigate, screenshot, fill, click, snapshot, evaluate, and cookie management.
 */
import type { Browser, BrowserContext, Page } from "playwright-core";

export type BrowserControllerOptions = {
  headless?: boolean;
  executablePath?: string;
};

let runningInstance: BrowserController | undefined;

export class BrowserController {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private options: BrowserControllerOptions;

  constructor(options: BrowserControllerOptions = {}) {
    this.options = options;
  }

  /** Get the currently running browser controller (if any). */
  static getRunning(): BrowserController | undefined {
    return runningInstance;
  }

  /** Launch the browser. */
  async launch(): Promise<void> {
    const { chromium } = await import("playwright-core");

    this.browser = await chromium.launch({
      headless: this.options.headless ?? false,
      executablePath: this.options.executablePath,
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
    });

    this.page = await this.context.newPage();
    runningInstance = this;
  }

  /** Navigate to a URL. */
  async navigate(url: string): Promise<void> {
    this.ensurePage();
    await this.page!.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  /** Take a screenshot of the current page. */
  async screenshot(outputPath: string): Promise<string> {
    this.ensurePage();
    await this.page!.screenshot({ path: outputPath, fullPage: false });
    return outputPath;
  }

  /** Fill a form input by CSS selector. */
  async fill(selector: string, value: string): Promise<void> {
    this.ensurePage();
    await this.page!.fill(selector, value);
  }

  /** Click an element by CSS selector. */
  async click(selector: string): Promise<void> {
    this.ensurePage();
    await this.page!.click(selector);
  }

  /** Get accessibility snapshot of the current page. */
  async snapshot(format: "aria" | "text" = "text"): Promise<string> {
    this.ensurePage();
    // Use modern Playwright ariaSnapshot API instead of deprecated page.accessibility.snapshot()
    const ariaYaml = await this.page!.locator(":root").ariaSnapshot();
    if (!ariaYaml) return "(empty page)";

    if (format === "aria") {
      return ariaYaml;
    }
    return ariaYaml;
  }

  /** Evaluate JavaScript in the page context. */
  async evaluate<T>(expression: string): Promise<T> {
    this.ensurePage();
    return await this.page!.evaluate(expression) as T;
  }

  /** Get all cookies for the current page. */
  async getCookies(): Promise<Array<{ name: string; value: string; domain: string }>> {
    this.ensurePage();
    const cookies = await this.context!.cookies();
    return cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain }));
  }

  /** Get the current page URL. */
  getUrl(): string {
    this.ensurePage();
    return this.page!.url();
  }

  /** Get page title. */
  async getTitle(): Promise<string> {
    this.ensurePage();
    return await this.page!.title();
  }

  /** Wait for a selector to appear. */
  async waitForSelector(selector: string, timeoutMs = 10_000): Promise<void> {
    this.ensurePage();
    await this.page!.waitForSelector(selector, { timeout: timeoutMs });
  }

  /** Select an option from a <select> element. */
  async selectOption(selector: string, value: string): Promise<void> {
    this.ensurePage();
    await this.page!.selectOption(selector, value);
  }

  /** Type text with key-by-key input (for inputs that don't support fill). */
  async type(selector: string, text: string, delayMs = 50): Promise<void> {
    this.ensurePage();
    await this.page!.type(selector, text, { delay: delayMs });
  }

  /** Press a keyboard key. */
  async pressKey(key: string): Promise<void> {
    this.ensurePage();
    await this.page!.keyboard.press(key);
  }

  /** Go back in history. */
  async goBack(): Promise<void> {
    this.ensurePage();
    await this.page!.goBack({ waitUntil: "domcontentloaded" });
  }

  /** Go forward in history. */
  async goForward(): Promise<void> {
    this.ensurePage();
    await this.page!.goForward({ waitUntil: "domcontentloaded" });
  }

  /** Reload the current page. */
  async reload(): Promise<void> {
    this.ensurePage();
    await this.page!.reload({ waitUntil: "domcontentloaded" });
  }

  /** Close the browser. */
  async close(): Promise<void> {
    if (runningInstance === this) runningInstance = undefined;
    await this.browser?.close().catch(() => {});
    this.browser = undefined;
    this.context = undefined;
    this.page = undefined;
  }

  /** Check if the browser is running. */
  isRunning(): boolean {
    return Boolean(this.browser?.isConnected());
  }

  private ensurePage(): void {
    if (!this.page) {
      throw new Error("Browser not launched. Call launch() first.");
    }
  }
}

/** Format an accessibility snapshot tree into indented text. */
function formatAccessibilityTree(
  node: { role?: string; name?: string; children?: unknown[] },
  depth = 0,
): string {
  const indent = "  ".repeat(depth);
  const role = node.role ?? "unknown";
  const name = node.name ? ` "${node.name}"` : "";
  let result = `${indent}[${role}]${name}\n`;

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      result += formatAccessibilityTree(child as typeof node, depth + 1);
    }
  }
  return result;
}
