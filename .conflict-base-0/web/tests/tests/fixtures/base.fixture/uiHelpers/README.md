# UI Helpers

Type-safe UI interaction helpers with built-in waiting and error handling.

## Usage

```typescript
test('example', async ({ uiHelpers }) => {
  const { expectText, clickButton, typeWithDelay } = uiHelpers;
  
  await expectText('Welcome');
  await typeWithDelay('#email', 'user@example.com');
  await clickButton('Submit');
});
```

## Available Helpers

### Text Assertions

```typescript
expectText(text: string, options?: ExpectTextOptions): Promise<void>
// Options: { exact?: boolean, multiple?: boolean }

expectNoText(text: string): Promise<void>

// Examples
await uiHelpers.expectText('Welcome')
await uiHelpers.expectText('Results', { multiple: true })
await uiHelpers.expectNoText('Error')
```

### Form Interactions

```typescript
typeWithDelay(selector: string, text: string, delay?: number): Promise<void>
clickButton(name: string, locator?: Locator): Promise<void>
selectOption(config: SelectOptionConfig): Promise<void>
// SelectOptionConfig: { label?: string, text?: string | [string, { exact: boolean }] }
selectOptions(labels: string[]): Promise<void>

// Examples
await uiHelpers.typeWithDelay('#email', 'user@example.com')
await uiHelpers.clickButton('Submit', dialogLocator)
await uiHelpers.selectOption({ text: 'Option 1' })
await uiHelpers.selectOption({ text: ['Exact Match', { exact: true }] })
await uiHelpers.selectOption({ label: 'Remember me' })
```

### Table Row Actions

```typescript
// Click a table row that contains the specified text
clickTableRow(rowText: string | RegExp): Promise<void>

// Select a checkbox or radio button in a table row
selectTableRowInput({
  rowText?: string | RegExp,
  inputType: 'checkbox' | 'radio',
  checked: boolean
}): Promise<void>

// Click a button inside a specific table row by row text and button name
clickTableRowButton({ 
  rowText: string | RegExp, 
  buttonName: string | RegExp 
}): Promise<void>

// Click an icon (e.g., edit/delete) inside a specific table row by row text and icon name
// Falls back to clicking the first SVG in the row if no aria-label/title is present (for AntD icons)
clickTableRowIcon({ 
  rowText: string, 
  icon: string 
}): Promise<void>

// Examples
await uiHelpers.clickTableRow('My Row')
await uiHelpers.selectTableRowInput({ inputType: 'checkbox', checked: true })
await uiHelpers.clickTableRowButton({ rowText: 'My Row', buttonName: 'Delete' })
await uiHelpers.clickTableRowIcon({ rowText: 'My Row', icon: 'edit' })
```

### Modal Interactions

```typescript
// Confirm a modal dialog by clicking a button (default: 'Confirm', customizable)
// Automatically waits for the modal to be visible before clicking the confirm button
confirmModal(buttonText?: string | RegExp): Promise<void>

// Example
await uiHelpers.confirmModal('Delete')
```

### Canonical API-driven UI Flow Pattern

> **Best Practice:** For all API-driven UI flows (e.g., create, edit, delete), always initiate waitForApiResponse BEFORE the UI action, then trigger the action, then await and assert on the backend response. See UTILITIES_AND_FIXTURES_GUIDE.md for canonical examples.


### Navigation & Loading

```typescript
// Type text with a delay between keystrokes (useful for fields with autocomplete)
typeWithDelay(selector: string, text: string, delay?: number): Promise<void>

// Wait for the URL path to match the given path
expectPath(path: string): Promise<void>
waitForPath(path: string): Promise<void>

// Wait for a loading state with specific text
waitForLoadingState(text: string): Promise<void>

// Examples
await uiHelpers.typeWithDelay('#search', 'query', 50)
await uiHelpers.waitForPath('/dashboard')
await uiHelpers.expectPath('/profile')
await uiHelpers.waitForLoadingState('Loading...')
```

## Key Features

1. **Namespaced Helpers**
   - All UI helpers are grouped under `uiHelpers` namespace
   - Prevents naming conflicts with other fixtures
   - Clear separation of concerns

2. **Type Safety**
   - Full TypeScript support
   - Auto-completion for options
   - Runtime type checking

3. **Built-in Reliability**
   - Automatic waiting for elements
   - Smart retries
   - Clear error messages
   - Consistent timeout handling

## Implementation Notes

- Built on top of Playwright's built-in assertions
- Uses role-based selectors when possible
- Supports both exact and fuzzy text matching
- Handles dynamic content loading
