import {useState} from "react"

import {archiveWorkflowRevision} from "@agenta/entities/workflow"
import {message} from "@agenta/ui/app-message"
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
import {Trash} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"

import {useRevisionParam} from "../revisions/useRevisionParam"

import type {DialogRevision} from "./DeployRevisionDialog"
import {useIsOnlyRevision} from "./useIsOnlyRevision"

/**
 * Delete one revision. The last revision of an app cannot go: the app is the thing to delete.
 * Mount it only while a revision is chosen.
 */
export const DeleteRevisionDialog = ({
    row,
    projectId,
    appId,
    onClose,
    onArchived,
    onDeleted,
}: {
    row: DialogRevision
    projectId: string
    appId: string
    onClose: () => void
    /** Called as soon as the server has deleted the revision, before the dialog closes. */
    onArchived?: (revisionId: string) => void
    /** Called once the revision is gone and the lists have loaded again. It must not throw. */
    onDeleted?: (revisionId: string) => Promise<void> | void
}) => {
    const queryClient = useQueryClient()
    const [shownRevisionId, setShownRevisionId] = useRevisionParam()
    const {only, pending: checking, failed, retry} = useIsOnlyRevision({projectId, appId})
    const [pending, setPending] = useState(false)

    const submit = async () => {
        setPending(true)
        try {
            // Only this revision. The shared delete action also archives other revisions it
            // takes for empty seeds, which can take a real revision with it.
            await archiveWorkflowRevision(projectId, row.revisionId)
        } catch (error) {
            console.error("Delete revision failed", error)
            message.error("Couldn't delete this revision")
            setPending(false)
            return
        }
        // The revision is gone: the dialog closes, and the screens that showed it load again.
        onArchived?.(row.revisionId)
        message.success("Deleted revision successfully")
        onClose()
        // The deleted revision itself is not loaded again: that load would write it back to
        // the persisted cache a reload paints from.
        await queryClient.invalidateQueries({
            queryKey: ["workflows"],
            predicate: ({queryKey}) =>
                !(queryKey[1] === "revision" && queryKey[2] === row.revisionId),
        })
        if (shownRevisionId === row.revisionId) setShownRevisionId(null)
        await onDeleted?.(row.revisionId)
    }

    return (
        <AlertDialog
            open
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
                    <AlertDialogTitle>Delete revision</AlertDialogTitle>
                    <AlertDialogDescription>
                        {only
                            ? "Cannot delete the only revision. Delete the app instead."
                            : `You are about to delete ${row.variantName} v${row.version}.`}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {failed ? (
                    <p className="m-0 text-sm text-destructive">
                        Couldn't check this app's revisions.{" "}
                        <button type="button" className="underline" onClick={() => void retry()}>
                            Try again
                        </button>
                    </p>
                ) : only ? null : (
                    <p className="m-0 text-sm text-muted-foreground">
                        This action cannot be undone.
                    </p>
                )}
                <AlertDialogFooter>
                    {only ? (
                        <AlertDialogCancel asChild>
                            <Button variant="outline" onClick={onClose}>
                                Close
                            </Button>
                        </AlertDialogCancel>
                    ) : (
                        <>
                            <AlertDialogCancel asChild>
                                <Button variant="outline" onClick={onClose} disabled={pending}>
                                    Cancel
                                </Button>
                            </AlertDialogCancel>
                            <AlertDialogAction asChild>
                                <Button
                                    variant="destructive"
                                    disabled={pending || checking || failed}
                                    onClick={(event) => {
                                        event.preventDefault()
                                        void submit()
                                    }}
                                >
                                    <Trash aria-hidden size={14} />
                                    {pending ? "Deleting…" : "Delete"}
                                </Button>
                            </AlertDialogAction>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
