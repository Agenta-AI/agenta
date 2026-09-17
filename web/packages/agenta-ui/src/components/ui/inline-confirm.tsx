import * as React from "react"

import {Button} from "./button"
import {cn} from "./utils"

/**
 * InlineConfirm — a confirm step rendered in place, directly under the control that opened it,
 * rather than in a popover or a dialog.
 *
 * It is for a destructive action whose consequence fits in one sentence and whose context is the
 * surface it sits on: taking that sentence into a dialog hides the thing being acted on. A
 * popover would do the same on a phone, where it covers the row it describes.
 *
 * Escape cancels, and focus opens on Cancel rather than on the destructive button, so a keyboard
 * user who arrives here by pressing Enter does not confirm with a second Enter.
 *
 * The consequence has to reach a screen reader twice over, because focus lands on Cancel the
 * moment this mounts. The sentence is an `alert`, which is announced on insertion, and it also
 * describes both buttons, so whichever one focus is on reads it out. An `aria-live` region
 * mounted with its text already in it announces nothing: a live region announces CHANGES to a
 * region already in the tree, and this one arrives complete.
 *
 * Focus goes back where it came from when the confirm closes. The usual call site swaps its
 * trigger FOR this component and back, so the control that returns is a new node rather than
 * the one that had focus, which is why the slot is the fallback.
 */
export interface InlineConfirmProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onError"> {
    /** The sentence naming the consequence. Required: there is no sensible default. */
    message: React.ReactNode
    /** The destructive button's label, e.g. `Remove`. Required for the same reason. */
    confirmLabel: React.ReactNode
    cancelLabel?: React.ReactNode
    onConfirm: () => void
    onCancel: () => void
}

/** What a slot's returning control looks like, for the focus fallback below. */
const FOCUSABLE =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function InlineConfirm({
    message,
    confirmLabel,
    cancelLabel = "Cancel",
    onConfirm,
    onCancel,
    className,
    ...props
}: InlineConfirmProps) {
    const cancelRef = React.useRef<HTMLButtonElement>(null)
    const rootRef = React.useRef<HTMLDivElement>(null)
    const messageId = `${React.useId()}-message`

    React.useEffect(() => {
        // Captured here rather than read back in the cleanup: React detaches refs while it tears
        // the tree down, so the ref is empty by then.
        const root = rootRef.current
        // `body` is not an opener. The usual call site removes the trigger in the same commit
        // that mounts this, so focus has already fallen there by the time this runs, and
        // `body.focus()` would silently do nothing.
        const focused = document.activeElement
        const opener = focused && focused !== document.body ? (focused as HTMLElement) : null
        const slot = root?.parentElement ?? null
        cancelRef.current?.focus()

        return () => {
            // Only when this held focus. The cleanup runs while the tree comes down, so focus is
            // either still on a node inside it or already fallen to `body`; anything else means
            // the reader moved on themselves and must not be pulled back.
            const active = document.activeElement
            const heldFocus = !active || active === document.body || !!root?.contains(active)
            if (!heldFocus) return

            // A microtask, because the control that takes focus back does not exist yet: this
            // cleanup runs before React inserts the trigger that replaces the confirm.
            queueMicrotask(() => {
                if (opener?.isConnected) {
                    opener.focus()
                    return
                }
                if (!slot?.isConnected) return
                slot.querySelector<HTMLElement>(FOCUSABLE)?.focus()
            })
        }
    }, [])

    return (
        <div
            ref={rootRef}
            data-slot="inline-confirm"
            role="group"
            className={cn("flex flex-col gap-2", className)}
            onKeyDown={(event) => {
                if (event.key !== "Escape") return
                event.stopPropagation()
                onCancel()
            }}
            {...props}
        >
            <span
                id={messageId}
                data-slot="inline-confirm-message"
                // Announced on insertion, which a region that arrives with its text already in it
                // is not; and named as the description of both buttons, so the consequence is read
                // out wherever focus is rather than only at the moment it appeared.
                role="alert"
                className="text-sm text-colorTextSecondary"
            >
                {message}
            </span>
            <div className="flex items-center gap-2">
                <Button
                    size="sm"
                    variant="destructive"
                    aria-describedby={messageId}
                    onClick={onConfirm}
                >
                    {confirmLabel}
                </Button>
                <Button
                    ref={cancelRef}
                    size="sm"
                    variant="ghost"
                    aria-describedby={messageId}
                    onClick={onCancel}
                >
                    {cancelLabel}
                </Button>
            </div>
        </div>
    )
}
