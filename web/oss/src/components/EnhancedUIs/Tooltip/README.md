## EnhancedTooltip

A Tooltip wrapper that adds click-to-copy behavior with built-in success feedback while preserving the child element.

## Props

- `title` (string): Tooltip title when not showing copy feedback
- `copyText` (string, optional): Text copied when the child is clicked
- `duration` (number, default: 1500): How long the "Copied" state stays visible (ms)
- `tooltipProps` (`TooltipProps`, optional): Extra props forwarded to Ant Design `Tooltip`
- `children`: The element to wrap and make copyable

## Features

- **Click to copy**: Copies `copyText` to the clipboard and shows a success state with a check icon.
- **Child-safe**: Keeps the child's props and `onClick` intact while adding copy handling and a copy cursor.
- **SSR friendly**: Uses `next/dynamic` to avoid server-side rendering issues with Ant Design tooltip portals.

## Usage

```tsx
import EnhancedTooltip from "@/components/EnhancedUIs/Tooltip"

<EnhancedTooltip title="Click to copy" copyText="api-key-123">
    <span>api-key-123</span>
</EnhancedTooltip>
```

