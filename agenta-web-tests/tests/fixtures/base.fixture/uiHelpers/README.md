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

### Navigation & Loading

```typescript
expectPath(path: string): Promise<void>
waitForPath(path: string | RegExp): Promise<void>
waitForLoadingState(text: string): Promise<void>

// Examples
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
