# SharedEditor

A flexible editor wrapper with debounce support and styling options. Built on top of the Editor component.

## Overview

SharedEditor provides:

- Debounced input handling to prevent excessive updates
- Flexible container styling (bordered, borderless, textarea-like)
- Support for both rich text and code editing modes
- Integration with the underlying Editor component

## Quick Start

```tsx
import { SharedEditor } from '@agenta/ui'

function MyEditor() {
  const [value, setValue] = useState('Hello World')

  return (
    <SharedEditor
      initialValue={value}
      handleChange={setValue}
      placeholder="Enter text..."
    />
  )
}
```

## API Reference

### SharedEditor

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `id` | `string` | auto-generated | Unique editor ID |
| `initialValue` | `string` | `""` | Initial content |
| `handleChange` | `(value: string) => void` | - | Change callback (debounced) |
| `placeholder` | `string` | - | Placeholder text |
| `state` | `"filled" \| "default"` | `"default"` | Visual state |
| `disabled` | `boolean` | `false` | Disable editing |
| `debounceDelay` | `number` | `300` | Debounce delay in ms |
| `containerVariant` | `"bordered" \| "borderless" \| "textarea"` | `"bordered"` | Container style |
| `editorProps` | `Partial<EditorProps>` | - | Props passed to Editor |

### Container Variants

- **bordered**: Default bordered container
- **borderless**: No border, minimal styling
- **textarea**: Styled like a native textarea

## Hooks

### useDebounceInput

Re-exported from `@agenta/shared`. Handles debounced input state.

```tsx
import { useDebounceInput } from '@agenta/ui'

const [localValue, setLocalValue] = useDebounceInput(
  value,           // External value
  onChange,        // Change callback
  300,             // Debounce delay (ms)
  ''               // Default value
)
```

## File Structure

```
SharedEditor/
├── SharedEditor.tsx    # Main component
├── types.ts            # Type definitions
├── index.ts            # Exports
└── README.md           # This file
```

## Integration with Editor

SharedEditor wraps the Editor component and adds:

1. **Debounce handling** via `useDebounceInput`
2. **Container styling** via `containerVariant`
3. **Simplified API** for common use cases

For advanced use cases, import `Editor` directly from `@agenta/ui`.
