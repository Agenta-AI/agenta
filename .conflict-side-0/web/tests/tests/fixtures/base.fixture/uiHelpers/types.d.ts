import {Page, Locator} from "@playwright/test"

// Extract AriaRole from Playwright's types
type GetByRoleOptions = Parameters<Page["getByRole"]>[1]
export type AriaRole = Parameters<Page["getByRole"]>[0]

export interface TextMatchOptions {
    multiple?: boolean
    exact?: boolean
    role?: AriaRole
}

export interface ExpectTextOptions {
    role?: AriaRole
    exact?: boolean
    multiple?: boolean
}

export interface SelectOptionConfig {
    label?: string
    text?: string | [string, {exact: boolean}]
}

export interface UIHelpers {
    /**
     * Clicks a tab by its visible name (role=tab)
     */
    clickTab(name: string): Promise<void>
    /**
     * Clicks a table row by its visible name (role=row)
     */
    clickTableRow(rowText: string): Promise<void>

    /**
     * Clicks a button inside a specific table row by row text and button name
     */
    clickTableRowButton(config: {rowText: string; buttonName: string}): Promise<void>

    /**
     * Clicks an icon (e.g., edit/delete) inside a specific table row by row text and icon aria-label or title
     */
    clickTableRowIcon(config: {rowText: string; icon: string}): Promise<void>

    /**
     * Confirms a modal dialog by clicking a button with the given text (case-insensitive by default).
     * @param buttonText - The button text or regex to match (defaults to /Confirm/i)
     */
    confirmModal(buttonText?: string | RegExp): Promise<void>
    // Text assertions
    /**
     * Verifies text content is visible on the page
     * @param text Text content to verify
     * @param options.exact Match text exactly (default: false)
     * @param options.multiple Allow multiple occurrences (default: false)
     */
    expectText(text: string, options?: TextMatchOptions): Promise<void>

    /**
     * Verifies text content is not visible on the page
     * @param text Text content that should not be visible
     */
    expectNoText(text: string): Promise<void>

    // Form interactions
    /**
     * Types text with a human-like delay between keystrokes
     * @param selector CSS selector for the input element
     * @param text Content to type
     * @param delay Milliseconds between keystrokes (default: 50)
     */
    typeWithDelay(selector: string, text: string, delay?: number): Promise<void>

    /**
     * Clicks a button by its text content
     * @param name Text content of the button
     * @param locator Optional parent locator to scope the search
     */
    clickButton(name: string, locator?: Locator): Promise<void>

    /**
     * Selects an option either by text content or label
     * @param config.text Text content to click, or [text, {exact}] tuple
     * @param config.label Label text for checkbox/radio inputs
     */
    selectOption(config: SelectOptionConfig): Promise<void>

    /**
     * Selects multiple options by their labels (checkbox/radio)
     * @param labels Array of label texts to select
     */
    selectOptions(labels: string[]): Promise<void>

    // Navigation
    /**
     * Verifies current URL matches expected path
     * @param path Expected URL path or pattern
     */
    expectPath(path: string): Promise<void>

    /**
     * Waits for navigation to complete to a specific path
     * @param path URL path or pattern to wait for
     */
    waitForPath(path: string | RegExp): Promise<void>

    // Loading states
    /**
     * Waits for a loading indicator to appear and disappear
     * @param text Text content of the loading indicator
     */
    waitForLoadingState(text: string): Promise<void>

    /**
     * Selects a checkbox or radio button in a table row based on row text
     * @param config.rowText The text content or regex pattern to identify the row
     * @param config.inputType The type of input to select ('checkbox' or 'radio')
     * @param config.checked Whether the input should be checked (default: true)
     */
    selectTableRowInput(config: {
        rowText?: string | RegExp
        inputType: "checkbox" | "radio"
        checked: boolean
    }): Promise<void>
}
