import type {ReactNode} from "react"

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"

/**
 * The confirm-then-act alert every destructive action uses: no close X, outside clicks ignored,
 * Escape cancels — but never while the work is running, so the error stays visible.
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
    <AlertDialog
        open={open}
        onOpenChange={(next) => {
            if (!next && !pending) onClose()
        }}
    >
        <AlertDialogContent
            onEscapeKeyDown={(event) => {
                if (pending) event.preventDefault()
            }}
        >
            <AlertDialogHeader>
                <AlertDialogTitle>{title}</AlertDialogTitle>
                {/* Radix warns when a modal has no description, and the body is the description
                    here whenever there is no separate line. */}
                <AlertDialogDescription>{description ?? body ?? ""}</AlertDialogDescription>
            </AlertDialogHeader>
            {description && body ? <div className="text-sm">{body}</div> : null}
            {error ? <p className="m-0 text-sm text-destructive">{error}</p> : null}
            <AlertDialogFooter>
                <AlertDialogCancel asChild>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                </AlertDialogCancel>
                {/* preventDefault keeps the alert open: it closes itself on success, and stays
                    for the error otherwise. */}
                <AlertDialogAction asChild>
                    <Button
                        variant={destructive ? "destructive" : "default"}
                        disabled={pending}
                        onClick={(event) => {
                            event.preventDefault()
                            onConfirm()
                        }}
                    >
                        {pending ? "Working…" : confirmLabel}
                    </Button>
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
)
