import {useCallback, useState} from "react"

import {triggerScheduleDrawerAtom} from "@agenta/entities/gatewayTrigger"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {useAtom} from "jotai"

import {SHOW_LIST_RAIL} from "./schedule/constants"
import {ScheduleDrawerContent} from "./schedule/ScheduleDrawerContent"
import {ScheduleForm} from "./schedule/ScheduleForm"

// ---------------------------------------------------------------------------
// TriggerScheduleDrawer (root) — create or edit a schedule.
//
// Binds a recurring UTC cron tick to a workflow revision. Edits are full-PUT:
// the body is sourced from the freshly-fetched schedule and only owned fields
// are overridden. From a playground it's a master-detail manager: existing
// schedules on the left, the config on the right, a persistent "Run in
// playground" in the footer. From settings (no playground) it stays a single
// create/edit form, since that page already lists schedules.
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
    const title =
        SHOW_LIST_RAIL && playgroundEntityId
            ? "Schedules"
            : renderedState?.scheduleId
              ? "Edit schedule"
              : "New schedule"

    // EnhancedDrawer renders nothing until first open and unmounts after close, so the
    // content below — which owns all data fetching and master-detail state — only mounts
    // (and its hooks only run) while the drawer is open. Settings mounts the bare form for
    // the same reason: it never shows the rail, so it must not pay for the schedules list
    // query or the draft state. The lifecycle is structural; no `enabled` flags needed.
    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={handleClose}
            afterOpenChange={handleAfterOpenChange}
            title={title}
            width={playgroundEntityId ? 960 : 640}
            closeOnLayoutClick={false}
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
        >
            {renderedState &&
                (playgroundEntityId ? (
                    <ScheduleDrawerContent
                        state={renderedState}
                        playgroundEntityId={playgroundEntityId}
                        onClose={handleClose}
                    />
                ) : (
                    <ScheduleForm
                        key={renderedState.scheduleId ?? "new"}
                        scheduleId={renderedState.scheduleId}
                        onClose={handleClose}
                    />
                ))}
        </EnhancedDrawer>
    )
}
