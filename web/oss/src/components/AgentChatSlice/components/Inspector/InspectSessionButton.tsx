/**
 * "Inspect session" trigger (build-spec §6) — toggles the docked Inspector at Session scope. The
 * first-class session entry point (the old panel only reached session view via the in-panel
 * toggle). Placed in the thread's session controls; clicking again collapses the panel.
 */
import {MagnifyingGlass} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {inspectorTargetAtom, toggleInspectorSessionAtom} from "./state"

export default function InspectSessionButton({sessionId}: {sessionId: string | null}) {
    const toggleSession = useSetAtom(toggleInspectorSessionAtom)
    const open = useAtomValue(inspectorTargetAtom)?.sessionId === sessionId && !!sessionId
    return (
        <Tooltip title={open ? "Hide inspector" : "Inspect session"}>
            <Button
                type={open ? "primary" : "text"}
                size="small"
                icon={<MagnifyingGlass size={14} />}
                disabled={!sessionId}
                onClick={() => sessionId && toggleSession(sessionId)}
                aria-label="Inspect session"
                aria-pressed={open}
            />
        </Tooltip>
    )
}
