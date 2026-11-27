import {useCallback, useEffect, useRef, useState} from "react"

import {
    AutomationDetailBody,
    AutomationPaneSkeleton,
    useAutomation,
    useAutomationEditor,
} from "@agenta/automation-ui"
import {useAutomationDelete} from "@agenta/entity-ui/drill-in"
import {createT, useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import automationsPanelCatalog from "@agenta/i18n/catalogs/automations.panel"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
import {message} from "@agenta/ui/app-message"
import {
    Alert,
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
    EmptyState,
} from "@agenta/ui/ui"
import {useViewForm, useViewTitle, ViewFooterStart, type ViewProps} from "@agenta/ui/view-stack"
import {Lightning, Trash} from "@phosphor-icons/react"

import {automationRunHistoryView} from "./automationRunHistoryView"
import {AutomationRunNowButton} from "./AutomationRunNowButton"
import type {AutomationViewParams} from "./automationView"

const tNow = createT(automationsScreensCatalog)

/** The body of the automation view: the shared body in a panel column, with this app's Run now. */
const AutomationViewBody = ({params, target, nav}: ViewProps<AutomationViewParams>) => {
    const t = useT(automationsScreensCatalog, automationsPanelCatalog)
    const tEditor = useT(automationsEditorCatalog)
    const editor = useAutomationEditor(params.automationId)
    const {remove} = useAutomation(params.automationId, params.kind)
    const base = `/w/${params.workspaceId}/p/${params.projectId}`
    const [confirmDelete, setConfirmDelete] = useState(false)

    useViewTitle(editor.automation?.name || t("automations.screens.detailFallbackTitle"))
    useViewForm({
        dirty: editor.dirty,
        valid: true,
        // The automation stays open after Save; a failed save says so itself.
        save: async () => {
            await editor.save()
            return "stay"
        },
    })

    const openRuns = useCallback(
        (runId?: string) => {
            if (!nav.push) return
            void nav.push(
                automationRunHistoryView,
                {
                    automationId: params.automationId,
                    kind: params.kind,
                    workspaceId: params.workspaceId,
                    projectId: params.projectId,
                    runId,
                    // The settings are covered while the history is open, so this stays true.
                    unsavedSettings: editor.dirty,
                },
                target,
            )
        },
        [editor.dirty, nav, params, target],
    )

    // The row menu's "Run history" opens this view with `openRuns`: the history goes on top once,
    // as soon as the stack can take it, so Back lands on the automation.
    const openedRuns = useRef(false)
    useEffect(() => {
        if (!params.openRuns || openedRuns.current || !nav.push) return
        openedRuns.current = true
        openRuns()
    }, [nav.push, openRuns, params.openRuns])

    // Deleted: nothing is left to save, so the view leaves without asking.
    const onDelete = useCallback(async () => {
        await remove(params.automationId)
        message.success(tNow("automations.screens.deleted"))
        nav.cancel()
    }, [nav, params.automationId, remove])
    const deletion = useAutomationDelete({onDelete, onClose: () => setConfirmDelete(false)})

    if (editor.loading) return <AutomationPaneSkeleton />
    if (editor.loadFailed)
        return (
            <div className="p-4">
                <Alert
                    type="error"
                    showIcon
                    message={t("automations.screens.loadOneFailed")}
                    description={t("automations.screens.loadOneFailedBody")}
                    action={
                        <Button
                            variant="outline"
                            size="compact"
                            onClick={() => void editor.retry()}
                        >
                            {tEditor("automations.editor.tryAgain")}
                        </Button>
                    }
                />
            </div>
        )
    if (!editor.automation || !editor.preview)
        return (
            <EmptyState
                className="px-4 py-14"
                image={<Lightning aria-hidden />}
                title={t("automations.screens.noLongerExists")}
                description={t("automations.screens.noLongerExistsBody")}
            >
                <Button variant="outline" size="compact" onClick={() => nav.cancel()}>
                    {t("automations.screens.backToAutomations")}
                </Button>
            </EmptyState>
        )

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="ag-scroll-no-bar min-h-0 flex-1 overflow-y-auto">
                <AutomationDetailBody
                    automation={editor.automation}
                    preview={editor.preview}
                    agentName={editor.agentName}
                    className="flex min-w-0 flex-col px-4 pb-6 pt-4"
                    panel
                    hideSaveBar
                    onOpenRunHistory={openRuns}
                    failureReason={editor.failureReason}
                    dirty={editor.dirty}
                    saving={editor.saving}
                    onRename={editor.onRename}
                    onChangeCron={editor.setCron}
                    onSelectEvent={editor.setEvent}
                    onChangeInputs={editor.setInputs}
                    includeEvent={editor.draft.includeEvent}
                    onChangeIncludeEvent={editor.setIncludeEvent}
                    onToggle={editor.onToggle}
                    onDiscard={editor.discard}
                    onSave={() => void editor.save()}
                    runNow={
                        <AutomationRunNowButton
                            automation={editor.automation}
                            base={base}
                            dirty={editor.dirty}
                        />
                    }
                />
            </div>
            {/* The chrome's action row: Delete at its start, quiet, as "Remove from agent". */}
            <ViewFooterStart>
                <Button
                    type="button"
                    variant="destructive-ghost"
                    size="compact"
                    className="-ml-2"
                    onClick={() => setConfirmDelete(true)}
                >
                    <Trash data-icon="inline-start" />
                    {t("automations.screens.delete")}
                </Button>
            </ViewFooterStart>
            <AlertDialog
                open={confirmDelete}
                onOpenChange={(next) => (next ? undefined : deletion.close())}
            >
                <AlertDialogContent data-testid="automation-delete-dialog">
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("automations.screens.deleteTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("automations.screens.deleteMessage", {name: editor.automation.name})}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {deletion.failed ? (
                        <p role="alert" className="m-0 text-label text-destructive">
                            {t("automations.panel.deleteFailed")}
                        </p>
                    ) : null}
                    <AlertDialogFooter>
                        {/* Focus starts on Cancel when the dialog opens. */}
                        <AlertDialogCancel asChild>
                            <Button variant="outline" disabled={deletion.pending}>
                                {t("automations.screens.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <Button
                            variant="destructive"
                            disabled={deletion.pending}
                            onClick={() => void deletion.remove()}
                        >
                            {t("automations.screens.delete")}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

export default AutomationViewBody
