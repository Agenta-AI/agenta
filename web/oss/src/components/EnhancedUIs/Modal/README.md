## EnhancedModal

A Modal wrapper that delays mounting until opened and tweaks layout defaults for better UX on smaller screens.

## Props

- Inherits all Ant Design `ModalProps`
- Children are rendered only after `open` becomes true

## Features

- **Mount on open**: Nothing is injected into the DOM until the modal is visible, avoiding Ant Design's eager portal rendering.
- **Dynamic content friendly**: Pair with `next/dynamic` to lazy-load heavy modal content only when needed.
- **Auto-contained height**: Caps height at `95dvh` with internal scrolling so the window itself does not scroll.
- **Cleanup on hide**: Uses `destroyOnHidden` and resets render state after `afterClose`.

## Usage

Load heavy modal bodies with `next/dynamic` (`ssr: false`) so they only mount after `open` is true.

```tsx
import dynamic from "next/dynamic"
import EnhancedModal from "@/components/EnhancedUIs/Modal"

const LazyContent = dynamic(() => import("./ModalContent"), {ssr: false})

export const Example = ({open, onClose}: {open: boolean; onClose: () => void}) => (
    <EnhancedModal open={open} onCancel={onClose} afterClose={onClose} title="Lazy modal">
        <LazyContent />
    </EnhancedModal>
)
```
