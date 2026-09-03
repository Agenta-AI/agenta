/**
 * Which parked `request_input` calls the run is currently blocked on — the sibling of
 * ./connectInteractions, read by the docked question card on both /m and oss.
 *
 * Unlike the connect dock there is no "whole batch" reader here. That one exists to feed progress
 * dots across several cards; the runner parks exactly ONE interaction per turn (a second is
 * force-settled `DEFERRED_NOT_EXECUTED` and re-asked next turn — see `ConnectToolWidget`), so the
 * question dock shows one card and any straggler simply waits behind it.
 */
import {buildRenderMap, isPendingClientToolInteraction} from "@agenta/playground"
import {CLIENT_TOOL_DESCRIPTORS, canonicalClientToolName} from "@agenta/shared/clientTools"
import {hasPriorElicitationDegradation} from "@agenta/shared/utils"
import type {ToolUIPart, UIMessage} from "ai"

import type {ClientToolMeta} from "../skin"

import {clientToolMeta} from "./meta"

/** Whether this client-tool meta is the question form (the registry's two dispatch axes). The name
 * axis is canonicalized: the wire name is `__ag__request_input`, or an MCP-wrapped form of it. */
export const isElicitationInteraction = (meta: ClientToolMeta): boolean =>
    meta.renderKind === "elicitation" ||
    canonicalClientToolName(meta.toolName) === CLIENT_TOOL_DESCRIPTORS.elicitation.toolName

const lastAssistantParts = (messages: UIMessage[]): UIMessage["parts"] => {
    const last = messages[messages.length - 1]
    return !last || last.role !== "assistant" ? [] : (last.parts ?? [])
}

/**
 * The parked question forms the run is blocked on, in the order the agent asked for them. HITL only
 * ever pauses the LAST assistant turn (see `isHitlPending`), so only that turn is read.
 */
export const getPendingElicitationInteractions = (messages: UIMessage[]): ClientToolMeta[] => {
    const parts = lastAssistantParts(messages)
    if (parts.length === 0) return []
    const renderMap = buildRenderMap(parts as {type?: string; data?: unknown}[])
    const pending: ClientToolMeta[] = []
    for (const part of parts) {
        if (!isPendingClientToolInteraction(part as {type?: string; state?: string}, renderMap))
            continue
        const meta = clientToolMeta(part as ToolUIPart, renderMap)
        if (isElicitationInteraction(meta)) pending.push(meta)
    }
    return pending
}

/**
 * Whether an earlier part of this turn already auto-settled as a degradation. The dock must not
 * settle a second malformed payload — that is the settle→resume→re-emit loop the degradation cap
 * exists to break. Derived here rather than threaded down from the host, because the dock already
 * scans exactly these parts.
 */
export const hasEarlierElicitationDegradation = (messages: UIMessage[]): boolean =>
    hasPriorElicitationDegradation(
        lastAssistantParts(messages) as {state?: string; errorText?: string}[],
    )
