import {useCallback, useState, type ReactNode} from "react"

import {EnhancedDrawer} from "@agenta/ui/drawer"
import {useAtom} from "jotai"

import {AutomationRunHistoryView} from "./AutomationRunHistoryView"
import {automationRunHistoryDrawerAtom} from "./runHistoryDrawerAtom"
import {useAutomation} from "./useAutomation"

/**
 * An automation's runs in a drawer — the same view the automation screen shows, so a reader in
 * the playground answers "did it work?" without leaving the agent.
 *
 * The transcript is the host's chat surface, taken as a slot like the screen takes it. Wide
 * enough for the view's split (list beside run) on a desktop; on a phone it is the full width
 * and the view falls back to its single column on its own.
 */
export const AutomationRunHistoryDrawer = ({
    renderConversation,
}: {
    /** The run's transcript, given its session and the automation's agent. */
    renderConversation: (sessionId: string, agentId: string | null) => ReactNode
}) => {
    const [state, setState] = useAtom(automationRunHistoryDrawerAtom)

    // The atom clears on close, but the shell has to outlive it to play the slide-out.
    const [rendered, setRendered] = useState(state)
    if (state && state !== rendered) setRendered(state)

    const onClose = useCallback(() => setState(null), [setState])
    const onAfterOpenChange = useCallback((isOpen: boolean) => {
        if (!isOpen) setRendered(null)
    }, [])

    if (!rendered) return null

    return (
        <AutomationRunHistoryDrawerBody
            key={rendered.automationId}
            automationId={rendered.automationId}
            kind={rendered.kind}
            open={!!state}
            onClose={onClose}
            onAfterOpenChange={onAfterOpenChange}
            renderConversation={renderConversation}
        />
    )
}

const AutomationRunHistoryDrawerBody = ({
    automationId,
    kind,
    open,
    onClose,
    onAfterOpenChange,
    renderConversation,
}: {
    automationId: string
    kind: "schedule" | "event"
    open: boolean
    onClose: () => void
    onAfterOpenChange: (isOpen: boolean) => void
    renderConversation: (sessionId: string, agentId: string | null) => ReactNode
}) => {
    const {automation} = useAutomation(automationId, kind)
    const render = useCallback(
        (sessionId: string) => renderConversation(sessionId, automation?.agentId ?? null),
        [automation?.agentId, renderConversation],
    )

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            afterOpenChange={onAfterOpenChange}
            // The automation's name: the view below carries its own "Run history" heading, and
            // the drawer title repeating it read as two headings for one thing.
            title={automation?.name || "Automation"}
            width={960}
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
        >
            <AutomationRunHistoryView automation={automation} renderConversation={render} />
        </EnhancedDrawer>
    )
}
