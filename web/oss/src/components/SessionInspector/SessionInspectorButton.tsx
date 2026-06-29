import {executionController} from "@agenta/playground"
import {MagnifyingGlass} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {openSessionInspectorAtom} from "./store"

/** Per-panel session-inspector trigger; disabled until the panel has a backend session_id. */
const SessionInspectorButton = ({entityId}: {entityId: string}) => {
    const loadableId = useAtomValue(executionController.selectors.derivedLoadableId)
    const panelSessionId = `sess:${entityId}`
    const backendSessionId = useAtomValue(
        executionController.selectors.backendSessionId(loadableId ?? "", panelSessionId),
    )
    const open = useSetAtom(openSessionInspectorAtom)

    const tooltip = backendSessionId
        ? "Inspect session"
        : "Run once to start a session before inspecting"

    return (
        <Tooltip title={tooltip}>
            <Button
                type="text"
                size="small"
                icon={<MagnifyingGlass size={16} />}
                aria-label="Inspect session"
                disabled={!backendSessionId}
                onClick={() => backendSessionId && open(backendSessionId)}
            />
        </Tooltip>
    )
}

export default SessionInspectorButton
