import {useCallback, useState} from "react"

import {triggerScheduleDrawerAtom} from "@agenta/entities/gatewayTrigger"
import {workflowMolecule} from "@agenta/entities/workflow"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {useAtom, useAtomValue} from "jotai"

import {ScheduleForm} from "./schedule/ScheduleForm"

// ---------------------------------------------------------------------------
// TriggerScheduleDrawer (root) — create or edit a schedule.
//
// Binds a recurring UTC cron tick to a workflow revision. Edits are full-PUT: the body is
// sourced from the freshly-fetched schedule and only owned fields are overridden. Both hosts
// render the same single form; the playground passes its agent so the drawer can drop the agent
// picker and offer "Run in playground".
// ---------------------------------------------------------------------------

export default function TriggerScheduleDrawer() {
    const [state, setState] = useAtom(triggerScheduleDrawerAtom)
    const open = !!state
    const handleClose = useCallback(() => setState(null), [setState])

    // EnhancedDrawer keeps the Sheet shell mounted ~320ms after `open` goes false to play
    // the slide-out, then calls `afterOpenChange(false)`. Gating content on `state` directly
    // would unmount it in the same render as the close click — an empty shell sliding out
    // for that window. Keep rendering the last known state until the shell actually unmounts.
    const [renderedState, setRenderedState] = useState(state)
    if (state && state !== renderedState) setRenderedState(state)
    const handleAfterOpenChange = useCallback((isOpen: boolean) => {
        if (!isOpen) setRenderedState(null)
    }, [])

    const playgroundEntityId = renderedState?.playgroundEntityId
    const agentName = useAtomValue(
        workflowMolecule.selectors.artifactName(playgroundEntityId ?? ""),
    )
    const title = renderedState?.scheduleId ? "Edit schedule" : "New schedule"

    // EnhancedDrawer renders nothing until first open and unmounts after close, so the form
    // below — which owns all data fetching — only mounts (and its hooks only run) while the
    // drawer is open. The lifecycle is structural; no `enabled` flags needed.
    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={handleClose}
            afterOpenChange={handleAfterOpenChange}
            title={
                <span className="flex min-w-0 items-baseline gap-1.5">
                    <span>{title}</span>
                    {agentName ? (
                        <>
                            <span className="text-[var(--ag-colorTextQuaternary)]">·</span>
                            <span className="min-w-0 truncate text-sm font-normal text-[var(--ag-colorTextDescription)]">
                                {agentName}
                            </span>
                        </>
                    ) : null}
                </span>
            }
            width={640}
            closeOnLayoutClick={false}
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
        >
            {renderedState && (
                <ScheduleForm
                    key={renderedState.scheduleId ?? "new"}
                    scheduleId={renderedState.scheduleId}
                    onClose={handleClose}
                />
            )}
        </EnhancedDrawer>
    )
}
