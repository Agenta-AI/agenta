import React, {useCallback, useState} from "react"

import {CaretDown, Lightning} from "@phosphor-icons/react"
import {Dropdown, message as antMessage} from "antd"
import {v4 as uuidv4} from "uuid"

import {executeToolCall} from "@/oss/services/tools/api"

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
            {gatewayPayloads.map((p) => (
                <Dropdown.Button
                    key={p.callId || p.name}
                    size="small"
                    icon={<CaretDown size={12} />}
                    loading={executingId === (p.callId || p.name || "default")}
                    onClick={() => handleExecute(p, true)}
                    menu={{
                        items: [
                            {
                                key: "call-and-send",
                                label: "Call tool",
                            },
                        ],
                        onClick: () => handleExecute(p, false),
                    }}
                >
                    <Lightning size={12} />
                    Call tool and send to chat
                </Dropdown.Button>
            ))}
        </div>
    )
}

export default GatewayToolExecuteButton
