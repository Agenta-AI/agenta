import {useCallback, useState} from "react"

import {
    AutomationDetailBody,
    AutomationDetailSkeleton,
    useAutomation,
    useAutomationEditor,
} from "@agenta/automation-ui"
import {AutomationDeleteDialog} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
import {message} from "@agenta/ui/app-message"
import {Button} from "@agenta/ui/ui"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {Trash} from "@phosphor-icons/react"

import {automationRunHistoryView} from "./automationRunHistoryView"
import {AutomationRunNowButton} from "./AutomationRunNowButton"
import type {AutomationViewParams} from "./automationView"

/** The body of the automation view: the shared body in a panel column, with this app's Run now. */
const AutomationViewBody = ({params, target, nav}: ViewProps<AutomationViewParams>) => {
    const t = useT(automationsScreensCatalog)
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

    // Deleted: nothing is left to save, so the view leaves without asking.
    const onDelete = useCallback(async () => {
        await remove(params.automationId)
        message.success(t("automations.screens.deleted"))
        nav.cancel()
    }, [nav, params.automationId, remove, t])

    if (editor.loading) return <AutomationDetailSkeleton />
    if (!editor.automation || !editor.preview)
        return (
            <p className="m-0 px-6 py-16 text-center text-[13px] text-muted-foreground">
                {t("automations.screens.noLongerExists")}
            </p>
        )

    return (
        <div className="ag-scroll-no-bar h-full min-h-0 overflow-y-auto">
            <AutomationDetailBody
                automation={editor.automation}
                preview={editor.preview}
                agentName={editor.agentName}
                className="flex min-w-0 flex-col px-4 pb-6 pt-2"
                onOpenRunHistory={openRuns}
                failureReason={editor.failureReason}
                dirty={editor.dirty}
                saving={editor.saving}
                onRename={editor.onRename}
                // The panel opens over the agent that runs it: the agent is a fact here.
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
            <div className="px-4 pb-6">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs font-normal text-destructive"
                    onClick={() => setConfirmDelete(true)}
                >
                    <Trash aria-hidden className="size-3.5" />
                    {t("automations.screens.delete")}
                </Button>
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
