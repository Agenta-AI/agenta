# Utilities

Generic utilities shared across the UI package.

## Available Utilities

### copyToClipboard

Copy text to the clipboard using the Clipboard API.

```typescript
import {copyToClipboard} from "@agenta/ui"

// Returns true on success, false on failure
const success = await copyToClipboard("Hello, World!")

if (success) {
    // Show success toast
} else {
    // Handle error
}
```

**Note:** Toast notifications should be handled by the calling code.
The utility only handles the clipboard operation itself.

### Styling Utilities (styles.ts)

`cn` and the shared layout sizes. Write theme-variable classes as literals
(`text-muted-foreground`, `border-border-muted`, `bg-accent`); see `web/DESIGN.md`.

```typescript
import {cn, layoutSizes, scrollBehavior} from "@agenta/ui/styles"

// Class name combiner (clsx + tailwind-merge): a later conflicting class wins
cn("px-4 text-muted-foreground", isActive && "text-foreground", className)

// Layout sizes (pixel values for panel widths)
layoutSizes.sidebarNarrow // 280
layoutSizes.sidebarWide // 320

// "smooth", or "auto" under reduced motion
element.scrollIntoView({behavior: scrollBehavior()})
```

### AppMessageContext

Static exports for Ant Design message/modal/notification that work outside React components.

```tsx
import {AppMessageContext, message, modal, notification} from "@agenta/ui"

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
message.success("Saved successfully")
modal.confirm({title: "Are you sure?"})
notification.info({message: "Update available"})
```

## File Structure

```text
utils/
├── copyToClipboard.ts    # Clipboard utility
├── styles.ts             # cn and layout sizes
├── appMessageContext.tsx # Ant Design message/modal/notification
└── README.md             # This file
```

## Adding New Utilities

When adding new utilities:

1. Create a new file in this folder
2. Export from the file itself
3. Add the export to `src/index.ts` (or a subpath barrel)
4. Keep utilities generic - avoid UI framework dependencies where possible
