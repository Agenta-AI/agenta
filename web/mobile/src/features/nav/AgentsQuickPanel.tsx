import {useEffect, useRef} from "react"

import {AgentPickerPanel} from "@agenta/entity-ui/agent"
import {Spinner} from "@agenta/ui/ui"
import {useRouter} from "next/router"

import {useNewAgentAction} from "@/features/agents/useNewAgentAction"
import {startBlankSession} from "@/features/chat/useStartBlankSession"

const NO_SELECTION: string[] = []

/**
 * The rail's Agents flyout: the app's one agent picker panel, where a pick opens a blank session
 * with that agent (its playground) and "New agent" creates one and opens it.
 */
export const AgentsQuickPanel = ({
    base,
    onDone,
    autoFocusSearch = true,
    onBusyChange,
}: {
    /** `/w/:workspace/p/:project` */
    base: string
    /** Closes the host popover. */
    onDone: () => void
    autoFocusSearch?: boolean
    /** A create is in flight: the host must not dismiss, or its outcome and latch are lost. */
    onBusyChange?: (busy: boolean) => void
}) => {
    const newAgent = useNewAgentAction(base)
    const creating = newAgent.creating
    useEffect(() => {
        onBusyChange?.(creating)
        return () => onBusyChange?.(false)
    }, [creating, onBusyChange])
    // A create lands on a new route; close then, so a failed one keeps its error in view.
    const path = useRouter().asPath
    const openedAt = useRef(path)
    useEffect(() => {
        if (path !== openedAt.current) onDone()
    }, [path, onDone])

    return (
        <>
            <AgentPickerPanel
                selectedIds={NO_SELECTION}
                onSelect={(agentId) => {
                    startBlankSession(base, agentId)
                    onDone()
                }}
                onCreateAgent={newAgent.create}
                autoFocusSearch={autoFocusSearch}
            />
            {newAgent.creating ? (
                <p className="text-muted-foreground m-0 flex items-center gap-2 px-3 pb-2 text-[12px]">
                    <Spinner size="small" />
                    Creating agent…
                </p>
            ) : newAgent.error ? (
                <p className="text-destructive m-0 px-3 pb-2 text-[12px]">{newAgent.error}</p>
            ) : null}
        </>
    )
}
