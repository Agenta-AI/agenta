import {useCallback, useEffect, useRef, useState} from "react"

import {
    AutomationDetailBody,
    AutomationDetailSkeleton,
    useAutomation,
    useAutomationEditor,
} from "@agenta/automation-ui"
import {AutomationDeleteDialog} from "@agenta/entity-ui/drill-in"
import {createT, useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
import {message} from "@agenta/ui/app-message"
import {useIsPhone} from "@agenta/ui/phone"
import {Button} from "@agenta/ui/ui"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {Trash} from "@phosphor-icons/react"

import {automationRunHistoryView} from "./automationRunHistoryView"
import {AutomationRunNowButton} from "./AutomationRunNowButton"
import type {AutomationViewParams} from "./automationView"

const tNow = createT(automationsScreensCatalog)

/** The body of the automation view: the shared body in a panel column, with this app's Run now. */
const AutomationViewBody = ({params, target, nav}: ViewProps<AutomationViewParams>) => {
    const t = useT(automationsScreensCatalog)
    const tEditor = useT(automationsEditorCatalog)
    // A phone keeps 44 px tap targets in the footer.
    const phone = useIsPhone()
    const footerButton = phone ? "h-11 px-4 text-[15px]" : ""
    const editor = useAutomationEditor(params.automationId)
    const {remove} = useAutomation(params.automationId, params.kind)
    const base = `/w/${params.workspaceId}/p/${params.projectId}`
    const [confirmDelete, setConfirmDelete] = useState(false)

    useViewTitle(editor.automation?.name || t("automations.screens.detailFallbackTitle"))
    useViewForm({
        dirty: editor.dirty,
        valid: true,
        save: editor.save,
        leaveDescription: t("automations.screens.leaveMessage"),
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

    if (editor.loading) return <AutomationDetailSkeleton />
    if (!editor.automation || !editor.preview)
        return (
            <p className="m-0 px-6 py-16 text-center text-[13px] text-muted-foreground">
                {t("automations.screens.noLongerExists")}
            </p>
        )

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="ag-scroll-no-bar min-h-0 flex-1 overflow-y-auto">
                <AutomationDetailBody
                    automation={editor.automation}
                    preview={editor.preview}
                    agentName={editor.agentName}
                    className="flex min-w-0 flex-col px-4 pb-6 pt-3.5"
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
            {/* The view's footer (F05 f5): Delete at the left; Discard and Save, which belong to
                "Settings", at the right. */}
            <div
                className={`flex shrink-0 items-center justify-between gap-2 border-0 border-t border-solid border-colorBorderSecondary ${phone ? "px-4 pb-6 pt-3" : "p-3"}`}
            >
                <Button
                    type="button"
                    variant="ghost"
                    size="compact"
                    className={`font-normal text-destructive hover:text-destructive ${footerButton}`}
                    onClick={() => setConfirmDelete(true)}
                >
                    <Trash aria-hidden className="size-3.5" />
                    {t("automations.screens.delete")}
                </Button>
                <span className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="compact"
                        className={`font-normal ${footerButton}`}
                        disabled={editor.saving || !editor.dirty}
                        onClick={editor.discard}
                    >
                        {tEditor("automations.editor.discard")}
                    </Button>
                    <Button
                        type="button"
                        size="compact"
                        className={`font-normal ${footerButton}`}
                        disabled={editor.saving || !editor.dirty}
                        onClick={() => void editor.save()}
                    >
                        {editor.saving
                            ? tEditor("automations.editor.saving")
                            : tEditor("automations.editor.save")}
                    </Button>
                </span>
            </div>
            <AutomationDeleteDialog
                open={confirmDelete}
                name={editor.automation.name}
                onDelete={onDelete}
                onClose={() => setConfirmDelete(false)}
            />
        </div>
    )
}

export default AutomationViewBody
