import React, {useCallback, useState} from "react"

import {type ToolCall} from "@agenta/shared/types"
import {isGatewayToolSlug} from "@agenta/shared/utils"
import {message as antMessage} from "@agenta/ui/app-message"
import {DropdownButton} from "@agenta/ui/components"
import {CaretDown, Lightning} from "@phosphor-icons/react"
import {v4 as uuidv4} from "uuid"

export interface GatewayToolPayloadInfo {
    name?: string
    callId?: string
    json: string
}

interface Props {
    toolPayloads: GatewayToolPayloadInfo[]
    onUpdateToolResponse: (callId: string | undefined, resultStr: string, toolName?: string) => void
    onExecuteAndSendToChat?: () => void
    onExecuteToolCall: (params: {data: ToolCall}) => Promise<{
        call?: {
            data?: {
                content?: string
                role?: string
                tool_call_id?: string
            }
        }
    }>
}

const GatewayToolExecuteButton: React.FC<Props> = ({
    toolPayloads,
    onUpdateToolResponse,
    onExecuteAndSendToChat,
    onExecuteToolCall,
}) => {
    const [executingId, setExecutingId] = useState<string | null>(null)

    const handleExecute = useCallback(
        async (p: GatewayToolPayloadInfo, sendToChat: boolean) => {
            const execId = p.callId || p.name || "default"
            const toolCallId = p.callId || `call_${uuidv4()}`
            setExecutingId(execId)

            try {
                const response = await onExecuteToolCall({
                    data: {
                        id: toolCallId,
                        type: "function",
                        function: {
                            name: p.name!,
                            arguments: p.json, // pass raw JSON string as LLM returned it
                        },
                    },
                })
                const resultStr =
                    response.call?.data?.content ?? JSON.stringify(response.call?.data, null, 2)
                onUpdateToolResponse(toolCallId, resultStr, p.name)
                if (sendToChat) {
                    onExecuteAndSendToChat?.()
                }
            } catch {
                antMessage.error("Tool execution failed")
            } finally {
                setExecutingId(null)
            }
        },
        [onExecuteAndSendToChat, onUpdateToolResponse, onExecuteToolCall],
    )

    const gatewayPayloads = toolPayloads.filter((p) => isGatewayToolSlug(p.name || ""))
    if (gatewayPayloads.length === 0) return null

    return (
        <div className="flex flex-col gap-1">
            {gatewayPayloads.map((p) => (
                <DropdownButton
                    key={p.callId || p.name}
                    size="sm"
                    icon={<Lightning size={12} />}
                    label="Call tool and send to chat"
                    dropdownIcon={<CaretDown size={12} />}
                    dropdownAriaLabel="More tool actions"
                    loading={executingId === (p.callId || p.name || "default")}
                    onClick={() => handleExecute(p, true)}
                    options={[{key: "call-and-send", label: "Call tool"}]}
                    onOptionSelect={() => handleExecute(p, false)}
                    placement="bottomRight"
                />
            ))}
        </div>
    )
}

export default GatewayToolExecuteButton
