import type { Page, Locator } from "@playwright/test";
import type { UseFn } from "../types";

// Extract AriaRole from Playwright's types
type GetByRoleOptions = Parameters<Page["getByRole"]>[1];
export type AriaRole = Parameters<Page["getByRole"]>[0];

export interface TextMatchOptions {
  multiple?: boolean;
  exact?: boolean;
  role?: AriaRole;
}

export interface ExpectTextOptions {
  role?: AriaRole;
  exact?: boolean;
  multiple?: boolean;
}

export interface SelectOptionConfig {
  label?: string;
  text?: string | [string, { exact: boolean }];
}

export interface UIHelpers {
  // Text assertions
  /**
   * Verifies text content is visible on the page
   * @param text Text content to verify
   * @param options.exact Match text exactly (default: false)
   * @param options.multiple Allow multiple occurrences (default: false)
   */
  expectText(text: string, options?: TextMatchOptions): Promise<void>;

  /**
   * Verifies text content is not visible on the page
   * @param text Text content that should not be visible
   */
  expectNoText(text: string): Promise<void>;

  // Form interactions
  /**
   * Types text with a human-like delay between keystrokes
   * @param selector CSS selector for the input element
   * @param text Content to type
   * @param delay Milliseconds between keystrokes (default: 50)
   */
  typeWithDelay(selector: string, text: string, delay?: number): Promise<void>;

  /**
   * Clicks a button by its text content
   * @param name Text content of the button
   * @param locator Optional parent locator to scope the search
   */
  clickButton(name: string, locator?: Locator): Promise<void>;

  /**
   * Selects an option either by text content or label
   * @param config.text Text content to click, or [text, {exact}] tuple
   * @param config.label Label text for checkbox/radio inputs
   */
  selectOption(config: SelectOptionConfig): Promise<void>;

  /**
   * Selects multiple options by their labels (checkbox/radio)
   * @param labels Array of label texts to select
   */
  selectOptions(labels: string[]): Promise<void>;

  // Navigation
  /**
   * Verifies current URL matches expected path
   * @param path Expected URL path or pattern
   */
  expectPath(path: string): Promise<void>;

  /**
   * Waits for navigation to complete to a specific path
   * @param path URL path or pattern to wait for
   */
  waitForPath(path: string | RegExp): Promise<void>;

  // Loading states
  /**
   * Waits for a loading indicator to appear and disappear
   * @param text Text content of the loading indicator
   */
  waitForLoadingState(text: string): Promise<void>;
}
