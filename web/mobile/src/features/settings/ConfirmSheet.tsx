import type {ReactNode} from "react"

import {Button} from "@/components/ui/button"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"

/**
 * The confirm-then-act bottom sheet every destructive settings action uses, so a delete
 * reads the same wherever it is triggered from.
 */
export const ConfirmSheet = ({
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
    <Sheet
        open={open}
        onOpenChange={(next) => {
            if (!next && !pending) onClose()
        }}
    >
        <SheetContent side="responsive">
            <SheetHeader>
                <SheetTitle>{title}</SheetTitle>
                {description ? <SheetDescription>{description}</SheetDescription> : null}
            </SheetHeader>
            {body ? <div className="px-4 text-sm">{body}</div> : null}
            {error ? <p className="m-0 px-4 text-sm text-colorError">{error}</p> : null}
            <SheetFooter>
                <Button
                    variant={destructive ? "destructive" : "default"}
                    disabled={pending}
                    onClick={onConfirm}
                >
                    {pending ? "Working…" : confirmLabel}
                </Button>
                <Button variant="outline" onClick={onClose} disabled={pending}>
                    Cancel
                </Button>
            </SheetFooter>
        </SheetContent>
    </Sheet>
)
