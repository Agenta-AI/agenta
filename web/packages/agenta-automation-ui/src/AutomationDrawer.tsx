import {useCallback, useState, type ReactNode} from "react"

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
import {AutomationSaveBar} from "./AutomationSaveBar"
import {AutomationTriggerDrawers} from "./AutomationTriggerDrawers"
import {AutomationDetailSkeleton} from "./states/AutomationStates"
import {useAutomationCreate} from "./useAutomationCreate"
import {useAutomationEditor} from "./useAutomationEditor"

/**
 * One drawer for both kinds of automation.
 *
 * A schedule and an event subscription are two endpoints, but they are one thing to a reader:
 * something that runs an agent. This replaces the pair of kind-specific forms with the single
 * field stack the automations screens render, so the two surfaces cannot drift.
 *
 * It is driven by the SAME two atoms the old drawers used, so every existing opener — the agent
 * panel's rows and its "+", the session row menus — keeps working untouched; which atom is set
 * decides only which half of the "Runs when" control a new automation opens on.
 *
 * Create and edit each own their whole shell rather than sharing one: the footer is a prop of the
 * drawer, and the buttons in it need state that lives inside the body. Only one is ever mounted,
 * and it stays mounted through the close animation.
 */
export const AutomationDrawer = () => {
    const [schedule, setSchedule] = useAtom(triggerScheduleDrawerAtom)
    const [subscription, setSubscription] = useAtom(triggerSubscriptionDrawerAtom)

    const state = schedule ?? subscription
    const kind: AutomationKind = schedule ? "schedule" : "event"
    const automationId = schedule?.scheduleId ?? subscription?.subscriptionId

    const handleClose = useCallback(() => {
        setSchedule(null)
        setSubscription(null)
    }, [setSchedule, setSubscription])

    // The atom clears on close, but the shell has to outlive it to play the slide-out. The kind
    // is held with it: `kind` reads the live atoms, so clearing them on close flips a schedule
    // draft to "event", which changes the key and remounts a blank form mid-animation.
    const [rendered, setRendered] = useState(state)
    const [renderedId, setRenderedId] = useState(automationId)
    const [renderedKind, setRenderedKind] = useState(kind)
    if (state && state !== rendered) {
        setRendered(state)
        setRenderedId(automationId)
        setRenderedKind(kind)
    }
    const handleAfterOpenChange = useCallback((isOpen: boolean) => {
        if (!isOpen) setRendered(null)
    }, [])

    if (!rendered) return null

    return renderedId ? (
        <AutomationEditDrawer
            key={renderedId}
            automationId={renderedId}
            open={!!state}
            onClose={handleClose}
            onAfterOpenChange={handleAfterOpenChange}
            playgroundEntityId={rendered.playgroundEntityId}
        />
    ) : (
        <AutomationCreateDrawer
            key={`new-${renderedKind}`}
            kind={renderedKind}
            open={!!state}
            onClose={handleClose}
            onAfterOpenChange={handleAfterOpenChange}
            playgroundEntityId={rendered.playgroundEntityId}
            defaultAgentName={rendered.defaultBoundLabel}
            defaultReferences={rendered.defaultReferences}
        />
    )
}

/** The shell both modes share — title, width, and a footer only when there is something in it. */
const AutomationDrawerShell = ({
    open,
    onClose,
    onAfterOpenChange,
    playgroundEntityId,
    title,
    footer,
    children,
}: {
    open: boolean
    onClose: () => void
    onAfterOpenChange: (isOpen: boolean) => void
    playgroundEntityId?: string
    title: string
    footer?: ReactNode
    children: ReactNode
}) => {
    const boundAgentName = useAtomValue(
        workflowMolecule.selectors.artifactName(playgroundEntityId ?? ""),
    )

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            afterOpenChange={onAfterOpenChange}
            title={
                <span className="flex min-w-0 items-baseline gap-1.5">
                    <span>{title}</span>
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
            footer={footer}
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
        >
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">{children}</div>
            {/* The event picker's "Connect another app…" opens the catalog by atom, so the
                catalog has to be mounted wherever this drawer is — the screens mount their own,
                and this shell renders nothing when closed, so the two never collide. */}
            <AutomationTriggerDrawers />
        </EnhancedDrawer>
    )
}

/** An existing automation: the same body the detail screen renders, minus its run history. */
const AutomationEditDrawer = ({
    automationId,
    open,
    onClose,
    onAfterOpenChange,
    playgroundEntityId,
}: {
    automationId: string
    open: boolean
    onClose: () => void
    onAfterOpenChange: (isOpen: boolean) => void
    playgroundEntityId?: string
}) => {
    const editor = useAutomationEditor(automationId)

    return (
        <AutomationDrawerShell
            open={open}
            onClose={onClose}
            onAfterOpenChange={onAfterOpenChange}
            playgroundEntityId={playgroundEntityId}
            title="Automation"
            // The bar stands whether or not there is an edit, disabled until there is — a footer
            // that appears mid-edit moves the ground under the cursor.
            footer={
                <AutomationSaveBar
                    bare
                    dirty={editor.dirty}
                    saving={editor.saving}
                    onDiscard={editor.discard}
                    onSave={() => void editor.save()}
                />
            }
        >
            {editor.loading ? (
                <AutomationDetailSkeleton />
            ) : !editor.automation || !editor.preview ? (
                <p className="m-0 py-16 text-center text-[13px] text-muted-foreground">
                    This automation no longer exists.
                </p>
            ) : (
                <AutomationDetailBody
                    automation={editor.automation}
                    preview={editor.preview}
                    agentName={editor.agentName}
                    // The drawer owns the gutters, so the body drops its page column.
                    className="flex min-w-0 flex-col"
                    // The save bar lives in the drawer's footer, where it stays put while the
                    // form scrolls under it.
                    hideSaveBar
                    failureReason={editor.failureReason}
                    dirty={editor.dirty}
                    saving={editor.saving}
                    onRename={editor.onRename}
                    // No rebinding from here: this drawer opens over the agent that owns the
                    // automation, so the field states which agent runs it and stops there.
                    onSelectAgent={playgroundEntityId ? undefined : editor.setAgent}
                    onChangeCron={editor.setCron}
                    onSelectEvent={editor.setEvent}
                    onChangeInputs={editor.setInputs}
                    onToggle={editor.onToggle}
                    onDiscard={editor.discard}
                    onSave={() => void editor.save()}
                />
            )}
        </AutomationDrawerShell>
    )
}

/** A new automation, pre-bound to the agent whose panel opened the drawer. */
const AutomationCreateDrawer = ({
    kind,
    open,
    onClose,
    onAfterOpenChange,
    playgroundEntityId,
    defaultAgentName,
    defaultReferences,
}: {
    kind: AutomationKind
    open: boolean
    onClose: () => void
    onAfterOpenChange: (isOpen: boolean) => void
    playgroundEntityId?: string
    defaultAgentName?: string
    defaultReferences?: Record<string, {id?: string; slug?: string}>
}) => {
    const state = useAutomationCreate({
        defaultKind: kind,
        defaultAgentId: playgroundEntityId ?? null,
        defaultAgentName,
        defaultReferences,
    })

    return (
        <AutomationDrawerShell
            open={open}
            onClose={onClose}
            onAfterOpenChange={onAfterOpenChange}
            playgroundEntityId={playgroundEntityId}
            title="New automation"
            footer={
                <div className="flex items-center justify-end gap-2.5">
                    <Button
                        type="button"
                        variant="outline"
                        className="font-normal"
                        onClick={onClose}
                    >
                        Cancel
                    </Button>
                    {/* A disabled button takes no pointer events, so the reason has to hang off
                        something that does. */}
                    <span title={state.blockedReason || undefined}>
                        <Button
                            type="button"
                            className="font-normal"
                            disabled={!!state.blockedReason || state.saving}
                            title={state.blockedReason || undefined}
                            onClick={() => void state.create().then((made) => made && onClose())}
                        >
                            Create automation
                        </Button>
                    </span>
                </div>
            }
        >
            <AutomationCreateBody
                state={state}
                // The agent is the panel this drawer opened from — offering to change it here
                // would let the reader move an automation off the agent they are looking at.
                showAgentField={!playgroundEntityId}
            />
        </AutomationDrawerShell>
    )
}
