import {useCallback, useState} from "react"

import {archiveRevision, invalidateRevisionsListCache} from "@agenta/entities/testset"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"

import {ConfirmModal} from "../../settings/ConfirmModal"

import {testsetRevisionPath} from "./testsetRouteId"
import type {RevisionsList} from "./useRevisionsList"

const ARCHIVE_FAILED = "Couldn't archive this revision"

/** Why "Archive revision" is off, or null when it is available. */
export const archiveDisabledReason = (
    list: Pick<RevisionsList, "status" | "revisions">,
): string | null => {
    if (list.status === "idle" || list.status === "loading") return "Loading revisions..."
    if (list.status === "error") return "Revisions did not load"
    if (list.revisions.length <= 1) return "Cannot archive the only revision"
    return null
}

/**
 * Archives the revision on screen after a confirm, then opens the newest other revision, or
 * the list when there is none. The only saved revision stays, as in the old app.
 *
 * Render `modal` next to the menu that calls `request`.
 */
export function useRevisionArchive({
    projectId,
    testsetId,
    revisionId,
    name,
    version,
    list,
    base,
    leave,
}: {
    projectId: string
    testsetId: string | undefined
    revisionId: string | null
    name: string
    version: number | undefined
    list: Pick<RevisionsList, "status" | "revisions">
    base: string
    /** Goes to a page without the unsaved-changes prompt: after an archive there is none to save. */
    leave: (url: string) => void
}) {
    const queryClient = useQueryClient()
    const [open, setOpen] = useState(false)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const disabledReason = archiveDisabledReason(list)

    const request = useCallback(() => {
        if (!revisionId || !testsetId || disabledReason) return
        setError(null)
        setOpen(true)
    }, [disabledReason, revisionId, testsetId])

    const close = useCallback(() => setOpen(false), [])

    const confirmArchive = useCallback(async () => {
        if (!revisionId || !testsetId) return
        setPending(true)
        setError(null)
        try {
            try {
                await archiveRevision({projectId, revisionId})
            } catch (cause) {
                console.error("Archiving the revision failed", cause)
                setError(ARCHIVE_FAILED)
                return
            }
            message.success("Revision archived")
            invalidateRevisionsListCache(testsetId)
            await queryClient.invalidateQueries({queryKey: ["testsets"]})
            const next = list.revisions.find((revision) => revision.id !== revisionId)
            setOpen(false)
            leave(next ? testsetRevisionPath(base, next.id) : `${base}/testsets`)
        } finally {
            setPending(false)
        }
    }, [base, leave, list.revisions, projectId, queryClient, revisionId, testsetId])

    const modal = (
        <ConfirmModal
            open={open}
            title="Are you sure?"
            description="Are you sure you want to archive the following?"
            body={
                <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">Revisions only</span>
                    <span className="font-medium">
                        {name} v{version ?? "#"}
                    </span>
                </div>
            }
            confirmLabel="Archive"
            pending={pending}
            error={error}
            onClose={close}
            onConfirm={() => void confirmArchive()}
        />
    )

    return {request, modal, disabledReason}
}
