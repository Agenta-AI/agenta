## EnhancedButton

A Button wrapper that bundles a tooltip so you do not have to compose two components.

## Props

- Inherits all Ant Design `ButtonProps`
- `label` (ReactNode): Button content (use instead of `children`)
- `tooltipProps` (`TooltipProps`): Props forwarded to the built-in tooltip

## Features

- **Tooltip included**: Automatically wraps the button with Ant Design's `Tooltip`.
- **One component**: Keeps button and tooltip props together for cleaner call sites.
- **Ref friendly**: Forwards refs to the underlying button.

## Usage

```tsx
import EnhancedButton from "@/components/EnhancedUIs/Button"

<EnhancedButton
    type="primary"
    label="Save changes"
    tooltipProps={{title: "Saves the current form"}}
    onClick={handleSave}
/>
```

