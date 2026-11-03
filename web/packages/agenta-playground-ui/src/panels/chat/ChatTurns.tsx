import {useMemo, type ReactNode} from "react"

import {executionItemController} from "@agenta/playground"
import {useAtomValue, useSetAtom} from "jotai"

import {useExecutionCell} from "../../hooks/useExecutionCell"

import {ChatControls} from "./ChatControls"
import {ChatTurn} from "./ChatTurn"

export interface ChatTurnsProps {
    entityId: string
    renderTraceFooter?: (traceId: string) => ReactNode
}

/** The turns of the conversation in order, then the Run and "+ Message" controls of the last. */
export const ChatTurns = ({entityId, renderTraceFooter}: ChatTurnsProps) => {
    const items = useAtomValue(
        useMemo(() => executionItemController.selectors.itemsByExecutionId(entityId), [entityId]),
    )
    const turnIds = useMemo(
        () => Array.from(new Set(items.map((item) => item.rowId))) as string[],
        [items],
    )
    const lastTurnId = turnIds[turnIds.length - 1]

    return (
        <div className="flex flex-col gap-4 px-4 pt-2 pb-4">
            {turnIds.map((turnId, index) => (
                <ChatTurn
                    key={turnId}
                    entityId={entityId}
                    turnId={turnId}
                    isLastTurn={index === turnIds.length - 1}
                    renderTraceFooter={renderTraceFooter}
                />
            ))}
            {lastTurnId ? <LastTurnControls entityId={entityId} turnId={lastTurnId} /> : null}
        </div>
    )
}

const LastTurnControls = ({entityId, turnId}: {entityId: string; turnId: string}) => {
    const addUserMessage = useSetAtom(executionItemController.actions.addUserMessage)
    const {isRunning, run, cancel} = useExecutionCell({entityId, stepId: turnId})
    return (
        <ChatControls
            isRunning={Boolean(isRunning)}
            onRun={run}
            onCancel={cancel}
            onAddMessage={() => addUserMessage({userMessage: null})}
        />
    )
}
