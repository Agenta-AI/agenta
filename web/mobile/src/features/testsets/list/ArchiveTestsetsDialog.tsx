import {useEffect, useState} from "react"

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
import {Archive} from "@phosphor-icons/react"

import type {TestsetRow} from "./testsetRowTypes"

/**
 * Asks before archiving one or more test sets, naming each one. The Archive button is solid red,
 * so it reads as the active choice and not as a disabled one.
 *
 * `onConfirm` throws an `Error` with a plain message when it cannot archive (an evaluation uses a
 * test set, a row is busy, the request failed): the dialog shows that text and stays open.
 */
export const ArchiveTestsetsDialog = ({
    targets,
    onConfirm,
    onClose,
}: {
    /** The test sets to archive. Empty = closed. */
    targets: readonly Pick<TestsetRow, "id" | "name">[]
    onConfirm: () => Promise<void>
    onClose: () => void
}) => {
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const open = targets.length > 0
    const single = targets.length === 1

    // Each opening starts clean: an error from the last attempt is not about this one.
    useEffect(() => {
        if (open) setError(null)
    }, [open, targets])

    const confirm = async () => {
        if (pending) return
        setPending(true)
        setError(null)
        try {
            await onConfirm()
            onClose()
        } catch (cause) {
            setError(cause instanceof Error && cause.message ? cause.message : "That did not work")
        } finally {
            setPending(false)
        }
    }

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
                    <AlertDialogTitle>
                        {single ? "Archive this test set?" : `Archive ${targets.length} test sets?`}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {single
                            ? `“${targets[0].name}” and all its revisions will be archived.`
                            : "These test sets and all their revisions will be archived:"}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {single ? null : (
                    <ul className="m-0 max-h-48 list-disc overflow-y-auto pl-5 text-sm text-foreground">
                        {targets.map((target) => (
                            <li key={target.id} className="truncate">
                                {target.name}
                            </li>
                        ))}
                    </ul>
                )}
                {error ? <p className="m-0 text-sm text-destructive">{error}</p> : null}
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button variant="outline" onClick={onClose} disabled={pending}>
                            Cancel
                        </Button>
                    </AlertDialogCancel>
                    {/* preventDefault keeps the dialog open: it closes itself on success and
                        stays for the error otherwise. */}
                    <AlertDialogAction asChild>
                        <Button
                            variant="destructive"
                            className="bg-destructive text-destructive-foreground hover:bg-error-hover"
                            disabled={pending}
                            onClick={(event) => {
                                event.preventDefault()
                                void confirm()
                            }}
                        >
                            <Archive aria-hidden data-icon="inline-start" />
                            {pending ? "Archiving…" : "Archive"}
                        </Button>
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
