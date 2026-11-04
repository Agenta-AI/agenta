import type {ReactNode} from "react"

import {RunsPanelHeader} from "../runs/RunsPanelHeader"

import {ChatInputsBlock} from "./ChatInputsBlock"
import {ChatTurns} from "./ChatTurns"

export interface ChatPanelProps {
    /** The revision that runs. */
    revisionId: string
    /** The line under each reply with the run's numbers and the trace link. */
    renderTraceFooter?: (traceId: string) => ReactNode
    /** The test set menu in the header. */
    testsetMenu?: ReactNode
}

/** The run pane of a chat app: the header bar, the prompt's variables and messages, the turns. */
export const ChatPanel = ({revisionId, renderTraceFooter, testsetMenu}: ChatPanelProps) => (
    <section className="flex flex-col">
        <RunsPanelHeader entityId={revisionId} label="Chat" testsetMenu={testsetMenu} />
        <ChatInputsBlock entityId={revisionId} />
        <ChatTurns entityId={revisionId} renderTraceFooter={renderTraceFooter} />
    </section>
)
