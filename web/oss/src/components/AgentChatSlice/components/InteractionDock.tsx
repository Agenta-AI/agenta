/** Persistent shortcut from the composer to a parked connect card in the transcript. */
import {memo, useCallback, useRef} from "react"

import {buildRenderMap, isPendingClientToolInteraction} from "@agenta/playground"
import {CLIENT_TOOL_DESCRIPTORS} from "@agenta/shared/clientTools"
import {ArrowUp, Plugs} from "@phosphor-icons/react"
import type {ToolUIPart, UIMessage} from "ai"
import {Typography} from "antd"

import {clientToolMeta, type ClientToolMeta} from "./clientTools"

const {Text} = Typography

/** Whether this client-tool meta is the connect interaction (registry's two dispatch axes). */
const isConnectInteraction = (meta: ClientToolMeta): boolean =>
    meta.renderKind === CLIENT_TOOL_DESCRIPTORS.connection.renderKind ||
    meta.toolName === CLIENT_TOOL_DESCRIPTORS.connection.toolName

/** The newest parked connect interaction across the transcript, or null. */
export const getPendingConnectInteraction = (messages: UIMessage[]): ClientToolMeta | null => {
    // The shortcut points to the most recent pending connect card.
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
        const message = messages[messageIndex]
        if (message.role !== "assistant") continue
        const parts = message.parts ?? []
        const renderMap = buildRenderMap(parts as {type?: string; data?: unknown}[])
        for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
            const part = parts[partIndex]
            if (!isPendingClientToolInteraction(part as {type?: string; state?: string}, renderMap))
                continue
            const meta = clientToolMeta(part as ToolUIPart, renderMap)
            if (isConnectInteraction(meta)) return meta
        }
    }
    return null
}

interface InteractionDockProps {
    /** The parked connect interaction the run is blocked on (from `getPendingConnectInteraction`). */
    pending: ClientToolMeta | null
    className?: string
}

/**
 * Always mounted; enter + leave animate via the grid-rows 0fr↔1fr height collapse (+ opacity), the
 * same idiom as ApprovalDock. `inert` while closed drops the (clipped, latched) card from tab order
 * + a11y so a keyboard user can't reach the hidden shortcut.
 */
const InteractionDock = ({pending, className}: InteractionDockProps) => {
    const open = !!pending
    // Latch the last pending interaction so the card persists through the height collapse.
    const shownRef = useRef(pending)
    if (pending) shownRef.current = pending
    const shown = shownRef.current
    const toolCallId = shown?.toolCallId
    const scrollToCard = useCallback(() => {
        if (!toolCallId) return
        // Virtualized transcript cards may not be mounted.
        document
            .querySelector(`[data-client-tool-call-id="${CSS.escape(toolCallId)}"]`)
            ?.scrollIntoView({behavior: "smooth", block: "center"})
    }, [toolCallId])

    return (
        <div
            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            } ${className ?? ""}`}
            inert={!open}
        >
            <div className="min-h-0 overflow-hidden">
                {shown ? (
                    <button
                        type="button"
                        onClick={scrollToCard}
                        className="ag-surface-chat mb-2 flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 p-3 text-left transition-colors hover:bg-colorFillTertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-colorPrimary"
                    >
                        <Plugs size={15} weight="fill" className="shrink-0 text-colorPrimary" />
                        <span className="flex min-w-0 flex-col">
                            <Text className="!text-xs !font-medium">
                                The run is waiting for you
                            </Text>
                            <Text type="secondary" className="!text-xs">
                                Go to the connection card above
                            </Text>
                        </span>
                        <ArrowUp size={14} className="ml-auto shrink-0 text-colorTextTertiary" />
                    </button>
                ) : null}
            </div>
        </div>
    )
}

export default memo(InteractionDock)
