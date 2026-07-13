import {workflowMolecule} from "@agenta/entities/workflow"
import {executionController} from "@agenta/playground"
import {useAtomValue} from "jotai"

import SessionInspectorButton from "./SessionInspectorButton"

/** Compare-column variant: resolves the panel's read-back backend session_id, then renders the button. */
const PanelSessionInspectorButton = ({entityId}: {entityId: string}) => {
    const artifactId = useAtomValue(workflowMolecule.selectors.workflowId(entityId))
    const loadableId = useAtomValue(executionController.selectors.derivedLoadableId)
    const backendSessionId = useAtomValue(
        executionController.selectors.backendSessionId(loadableId ?? "", `sess:${entityId}`),
    )
    return <SessionInspectorButton sessionId={backendSessionId} artifactId={artifactId} />
}

export default PanelSessionInspectorButton
