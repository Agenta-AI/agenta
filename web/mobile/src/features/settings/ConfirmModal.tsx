import type {ReactNode} from "react"

import {Button} from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

/**
 * The confirm-then-act modal every destructive action uses, so a delete reads the same wherever
 * it is triggered from.
 *
 * A modal rather than a sheet: these questions interrupt — the answer is one keystroke from being
 * irreversible — and a sheet sliding in from the edge reads as somewhere you can look past.
 *
 * It closes on Escape and on an outside click, but never while the work is running: a modal
 * dismissed mid-delete would leave the reader with no idea whether it happened, and no way back
 * to the error if it did not.
 */
export const ConfirmModal = ({
    open,
    title,
    description,
    body,
    confirmLabel,
    pending = false,
    error,
    destructive = true,
    onConfirm,
    onClose,
}: {
    open: boolean
    title: string
    /** One line under the title — what this does, or that it cannot be undone. */
    description?: string
    /** Detail above the buttons: the name being deleted, what goes with it. */
    body?: ReactNode
    confirmLabel: string
    pending?: boolean
    /** Shown above the buttons when the action failed; this app has no toasts. */
    error?: string | null
    destructive?: boolean
    onConfirm: () => void
    onClose: () => void
}) => (
    <Dialog
        open={open}
        onOpenChange={(next) => {
            if (!next && !pending) onClose()
        }}
    >
        <DialogContent
            className="sm:max-w-[420px]"
            // Both routes out are the same close, and neither fires mid-flight.
            onInteractOutside={(event) => {
                if (pending) event.preventDefault()
            }}
            onEscapeKeyDown={(event) => {
                if (pending) event.preventDefault()
            }}
        >
            <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                {/* Radix warns when a modal has no description, and the body is the description
                    here whenever there is no separate line. */}
                <DialogDescription>{description ?? body ?? ""}</DialogDescription>
            </DialogHeader>
            {description && body ? <div className="text-sm">{body}</div> : null}
            {error ? <p className="m-0 text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
                <Button variant="outline" onClick={onClose} disabled={pending}>
                    Cancel
                </Button>
                <Button
                    variant={destructive ? "destructive" : "default"}
                    disabled={pending}
                    onClick={onConfirm}
                >
                    {pending ? "Working…" : confirmLabel}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
)
