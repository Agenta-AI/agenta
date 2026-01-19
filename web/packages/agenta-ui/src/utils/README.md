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

### Styling Utilities (styles.ts)

CSS class utilities and constants using Ant Design theme tokens.

```typescript
import { cn, sizeClasses, flexLayouts, textColors, bgColors } from '@agenta/ui'

// Class name concatenation (like clsx)
cn("base", isActive && "active", {"disabled": false})
// => "base active"

// Size classes
sizeClasses.small  // "text-xs"
sizeClasses.default // "text-sm"

// Flex layouts
flexLayouts.rowCenter  // "flex flex-row items-center"
flexLayouts.column     // "flex flex-col"

// Semantic colors (using Ant Design zinc scale)
textColors.primary    // "text-zinc-9"
textColors.secondary  // "text-zinc-7"
textColors.muted      // "text-zinc-6"

bgColors.chip         // "bg-zinc-1"
```

### AppMessageContext

Static exports for Ant Design message/modal/notification that work outside React components.

```tsx
import { AppMessageContext, message, modal, notification } from '@agenta/ui'

// 1. Render the context inside your Ant Design App provider
function MyApp() {
  return (
    <App>
      <AppMessageContext />
      {children}
    </App>
  )
}

// 2. Use the static exports anywhere
message.success('Saved successfully')
modal.confirm({ title: 'Are you sure?' })
notification.info({ message: 'Update available' })
```

## File Structure

```
utils/
├── copyToClipboard.ts    # Clipboard utility
├── styles.ts             # Styling utilities (cn, colors, layouts)
├── appMessageContext.tsx # Ant Design message/modal/notification
└── README.md             # This file
```

## Adding New Utilities

When adding new utilities:

1. Create a new file in this folder
2. Export from the file itself
3. Add the export to `@agenta/ui/src/index.ts`
4. Keep utilities generic - avoid UI framework dependencies where possible
