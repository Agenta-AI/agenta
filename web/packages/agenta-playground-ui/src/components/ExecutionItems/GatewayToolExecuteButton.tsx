import React, {useCallback, useState} from "react"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {type ToolCall} from "@agenta/shared/types"
import {isGatewayToolSlug} from "@agenta/shared/utils"
import {CaretDown, Lightning} from "@phosphor-icons/react"
import {message as antMessage} from "antd"
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
                <div className="flex" key={p.callId || p.name}>
                    <button
                        type="button"
                        disabled={executingId === (p.callId || p.name || "default")}
                        onClick={() => handleExecute(p, true)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-l-md rounded-r-none border border-input bg-background px-2.5 py-1 text-xs font-medium transition-all hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                    >
                        {executingId === (p.callId || p.name || "default") ? (
                            <Spinner />
                        ) : (
                            <Lightning size={12} />
                        )}
                        Call tool and send to chat
                    </button>
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            disabled={executingId === (p.callId || p.name || "default")}
                            className="inline-flex shrink-0 items-center justify-center rounded-l-none rounded-r-md border border-input bg-background px-1.5 text-xs font-medium transition-all hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                            aria-label="Tool options"
                        >
                            <CaretDown size={12} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" side="bottom" sideOffset={2}>
                            <DropdownMenuItem onClick={() => handleExecute(p, false)}>
                                Call tool
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            ))}
        </div>
    )
}

export default GatewayToolExecuteButton
