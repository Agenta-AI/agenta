/** True while an antd confirm/modal or a Radix dialog owns the screen. No global open-dialog state
 * exists to ask, and these dialogs come from `modal.confirm`, so the DOM is the only witness.
 *
 * Server-side there is no document, so this returns false. Callers are keydown handlers today, but
 * this is the obvious helper to reach for during render, and there it must not throw. */
export const isOverlayOpen = (): boolean =>
    typeof document !== "undefined" &&
    Boolean(
        document.querySelector(
            '.ant-modal-wrap:not([style*="display: none"]), [role="dialog"][data-state="open"]',
        ),
    )
