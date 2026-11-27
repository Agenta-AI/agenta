import type {ComponentProps} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {CompareLayout} from "@agenta/playground-ui/panels/compare"
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

import {RevisionConfig} from "./RevisionConfig"
import {useCloseRevision} from "./useCloseRevision"
import {usePlaygroundTraceFooter} from "./usePlaygroundTraceFooter"

type ColumnProps = Omit<
    ComponentProps<typeof RevisionConfig>,
    "revisionId" | "readOnly" | "onClose"
>

/**
 * The compare view: two or more revisions side by side. It loads on demand, the first time the
 * page shows more than one revision.
 */
export const PlaygroundCompare = ({
    revisionIds,
    deletedId,
    column,
}: {
    revisionIds: string[]
    /** A revision the server deleted, read only until it leaves the page. */
    deletedId: string | null
    column: ColumnProps
}) => {
    const {close, confirmDialog} = useCloseRevision()
    const t = useT(commonCatalog)
    const renderTraceFooter = usePlaygroundTraceFooter()

    return (
        <>
            <CompareLayout
                revisionIds={revisionIds}
                onClose={close}
                renderTraceFooter={renderTraceFooter}
                renderConfig={(revisionId) => (
                    <RevisionConfig
                        {...column}
                        revisionId={revisionId}
                        readOnly={deletedId === revisionId}
                        onClose={close}
                    />
                )}
            />
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
