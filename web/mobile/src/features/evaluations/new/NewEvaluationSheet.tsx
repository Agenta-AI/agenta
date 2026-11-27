import {useCallback, useRef} from "react"

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
    Sheet,
    SheetContent,
} from "@agenta/ui/ui"

import {useDeveloperViewEnabled} from "../../developer/developerViewAccess"
import {useConfirmModal} from "../../settings/useConfirmModal"

import type {DraftRevision, NewEvaluationKind} from "./newEvaluationDraft"
import {NewEvaluationForm} from "./NewEvaluationForm"
import {WIDE_SHEET_FRAME} from "./sheetFrame"
import {useStartEvaluation} from "./useStartEvaluation"

/**
 * The sheet that starts an auto or a human evaluation. It has no route of its own: the runs list
 * and the playground open it. Close, Escape, a click on the overlay and Cancel ask before they
 * drop a draft with input, and close an untouched one at once. None of them work while the start
 * runs.
 */
export const NewEvaluationSheet = ({
    kind,
    projectId,
    base,
    appId,
    initialRevisions,
    onClose,
    onStarted,
    allowAutomaticCreate = false,
}: {
    /** Null keeps the sheet closed. */
    kind: NewEvaluationKind | null
    projectId: string
    /** `/w/{workspace}/p/{project}` */
    base: string
    appId: string | null
    initialRevisions?: DraftRevision[]
    onClose: () => void
    onStarted: (kind: NewEvaluationKind) => void
    /** Create an automatic evaluator in the editable drawer; off inside a playground. */
    allowAutomaticCreate?: boolean
}) => {
    const {start, isStarting} = useStartEvaluation({projectId, base})
    const evaluatorsViewOn = useDeveloperViewEnabled("evaluators") === true
    const t = useT(commonCatalog)
    const confirmDialog = useConfirmModal()
    const {confirm} = confirmDialog
    const hasInput = useRef(false)

    const handleInputChange = useCallback((next: boolean) => {
        hasInput.current = next
    }, [])

    const close = useCallback(() => {
        hasInput.current = false
        onClose()
    }, [onClose])

    const requestClose = useCallback(() => {
        if (isStarting) return
        if (!hasInput.current) {
            close()
            return
        }
        confirm({
            title: "Discard this evaluation?",
            message: "The name and picks you made will be lost.",
            okText: "Discard",
            danger: true,
            onOk: close,
        })
    }, [close, confirm, isStarting])

    return (
        <>
            <Sheet open={kind !== null} onOpenChange={(next) => !next && requestClose()}>
                <SheetContent
                    {...WIDE_SHEET_FRAME}
                    onEscapeKeyDown={(event) => isStarting && event.preventDefault()}
                    onPointerDownOutside={(event) => isStarting && event.preventDefault()}
                    onInteractOutside={(event) => isStarting && event.preventDefault()}
                >
                    {kind ? (
                        <NewEvaluationForm
                            kind={kind}
                            projectId={projectId}
                            appId={appId}
                            initialRevisions={initialRevisions}
                            evaluatorsHref={evaluatorsViewOn ? `${base}/evaluators` : null}
                            isStarting={isStarting}
                            start={start}
                            onCancel={requestClose}
                            onClose={close}
                            onStarted={onStarted}
                            onInputChange={handleInputChange}
                            allowAutomaticCreate={allowAutomaticCreate}
                        />
                    ) : null}
                </SheetContent>
            </Sheet>
            <AlertDialog
                open={Boolean(confirmDialog.request)}
                onOpenChange={(next) => {
                    if (!next && !confirmDialog.pending) confirmDialog.close()
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{confirmDialog.request?.title ?? ""}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmDialog.request?.message ?? ""}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {confirmDialog.error ? (
                        <p className="m-0 text-body text-destructive">{confirmDialog.error}</p>
                    ) : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button
                                variant="outline"
                                onClick={confirmDialog.close}
                                disabled={confirmDialog.pending}
                            >
                                {confirmDialog.request?.cancelText ?? t("common.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button
                                variant={
                                    confirmDialog.request?.danger === false
                                        ? "default"
                                        : "destructive"
                                }
                                disabled={confirmDialog.pending}
                                onClick={(event) => {
                                    event.preventDefault()
                                    void confirmDialog.runConfirm()
                                }}
                            >
                                {confirmDialog.pending
                                    ? t("common.working")
                                    : (confirmDialog.request?.okText ?? t("common.confirm"))}
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
