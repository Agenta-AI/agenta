import {useState} from "react"

import {deletePreviewTrace} from "@agenta/entities/trace"
import {useObservability} from "@agenta/observability"
import {projectIdAtom} from "@agenta/shared/state"
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
} from "@agenta/ui/ui"
import {Trash} from "@phosphor-icons/react"
import {useAtom, useAtomValue} from "jotai"
import Router from "next/router"

import {deleteTraceModalAtom} from "./store/atom"

/**
 * The trace-delete confirmation, shared by /m and web/oss.
 *
 * The only app-specific part was the currently open trace, which is routing state: a host
 * that has a trace drawer passes its id so the drawer can close behind the delete, and a
 * host that does not simply omits it.
 */
export interface DeleteTraceModalProps {
    /** Id of the trace the host currently has open, if any. */
    openTraceId?: string | null
    /** Called when the deleted trace was the one on screen, so the host can close it. */
    onDrawerClose?: () => void
}

const DeleteTraceModal = ({openTraceId = null, onDrawerClose}: DeleteTraceModalProps) => {
    const projectIdValue = useAtomValue(projectIdAtom)
    const {fetchTraces, setSelectedTraceId: setGlobalSelectedTraceId, traces} = useObservability()
    // Closing the drawer behind the delete is the host's business, not the dialog's.
    const closeDrawer = () => onDrawerClose?.()
    // The open trace is app routing state; a host that has one passes it in.
    const currentTraceId = openTraceId
    const [isLoading, setIsLoading] = useState(false)
    const [{isOpen, traceIds, onClose}, setModalState] = useAtom(deleteTraceModalAtom)

    const handleClose = () => {
        setModalState((prev) => ({...prev, isOpen: false}))
    }

    const handleDelete = async () => {
        // Deleting against an empty project id silently targets nothing; fail loudly instead.
        if (!projectIdValue) {
            message.error("Cannot delete: no project is selected.")
            return
        }

        try {
            setIsLoading(true)
            await Promise.all(traceIds.map((id) => deletePreviewTrace(id, projectIdValue)))
            await fetchTraces()

            const isCurrentTraceDeleted = traceIds.includes(currentTraceId || "")

            if (isCurrentTraceDeleted && traceIds.length === 1) {
                // findIndex returns -1 when the trace is not in the current page; without
                // this guard that becomes traces[0], sending the user to an unrelated trace.
                const deletedIndex = traces.findIndex((t) => t.trace_id === traceIds[0])
                const nextTrace =
                    deletedIndex === -1
                        ? undefined
                        : (traces[deletedIndex + 1] ?? traces[deletedIndex - 1])

                if (nextTrace) {
                    const url = new URL(window.location.href)
                    url.searchParams.set("trace", nextTrace.trace_id)
                    url.searchParams.delete("span")
                    await Router.push(url.toString(), undefined, {shallow: true})
                } else {
                    closeDrawer()
                }
            } else if (isCurrentTraceDeleted) {
                closeDrawer()
            }

            // Clear global (observability) selections
            setGlobalSelectedTraceId("")

            // Execute the callback passed via atom (e.g. refresh, clear selection)
            onClose?.()

            // Close modal
            handleClose()
        } catch (error) {
            // A failed delete used to leave the dialog open with no explanation.
            console.error(error)
            message.error(
                traceIds.length > 1 ? "Failed to delete traces." : "Failed to delete the trace.",
            )
        } finally {
            setIsLoading(false)
        }
    }
    return (
        <AlertDialog open={isOpen} onOpenChange={(next) => (next ? null : handleClose())}>
            <AlertDialogContent className="max-w-[400px]">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {`Are you sure you want to delete${
                            traceIds.length > 1 ? ` ${traceIds.length} traces` : ""
                        }?`}
                    </AlertDialogTitle>
                    <AlertDialogDescription>This action is not reversible.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={handleClose}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={isLoading}
                        onClick={(event) => {
                            // The dialog closes itself on action; the delete is async.
                            event.preventDefault()
                            void handleDelete()
                        }}
                    >
                        <Trash size={14} />
                        Delete
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

export default DeleteTraceModal
