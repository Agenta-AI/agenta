import {useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
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
import {useAtomValue, useSetAtom} from "jotai"

import {useRevisionParam} from "../revisions/useRevisionParam"

import type {AppRevisionRow} from "./useAppRevisions"
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
}: {
    row: AppRevisionRow
    projectId: string
    appId: string
    onClose: () => void
}) => {
    const deleteRevision = useSetAtom(playgroundController.actions.deleteRevision)
    const queryClient = useQueryClient()
    const [shownRevisionId, setShownRevisionId] = useRevisionParam()
    const {only, pending: checking} = useIsOnlyRevision({projectId, appId})
    // The delete reads the revision's own record. Subscribing loads it for a row that was never opened.
    const entity = useAtomValue(workflowMolecule.selectors.data(row.revisionId))
    const [pending, setPending] = useState(false)

    const submit = async () => {
        setPending(true)
        try {
            const result = await deleteRevision(row.revisionId)
            if (!result.success) throw new Error(result.error ?? "Delete failed")
            message.success("Deleted workflow successfully")
            await queryClient.invalidateQueries({queryKey: ["workflows"]})
            if (shownRevisionId === row.revisionId) setShownRevisionId(null)
            onClose()
        } catch (error) {
            console.error("Delete revision failed", error)
            message.error("Couldn't delete this revision")
        } finally {
            setPending(false)
        }
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
                {only ? null : (
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
                                    disabled={pending || checking || !entity}
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
