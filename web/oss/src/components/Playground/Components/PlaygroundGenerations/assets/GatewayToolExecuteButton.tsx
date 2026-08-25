import React, {useCallback, useState} from "react"

import {executeToolCall} from "@agenta/entities/gatewayTool"
import {message} from "@agenta/ui/app-message"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    LoadingButton,
} from "@agenta/ui/ui"
import {CaretDown, Lightning} from "@phosphor-icons/react"
import {v4 as uuidv4} from "uuid"

// Identity of an in-flight execution. Derived in one place so the primary button and the
// menu item that trigger the same call agree on what "busy" means.
function executionId(p: GatewayToolPayloadInfo): string {
    return p.callId || p.name || "default"
}

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
            const execId = executionId(p)
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
                message.error("Tool execution failed")
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
                // Both halves of the split button drive the SAME call, so they share one
                // in-flight flag: without it the menu item could start a second execution
                // while the primary one is still running and both would write a response
                // back for the same tool call.
                const isExecuting = executingId === executionId(p)

                return (
                    // Split button: the primary click calls AND sends; the caret offers the plain call.
                    <span key={p.callId || p.name} className="inline-flex">
                        <LoadingButton
                            variant="outline"
                            size="sm"
                            loading={isExecuting}
                            onClick={() => handleExecute(p, true)}
                            className="rounded-r-none"
                        >
                            <Lightning size={12} />
                            Call tool and send to chat
                        </LoadingButton>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="icon-sm"
                                    aria-label="Tool call options"
                                    className="-ml-px rounded-l-none"
                                >
                                    <CaretDown size={12} />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                    disabled={isExecuting}
                                    onSelect={() => handleExecute(p, false)}
                                >
                                    Call tool
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </span>
                )
            })}
        </div>
    )
}

export default GatewayToolExecuteButton
