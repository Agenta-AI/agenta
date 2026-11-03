import {workflowMolecule} from "@agenta/entities/workflow"
import {executionController} from "@agenta/playground"
import {RunsPanel, RunsPanelSkeleton} from "@agenta/playground-ui/panels/runs"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {PlaygroundTestsetMenu} from "./PlaygroundTestsetMenu"
import {usePlaygroundTraceFooter} from "./usePlaygroundTraceFooter"

// A completion app never downloads the chat panel.
const ChatPanel = dynamic(
    () => import("@agenta/playground-ui/panels/chat").then((module) => module.ChatPanel),
    {ssr: false, loading: () => <RunsPanelSkeleton />},
)

/**
 * The run pane of the selected revision. A completion app runs its test cases here. A chat app
 * runs its conversation.
 */
export const PlaygroundRunPane = ({revisionId}: {revisionId: string}) => {
    const query = useAtomValue(workflowMolecule.selectors.query(revisionId))
    const isChat = useAtomValue(executionController.selectors.isChatMode)
    // Without trace access the footer is left out, as in the config pane.
    const footer = usePlaygroundTraceFooter()

    if (query.isPending || isChat === undefined) return <RunsPanelSkeleton />
    const testsetMenu = <PlaygroundTestsetMenu />
    if (isChat) {
        return (
            <ChatPanel
                revisionId={revisionId}
                renderTraceFooter={footer}
                testsetMenu={testsetMenu}
            />
        )
    }
    return (
        <RunsPanel revisionId={revisionId} renderTraceFooter={footer} testsetMenu={testsetMenu} />
    )
}
