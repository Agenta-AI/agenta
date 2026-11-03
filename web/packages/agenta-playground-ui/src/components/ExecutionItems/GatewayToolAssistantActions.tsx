import React from "react"

import type {ChatTurnAssistantActionsProps} from "../../context/PlaygroundUIContext"
import {useGatewayToolActions, type ExecuteToolCall} from "../../hooks/useGatewayToolActions"

import GatewayToolExecuteButton from "./GatewayToolExecuteButton"

interface GatewayToolAssistantActionsProps extends ChatTurnAssistantActionsProps {
    onExecuteToolCall: ExecuteToolCall
}

const GatewayToolAssistantActions: React.FC<GatewayToolAssistantActionsProps> = ({
    rowId,
    entityId,
    currentResult,
    onRun,
    onExecuteToolCall,
}) => {
    const {payloads, execute, executingId} = useGatewayToolActions({
        rowId,
        entityId,
        currentResult,
        onRun,
        onExecuteToolCall,
    })

    if (!payloads.length) return null

    return (
        <div className="px-1">
            <GatewayToolExecuteButton
                toolPayloads={payloads}
                onExecute={execute}
                executingId={executingId}
            />
        </div>
    )
}

export default GatewayToolAssistantActions
