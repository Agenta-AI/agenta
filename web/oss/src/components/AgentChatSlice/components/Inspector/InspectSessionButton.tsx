/**
 * "Inspect session" trigger (build-spec §6) — opens the docked Inspector at Session scope. The
 * first-class session entry point (the old panel only reached session view via the in-panel
 * toggle). Placed in the thread's session controls.
 */
import {MagnifyingGlass} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useSetAtom} from "jotai"

import {openInspectorSessionAtom} from "./state"

export default function InspectSessionButton({sessionId}: {sessionId: string | null}) {
    const openSession = useSetAtom(openInspectorSessionAtom)
    return (
        <Tooltip title="Inspect session">
            <Button
                type="text"
                size="small"
                icon={<MagnifyingGlass size={14} />}
                disabled={!sessionId}
                onClick={() => sessionId && openSession(sessionId)}
                aria-label="Inspect session"
            />
        </Tooltip>
    )
}
