import {useCallback, useState} from "react"

import {
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
} from "@agenta/entities/gatewayTrigger"
import {workflowMolecule} from "@agenta/entities/workflow"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button} from "@agenta/ui/ui"
import {useAtom, useAtomValue} from "jotai"

import {AutomationCreateBody} from "./AutomationCreateBody"
import {AutomationDetailBody} from "./AutomationDetailBody"
import {type AutomationKind} from "./automationModel"
import {AutomationDetailSkeleton} from "./states/AutomationStates"
import {useAutomationCreate} from "./useAutomationCreate"
import {useAutomationEditor} from "./useAutomationEditor"

/**
 * One drawer for both kinds of automation.
 *
 * A schedule and an event subscription are two endpoints, but they are one thing to a reader:
 * something that runs an agent. This replaces the pair of kind-specific forms with the single
 * field stack the app's own automations screens render, so the two surfaces cannot drift.
 *
 * It is driven by the SAME two atoms the old drawers used, so every existing opener — the agent
 * panel's rows, its add menu, the settings sections — keeps working untouched; which atom is set
 * decides only which half of the "Runs when" control a new automation opens on.
 */
export const AutomationDrawer = () => {
    const [schedule, setSchedule] = useAtom(triggerScheduleDrawerAtom)
    const [subscription, setSubscription] = useAtom(triggerSubscriptionDrawerAtom)

    const state = schedule ?? subscription
    const kind: AutomationKind = schedule ? "schedule" : "event"
    const open = !!state

    const handleClose = useCallback(() => {
        setSchedule(null)
        setSubscription(null)
    }, [setSchedule, setSubscription])

    // EnhancedDrawer keeps the shell mounted for the slide-out, so gating content on `state`
    // would empty the drawer mid-animation. Keep the last state until the shell unmounts.
    const [rendered, setRendered] = useState(state)
    if (state && state !== rendered) setRendered(state)
    const handleAfterOpenChange = useCallback((isOpen: boolean) => {
        if (!isOpen) setRendered(null)
    }, [])

    const automationId = schedule?.scheduleId ?? subscription?.subscriptionId
    const playgroundEntityId = rendered?.playgroundEntityId
    const boundAgentName = useAtomValue(
        workflowMolecule.selectors.artifactName(playgroundEntityId ?? ""),
    )

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={handleClose}
            afterOpenChange={handleAfterOpenChange}
            title={
                <span className="flex min-w-0 items-baseline gap-1.5">
                    <span>{automationId ? "Automation" : "New automation"}</span>
                    {boundAgentName ? (
                        <>
                            <span className="text-[var(--ag-colorTextQuaternary)]">·</span>
                            <span className="min-w-0 truncate text-sm font-normal text-[var(--ag-colorTextDescription)]">
                                {boundAgentName}
                            </span>
                        </>
                    ) : null}
                </span>
            }
            width={640}
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
        >
            {rendered ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
                    {automationId ? (
                        <AutomationEditDrawerBody
                            key={automationId}
                            automationId={automationId}
                            onClose={handleClose}
                        />
                    ) : (
                        <AutomationCreateDrawerBody
                            key={`new-${kind}`}
                            kind={kind}
                            defaultReferences={rendered.defaultReferences}
                            defaultAgentId={playgroundEntityId ?? null}
                            onClose={handleClose}
                        />
                    )}
                </div>
            ) : null}
        </EnhancedDrawer>
    )
}

/** An existing automation: the same body the app's detail screen renders, minus its run history. */
const AutomationEditDrawerBody = ({
    automationId,
    onClose,
}: {
    automationId: string
    onClose: () => void
}) => {
    const editor = useAutomationEditor(automationId)

    if (editor.loading) return <AutomationDetailSkeleton />
    if (!editor.automation || !editor.preview)
        return (
            <p className="m-0 py-16 text-center text-[13px] text-muted-foreground">
                This automation no longer exists.
            </p>
        )

    return (
        <AutomationDetailBody
            automation={editor.automation}
            preview={editor.preview}
            agentName={editor.agentName}
            // The drawer opens over the agent that owns the run history, so a link out of it
            // would be a link to the surface the reader is already standing on.
            runsHref={null}
            // The drawer owns the gutters, so the body drops the page column it uses on a screen.
            className="flex min-w-0 flex-col"
            failureReason={editor.failureReason}
            runHistoryCaption={editor.runHistoryCaption}
            dirty={editor.dirty}
            saving={editor.saving}
            onRename={editor.onRename}
            onSelectAgent={editor.setAgent}
            onChangeCron={editor.setCron}
            onSelectEvent={editor.setEvent}
            onChangeInputs={editor.setInputs}
            onToggle={editor.onToggle}
            onDiscard={editor.discard}
            onSave={() => void editor.save().then(onClose)}
        />
    )
}

/** A new automation, pre-bound to the agent whose panel opened the drawer. */
const AutomationCreateDrawerBody = ({
    kind,
    defaultAgentId,
    defaultReferences,
    onClose,
}: {
    kind: AutomationKind
    defaultAgentId: string | null
    defaultReferences?: Record<string, {id?: string; slug?: string}>
    onClose: () => void
}) => {
    const state = useAutomationCreate({
        defaultKind: kind,
        defaultAgentId,
        defaultReferences,
    })

    return (
        <AutomationCreateBody
            state={state}
            // The agent is the panel this drawer opened from — offering to change it here would
            // let the reader move an automation off the agent they are looking at.
            showAgentField={!defaultAgentId}
            footer={
                <div className="mt-[30px] flex items-center justify-end gap-2.5 border-0 border-t border-solid border-border pt-5">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-xs font-normal"
                        onClick={onClose}
                    >
                        Cancel
                    </Button>
                    <span title={state.blockedReason || undefined}>
                        <Button
                            type="button"
                            size="sm"
                            className="text-xs font-normal"
                            disabled={!!state.blockedReason || state.saving}
                            title={state.blockedReason || undefined}
                            onClick={() => void state.create().then((made) => made && onClose())}
                        >
                            Create automation
                        </Button>
                    </span>
                </div>
            }
        />
    )
}
