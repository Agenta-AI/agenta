## EnhancedDrawer

A Drawer wrapper that only mounts when opened and adds optional outside-click closing while keeping Ant Design's API.

## Props

- Inherits all Ant Design `DrawerProps`
- `closeOnLayoutClick` (default: true): Close when clicking on `.ant-layout` areas outside the drawer (ignores `.variant-table-row`)

## Features

- **Mount on open**: Defers rendering until `open` is true, preventing extra portals in the DOM.
- **Outside click close**: Optionally closes when the user clicks the surrounding layout (useful for full-page layouts).
- **Cleanup on hide**: Uses `destroyOnHidden` and resets render state after `afterOpenChange`.

## Usage

Load drawer content lazily with `next/dynamic` (`ssr: false`) so the drawer body only mounts when opened.

```tsx
import dynamic from "next/dynamic"
import EnhancedDrawer from "@/components/EnhancedUIs/Drawer"

const DrawerContent = dynamic(() => import("./DrawerContent"), {ssr: false})

export const Example = ({open, onClose}: {open: boolean; onClose: () => void}) => (
    <EnhancedDrawer
        title="Details"
        open={open}
        onClose={onClose}
        closeOnLayoutClick
        placement="right"
        width={520}
    >
        <DrawerContent />
    </EnhancedDrawer>
)
```
