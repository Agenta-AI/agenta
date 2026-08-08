/**
 * "Inspect session" trigger (build-spec §6) — toggles the docked Inspector at Session scope. The
 * first-class session entry point (the old panel only reached session view via the in-panel
 * toggle). Placed in the thread's session controls; clicking again collapses the panel.
 */
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {MagnifyingGlass} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {playgroundInspectorEnabledAtom} from "@/oss/state/settings/featureFlags"

import {inspectorTargetAtom, toggleInspectorSessionAtom} from "./state"

export default function InspectSessionButton({sessionId}: {sessionId: string | null}) {
    const inspectorEnabled = useAtomValue(playgroundInspectorEnabledAtom)
    const toggleSession = useSetAtom(toggleInspectorSessionAtom)
    const open = useAtomValue(inspectorTargetAtom)?.sessionId === sessionId && !!sessionId

    if (!inspectorEnabled) return null

    return (
        <SimpleTooltip title={open ? "Hide inspector" : "Inspect session"}>
            <Button
                variant={open ? "default" : "ghost"}
                size="icon-sm"
                disabled={!sessionId}
                onClick={() => sessionId && toggleSession(sessionId)}
                aria-label="Inspect session"
                aria-pressed={open}
            >
                <MagnifyingGlass size={14} />
            </Button>
        </SimpleTooltip>
    )
}
