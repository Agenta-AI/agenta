import {useEffect, useMemo} from "react"

import {type UIMessage} from "ai"
import {useAtomValue, useSetAtom} from "jotai"

import {playgroundInspectorEnabledAtom} from "@/oss/state/settings/featureFlags"

import {assistantTurnNumbers} from "../assets/messageParts"
import {
    closeInspectorAtom,
    inspectorTargetAtom,
    openInspectorTurnAtom,
} from "../components/Inspector/state"
import {chatPanelMaximizedAtom} from "../state/panelLayout"

/**
 * Turn Inspector wiring for one session: whether the panel is open, which turn it targets, and the
 * assistant-message → turn-number mapping the transcript needs to tint and re-focus rows.
 */
export const useTurnInspector = ({
    sessionId,
    messages,
}: {
    sessionId: string
    messages: UIMessage[]
}) => {
    const inspectorTarget = useAtomValue(inspectorTargetAtom)
    const openInspectorTurn = useSetAtom(openInspectorTurnAtom)
    const closeInspector = useSetAtom(closeInspectorAtom)
    const buildMode = !useAtomValue(chatPanelMaximizedAtom)
    const inspectorEnabled = useAtomValue(playgroundInspectorEnabledAtom)
    // The Inspector is a personal debug tool in BUILD mode. Chat mode has no inspector (the
    // context rail owns the right dock there).
    const inspectorOpen = inspectorEnabled && buildMode && inspectorTarget?.sessionId === sessionId
    const turnInspectorOpen = inspectorOpen && inspectorTarget?.focusedTurn != null
    // The assistant turn the panel is focused on. Turn ids are 1-based indices (records group by
    // `done`); the inspected assistant message is the Nth assistant message.
    const inspectedTurn = turnInspectorOpen ? (inspectorTarget?.focusedTurn ?? null) : null
    // Leaving Build for Chat closes the Inspector entirely.
    useEffect(() => {
        if ((!buildMode || !inspectorEnabled) && inspectorTarget?.sessionId === sessionId) {
            closeInspector()
        }
    }, [buildMode, inspectorEnabled, inspectorTarget?.sessionId, sessionId, closeInspector])

    // Assistant message id → 1-based turn number, built once per message set.
    const turnNumbers = useMemo(() => assistantTurnNumbers(messages), [messages])

    return {
        buildMode,
        inspectorEnabled,
        inspectorOpen,
        inspectedTurn,
        openInspectorTurn,
        turnNumbers,
    }
}
