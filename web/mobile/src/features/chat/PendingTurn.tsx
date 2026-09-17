import {ActivityTimeline} from "@agenta/chat/components"
import {ChatBubble} from "@agenta/ui/components/presentational"

import {mobileTurnRowClass} from "./turnRowClass"

/** The assistant turn that does not exist yet: the request is in and no part has arrived. */
export const PendingTurn = ({
    sessionId,
    runId,
    firstTurn = false,
}: {
    sessionId: string
    /** The run's clock key — the assistant turn that follows inherits it. */
    runId?: string
    /** The session's first response: the one that narrates the agent's startup. */
    firstTurn?: boolean
}) => {
    return (
        <div className={`${mobileTurnRowClass} justify-start`}>
            <ChatBubble
                placement="start"
                variant="borderless"
                className="min-w-0 max-w-full sm:max-w-[85%]"
                classNames={{content: "min-w-0 max-w-full overflow-hidden text-xs"}}
                content={
                    <ActivityTimeline
                        messageId={runId ?? `pending:${sessionId}`}
                        sessionId={sessionId}
                        steps={[]}
                        streaming
                        answerStarted={false}
                        firstTurn={firstTurn}
                    />
                }
            />
        </div>
    )
}
