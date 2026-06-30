import {executionController} from "@agenta/playground"
import {useAtomValue} from "jotai"

import SessionInspectorButton from "./SessionInspectorButton"

/** Compare-column variant: resolves the panel's read-back backend session_id, then renders the button. */
const PanelSessionInspectorButton = ({entityId}: {entityId: string}) => {
    const loadableId = useAtomValue(executionController.selectors.derivedLoadableId)
    const backendSessionId = useAtomValue(
        executionController.selectors.backendSessionId(loadableId ?? "", `sess:${entityId}`),
    )
    return <SessionInspectorButton sessionId={backendSessionId} />
}

export default PanelSessionInspectorButton
