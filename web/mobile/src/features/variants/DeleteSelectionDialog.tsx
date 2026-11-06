import {useState} from "react"

import {archiveWorkflowRevision, archiveWorkflowVariant} from "@agenta/entities/workflow"
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

import type {RegistryDeletion} from "./registryRows"
import {useAppRevisions} from "./useAppRevisions"

const label = ({variants, revisions}: RegistryDeletion) =>
    [
        ...variants.map((variant) => `${variant.name} (all revisions)`),
        ...revisions.map((revision) => `${revision.variantName} v${revision.version}`),
    ].join(", ")

/**
 * Delete whole variants and single revisions, as the old app's Registry does. An app keeps at
 * least one revision: the app is the thing to delete then. Mount it only while something is
 * chosen.
 */
export const DeleteSelectionDialog = ({
    deletion,
    projectId,
    appId,
    onClose,
    onDeleted,
}: {
    deletion: RegistryDeletion
    projectId: string
    appId: string
    onClose: () => void
    onDeleted: () => void
}) => {
    const queryClient = useQueryClient()
    const [shownRevisionId, setShownRevisionId] = useRevisionParam()
    // The unfiltered list: a search on the page must not make the app look smaller than it is.
    const all = useAppRevisions({projectId, appId, search: ""})
    const [pending, setPending] = useState(false)
    const variantIds = new Set(deletion.variants.map((variant) => variant.id))
    const revisionIds = new Set(deletion.revisions.map((revision) => revision.revisionId))
    const everything =
        !all.isPending &&
        !all.hasMore &&
        all.rows.every((row) => variantIds.has(row.variantId) || revisionIds.has(row.revisionId))
    const checking = all.isPending

    const submit = async () => {
        setPending(true)
        try {
            for (const variant of deletion.variants) {
                await archiveWorkflowVariant(projectId, variant.id)
            }
            for (const revision of deletion.revisions) {
                await archiveWorkflowRevision(projectId, revision.revisionId)
            }
        } catch (error) {
            console.error("Delete from the registry failed", error)
            message.error("Couldn't delete everything you selected")
            setPending(false)
            void queryClient.invalidateQueries({queryKey: ["workflows"]})
            return
        }
        message.success(
            deletion.variants.length
                ? "Deleted the selected variants"
                : "Deleted the selected revisions",
        )
        onDeleted()
        onClose()
        const gone = (id: string | null) =>
            id !== null &&
            (revisionIds.has(id) ||
                all.rows.some((row) => row.revisionId === id && variantIds.has(row.variantId)))
        if (gone(shownRevisionId)) setShownRevisionId(null)
        await queryClient.invalidateQueries({queryKey: ["workflows"]})
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
                    <AlertDialogTitle>Confirm deletion</AlertDialogTitle>
                    <AlertDialogDescription>
                        {everything
                            ? "Cannot delete every revision of an app. Delete the app instead."
                            : `You are about to delete ${label(deletion)}.`}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {all.isError ? (
                    <p className="m-0 text-sm text-destructive">
                        Couldn't check this app's revisions.{" "}
                        <button
                            type="button"
                            className="underline"
                            onClick={() => void all.refetch()}
                        >
                            Try again
                        </button>
                    </p>
                ) : everything ? null : (
                    <p className="m-0 text-sm text-muted-foreground">
                        This action cannot be undone.
                    </p>
                )}
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button variant="outline" onClick={onClose} disabled={pending}>
                            {everything ? "Close" : "Cancel"}
                        </Button>
                    </AlertDialogCancel>
                    {everything ? null : (
                        <AlertDialogAction asChild>
                            <Button
                                variant="destructive"
                                disabled={pending || checking || all.isError}
                                onClick={(event) => {
                                    event.preventDefault()
                                    void submit()
                                }}
                            >
                                <Trash aria-hidden size={14} />
                                {pending ? "Deleting…" : "Delete"}
                            </Button>
                        </AlertDialogAction>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
