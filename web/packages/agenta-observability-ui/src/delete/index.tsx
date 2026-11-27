import {useState} from "react"

import {deletePreviewTrace} from "@agenta/entities/trace"
import {useT} from "@agenta/i18n"
import deleteCatalog from "@agenta/i18n/catalogs/observabilityUi.deleteTrace"
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
    Button,
} from "@agenta/ui/ui"
import {Trash} from "@phosphor-icons/react"
import {useAtom, useAtomValue} from "jotai"

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

const normalizeTraceId = (id?: string | null) => (id ? id.replace(/-/g, "") : "")

const DeleteTraceModal = ({openTraceId = null, onDrawerClose}: DeleteTraceModalProps) => {
    const projectIdValue = useAtomValue(projectIdAtom)
    const {fetchTraces, setSelectedTraceId: setGlobalSelectedTraceId} = useObservability()
    const t = useT(deleteCatalog)
    const [isLoading, setIsLoading] = useState(false)
    const [{isOpen, traceIds, onClose}, setModalState] = useAtom(deleteTraceModalAtom)
    const count = traceIds.length

    const handleClose = () => {
        setModalState((prev) => ({...prev, isOpen: false}))
    }

    const handleDelete = async () => {
        // Deleting against an empty project id silently targets nothing; fail loudly instead.
        if (!projectIdValue) {
            message.error(t("observabilityUi.deleteTrace.noProject"))
            return
        }

        try {
            setIsLoading(true)
            await Promise.all(traceIds.map((id) => deletePreviewTrace(id, projectIdValue)))
            await fetchTraces()

            // The open trace is gone, so its drawer closes.
            const openId = normalizeTraceId(openTraceId)
            if (openId && traceIds.some((id) => normalizeTraceId(id) === openId)) {
                onDrawerClose?.()
            }

            setGlobalSelectedTraceId("")
            // The caller's callback (e.g. clear the selection).
            onClose?.()
            handleClose()
            message.success(
                count > 1
                    ? t("observabilityUi.deleteTrace.deletedMany", {count})
                    : t("observabilityUi.deleteTrace.deletedOne"),
            )
        } catch (error) {
            // A failed delete used to leave the dialog open with no explanation.
            console.error(error)
            message.error(
                count > 1
                    ? t("observabilityUi.deleteTrace.failedMany")
                    : t("observabilityUi.deleteTrace.failedOne"),
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
                        {count > 1
                            ? t("observabilityUi.deleteTrace.confirmMany", {count})
                            : t("observabilityUi.deleteTrace.confirmOne")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {count > 1
                            ? t("observabilityUi.deleteTrace.descriptionMany")
                            : t("observabilityUi.deleteTrace.descriptionOne")}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={handleClose}>
                        {t("observabilityUi.deleteTrace.cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction asChild>
                        <Button
                            variant="destructive"
                            disabled={isLoading}
                            onClick={(event) => {
                                // The dialog closes itself on action; the delete is async.
                                event.preventDefault()
                                void handleDelete()
                            }}
                        >
                            <Trash size={14} />
                            {isLoading
                                ? t("observabilityUi.deleteTrace.deleting")
                                : t("observabilityUi.deleteTrace.delete")}
                        </Button>
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

export default DeleteTraceModal
