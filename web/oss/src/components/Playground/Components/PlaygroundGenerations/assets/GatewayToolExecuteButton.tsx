import React, {useCallback, useState} from "react"

import {executeToolCall} from "@agenta/entities/gatewayTool"
import {Button} from "@agenta/primitive-ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {CaretDown, Lightning} from "@phosphor-icons/react"
import {message as antMessage} from "antd"
import {v4 as uuidv4} from "uuid"

// Gateway tool function name format: tools__{provider}__{integration}__{action}__{connection}
// Double-underscore is used because LLM providers forbid dots in function names.
// The /tools/call API normalises __ → . before parsing.
// Segments may contain single underscores (e.g. CREATE_EMAIL_DRAFT); only __ is a separator.
function isGatewaySlug(name: string): boolean {
    const parts = name.split("__")
    return parts.length === 5 && parts[0] === "tools" && parts.slice(1).every(Boolean)
}

export interface GatewayToolPayloadInfo {
    name?: string
    callId?: string
    json: string
}

interface Props {
    toolPayloads: GatewayToolPayloadInfo[]
    onUpdateToolResponse: (callId: string | undefined, resultStr: string, toolName?: string) => void
    onExecuteAndSendToChat?: () => void
}

const GatewayToolExecuteButton: React.FC<Props> = ({
    toolPayloads,
    onUpdateToolResponse,
    onExecuteAndSendToChat,
}) => {
    const [executingId, setExecutingId] = useState<string | null>(null)

    const handleExecute = useCallback(
        async (p: GatewayToolPayloadInfo, sendToChat: boolean) => {
            const execId = p.callId || p.name || "default"
            const toolCallId = p.callId || `call_${uuidv4()}`
            setExecutingId(execId)

            try {
                const response = await executeToolCall({
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
        [onExecuteAndSendToChat, onUpdateToolResponse],
    )

    const gatewayPayloads = toolPayloads.filter((p) => isGatewaySlug(p.name || ""))
    if (gatewayPayloads.length === 0) return null

    return (
        <div className="flex flex-col gap-1">
            {gatewayPayloads.map((p) => {
                const execId = p.callId || p.name || "default"
                const isLoading = executingId === execId

                return (
                    <div key={p.callId || p.name} className="flex">
                        <Button
                            variant="outline"
                            size="sm"
                            className="rounded-r-none border-r-0"
                            disabled={isLoading}
                            onClick={() => handleExecute(p, true)}
                        >
                            <Lightning size={12} />
                            Call tool and send to chat
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger className="rounded-l-none border-l-0 inline-flex shrink-0 items-center justify-center rounded-lg border px-1 text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 bg-transparent">
                                <CaretDown size={12} />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <DropdownMenuItem onClick={() => handleExecute(p, false)}>
                                    Call tool
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )
            })}
        </div>
    )
}

export default GatewayToolExecuteButton
