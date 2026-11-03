import {executeToolCall} from "@agenta/entities/gatewayTool"
import {message} from "@agenta/ui/app-message"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    Spinner,
} from "@agenta/ui/ui"
import {CaretDown, Lightning} from "@phosphor-icons/react"

import {
    gatewayToolKey,
    useGatewayToolActions,
    type GatewayToolPayload,
} from "../../hooks/useGatewayToolActions"

export interface GatewayToolActionsProps {
    rowId: string
    entityId: string
    /** The run result of the turn. */
    currentResult?: unknown
    /** Runs the turn, after "Call tool and send to chat". */
    onRun: () => void
}

/**
 * One split button for each gateway tool call of the reply. The main action calls the tool,
 * writes the result into the tool message and runs the turn. The menu item only calls the tool.
 */
export const GatewayToolActions = ({
    rowId,
    entityId,
    currentResult,
    onRun,
}: GatewayToolActionsProps) => {
    const {payloads, execute, executingId} = useGatewayToolActions({
        rowId,
        entityId,
        currentResult,
        onRun,
        onExecuteToolCall: executeToolCall,
    })
    if (payloads.length === 0) return null

    const call = async (payload: GatewayToolPayload, sendToChat: boolean) => {
        const outcome = await execute(payload, sendToChat)
        if (!outcome.ok) message.error("Tool execution failed")
    }

    return (
        <div className="flex flex-col gap-1">
            {payloads.map((payload) => {
                const busy = executingId === gatewayToolKey(payload)
                return (
                    <div key={payload.callId || payload.name} className="inline-flex self-start">
                        <Button
                            variant="outline"
                            size="sm"
                            className="rounded-r-none"
                            disabled={busy}
                            onClick={() => call(payload, true)}
                        >
                            {busy ? <Spinner size="small" /> : <Lightning size={12} />}
                            Call tool and send to chat
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild disabled={busy}>
                                <Button
                                    variant="outline"
                                    size="icon-sm"
                                    className="-ml-px rounded-l-none"
                                    aria-label="Tool options"
                                >
                                    <CaretDown size={12} />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => call(payload, false)}>
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
