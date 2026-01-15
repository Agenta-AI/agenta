# Utilities

Generic utilities shared across the UI package.

## Available Utilities

### copyToClipboard

Copy text to the clipboard using the Clipboard API.

```typescript
import { copyToClipboard } from '@agenta/ui'

// Returns true on success, false on failure
const success = await copyToClipboard('Hello, World!')

if (success) {
  // Show success toast
} else {
  // Handle error
}
```

**Note:** Toast notifications should be handled by the calling code.
The utility only handles the clipboard operation itself.

## Adding New Utilities

When adding new utilities:

1. Create a new file in this folder
2. Export from the file itself
3. Add the export to `@agenta/ui/src/index.ts`
4. Keep utilities generic - avoid UI framework dependencies
