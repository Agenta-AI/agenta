import {useCallback} from "react"

import {canViewSpansAtom} from "@agenta/entities/access"
import {workflowMolecule} from "@agenta/entities/workflow"
import {executionController} from "@agenta/playground"
import {RunsPanel, RunsPanelSkeleton} from "@agenta/playground-ui/panels/runs"
import {useAtomValue} from "jotai"

import {PlaygroundTraceFooter} from "./PlaygroundTraceFooter"
import {RunPanePlaceholder} from "./RunPanePlaceholder"

/**
 * The run pane of the selected revision. A completion app runs its test cases here. A chat app
 * keeps the empty placeholder until chat lands.
 */
export const PlaygroundRunPane = ({revisionId}: {revisionId: string}) => {
    const query = useAtomValue(workflowMolecule.selectors.query(revisionId))
    const isChat = useAtomValue(executionController.selectors.isChatMode)
    // Without trace access the footer is left out, as in the config pane.
    const canViewSpans = useAtomValue(canViewSpansAtom)
    const renderTraceFooter = useCallback(
        (traceId: string) => <PlaygroundTraceFooter traceId={traceId} />,
        [],
    )

    if (query.isPending || isChat === undefined) return <RunsPanelSkeleton />
    if (isChat) return <RunPanePlaceholder />
    return (
        <RunsPanel
            revisionId={revisionId}
            renderTraceFooter={canViewSpans ? renderTraceFooter : undefined}
        />
    )
}
