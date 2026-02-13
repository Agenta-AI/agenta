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

// Size classes (empty - text size inherits from parent context)
sizeClasses.small  // ""
sizeClasses.default // ""

// Flex layouts
flexLayouts.rowCenter  // "flex items-center"
flexLayouts.column     // "flex flex-col"

// Semantic colors (using Ant Design zinc scale)
textColors.primary    // "text-zinc-9"
textColors.secondary  // "text-zinc-7"
textColors.muted      // "text-zinc-6"

bgColors.chip         // "bg-zinc-1"

// Border colors
borderColors.default   // "border-zinc-4"
borderColors.secondary // "border-zinc-2"

// Justify classes for flex layouts
justifyClasses.start   // "justify-start"
justifyClasses.center  // "justify-center"
justifyClasses.end     // "justify-end"
justifyClasses.between // "justify-between"

// Focus styles for accessibility
focusStyles.ring        // "outline-none focus:ring-2 focus:ring-zinc-5"
focusStyles.ringOffset  // "outline-none focus:ring-2 focus:ring-zinc-5 focus:ring-offset-2"
focusStyles.ringVisible // "outline-none focus-visible:ring-2 focus-visible:ring-zinc-5"

// Layout sizes (pixel values for panel widths)
layoutSizes.sidebarNarrow // 280
layoutSizes.sidebarWide   // 320

// Spacing classes for consistent padding
spacingClasses.panel   // "p-4" (16px)
spacingClasses.compact // "p-3" (12px)
spacingClasses.large   // "p-6" (24px)

// Text size classes for consistent typography
textSizes.xs   // "text-xs" (12px)
textSizes.sm   // "text-sm" (14px)
textSizes.base // "text-base" (16px)
textSizes.lg   // "text-lg" (18px)

// Gap classes for flex/grid layouts
gapClasses.none // "gap-0" (0px)
gapClasses.xs   // "gap-1" (4px)
gapClasses.sm   // "gap-2" (8px)
gapClasses.md   // "gap-3" (12px)
gapClasses.lg   // "gap-4" (16px)
gapClasses.xl   // "gap-6" (24px)
```

#### Border Direction Pattern

When applying borders to specific sides (top, right, bottom, left), combine Tailwind's
border direction classes with the token color utilities:

```typescript
// ✅ Correct - combine direction with token color
<div className={`border-t ${borderColors.secondary} p-4`}>
<div className={`border-r ${borderColors.default}`}>

// ❌ Avoid - hardcoded colors
<div className="border-t border-zinc-200">
```

This pattern ensures consistent theming while allowing flexible border placement.

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

```text
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
