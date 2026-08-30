/** True while an antd modal, or any open Radix layer, owns the screen.
 *
 * Radix gives a dialog, a dropdown menu, a context menu, a popover and a select the SAME
 * dismissable layer, so all of them swallow a click but let a keystroke keep propagating. A guard
 * that watched only `role="dialog"` therefore missed the menus: with the top bar's settings menu
 * open, Cmd+Enter still reached the approval card behind it. There is no global open-layer state
 * to ask, so the DOM is the only witness.
 *
 * Server-side there is no document, so this returns false. Callers are keydown handlers today, but
 * this is the obvious helper to reach for during render, and there it must not throw. */
export const isOverlayOpen = (): boolean =>
    typeof document !== "undefined" &&
    Boolean(
        document.querySelector(
            '.ant-modal-wrap:not([style*="display: none"]), [data-state="open"]:is([role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"])',
        ),
    )
