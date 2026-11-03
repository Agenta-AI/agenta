import React, {useCallback} from "react"

import {isGatewayToolSlug} from "@agenta/shared/utils"
import {CaretDown, Lightning} from "@phosphor-icons/react"
import {Dropdown, message as antMessage} from "antd"

import {
    gatewayToolKey,
    type GatewayToolOutcome,
    type GatewayToolPayload,
} from "../../hooks/useGatewayToolActions"

export type GatewayToolPayloadInfo = GatewayToolPayload

interface Props {
    toolPayloads: GatewayToolPayloadInfo[]
    /** Calls the tool and writes its result; `sendToChat` also runs the turn. */
    onExecute: (payload: GatewayToolPayloadInfo, sendToChat: boolean) => Promise<GatewayToolOutcome>
    /** The `gatewayToolKey` of the call that runs now. */
    executingId: string | null
}

const GatewayToolExecuteButton: React.FC<Props> = ({toolPayloads, onExecute, executingId}) => {
    const handleExecute = useCallback(
        async (p: GatewayToolPayloadInfo, sendToChat: boolean) => {
            const outcome = await onExecute(p, sendToChat)
            if (!outcome.ok) antMessage.error("Tool execution failed")
        },
        [onExecute],
    )

    const gatewayPayloads = toolPayloads.filter((p) => isGatewayToolSlug(p.name || ""))
    if (gatewayPayloads.length === 0) return null

    return (
        <div className="flex flex-col gap-1">
            {gatewayPayloads.map((p) => (
                <Dropdown.Button
                    key={p.callId || p.name}
                    size="small"
                    icon={<CaretDown size={12} />}
                    loading={executingId === gatewayToolKey(p)}
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
