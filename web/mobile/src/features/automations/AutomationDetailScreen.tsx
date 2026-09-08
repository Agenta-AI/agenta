import {
    AutomationBackLink,
    AutomationDetailBody,
    AutomationDetailSkeleton,
    AutomationTriggerDrawers,
    useAutomationEditor,
} from "@agenta/automation-ui"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"
import {useConfirmSheet} from "../settings/useConfirmSheet"

import {AutomationActionsMenu} from "./AutomationActionsMenu"
import {AutomationTestRunButton} from "./AutomationTestRunButton"
import {useUnsavedGuard} from "./useUnsavedGuard"

/**
 * One automation — its identity, what it runs, when it runs, and what it is told.
 *
 * The route carries only an id, so the kind is resolved from the two lists (schedules first,
 * then subscriptions) rather than being threaded through from the row that was tapped: a link
 * pasted into a cold tab has to open the same screen. The list row also seeds the body, so the
 * screen is readable before the single-entity fetch lands.
 *
 * The three config fields are one unsaved draft (`useAutomationDraft`) that leaves on Save; only
 * the name and the on/off switch still write on the spot.
 */
export const AutomationDetailScreen = ({
    workspaceId,
    projectId,
    automationId,
}: {
    workspaceId: string
    projectId: string
    automationId: string
}) => {
    useBindProjectContext(projectId)
    const base = `/w/${workspaceId}/p/${projectId}`

    const {
        automation,
        preview,
        agentName,
        runHistoryCaption,
        failureReason,
        missing,
        loading,
        dirty,
        saving,
        onRename,
        onToggle,
        setAgent,
        setCron,
        setInputs,
        setEvent,
        discard,
        save,
    } = useAutomationEditor(automationId)

    // One sheet for both questions this screen can ask (leave without saving, delete) would mean
    // one of them waiting on the other; the menu owns its own.
    const {confirm, sheet} = useConfirmSheet()
    const leave = useUnsavedGuard({dirty, confirm})

    return (
        <>
            <PageTitle title="Automations" context={automation?.name} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className="mx-auto w-full max-w-[760px] shrink-0 px-8 pb-3.5 pt-[30px]">
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <AutomationBackLink href={`${base}/automations`} />
                            </div>
                        </div>
                    }
                >
                    {automation && preview ? (
                        <AutomationDetailBody
                            automation={automation}
                            preview={preview}
                            agentName={agentName}
                            runsHref={`${base}/automations/${automation.id}/runs`}
                            failureReason={failureReason}
                            runHistoryCaption={runHistoryCaption}
                            dirty={dirty}
                            saving={saving}
                            onRename={onRename}
                            onSelectAgent={setAgent}
                            onChangeCron={setCron}
                            onSelectEvent={setEvent}
                            onChangeInputs={setInputs}
                            onToggle={onToggle}
                            actions={
                                <>
                                    <AutomationTestRunButton
                                        automation={automation}
                                        base={base}
                                        dirty={dirty}
                                    />
                                    <AutomationActionsMenu
                                        automation={automation}
                                        base={base}
                                        onLeave={leave}
                                    />
                                </>
                            }
                            onDiscard={discard}
                            onSave={() => void save()}
                        />
                    ) : loading ? (
                        <AutomationDetailSkeleton />
                    ) : missing ? (
                        <p className="m-0 px-8 py-16 text-center text-[13px] text-muted-foreground">
                            This automation no longer exists.
                        </p>
                    ) : null}
                </ScreenScaffold>
            </AppShell>
            <AutomationTriggerDrawers />
            {sheet}
        </>
    )
}
