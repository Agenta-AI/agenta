/** Confirms a destructive connection verb (revoke, delete) inside the integration drawer. */
import {useState} from "react"

import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    LoadingButton,
} from "@agenta/ui/ui"

export type ConnectionAction = "revoke" | "delete"

// Settings' own wording, so the same verb reads the same in both places.
const COPY: Record<ConnectionAction, {title: string; body: string; confirm: string}> = {
    revoke: {
        title: "Revoke connection",
        body: "This will mark the connection as invalid. You can refresh it later to reactivate.",
        confirm: "Revoke",
    },
    delete: {
        title: "Delete connection",
        body: "Are you sure you want to delete this connection? This action is irreversible.",
        confirm: "Delete",
    },
}

export function ConnectionActionConfirm({
    action,
    name,
    container,
    onConfirm,
    onClose,
}: {
    action: ConnectionAction
    name: string
    /** The drawer panel: the dialog masks and centres inside it, not the page. */
    container: HTMLElement | null
    onConfirm: () => Promise<void>
    onClose: () => void
}) {
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const copy = COPY[action]

    return (
        // Non-modal when contained: the drawer already traps focus.
        <Dialog modal={!container} open onOpenChange={(next) => (next ? undefined : onClose())}>
            <DialogContent
                container={container ?? undefined}
                contained={!!container}
                showCloseButton={false}
                className="max-w-[400px]"
            >
                <DialogHeader>
                    <DialogTitle>
                        {copy.title}: {name}
                    </DialogTitle>
                    <DialogDescription>{copy.body}</DialogDescription>
                </DialogHeader>
                {error ? (
                    <p role="alert" className="m-0 text-sm text-colorError">
                        {error}
                    </p>
                ) : null}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <LoadingButton
                        variant="destructive"
                        loading={working}
                        onClick={async () => {
                            setWorking(true)
                            setError(null)
                            try {
                                await onConfirm()
                                onClose()
                            } catch (cause) {
                                // Stays open with the reason, so the user knows nothing changed.
                                setError(
                                    (cause as Error)?.message ||
                                        `Couldn't ${action} this connection.`,
                                )
                            } finally {
                                setWorking(false)
                            }
                        }}
                    >
                        {copy.confirm}
                    </LoadingButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
