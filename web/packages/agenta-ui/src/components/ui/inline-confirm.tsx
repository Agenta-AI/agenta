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

    React.useEffect(() => {
        cancelRef.current?.focus()
    }, [])

    return (
        <div
            data-slot="inline-confirm"
            role="group"
            // The sentence appears after a click, so a screen reader is told rather than left to
            // find it.
            aria-live="polite"
            className={cn("flex flex-col gap-2", className)}
            onKeyDown={(event) => {
                if (event.key !== "Escape") return
                event.stopPropagation()
                onCancel()
            }}
            {...props}
        >
            <span data-slot="inline-confirm-message" className="text-sm text-colorTextSecondary">
                {message}
            </span>
            <div className="flex items-center gap-2">
                <Button size="sm" variant="destructive" onClick={onConfirm}>
                    {confirmLabel}
                </Button>
                <Button ref={cancelRef} size="sm" variant="ghost" onClick={onCancel}>
                    {cancelLabel}
                </Button>
            </div>
        </div>
    )
}
