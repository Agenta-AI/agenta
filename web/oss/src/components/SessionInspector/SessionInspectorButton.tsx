import {MagnifyingGlass} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useSetAtom} from "jotai"

import {openSessionInspectorAtom} from "./store"

/** Session-inspector trigger; disabled until a backend session_id exists. */
const SessionInspectorButton = ({
    sessionId,
    artifactId,
}: {
    sessionId: string | null
    artifactId?: string | null
}) => {
    const open = useSetAtom(openSessionInspectorAtom)

    const tooltip = sessionId ? "Inspect session" : "Run once to start a session before inspecting"

    return (
        <Tooltip title={tooltip}>
            <Button
                type="text"
                size="small"
                icon={<MagnifyingGlass size={16} />}
                aria-label="Inspect session"
                disabled={!sessionId}
                onClick={() => sessionId && open(sessionId, artifactId ?? null)}
            />
        </Tooltip>
    )
}

export default SessionInspectorButton
