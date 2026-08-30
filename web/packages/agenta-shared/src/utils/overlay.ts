/** Layers that own the keyboard while they are open.
 *
 * Radix marks its own with `data-state`, and gives a dialog, a dropdown menu, a context menu and a
 * select the same dismissable layer: each swallows a click but lets a keystroke keep propagating.
 * antd sets no `data-state` at all and leaves its popups mounted after they close, so those are
 * matched by class and filtered by visibility below. A tooltip is excluded on purpose: it is
 * passive and must not suppress a shortcut. */
const LAYER_SELECTOR = [
    '[data-state="open"]:is([role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"])',
    ".ant-modal-wrap",
    ".ant-drawer-open",
    ".ant-dropdown",
    ".ant-select-dropdown",
    ".ant-popover",
].join(", ")

/** `checkVisibility` is the honest answer. jsdom does not implement it, and computed display is
 * per-element, so the fallback walks the ancestors: a card is hidden when its PANE is. */
const isVisible = (element: Element): boolean => {
    const withCheck = element as Element & {checkVisibility?: () => boolean}
    if (typeof withCheck.checkVisibility === "function") return withCheck.checkVisibility()
    for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.display === "none" || style.visibility === "hidden") return false
    }
    return true
}

/**
 * True while a modal, drawer, menu, select or popover owns the keyboard.
 *
 * There is no global open-layer state to ask, so the DOM is the only witness. Server-side there is
 * no document, so this returns false. Callers are keydown handlers today, but this is the obvious
 * helper to reach for during render, and there it must not throw.
 */
export const isOverlayOpen = (): boolean => {
    if (typeof document === "undefined") return false
    for (const element of document.querySelectorAll(LAYER_SELECTOR)) {
        if (isVisible(element)) return true
    }
    return false
}

/**
 * True while this element actually renders. A chat surface keeps every visited session mounted
 * behind `display: none`, so a window-level key handler owned by a hidden pane must ask before it
 * answers, or one keystroke resolves a decision the user cannot see.
 */
export const isOnScreen = (element: Element | null): boolean => {
    if (!element || typeof document === "undefined") return false
    return isVisible(element)
}
