import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
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

/** Confirm-then-act alert: no close X, outside clicks ignored, Escape cancels unless pending. */
export const ConfirmModal = ({
    open,
    title,
    description,
    body,
    confirmLabel,
    cancelLabel,
    pending = false,
    error,
    destructive = true,
    solid = false,
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
    /** Names the way back; absent falls back to Cancel. */
    cancelLabel?: string
    pending?: boolean
    /** Shown above the buttons when the action failed. */
    error?: string | null
    destructive?: boolean
    /** A solid red confirm button instead of the pale one; for a destructive developer page. */
    solid?: boolean
    onConfirm: () => void
    onClose: () => void
}) => {
    const t = useT(commonCatalog)
    return (
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
                    {/* Radix needs a description; the body is it when there is no separate line. */}
                    <AlertDialogDescription>{description ?? body ?? ""}</AlertDialogDescription>
                </AlertDialogHeader>
                {description && body ? <div className="text-body">{body}</div> : null}
                {error ? <p className="m-0 text-body text-destructive">{error}</p> : null}
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button variant="outline" onClick={onClose} disabled={pending}>
                            {cancelLabel ?? t("common.cancel")}
                        </Button>
                    </AlertDialogCancel>
                    {/* preventDefault keeps it open; the caller closes it on success. */}
                    <AlertDialogAction asChild>
                        <Button
                            variant={destructive ? "destructive" : "default"}
                            className={
                                // White text in both themes, as the /w danger buttons have.
                                destructive && solid
                                    ? "bg-destructive text-background hover:bg-destructive/90"
                                    : undefined
                            }
                            disabled={pending}
                            onClick={(event) => {
                                event.preventDefault()
                                onConfirm()
                            }}
                        >
                            {pending ? t("common.working") : confirmLabel}
                        </Button>
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
