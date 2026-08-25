/**
 * Which parked `request_connection` calls the run is currently blocked on.
 *
 * Lifted out of the oss dock so /m and oss read the SAME set. It returns every pending
 * connect on the paused turn, not just the first: a turn can park several browser-fulfilled client
 * tools at once (see `useConnectFlow`'s per-flow popup naming, and the all-settled resume rule in
 * @agenta/playground `agentShouldResumeAfterApproval`), and the dock stacks them.
 */
import {buildRenderMap, isPendingClientToolInteraction} from "@agenta/playground"
import type {ToolUIPart, UIMessage} from "ai"

import type {ClientToolMeta} from "../skin"

import {clientToolMeta} from "./meta"

/** Whether this client-tool meta is the connect interaction (the registry's two dispatch axes). */
const isConnectInteraction = (meta: ClientToolMeta): boolean =>
    meta.renderKind === "connect" || meta.toolName === "request_connection"

/**
 * The parked connect interactions the run is blocked on, in the order the agent asked for them.
 * Like `getPendingApprovals`, HITL only ever pauses the LAST assistant turn (see `isHitlPending`),
 * so only that turn is read.
 */
export const getPendingConnectInteractions = (messages: UIMessage[]): ClientToolMeta[] => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== "assistant") return []
    const parts = last.parts ?? []
    const renderMap = buildRenderMap(parts as {type?: string; data?: unknown}[])
    const pending: ClientToolMeta[] = []
    for (const part of parts) {
        if (!isPendingClientToolInteraction(part as {type?: string; state?: string}, renderMap))
            continue
        const meta = clientToolMeta(part as ToolUIPart, renderMap)
        if (isConnectInteraction(meta)) pending.push(meta)
    }
    return pending
}

/**
 * EVERY connect call on the paused turn — settled ones included — in the order the agent asked.
 * The dock's progress dots need the whole batch in a stable order: the pending set alone loses a
 * connection the moment it settles, and reordering it (the user pulling a card forward) would walk
 * the dots around.
 */
export const getConnectInteractions = (messages: UIMessage[]): ClientToolMeta[] => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== "assistant") return []
    const parts = last.parts ?? []
    const renderMap = buildRenderMap(parts as {type?: string; data?: unknown}[])
    const batch: ClientToolMeta[] = []
    for (const part of parts) {
        const type = (part as {type?: string}).type
        if (typeof type !== "string" || !(type.startsWith("tool-") || type === "dynamic-tool"))
            continue
        const meta = clientToolMeta(part as ToolUIPart, renderMap)
        if (isConnectInteraction(meta)) batch.push(meta)
    }
    return batch
}
